#!/usr/bin/env python3
"""
神探监控机器人 - 引擎 v3.1
架构：纯实时监听 (Pure Real-time Listening)
核心改进：
  1. 废弃公共群组轮询，改为纯 on_message 实时推送监听
  2. 监控范围：
     a. 公共群组（publicGroups）：系统TG账号监控，命中通配所有用户的 globalKeywords
     b. 用户私有群组（monitorGroups）：用户自己的群组，只匹配该用户的关键词
  3. 增加 HTTP 加群接口 /join-group，供后台调用
  4. 关键词匹配：精准匹配，命中后写入对应用户的命中记录
  5. 主控进程：动态管理账号子进程，新增账号自动启动
  v3.1 修复：
  - 公共群组消息现在遍历所有用户的 globalKeywords，命中后写入对应 userId
  - 系统TG账号是公共资源，不依赖账号所属 userId
"""
import asyncio
import json
import logging
import os
import re
import random
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
parser = argparse.ArgumentParser(description="神探监控引擎 v3.1")
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

# ─── 环境变量 ──────────────────────────────────────────────
API_BASE        = os.getenv("WEB_API_BASE", "http://localhost:7000/api")
ENGINE_SECRET   = os.getenv("ENGINE_SECRET", "shentanbot-engine-secret-2026")
POLL_INTERVAL   = int(os.getenv("POLL_INTERVAL", "60"))   # 配置同步间隔（秒）
TG_API_ID       = int(os.getenv("TG_API_ID", "0"))
TG_API_HASH     = os.getenv("TG_API_HASH", "")
SESSIONS_DIR    = os.getenv("SESSIONS_DIR", os.path.join(_BASE_DIR, "sessions"))
HTTP_PORT_BASE  = int(os.getenv("ENGINE_HTTP_PORT_BASE", "7100"))  # 账号 HTTP 服务端口基址，Acc2=7102, Acc3=7103...
os.makedirs(SESSIONS_DIR, exist_ok=True)

# ─── 全局状态 ──────────────────────────────────────────────
_dedup_cache: Dict[str, float] = {}
DEDUP_TTL = 3600
_rate_cache: Dict[str, List[float]] = {}
_monitor_config: Dict[str, Any] = {}
_config_lock = asyncio.Lock()

# ─── Web API 客户端 ────────────────────────────────────────
class ApiClient:
    def __init__(self, base: str, secret: str):
        self.base = base
        self.headers = {"X-Engine-Secret": secret, "Content-Type": "application/json"}

    async def trpc_query(self, procedure: str, timeout: int = 30) -> Optional[dict]:
        import urllib.parse
        input_str = urllib.parse.quote("{\"0\":{\"json\":null}}")
        url = f"{self.base}/trpc/{procedure}?batch=1&input={input_str}"
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=self.headers, timeout=aiohttp.ClientTimeout(total=timeout)) as r:
                    if r.status == 200:
                        data = await r.json()
                        if isinstance(data, list) and len(data) > 0:
                            return data[0].get("result", {}).get("data", {}).get("json")
                    else:
                        logger.warning(f"tRPC {procedure} → HTTP {r.status}")
        except Exception as e:
            logger.warning(f"tRPC {procedure} failed: {e}")
        return None

    async def post(self, path: str, data: dict, timeout: int = 15) -> Optional[dict]:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.base}{path}", headers=self.headers,
                    json=data, timeout=aiohttp.ClientTimeout(total=timeout)
                ) as r:
                    if r.status == 200:
                        return await r.json()
                    else:
                        logger.warning(f"API POST {path} → HTTP {r.status}")
        except Exception as e:
            logger.warning(f"API POST {path} failed: {e}")
        return None

api = ApiClient(API_BASE, ENGINE_SECRET)

# ─── 关键词匹配 ────────────────────────────────────────────
def match_keyword(text: str, keyword: dict, user_match_mode: str = "fuzzy") -> bool:
    if not text: return False
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
        except re.error: return False
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
    if not compare_pattern: return False
    if user_match_mode == "leftmost": return compare_text.lstrip().startswith(compare_pattern)
    elif user_match_mode == "rightmost": return compare_text.rstrip().endswith(compare_pattern)
    elif user_match_mode == "exact":
        escaped = re.escape(compare_pattern)
        return bool(re.search(r'\b' + escaped + r'\b', compare_text))
    else: return compare_pattern in compare_text

