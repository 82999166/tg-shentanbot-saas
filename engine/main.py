#!/usr/bin/env python3
"""
神探监控机器人 - 引擎 v4.0
架构：统一 REST 接口 + 纯实时监听

核心设计原则：
  1. 零硬编码：所有配置来自环境变量（.env）或数据库（通过 REST API）
  2. 统一 REST：废弃 tRPC 调用，全部使用 /api/engine/* REST 接口
  3. 简化架构：去除「公共群组/私有群组」的区分判断
     - 监控账号（系统TG账号A/B/...N）加入所有要监控的群
     - 收到消息 → 遍历所有用户的关键词 → 命中谁就推送给谁
  4. 配置健壮化：启动时等待配置加载成功，失败有指数退避重试
  5. 消息监听：同时监听 incoming（别人发的）和 outgoing（自己发的）消息

数据流：
  TG群消息 → AccountWorker._process_message()
           → 遍历所有用户的 globalKeywords
           → match_keyword() 命中
           → POST /api/engine/hit 写入命中记录
           → Bot 轮询 tRPC botGetPendingHits 推送给用户
"""
import asyncio
import json
import logging
import os
import re
import time
import argparse
import subprocess
from typing import Optional, Dict, List, Any

from aiohttp import web

try:
    from dotenv import load_dotenv
    _env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    load_dotenv(_env_path, override=True)
except ImportError:
    pass

import aiohttp
from pyrogram import Client, filters, idle
from pyrogram.types import Message
from pyrogram.errors import (
    FloodWait, UserDeactivated, AuthKeyUnregistered,
    SessionExpired, SessionRevoked, PhoneNumberBanned,
    ChannelPrivate, ChatWriteForbidden,
    UsernameNotOccupied, UsernameInvalid, InviteHashInvalid,
    InviteHashExpired, PeerIdInvalid, UserAlreadyParticipant,
    ChannelInvalid
)
import jieba

# ─── 命令行参数 ──────────────────────────────────────────────
parser = argparse.ArgumentParser(description="神探监控引擎 v4.0")
parser.add_argument("--account_id", type=int, help="启动特定账号的监控进程")
parser.add_argument("--master", action="store_true", help="以主控模式启动（负责同步配置和管理进程）")
args = parser.parse_args()

# ─── 日志配置 ──────────────────────────────────────────────
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
log_suffix = f"-acc{args.account_id}" if args.account_id else "-master" if args.master else ""
_LOG_FILE = os.path.join(_BASE_DIR, f"engine{log_suffix}.log")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(_LOG_FILE, encoding="utf-8"),
    ],
)
logger = logging.getLogger(f"shentanbot-engine{log_suffix}")

# ─── 环境变量（全部来自 .env，零硬编码）──────────────────────
API_BASE        = os.getenv("WEB_API_BASE", "http://localhost:7000/api")
ENGINE_SECRET   = os.getenv("ENGINE_SECRET", "")
TG_API_ID       = int(os.getenv("TG_API_ID", "0"))
TG_API_HASH     = os.getenv("TG_API_HASH", "")
SESSIONS_DIR    = os.getenv("SESSIONS_DIR", os.path.join(_BASE_DIR, "sessions"))
HTTP_PORT_BASE  = int(os.getenv("ENGINE_HTTP_PORT_BASE", "7100"))
POLL_INTERVAL   = int(os.getenv("POLL_INTERVAL", "30"))   # 配置同步间隔（秒）
MASTER_CHECK_INTERVAL = int(os.getenv("MASTER_CHECK_INTERVAL", "10"))  # 主控检查间隔（秒）

os.makedirs(SESSIONS_DIR, exist_ok=True)

# ─── 全局状态 ──────────────────────────────────────────────
_dedup_cache: Dict[str, float] = {}
DEDUP_TTL = 3600
_rate_cache: Dict[str, List[float]] = {}
_monitor_config: Dict[str, Any] = {}
_config_lock = asyncio.Lock()

# ─── PM2 路径（从环境变量读取，避免硬编码）──────────────────
_PM2_SCRIPT = os.getenv("PM2_SCRIPT", "/home/hjroot/.local/lib/node_modules/pm2/bin/pm2")
_NODE_BIN   = os.getenv("NODE_BIN", "/usr/bin/node")
_PYTHON_PATH = os.getenv("ENGINE_PYTHON", "/home/hjroot/shentanbot/engine/venv/bin/python3")
_PM2_ENV = {
    **os.environ,
    "HOME": os.getenv("HOME", "/home/hjroot"),
    "PM2_HOME": os.getenv("PM2_HOME", "/home/hjroot/.pm2"),
    "PATH": os.getenv("PATH", "/usr/bin:/bin:/home/hjroot/.local/bin"),
}