def is_dedup(chat_id: int, message_id: int) -> bool:
    key = f"{chat_id}:{message_id}"
    now = time.time()
    # 清理过期缓存
    expired = [k for k, v in _dedup_cache.items() if now - v > DEDUP_TTL]
    for k in expired: del _dedup_cache[k]
    if key in _dedup_cache: return True
    _dedup_cache[key] = now
    return False

def check_rate_limit(sender_id: int, chat_id: int, window: int, limit: int) -> bool:
    if window <= 0 or limit <= 0: return False
    key = f"{sender_id}:{chat_id}"
    now = time.time()
    timestamps = _rate_cache.get(key, [])
    timestamps = [ts for ts in timestamps if now - ts <= window]
    if len(timestamps) >= limit: return True
    timestamps.append(now)
    _rate_cache[key] = timestamps
    return False

# ─── AccountWorker 类 ────────────────────────────────────────
class AccountWorker:
    def __init__(self, account_id: int, phone_number: str, session_string: str):
        self.account_id = account_id
        self.phone_number = phone_number
        self.session_string = session_string
        self.client: Optional[Client] = None
        self._running = False
        self._http_runner = None
        self._http_site = None

    async def start(self):
        if self._running: return
        self._running = True
        logger.info(f"[Account {self.account_id}] 正在启动客户端...")
        try:
            self.client = Client(
                name=f"acc_{self.account_id}",
                api_id=TG_API_ID,
                api_hash=TG_API_HASH,
                session_string=self.session_string,
                workdir=SESSIONS_DIR,
                in_memory=True
            )

            # 注册实时消息监听器（只监听群组消息）
            @self.client.on_message(filters.group)
            async def on_message_handler(client, message):
                await self._process_message(message)

            await self.client.start()
            me = await self.client.get_me()
            logger.info(f"[Account {self.account_id}] 客户端启动成功，TG用户: @{me.username or me.id}")

            # 启动 HTTP 服务（供后台调用加群接口）
            await self._start_http_server()

        except (UserDeactivated, AuthKeyUnregistered, SessionExpired, SessionRevoked, PhoneNumberBanned) as e:
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

    # ─── 实时消息处理（核心逻辑）──────────────────────────────
    async def _process_message(self, message: Message):
        """
        纯实时监听模式 v3.1：
        
        【公共群组模式】系统TG账号是公共资源，监控 publicGroups 中的群组。
        收到消息后，遍历所有用户的 globalKeywords，命中后写入对应用户的命中记录。
        
        【私有群组模式】用户自己的群组（monitorGroups），只匹配该用户的关键词。
        
        这样实现了：一条消息 → 匹配所有用户关键词 → 推送给命中的用户
        """
        if not message or not message.text: return
        if is_dedup(message.chat.id, message.id): return

        text = message.text
        chat_id_int = message.chat.id
        chat_id_str = str(chat_id_int)
        chat_username = message.chat.username or ""

        async with _config_lock:
            config = _monitor_config

        anti_spam = config.get("globalAntiSpam", {})
        user_configs = config.get("userConfigs", {})
        public_groups = config.get("publicGroups", [])

        # 全局过滤：消息长度
        max_len = anti_spam.get("globalMaxMsgLen", 500)
        if max_len > 0 and len(text) > max_len:
            return

        # 全局过滤：机器人消息
        if anti_spam.get("filterBot", True) and message.from_user and message.from_user.is_bot:
            return

        sender_id = message.from_user.id if message.from_user else 0

        # ── 判断当前消息来自哪种群组 ──────────────────────────
        # 公共群组：realId 是带负号的整数字符串，如 "-1001954304332"
        # 也可能通过 username 匹配
        is_public_group = False
        for pg in public_groups:
            if not pg.get("isActive", True):
                continue
            pg_real_id = str(pg.get("realId", ""))
            pg_group_id = str(pg.get("groupId", ""))
            # 通过 realId 匹配（最准确）
            if pg_real_id and pg_real_id == chat_id_str:
                is_public_group = True
                break
            # 通过 username 匹配（备用）
            if pg_group_id and chat_username and pg_group_id.lstrip("@") == chat_username.lstrip("@"):
                is_public_group = True
                break

        if is_public_group:
            # ── 公共群组模式：遍历所有用户的 globalKeywords ──────
            # 系统TG账号是公共资源，命中后写入对应用户的命中记录
            for uid_str, user_cfg in user_configs.items():
                user_id = int(uid_str)
                mode = user_cfg.get("pushSettings", {}).get("keywordMatchMode", "fuzzy")

                # 全局限速检查
                rate_window = anti_spam.get("globalRateWindow", 60)
                rate_limit = anti_spam.get("globalRateLimit", 5)
                if sender_id and check_rate_limit(sender_id, message.chat.id, rate_window, rate_limit):
                    continue

                # 黑名单过滤
                push_settings = user_cfg.get("pushSettings", {})
                if push_settings.get("filterBots", False) and message.from_user and message.from_user.is_bot:
                    continue

                # 遍历该用户的全局关键词
                global_kws = user_cfg.get("globalKeywords", [])
                for kw in global_kws:
                    if not kw.get("isActive", True):
                        continue
                    if not kw.get("pattern"):
                        continue
                    if match_keyword(text, kw, mode):
                        # 命中！写入该用户的命中记录
                        await self._handle_hit(message, kw, user_id, {
                            "groupTitle": message.chat.title or "",
                            "groupId": chat_id_str,
                            "isPublic": True,
                        })
                        # 同一用户在同一消息中只触发一次命中（避免多关键词重复推送）
                        break
        else:
            # ── 私有群组模式：遍历用户的 monitorGroups ──────────
            # 用户自己的群组，只匹配该用户的关键词
            for uid_str, user_cfg in user_configs.items():
                user_id = int(uid_str)
                mode = user_cfg.get("pushSettings", {}).get("keywordMatchMode", "fuzzy")

                # 全局限速检查
                rate_window = anti_spam.get("globalRateWindow", 60)
                rate_limit = anti_spam.get("globalRateLimit", 5)
                if sender_id and check_rate_limit(sender_id, message.chat.id, rate_window, rate_limit):
                    continue

                # 匹配用户的私有监控群组
                for grp in user_cfg.get("groups", []):
                    grp_id = str(grp.get("groupId", ""))
                    grp_username = grp.get("groupUsername", "")
                    if not grp.get("isActive", True): continue
                    # 通过 chat_id 或 username 匹配
                    if grp_id != chat_id_str and grp_username != chat_username:
                        continue
                    # 该群组匹配，检查关键词
                    for kw in grp.get("keywords", []):
                        if not kw.get("isActive", True): continue
                        if not kw.get("pattern"): continue
                        if match_keyword(text, kw, mode):
                            await self._handle_hit(message, kw, user_id, grp)
                            break  # 同一群组只触发一次命中

    async def _handle_hit(self, message: Message, kw: dict, user_id: int, grp: dict):
        """上报命中记录到后台"""
        payload = {
            "userId": user_id,
            "monitorAccountId": self.account_id,
            "tgGroupId": str(message.chat.id),
            "groupName": message.chat.title or grp.get("groupTitle", ""),
            "senderTgId": str(message.from_user.id) if message.from_user else "",
            "senderUsername": message.from_user.username if message.from_user else None,
            "senderName": (
                f"{message.from_user.first_name or ''} {message.from_user.last_name or ''}".strip()
                if message.from_user else None
            ),
            "messageText": message.text,
            "matchedKeywords": [kw.get("pattern", "")],
            "messageId": str(message.id),
        }
        result = await api.post("/trpc/engine.hit?batch=1", {
            "0": {"json": payload}
        })
        # 兼容 tRPC batch 响应格式
        if result:
            hit_data = result[0].get("result", {}).get("data", {}).get("json", {}) if isinstance(result, list) else result
            if hit_data.get("success") or hit_data.get("id"):
                logger.info(f"[Account {self.account_id}] 命中成功: userId={user_id}, keyword={kw.get('pattern')}, group={message.chat.title}")
                return
        logger.warning(f"[Account {self.account_id}] 命中写入失败: userId={user_id}, keyword={kw.get('pattern')}, result={result}")

    # ─── HTTP 服务（加群接口）────────────────────────────────
    async def _start_http_server(self):
        """启动本地 HTTP 服务，供后台调用加群、退群等操作"""
        port = HTTP_PORT_BASE + self.account_id
        app = web.Application()
        app.router.add_post("/join-group", self._http_join_group)
        app.router.add_post("/leave-group", self._http_leave_group)
        app.router.add_get("/status", self._http_status)
        app.router.add_get("/dialogs", self._http_dialogs)

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
                return web.json_response({"success": False, "error": "group 参数不能为空"}, status=400)

            logger.info(f"[Account {self.account_id}] 正在加入群组: {group_input}")

            try:
                # 支持 invite link、username、@username 等格式
                chat = await self.client.join_chat(group_input)
                chat_id = chat.id
                chat_title = chat.title or ""
                chat_username = chat.username or ""
                member_count = getattr(chat, "members_count", None)

                logger.info(f"[Account {self.account_id}] 成功加入群组: {chat_title} ({chat_id})")
                return web.json_response({
                    "success": True,
                    "chatId": str(chat_id),
                    "chatTitle": chat_title,
                    "chatUsername": chat_username,
                    "memberCount": member_count,
                })
            except UserAlreadyParticipant:
                # 已经是成员，获取群组信息返回
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
                    return web.json_response({"success": True, "alreadyJoined": True, "error": str(e2)})
            except FloodWait as e:
                logger.warning(f"[Account {self.account_id}] 加群 FloodWait {e.value}s")
                return web.json_response({"success": False, "error": f"请求过于频繁，请 {e.value} 秒后重试", "floodWait": e.value}, status=429)
            except (InviteHashInvalid, InviteHashExpired):
                return web.json_response({"success": False, "error": "邀请链接无效或已过期"}, status=400)
            except (UsernameNotOccupied, UsernameInvalid):
                return web.json_response({"success": False, "error": "群组用户名不存在或无效"}, status=400)
            except ChannelPrivate:
                return web.json_response({"success": False, "error": "该群组为私有群组，需要邀请链接"}, status=403)
            except Exception as e:
                logger.error(f"[Account {self.account_id}] 加群失败: {e}")
                return web.json_response({"success": False, "error": str(e)}, status=500)

        except Exception as e:
            return web.json_response({"success": False, "error": f"请求解析失败: {e}"}, status=400)

    async def _http_leave_group(self, request: web.Request) -> web.Response:
        """退群接口"""
        try:
            body = await request.json()
            chat_id = body.get("chatId")
            if not chat_id:
                return web.json_response({"success": False, "error": "chatId 不能为空"}, status=400)
            await self.client.leave_chat(int(chat_id))
            logger.info(f"[Account {self.account_id}] 已退出群组: {chat_id}")
            return web.json_response({"success": True})
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    async def _http_status(self, request: web.Request) -> web.Response:
        """状态查询接口"""
        is_connected = self.client and self.client.is_connected
        return web.json_response({
            "accountId": self.account_id,
            "connected": bool(is_connected),
            "running": self._running,
        })

    async def _http_dialogs(self, request: web.Request) -> web.Response:
        """获取账号已加入的群组列表"""
        try:
            groups = []
            async for dialog in self.client.get_dialogs():
                chat = dialog.chat
                if chat.type.value in ("group", "supergroup"):
                    groups.append({
                        "chatId": str(chat.id),
                        "title": chat.title or "",
                        "username": chat.username or "",
                        "memberCount": getattr(chat, "members_count", None),
                    })
            return web.json_response({"success": True, "groups": groups, "count": len(groups)})
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)