# ─── REST API 客户端（统一使用 REST，废弃 tRPC）──────────────
class ApiClient:
    """
    统一 REST API 客户端
    所有接口均通过 /api/engine/* 调用，使用 X-Engine-Secret 鉴权
    """
    def __init__(self, base: str, secret: str):
        self.base = base.rstrip("/")
        self.headers = {
            "X-Engine-Secret": secret,
            "Content-Type": "application/json",
        }

    async def get(self, path: str, timeout: int = 30) -> Optional[dict]:
        """GET 请求"""
        url = f"{self.base}{path}"
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    url, headers=self.headers,
                    timeout=aiohttp.ClientTimeout(total=timeout)
                ) as r:
                    if r.status == 200:
                        return await r.json()
                    else:
                        logger.warning(f"GET {path} → HTTP {r.status}")
        except Exception as e:
            logger.warning(f"GET {path} 失败: {e}")
        return None

    async def post(self, path: str, data: dict, timeout: int = 15) -> Optional[dict]:
        """POST 请求"""
        url = f"{self.base}{path}"
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    url, headers=self.headers,
                    json=data, timeout=aiohttp.ClientTimeout(total=timeout)
                ) as r:
                    if r.status == 200:
                        return await r.json()
                    else:
                        logger.warning(f"POST {path} → HTTP {r.status}")
        except Exception as e:
            logger.warning(f"POST {path} 失败: {e}")
        return None

    async def fetch_config(self) -> Optional[dict]:
        """
        获取完整监控配置（REST 接口）
        返回结构：
        {
          "accounts": [...],
          "userConfigs": { "1": {...}, "5": {...} },
          "globalAntiSpam": {...}
        }
        注意：REST 接口返回的 userConfigs 包含所有有活跃关键词的用户
        """
        return await self.get("/engine/config")

    async def report_hit(self, payload: dict) -> Optional[dict]:
        """
        上报命中记录（REST 接口）
        payload 字段：
          userId, monitorAccountId, tgGroupId, groupName,
          senderTgId, senderUsername, senderName,
          messageText, matchedKeywords, messageId
        """
        return await self.post("/engine/hit", payload)

    async def report_heartbeat(self, data: dict) -> Optional[dict]:
        """上报引擎心跳"""
        return await self.post("/engine/heartbeat", data)


api = ApiClient(API_BASE, ENGINE_SECRET)


# ─── 关键词匹配 ────────────────────────────────────────────
def match_keyword(text: str, keyword: dict, user_match_mode: str = "fuzzy") -> bool:
    """
    关键词匹配函数
    支持 matchType: contains / regex / and / or / not / fuzzy_cn
    user_match_mode: fuzzy / leftmost / rightmost / exact
    """
    if not text:
        return False
    match_type = keyword.get("matchType", "contains")
    pattern = keyword.get("pattern", "")
    sub_keywords = keyword.get("subKeywords", [])
    case_sensitive = keyword.get("caseSensitive", False)

    compare_text = text if case_sensitive else text.lower()
    compare_pattern = pattern if case_sensitive else pattern.lower()

    if match_type == "regex":
        try:
            flags = 0 if case_sensitive else re.IGNORECASE
            return bool(re.search(pattern, text, flags))
        except re.error:
            return False
    elif match_type == "and":
        kws = [k.strip() for k in sub_keywords if k.strip()] or [compare_pattern]
        return all((k if case_sensitive else k.lower()) in compare_text for k in kws)
    elif match_type == "or":
        kws = [k.strip() for k in sub_keywords if k.strip()] or [compare_pattern]
        return any((k if case_sensitive else k.lower()) in compare_text for k in kws)
    elif match_type == "not":
        kws = [k.strip() for k in sub_keywords if k.strip()] or [compare_pattern]
        return all((k if case_sensitive else k.lower()) not in compare_text for k in kws)
    elif match_type == "fuzzy_cn":
        words = jieba.cut(text)
        return compare_pattern in " ".join(words)

    if not compare_pattern:
        return False
    if user_match_mode == "leftmost":
        return compare_text.lstrip().startswith(compare_pattern)
    elif user_match_mode == "rightmost":
        return compare_text.rstrip().endswith(compare_pattern)
    elif user_match_mode == "exact":
        escaped = re.escape(compare_pattern)
        return bool(re.search(r'\b' + escaped + r'\b', compare_text))
    else:
        # fuzzy（默认）：包含匹配
        return compare_pattern in compare_text


def is_dedup(chat_id: int, message_id: int) -> bool:
    """消息去重（防止同一条消息被处理多次）"""
    key = f"{chat_id}:{message_id}"
    now = time.time()
    # 清理过期缓存
    expired = [k for k, v in _dedup_cache.items() if now - v > DEDUP_TTL]
    for k in expired:
        del _dedup_cache[k]
    if key in _dedup_cache:
        return True
    _dedup_cache[key] = now
    return False


def check_rate_limit(sender_id: int, chat_id: int, window: int, limit: int) -> bool:
    """全局限速：同一发送者在 window 秒内超过 limit 条消息则跳过"""
    if window <= 0 or limit <= 0:
        return False
    key = f"{sender_id}:{chat_id}"
    now = time.time()
    timestamps = _rate_cache.get(key, [])
    timestamps = [ts for ts in timestamps if now - ts <= window]
    if len(timestamps) >= limit:
        return True
    timestamps.append(now)
    _rate_cache[key] = timestamps
    return False


# ─── AccountWorker 类 ────────────────────────────────────────
class AccountWorker:
    """
    单个 TG 账号的监控工作进程
    负责：连接 TG、监听群消息、匹配关键词、上报命中
    """

    def __init__(self, account_id: int, phone: str, session_string: str):
        self.account_id = account_id
        self.phone = phone
        self.session_string = session_string
        self.client: Optional[Client] = None
        self._running = False
        self._http_runner: Optional[web.AppRunner] = None
        self._http_site = None

    async def start(self):
        if self._running:
            return
        self._running = True
        logger.info(f"[Account {self.account_id}] 正在启动客户端...")
        try:
            self.client = Client(
                name=f"acc_{self.account_id}",
                api_id=TG_API_ID,
                api_hash=TG_API_HASH,
                session_string=self.session_string,
                workdir=SESSIONS_DIR,
                in_memory=True,
            )

            # 注册实时消息监听器
            # 同时监听 incoming（别人发的）和 outgoing（自己发的）消息
            @self.client.on_message(filters.group & (filters.incoming | filters.outgoing))
            async def on_message_handler(client, message):
                await self._process_message(message)

            await self.client.start()
            me = await self.client.get_me()
            logger.info(
                f"[Account {self.account_id}] 客户端启动成功，"
                f"TG用户: @{me.username or me.id}"
            )

            # ── 全量激活所有群组对话 ──────────────────────────────
            # Pyrogram 默认只推送最近活跃的 ~100 个对话的消息。
            # 通过 get_dialogs(limit=0) 全量拉取，让 TG 服务器知道
            # 客户端关注所有对话，从而推送全部群组的实时消息。
            try:
                group_count = 0
                async for dialog in self.client.get_dialogs(limit=0):
                    if dialog.chat.type.value in ("group", "supergroup", "channel"):
                        group_count += 1
                logger.info(
                    f"[Account {self.account_id}] 全量激活完成，"
                    f"共激活 {group_count} 个群组/频道对话"
                )
            except Exception as e:
                logger.warning(f"[Account {self.account_id}] 全量激活对话失败（不影响运行）: {e}")

            # 启动 HTTP 服务（供后台调用加群/退群/状态查询）
            await self._start_http_server()

        except (UserDeactivated, AuthKeyUnregistered, SessionExpired,
                SessionRevoked, PhoneNumberBanned) as e:
            logger.error(f"[Account {self.account_id}] 账号异常，需要重新登录: {e}")
            self._running = False
        except Exception as e:
            logger.error(f"[Account {self.account_id}] 启动失败: {e}", exc_info=True)
            self._running = False

    async def stop(self):
        self._running = False
        if self._http_runner:
            await self._http_runner.cleanup()
        if self.client:
            try:
                await self.client.stop()
            except Exception:
                pass
        logger.info(f"[Account {self.account_id}] 客户端已停止")

    # ─── 核心消息处理逻辑 ──────────────────────────────────────
    async def _process_message(self, message: Message):
        """
        消息处理核心：
        收到任意群消息 → 遍历所有用户的 globalKeywords → 命中推送给对应用户

        架构说明：
        - 不区分「公共群组/私有群组」，所有监控账号加入的群都统一处理
        - 每条消息对所有用户的关键词做全量匹配
        - 同一用户在同一条消息中只触发一次命中（避免多关键词重复推送）
        """
        if not message or not message.text:
            logger.debug("消息被过滤: 无文本内容")
            return

        # 去重检查
        if is_dedup(message.chat.id, message.id):
            return

        text = str(message.text or "")
        chat_id_str = str(message.chat.id)
        logger.info(
            f"[Account {self.account_id}] [MSG] "
            f"chat={message.chat.title!r}({chat_id_str}), "
            f"text={text[:50]!r}"
        )

        # 读取当前配置（加锁保证线程安全）
        async with _config_lock:
            config = dict(_monitor_config)

        if not config:
            logger.warning(f"[Account {self.account_id}] 配置未加载，跳过消息处理")
            return

        anti_spam = config.get("globalAntiSpam", {})
        user_configs = config.get("userConfigs", {})

        # 全局过滤：消息长度上限
        max_len = anti_spam.get("globalMaxMsgLen", 0)
        if max_len > 0 and len(text) > max_len:
            logger.debug(f"消息被过滤: 长度 {len(text)} > {max_len}")
            return

        # 全局过滤：机器人消息
        if anti_spam.get("filterBot", True) and message.from_user and message.from_user.is_bot:
            logger.debug("消息被过滤: 机器人消息")
            return

        sender_id = message.from_user.id if message.from_user else 0

        # 遍历所有用户，匹配各自的关键词
        for uid_str, user_cfg in user_configs.items():
            user_id = int(uid_str)
            push_settings = user_cfg.get("pushSettings", {})
            mode = push_settings.get("keywordMatchMode", "fuzzy")

            # 用户级别：过滤机器人消息
            if push_settings.get("filterBots", False) and message.from_user and message.from_user.is_bot:
                continue

            # 全局限速检查（按发送者+群组）
            rate_window = anti_spam.get("globalRateWindow", 60)
            rate_limit = anti_spam.get("globalRateLimit", 5)
            if sender_id and check_rate_limit(sender_id, message.chat.id, rate_window, rate_limit):
                continue

            # 遍历该用户的全局关键词
            global_kws = user_cfg.get("globalKeywords", [])
            for kw in global_kws:
                if not kw.get("isActive", True):
                    continue
                if not kw.get("pattern"):
                    continue
                if match_keyword(text, kw, mode):
                    # 命中！上报到后台
                    await self._handle_hit(message, kw, user_id)
                    # 同一用户在同一条消息中只触发一次（避免多关键词重复推送）
                    break

    async def _handle_hit(self, message: Message, kw: dict, user_id: int):
        """
        上报命中记录到后台（REST 接口）
        使用 /api/engine/hit，服务端自动解析 tgGroupId → monitorGroupId
        """
        sender = message.from_user
        payload = {
            "userId": user_id,
            "monitorAccountId": self.account_id,
            "tgGroupId": (lambda cid: f"-100{abs(cid)}" if cid < -1000000000 and not str(cid).startswith("-100") else str(cid))(message.chat.id),
            "groupName": message.chat.title or "",
            "senderTgId": str(sender.id) if sender else "",
            "senderUsername": sender.username if sender else None,
            "senderName": (
                f"{sender.first_name or ''} {sender.last_name or ''}".strip()
                if sender else None
            ),
            "messageText": str(message.text or ""),
            "matchedKeywords": [kw.get("pattern", "")],
            "messageId": str(message.id),
        }
        result = await api.report_hit(payload)
        if result and (result.get("success") or result.get("id")):
            logger.info(
                f"[Account {self.account_id}] 命中成功: "
                f"userId={user_id}, keyword={kw.get('pattern')!r}, "
                f"group={message.chat.title!r}"
            )
        else:
            logger.warning(
                f"[Account {self.account_id}] 命中写入失败: "
                f"userId={user_id}, keyword={kw.get('pattern')!r}, result={result}"
            )

    # ─── HTTP 服务（加群/退群/状态查询）──────────────────────
    async def _start_http_server(self):
        """启动本地 HTTP 服务，供后台调用加群、退群等操作"""
        port = HTTP_PORT_BASE + self.account_id
        app = web.Application()
        app.router.add_post("/join-group", self._http_join_group)
        app.router.add_post("/leave-group", self._http_leave_group)
        app.router.add_post("/scrape-members", self._http_scrape_members)
        app.router.add_post("/scrape-links", self._http_scrape_links)
        app.router.add_get("/status", self._http_status)
        app.router.add_get("/dialogs", self._http_dialogs)
        app.router.add_post("/check-group-health", self._http_check_group_health)
        self._http_runner = web.AppRunner(app)
        await self._http_runner.setup()
        self._http_site = web.TCPSite(self._http_runner, "127.0.0.1", port)
        await self._http_site.start()
        logger.info(f"[Account {self.account_id}] HTTP 服务已启动，端口: {port}")

    async def _http_join_group(self, request: web.Request) -> web.Response:
        """
        加群接口
        POST /join-group
        Body: {"group": "@username 或 https://t.me/xxx 或 invite_link"}
        """
        try:
            body = await request.json()
            group_input = body.get("group", "").strip()
            if not group_input:
                return web.json_response(
                    {"success": False, "error": "group 参数不能为空"}, status=400
                )
            logger.info(f"[Account {self.account_id}] 正在加入群组: {group_input}")
            try:
                chat = await self.client.join_chat(group_input)
                chat_id = chat.id
                chat_title = chat.title or ""
                chat_username = chat.username or ""
                member_count = getattr(chat, "members_count", None)
                logger.info(
                    f"[Account {self.account_id}] 成功加入群组: "
                    f"{chat_title} ({chat_id})"
                )
                return web.json_response({
                    "success": True,
                    "chatId": str(chat_id),
                    "chatTitle": chat_title,
                    "chatUsername": chat_username,
                    "memberCount": member_count,
                })
            except UserAlreadyParticipant:
                try:
                    chat = await self.client.get_chat(group_input)
                    return web.json_response({
                        "success": True,
                        "alreadyJoined": True,
                        "chatId": str(chat.id),
                        "chatTitle": chat.title or "",
                        "chatUsername": chat.username or "",
                        "memberCount": getattr(chat, "members_count", None),
                    })
                except Exception as e2:
                    return web.json_response(
                        {"success": True, "alreadyJoined": True, "error": str(e2)}
                    )
            except FloodWait as e:
                logger.warning(
                    f"[Account {self.account_id}] 加群 FloodWait {e.value}s"
                )
                return web.json_response(
                    {
                        "success": False,
                        "error": f"请求过于频繁，请 {e.value} 秒后重试",
                        "floodWait": e.value,
                    },
                    status=429,
                )
            except (InviteHashInvalid, InviteHashExpired):
                return web.json_response(
                    {"success": False, "error": "邀请链接无效或已过期"}, status=400
                )
            except (UsernameNotOccupied, UsernameInvalid):
                return web.json_response(
                    {"success": False, "error": "群组用户名不存在或无效"}, status=400
                )
            except ChannelPrivate:
                return web.json_response(
                    {"success": False, "error": "该群组为私有群组，需要邀请链接"},
                    status=403,
                )
            except Exception as e:
                logger.error(f"[Account {self.account_id}] 加群失败: {e}")
                return web.json_response(
                    {"success": False, "error": str(e)}, status=500
                )
        except Exception as e:
            return web.json_response(
                {"success": False, "error": f"请求解析失败: {e}"}, status=400
            )


    async def _http_scrape_members(self, request: web.Request) -> web.Response:
        """
        POST /scrape-members
        通过扫描群组历史消息，提取发送者用户信息（突破成员列表 API 限制）
        Body: {
            "group": "@username or -100xxx",
            "limit": 500,          # 最多采集多少条消息（每条消息提取1个用户）
            "msg_limit": 2000      # 扫描多少条历史消息（越多越慢但用户越多）
        }
        Returns: { "success": true, "members": [...], "total": N }
        """
        try:
            body = await request.json()
            group_id = body.get("group", "").strip()
            user_limit = int(body.get("limit", 500))       # 最多采集用户数
            msg_limit = int(body.get("msg_limit", 3000))   # 扫描消息数
            if not group_id:
                return web.json_response({"success": False, "error": "group 不能为空"}, status=400)
            if not self.client or not self.client.is_connected:
                return web.json_response({"success": False, "error": "账号未连接"}, status=503)

            logger.info(
                f"[Account {self.account_id}] 开始从消息历史采集用户: {group_id}, "
                f"user_limit={user_limit}, msg_limit={msg_limit}"
            )

            members = []
            seen_ids = set()

            def add_user(user):
                """添加用户到结果集，自动去重"""
                if not user or user.is_deleted:
                    return
                uid = str(user.id)
                if uid in seen_ids:
                    return
                seen_ids.add(uid)
                members.append({
                    "tgId": uid,
                    "username": user.username or "",
                    "displayName": (
                        (user.first_name or "")
                        + (" " + user.last_name if user.last_name else "")
                    ).strip(),
                    "isBot": bool(user.is_bot),
                    "isPremium": bool(getattr(user, "is_premium", False)),
                })

            try:
                msg_count = 0
                async for msg in self.client.get_chat_history(group_id, limit=msg_limit):
                    msg_count += 1
                    if len(members) >= user_limit:
                        break

                    # 提取消息发送者
                    if msg.from_user:
                        add_user(msg.from_user)

                    # 提取转发来源用户
                    if msg.forward_from:
                        add_user(msg.forward_from)

                    # 提取回复对象（被回复的消息发送者）
                    if msg.reply_to_message and msg.reply_to_message.from_user:
                        add_user(msg.reply_to_message.from_user)

                    # 每扫描 200 条消息打一次日志
                    if msg_count % 200 == 0:
                        logger.info(
                            f"[Account {self.account_id}] 已扫描 {msg_count} 条消息，"
                            f"提取到 {len(members)} 个用户"
                        )

            except FloodWait as e:
                if members:
                    logger.warning(
                        f"[Account {self.account_id}] FloodWait {e.value}s，"
                        f"返回已采集 {len(members)} 人"
                    )
                else:
                    return web.json_response(
                        {"success": False, "error": f"FloodWait {e.value}s", "floodWait": e.value},
                        status=429,
                    )
            except Exception as e:
                if members:
                    logger.warning(
                        f"[Account {self.account_id}] 采集异常但已有数据: {e}"
                    )
                else:
                    return web.json_response(
                        {"success": False, "error": str(e)}, status=500
                    )

            logger.info(
                f"[Account {self.account_id}] 消息历史采集完成: {group_id}, "
                f"扫描 {msg_count} 条消息，共提取 {len(members)} 个用户"
            )
            return web.json_response({
                "success": True,
                "members": members,
                "total": len(members),
                "scannedMessages": msg_count,
            })
        except Exception as e:
            return web.json_response(
                {"success": False, "error": f"请求解析失败: {e}"}, status=400
            )

    async def _http_scrape_links(self, request: web.Request) -> web.Response:
        """
        POST /scrape-links
        扫描指定群组近期消息，提取群组/频道链接
        Body: { "group": "@username or -100xxx", "limit": 200, "types": ["group","channel"] }
        Returns: { "success": true, "groups": [...], "channels": [...] }
        """
        try:
            body = await request.json()
            group_id = body.get("group", "").strip()
            limit = int(body.get("limit", 200))
            types = body.get("types", ["group", "channel"])
            if not group_id:
                return web.json_response({"success": False, "error": "group 不能为空"}, status=400)
            if not self.client or not self.client.is_connected:
                return web.json_response({"success": False, "error": "账号未连接"}, status=503)

            import re
            tg_link_pattern = re.compile(
                r"(?:https?://)?t\.me/(?:joinchat/|\+)?([a-zA-Z0-9_\-]{4,})"
            )

            logger.info(f"[Account {self.account_id}] 开始扫描群组链接: {group_id}, limit={limit}")
            found_usernames = set()
            results = []

            try:
                count = 0
                async for msg in self.client.get_chat_history(group_id, limit=limit):
                    count += 1
                    text = msg.text or msg.caption or ""
                    # 提取消息中的 t.me 链接
                    for match in tg_link_pattern.finditer(text):
                        username = match.group(1)
                        if username.lower() in ("joinchat", "addstickers", "share", "msg") or len(username) < 4:
                            continue
                        if username in found_usernames:
                            continue
                        found_usernames.add(username)
                        # 尝试获取群组/频道信息
                        try:
                            chat = await self.client.get_chat(username)
                            chat_type = str(chat.type).lower()
                            is_channel = "channel" in chat_type
                            is_group = "group" in chat_type or "supergroup" in chat_type
                            if is_channel and "channel" in types:
                                results.append({
                                    "type": "channel",
                                    "tgId": str(chat.id),
                                    "username": chat.username or "",
                                    "title": chat.title or "",
                                    "memberCount": getattr(chat, "members_count", 0) or 0,
                                    "description": getattr(chat, "description", "") or "",
                                })
                            elif is_group and "group" in types:
                                results.append({
                                    "type": "group",
                                    "tgId": str(chat.id),
                                    "username": chat.username or "",
                                    "title": chat.title or "",
                                    "memberCount": getattr(chat, "members_count", 0) or 0,
                                    "description": getattr(chat, "description", "") or "",
                                })
                        except Exception:
                            pass
            except FloodWait as e:
                return web.json_response({"success": False, "error": f"FloodWait {e.value}s", "floodWait": e.value}, status=429)
            except Exception as e:
                return web.json_response({"success": False, "error": str(e)}, status=500)

            logger.info(f"[Account {self.account_id}] 扫描链接完成: {group_id}, 共 {len(results)} 个")
            return web.json_response({"success": True, "results": results, "total": len(results)})
        except Exception as e:
            return web.json_response({"success": False, "error": f"请求解析失败: {e}"}, status=400)

    async def _http_leave_group(self, request: web.Request) -> web.Response:
        """退群接口"""
        try:
            body = await request.json()
            chat_id = body.get("chatId")
            if not chat_id:
                return web.json_response(
                    {"success": False, "error": "chatId 不能为空"}, status=400
                )
            await self.client.leave_chat(int(chat_id))
            logger.info(f"[Account {self.account_id}] 已退出群组: {chat_id}")
            return web.json_response({"success": True})
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    async def _http_status(self, request: web.Request) -> web.Response:
        """状态查询接口"""
        is_connected = self.client and self.client.is_connected
        async with _config_lock:
            cfg = dict(_monitor_config)
        return web.json_response({
            "accountId": self.account_id,
            "connected": bool(is_connected),
            "running": self._running,
            "configLoaded": bool(cfg),
            "userCount": len(cfg.get("userConfigs", {})),
            "version": "v4.0",
        })

    async def _http_dialogs(self, request: web.Request) -> web.Response:
        """获取账号已加入的群组/频道列表"""
        try:
            groups = []
            async for dialog in self.client.get_dialogs():
                chat = dialog.chat
                # 包含 group、supergroup、channel 三种类型
                if chat.type.value in ("group", "supergroup", "channel"):
                    # Pyrogram 中群组用 members_count，频道用 participants_count
                    member_count = (
                        getattr(chat, "members_count", None)
                        or getattr(chat, "participants_count", None)
                    )
                    groups.append({
                        "chatId": str(chat.id),
                        "title": chat.title or "",
                        "username": chat.username or "",
                        "memberCount": member_count,
                        "type": chat.type.value,
                    })
            return web.json_response({
                "success": True,
                "groups": groups,
                "count": len(groups),
            })
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    async def _http_check_group_health(self, request: web.Request) -> web.Response:
        """检测群组健康状态（是否被 Telegram 标记为违规/屏蔽）"""
        try:
            body = await request.json()
            group_ids = body.get("group_ids", [])
            if not group_ids:
                return web.json_response({"success": False, "error": "group_ids 不能为空"}, status=400)

            normal = []
            abnormal = []

            for gid in group_ids:
                try:
                    # 尝试用 username 或数字 ID 获取群组信息
                    try:
                        chat_id = int(gid) if gid.lstrip('-').isdigit() else gid
                    except Exception:
                        chat_id = gid

                    chat = await self.client.get_chat(chat_id)

                    # 检测异常标志
                    is_scam = getattr(chat, 'is_scam', False) or False
                    is_fake = getattr(chat, 'is_fake', False) or False
                    is_restricted = getattr(chat, 'is_restricted', False) or False
                    restrictions = getattr(chat, 'restrictions', None) or []
                    restriction_reason = ""
                    if restrictions:
                        reasons = [getattr(r, 'reason', '') or '' for r in restrictions]
                        restriction_reason = "; ".join(r for r in reasons if r)

                    group_info = {
                        "groupId": str(gid),
                        "title": chat.title or str(gid),
                        "username": chat.username or "",
                        "memberCount": getattr(chat, 'members_count', 0) or 0,
                    }

                    if is_scam or is_fake or is_restricted or restriction_reason:
                        reason_parts = []
                        if is_scam:
                            reason_parts.append("诈骗群组")
                        if is_fake:
                            reason_parts.append("虚假群组")
                        if restriction_reason:
                            reason_parts.append(f"内容受限: {restriction_reason}")
                        elif is_restricted:
                            reason_parts.append("内容受限")
                        group_info["reason"] = " / ".join(reason_parts)
                        abnormal.append(group_info)
                    else:
                        normal.append(group_info)

                except Exception as e:
                    err_msg = str(e).lower()
                    # 无法访问的群组也标记为异常
                    if any(kw in err_msg for kw in ['not found', 'invalid', 'forbidden', 'banned', 'restricted', 'username']):
                        abnormal.append({
                            "groupId": str(gid),
                            "title": str(gid),
                            "username": "",
                            "memberCount": 0,
                            "reason": f"无法访问: {str(e)[:100]}",
                        })
                    else:
                        # 其他错误（网络等）跳过
                        normal.append({
                            "groupId": str(gid),
                            "title": str(gid),
                            "username": "",
                            "memberCount": 0,
                        })

            return web.json_response({
                "success": True,
                "normal": normal,
                "abnormal": abnormal,
                "normalCount": len(normal),
                "abnormalCount": len(abnormal),
                "totalChecked": len(group_ids),
            })
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)