# ─── 主控模式 (Master Mode) ──────────────────────────────────
_PM2_SCRIPT = "/home/hjroot/.local/lib/node_modules/pm2/bin/pm2"
_NODE_BIN = "/usr/bin/node"
_PM2_ENV = {
    **os.environ,
    "HOME": "/home/hjroot",
    "PM2_HOME": "/home/hjroot/.pm2",
    "PATH": "/usr/bin:/bin:/home/hjroot/.local/bin",
}

async def master_loop():
    logger.info("神探监控主控模式 v3.1 启动...")
    python_path = "/home/hjroot/shentanbot/engine/venv/bin/python3"
    script_path = "/home/hjroot/shentanbot/engine/main.py"

    # 测试 pm2 是否可用
    test_result = subprocess.run(
        [_NODE_BIN, _PM2_SCRIPT, "--version"],
        capture_output=True, text=True, env=_PM2_ENV
    )
    if test_result.returncode == 0:
        logger.info(f"PM2 可用，版本: {test_result.stdout.strip()}")
    else:
        logger.error(f"PM2 不可用: {test_result.stderr}")

    while True:
        try:
            config = await api.trpc_query("engine.config")
            if config:
                accounts = config.get("accounts", [])

                # 获取当前 PM2 进程列表
                jlist_result = subprocess.run(
                    [_NODE_BIN, _PM2_SCRIPT, "jlist"],
                    capture_output=True, text=True, env=_PM2_ENV
                )
                running_names = set()
                if jlist_result.returncode == 0:
                    try:
                        pm2_procs = json.loads(jlist_result.stdout)
                        running_names = {
                            p.get("name") for p in pm2_procs
                            if p.get("pm2_env", {}).get("status") == "online"
                        }
                        logger.info(f"当前运行中的进程: {running_names}")
                    except Exception as e:
                        logger.warning(f"解析 pm2 jlist 失败: {e}")

                # 检查并启动缺失的账号进程
                for acc in accounts:
                    acc_id = acc.get("id")
                    if not acc_id: continue
                    proc_name = f"神探-引擎-Acc{acc_id}"
                    if proc_name not in running_names:
                        logger.info(f"发现账号 {acc_id} 进程未运行，正在启动: {proc_name}")
                        log_path = f"/home/hjroot/shentanbot/engine/engine-acc{acc_id}.log"
                        start_result = subprocess.run(
                            [_NODE_BIN, _PM2_SCRIPT, "start", python_path,
                             "--name", proc_name,
                             "--log", log_path,
                             "--", script_path, "--account_id", str(acc_id)],
                            capture_output=True, text=True, env=_PM2_ENV
                        )
                        if start_result.returncode == 0:
                            logger.info(f"[Account {acc_id}] 进程启动成功")
                            subprocess.run([_NODE_BIN, _PM2_SCRIPT, "save"], capture_output=True, env=_PM2_ENV)
                        else:
                            logger.error(f"[Account {acc_id}] 进程启动失败: {start_result.stderr}")

            await asyncio.sleep(60)
        except Exception as e:
            logger.error(f"主控循环异常: {e}", exc_info=True)
            await asyncio.sleep(10)