# ─── 主控模式 (Master Mode) ──────────────────────────────────
async def master_loop():
    """
    主控进程：
    - 定期从 REST API 获取账号列表
    - 自动启动/停止对应的 PM2 子进程
    - 上报心跳到后台
    """
    logger.info("神探监控主控模式 v4.0 启动...")
    script_path = os.path.abspath(__file__)

    # 验证 PM2 可用性
    test_result = subprocess.run(
        [_NODE_BIN, _PM2_SCRIPT, "--version"],
        capture_output=True, text=True, env=_PM2_ENV,
    )
    if test_result.returncode == 0:
        logger.info(f"PM2 可用，版本: {test_result.stdout.strip()}")
    else:
        logger.error(f"PM2 不可用: {test_result.stderr}")

    while True:
        try:
            # 从 REST API 获取账号列表
            config = await api.fetch_config()
            if config:
                accounts = config.get("accounts", [])
                user_count = len(config.get("userConfigs", {}))

                # 上报心跳
                await api.report_heartbeat({
                    "timestamp": int(time.time() * 1000),
                    "activeAccounts": len(accounts),
                    "userCount": user_count,
                    "version": "v4.0",
                })

                # 获取当前 PM2 进程列表
                jlist_result = subprocess.run(
                    [_NODE_BIN, _PM2_SCRIPT, "jlist"],
                    capture_output=True, text=True, env=_PM2_ENV,
                )
                running_names: set = set()
                if jlist_result.returncode == 0:
                    try:
                        pm2_procs = json.loads(jlist_result.stdout)
                        running_names = {
                            p.get("name")
                            for p in pm2_procs
                            if p.get("pm2_env", {}).get("status") == "online"
                        }
                        logger.info(f"当前运行中的进程: {running_names}")
                    except Exception as e:
                        logger.warning(f"解析 pm2 jlist 失败: {e}")

                # 期望运行的进程名集合
                expected_names = {
                    f"神探-引擎-Acc{acc.get('id')}"
                    for acc in accounts
                    if acc.get("id")
                }

                # 停止已删除账号的多余进程
                for proc_name in list(running_names):
                    if (
                        proc_name.startswith("神探-引擎-Acc")
                        and proc_name not in expected_names
                    ):
                        logger.info(
                            f"发现多余进程 {proc_name}（账号已删除），正在停止..."
                        )
                        subprocess.run(
                            [_NODE_BIN, _PM2_SCRIPT, "delete", proc_name],
                            capture_output=True, text=True, env=_PM2_ENV,
                        )
                        subprocess.run(
                            [_NODE_BIN, _PM2_SCRIPT, "save"],
                            capture_output=True, env=_PM2_ENV,
                        )
                        logger.info(f"已停止并删除进程: {proc_name}")

                # 启动缺失的账号进程
                for acc in accounts:
                    acc_id = acc.get("id")
                    if not acc_id:
                        continue
                    proc_name = f"神探-引擎-Acc{acc_id}"
                    if proc_name not in running_names:
                        logger.info(
                            f"发现账号 {acc_id} 进程未运行，正在启动: {proc_name}"
                        )
                        log_path = os.path.join(
                            _BASE_DIR, f"engine-acc{acc_id}.log"
                        )
                        start_result = subprocess.run(
                            [
                                _NODE_BIN, _PM2_SCRIPT, "start", _PYTHON_PATH,
                                "--name", proc_name,
                                "--log", log_path,
                                "--", script_path, "--account_id", str(acc_id),
                            ],
                            capture_output=True, text=True, env=_PM2_ENV,
                        )
                        if start_result.returncode == 0:
                            logger.info(f"[Account {acc_id}] 进程启动成功")
                            subprocess.run(
                                [_NODE_BIN, _PM2_SCRIPT, "save"],
                                capture_output=True, env=_PM2_ENV,
                            )
                        else:
                            logger.error(
                                f"[Account {acc_id}] 进程启动失败: "
                                f"{start_result.stderr}"
                            )
            else:
                logger.warning("主控：获取配置失败，跳过本轮检查")

            await asyncio.sleep(MASTER_CHECK_INTERVAL)

        except Exception as e:
            logger.error(f"主控循环异常: {e}", exc_info=True)
            await asyncio.sleep(5)