# ─── 入口函数 ────────────────────────────────────────────────
async def main():
    if args.master:
        await master_loop()
    elif args.account_id:
        logger.info(f"[v3.1] 启动账号进程: {args.account_id}（纯实时监听模式，公共群组通配所有用户关键词）")

        # 持续同步配置
        async def config_sync():
            global _monitor_config
            while True:
                cfg = await api.trpc_query("engine.config")
                if cfg:
                    async with _config_lock:
                        _monitor_config = cfg
                    logger.debug(f"[Account {args.account_id}] 配置已同步")
                await asyncio.sleep(POLL_INTERVAL)

        asyncio.create_task(config_sync())
        await asyncio.sleep(3)  # 等待配置加载

        async with _config_lock:
            acc_data = next(
                (a for a in _monitor_config.get("accounts", []) if a["id"] == args.account_id),
                None
            )

        if not acc_data:
            logger.error(f"未找到账号 {args.account_id} 的配置，退出")
            return

        worker = AccountWorker(acc_data["id"], acc_data.get("phone", ""), acc_data["sessionString"])
        await worker.start()

        if worker._running:
            logger.info(f"[Account {args.account_id}] 纯实时监听模式已就绪，等待消息...")
            await idle()
        else:
            logger.error(f"[Account {args.account_id}] 启动失败，退出")
    else:
        parser.print_help()


if __name__ == "__main__":
    asyncio.run(main())