# ─── 账号进程入口 ────────────────────────────────────────────
async def account_worker_main(account_id: int):
    """
    账号子进程入口：
    1. 持续同步配置（REST API，指数退避重试）
    2. 等待配置加载成功后启动 AccountWorker
    3. 进入 idle 等待消息
    """
    logger.info(f"[v4.0] 启动账号进程: {account_id}")

    # 配置同步任务（后台持续运行）
    async def config_sync():
        global _monitor_config
        retry_count = 0
        while True:
            try:
                cfg = await api.fetch_config()
                if cfg:
                    async with _config_lock:
                        _monitor_config = cfg
                    user_count = len(cfg.get("userConfigs", {}))
                    logger.debug(
                        f"[Account {account_id}] 配置已同步 "
                        f"（用户数: {user_count}）"
                    )
                    retry_count = 0
                    await asyncio.sleep(POLL_INTERVAL)
                else:
                    retry_count += 1
                    wait_time = min(5 * retry_count, 60)
                    logger.warning(
                        f"[Account {account_id}] 配置同步失败（第{retry_count}次），"
                        f"{wait_time}秒后重试"
                    )
                    await asyncio.sleep(wait_time)
            except Exception as e:
                retry_count += 1
                wait_time = min(5 * retry_count, 60)
                logger.error(
                    f"[Account {account_id}] 配置同步异常: {e}，"
                    f"{wait_time}秒后重试"
                )
                await asyncio.sleep(wait_time)

    # 启动配置同步任务
    asyncio.create_task(config_sync())

    # 等待配置首次加载（最多等待 60 秒）
    logger.info(f"[Account {account_id}] 等待配置加载...")
    for i in range(12):  # 最多等 60 秒（每次 5 秒）
        await asyncio.sleep(5)
        async with _config_lock:
            cfg = dict(_monitor_config)
        if cfg:
            logger.info(f"[Account {account_id}] 配置加载成功")
            break
        logger.info(f"[Account {account_id}] 等待配置中... ({(i+1)*5}s)")
    else:
        logger.error(f"[Account {account_id}] 配置加载超时（60秒），退出")
        return

    # 从配置中找到本账号信息
    async with _config_lock:
        cfg = dict(_monitor_config)

    acc_data = next(
        (a for a in cfg.get("accounts", []) if a["id"] == account_id),
        None,
    )
    if not acc_data:
        logger.error(f"未找到账号 {account_id} 的配置，退出")
        return

    # 启动 AccountWorker
    worker = AccountWorker(
        acc_data["id"],
        acc_data.get("phone", ""),
        acc_data["sessionString"],
    )
    await worker.start()

    if worker._running:
        logger.info(
            f"[Account {account_id}] 监听模式已就绪，等待消息..."
        )
        await idle()
    else:
        logger.error(f"[Account {account_id}] 启动失败，退出")


# ─── 入口函数 ────────────────────────────────────────────────
async def main():
    if args.master:
        await master_loop()
    elif args.account_id:
        await account_worker_main(args.account_id)
    else:
        parser.print_help()


if __name__ == "__main__":
    asyncio.run(main())
