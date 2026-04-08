#!/usr/bin/env python3
"""
神探监控机器人 - Pyrofork 监控引擎 v1.0
基于 Pyrofork (MTProto) 重写，彻底解决 TDLib 的消息漏抓问题

核心改进：
  1. 使用 MTProto 原生 updates 流，无需 openChat 预热，重启即监控
  2. 支持所有消息类型：普通用户、匿名管理员、频道身份发言、Bot 消息
  3. 消息去重基于 (chat_id, message_id) 精确去重，跨账号不重复推送
  4. 关键词匹配：支持模糊/精确/正则/AND/OR/NOT 多种模式
  5. 多账号并发：每个账号独立 Pyrofork Client，互不影响
  6. 自动重连：Pyrofork 内置断线重连，无需手动管理
"""
import asyncio
import json
import logging
import os
import re
import random
import time
import hashlib
from datetime import datetime, timedelta
from typing import Optional, Dict, List, Any

try:
    from dotenv import load_dotenv
    _env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    load_dotenv(_env_path, override=True)
except ImportError:
    pass

import aiohttp
from pyrogram import Client, filters, idle
from pyrogram.types import Message, User, Chat
from pyrogram.errors import (
    FloodWait, UserDeactivated, AuthKeyUnregistered,
    SessionExpired, SessionRevoked, PhoneNumberBanned,
    ChannelPrivate, ChatWriteForbidden
)

# ─── 日志配置 ──────────────────────────────────────────────
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_LOG_FILE = os.path.join(_BASE_DIR, "engine.log")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(_LOG_FILE, encoding="utf-8"),
    ],
)
logger = logging.getLogger("shentanbot-engine")

# ─── 环境变量 ──────────────────────────────────────────────
API_BASE        = os.getenv("WEB_API_BASE", "http://localhost:7000/api")
ENGINE_SECRET   = os.getenv("ENGINE_SECRET", "shentanbot-engine-secret-2026")
POLL_INTERVAL   = int(os.getenv("POLL_INTERVAL", "30"))
TG_API_ID       = int(os.getenv("TG_API_ID", "0"))
TG_API_HASH     = os.getenv("TG_API_HASH", "")
SESSIONS_DIR    = os.getenv("SESSIONS_DIR", os.path.join(_BASE_DIR, "sessions"))
os.makedirs(SESSIONS_DIR, exist_ok=True)

# ─── 全局状态 ──────────────────────────────────────────────
# 消息去重缓存：{(chat_id, message_id): timestamp}，防止多账号重复推送
_dedup_cache: Dict[str, float] = {}
DEDUP_TTL = 3600  # 1小时内同一条消息只推送一次

# 防刷屏缓存：{sender_id: [timestamps]}
_rate_cache: Dict[str, List[float]] = {}

# 全局监控配置（定时从 Web API 拉取）
_monitor_config: Dict[str, Any] = {
    "accounts": [],
    "userConfigs": {},
    "publicGroups": [],
    "publicGroupRealIds": {},
    "antiSpam": {
        "filterBot": True,
        "filterAds": False,
        "globalRateWindow": 0,
        "globalRateLimit": 0,
        "globalMaxMsgLen": 0,
    },
    "joinConfig": {
        "joinEnabled": True,
        "joinIntervalMin": 30,
        "joinIntervalMax": 60,
        "maxGroupsPerAccount": 200,
    },
}

# 活跃的 Pyrofork 客户端：{account_id: AccountWorker}
_active_workers: Dict[int, "AccountWorker"] = {}

# asyncio 锁
_process_lock: Optional[asyncio.Lock] = None
_config_lock: Optional[asyncio.Lock] = None

# ─── Web API 客户端 ────────────────────────────────────────
class ApiClient:
    def __init__(self, base: str, secret: str):
        self.base = base
        self.headers = {
            "X-Engine-Secret": secret,
            "Content-Type": "application/json"
        }

    async def get(self, path: str, timeout: int = 15) -> Optional[dict]:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{self.base}{path}",
                    headers=self.headers,
                    timeout=aiohttp.ClientTimeout(total=timeout)
                ) as r:
                    if r.status == 200:
                        return await r.json()
                    else:
                        logger.warning(f"API GET {path} → HTTP {r.status}")
        except asyncio.TimeoutError:
            logger.warning(f"API GET {path} timeout")
        except Exception as e:
            logger.warning(f"API GET {path} failed: {e}")
        return None

    async def post(self, path: str, data: dict, timeout: int = 15) -> Optional[dict]:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.base}{path}",
                    headers=self.headers,
                    json=data,
                    timeout=aiohttp.ClientTimeout(total=timeout)
                ) as r:
                    if r.status == 200:
                        return await r.json()
                    else:
                        logger.warning(f"API POST {path} → HTTP {r.status}")
        except asyncio.TimeoutError:
            logger.warning(f"API POST {path} timeout")
        except Exception as e:
            logger.warning(f"API POST {path} failed: {e}")
        return None


api = ApiClient(API_BASE, ENGINE_SECRET)


# ─── 关键词匹配 ────────────────────────────────────────────
def match_keyword(text: str, keyword: dict, user_match_mode: str = "fuzzy") -> bool:
    """
    关键词匹配函数
    支持：fuzzy(模糊) / exact(精确) / regex(正则) / and / or / not
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
        return compare_pattern not in compare_text

    # contains / exact 受 user_match_mode 影响
    if not compare_pattern:
        return False

    if user_match_mode == "leftmost":
        return compare_text.lstrip().startswith(compare_pattern)
    elif user_match_mode == "rightmost":
        return compare_text.rstrip().endswith(compare_pattern)
    elif user_match_mode == "exact":
        escaped = re.escape(compare_pattern)
        return bool(re.search(r'(?<![a-zA-Z0-9\u4e00-\u9fff])' + escaped + r'(?![a-zA-Z0-9\u4e00-\u9fff])', compare_text))
    else:
        # fuzzy（默认）：包含匹配
        return compare_pattern in compare_text


def render_template(template: str, variables: dict) -> str:
    """渲染消息模板，支持 {key} 和 {{key}} 两种格式"""
    result = template
    for key, value in variables.items():
        result = result.replace(f"{{{key}}}", str(value or ""))
        result = result.replace(f"{{{{{key}}}}}", str(value or ""))
    return result


def is_dedup(chat_id: int, message_id: int) -> bool:
    """消息去重检查，返回 True 表示已处理过（需跳过）"""
    key = f"{chat_id}:{message_id}"
    now = time.time()
    if key in _dedup_cache:
        return True
    # 清理过期缓存
    expired = [k for k, ts in _dedup_cache.items() if now - ts > DEDUP_TTL]
    for k in expired:
        del _dedup_cache[k]
    _dedup_cache[key] = now
    return False


def check_rate_limit(sender_id: int, chat_id: int, window: int, limit: int) -> bool:
    """
    防刷屏检查（按发送者+群组维度，不跨群组计数）
    返回 True 表示超过限制（需跳过）
    """
    if window <= 0 or limit <= 0:
        return False
    key = f"{sender_id}:{chat_id}"
    now = time.time()
    timestamps = _rate_cache.get(key, [])
    # 清理窗口外的时间戳
    timestamps = [ts for ts in timestamps if now - ts <= window]
    if len(timestamps) >= limit:
        return True
    timestamps.append(now)
    _rate_cache[key] = timestamps
    return False


# ─── 消息处理核心 ──────────────────────────────────────────
async def process_message(
    account_id: int,
    chat_id: int,
    chat_title: str,
    chat_username: Optional[str],
    sender_id: Optional[int],
    sender_username: Optional[str],
    sender_first_name: str,
    sender_last_name: str,
    message_id: int,
    text: str,
    is_bot: bool,
    is_anonymous: bool = False,  # 匿名管理员
    is_channel_post: bool = False,  # 频道转发
) -> None:
    """
    核心消息处理函数：
    1. 全局防刷屏过滤
    2. 公共群组关键词匹配
    3. 用户私有关键词匹配
    4. 命中记录写入 + Bot 推送
    """
    global _process_lock, _monitor_config

    async with _process_lock:
        config = _monitor_config

    anti_spam = config.get("antiSpam", {})

    # 全局 Bot 过滤（可配置，默认过滤）
    if anti_spam.get("filterBot", True) and is_bot:
        return

    # 全局消息长度过滤
    max_len = anti_spam.get("globalMaxMsgLen", 0)
    if max_len and len(text) > max_len:
        return

    # 全局防刷屏（按发送者+群组维度）
    rate_window = anti_spam.get("globalRateWindow", 0)
    rate_limit = anti_spam.get("globalRateLimit", 0)
    if sender_id and check_rate_limit(sender_id, chat_id, rate_window, rate_limit):
        logger.debug(f"[RateLimit] 跳过: sender={sender_id} chat={chat_id}")
        return

    chat_id_str = str(chat_id)

    # ── 公共群组关键词匹配 ──────────────────────────────────
    public_groups = config.get("publicGroups", [])
    public_real_ids = config.get("publicGroupRealIds", {})

    matched_public_group = None
    for pg in public_groups:
        pg_id = str(pg.get("groupId", ""))
        # 优先用 real_id（数字 chat_id）匹配
        real_id = public_real_ids.get(pg_id)
        if real_id and str(real_id) == chat_id_str:
            matched_public_group = pg
            break
        # 其次用 @username 匹配
        if chat_username and pg_id.lstrip("@").lower() == chat_username.lower():
            matched_public_group = pg
            break
        # 最后用 groupId 直接匹配 chat_id
        if pg_id == chat_id_str:
            matched_public_group = pg
            break

    if matched_public_group:
        pg_keywords = matched_public_group.get("keywords", [])
        for kw in pg_keywords:
            if match_keyword(text, kw):
                await _handle_hit(
                    account_id=account_id,
                    hit_type="public",
                    chat_id=chat_id,
                    chat_title=chat_title,
                    chat_username=chat_username,
                    sender_id=sender_id,
                    sender_username=sender_username,
                    sender_first_name=sender_first_name,
                    sender_last_name=sender_last_name,
                    message_id=message_id,
                    text=text,
                    matched_keyword=kw.get("pattern", ""),
                    keyword_id=kw.get("id"),
                    user_id=None,
                    is_anonymous=is_anonymous,
                )
                break  # 公共群组每条消息只推送一次（第一个命中的关键词）

    # ── 用户私有关键词匹配 ──────────────────────────────────
    user_configs = config.get("userConfigs", {})
    for uid_str, user_cfg in user_configs.items():
        user_id = int(uid_str)

        # 用户级 Bot 过滤
        if user_cfg.get("filterBots", False) and is_bot:
            continue

        # 用户监控的群组列表（空列表=监控所有群）
        monitor_groups = user_cfg.get("monitorGroups", [])
        if monitor_groups:
            # 检查当前群是否在用户的监控列表中
            in_list = False
            for mg in monitor_groups:
                mg_chat_id = str(mg.get("chatId", ""))
                mg_username = (mg.get("username") or "").lstrip("@").lower()
                if mg_chat_id == chat_id_str:
                    in_list = True
                    break
                if chat_username and mg_username and mg_username == chat_username.lower():
                    in_list = True
                    break
            if not in_list:
                continue

        # 用户关键词匹配
        user_match_mode = user_cfg.get("matchMode", "fuzzy")
        keywords_list = user_cfg.get("keywords", [])

        for kw in keywords_list:
            if match_keyword(text, kw, user_match_mode):
                await _handle_hit(
                    account_id=account_id,
                    hit_type="user",
                    chat_id=chat_id,
                    chat_title=chat_title,
                    chat_username=chat_username,
                    sender_id=sender_id,
                    sender_username=sender_username,
                    sender_first_name=sender_first_name,
                    sender_last_name=sender_last_name,
                    message_id=message_id,
                    text=text,
                    matched_keyword=kw.get("pattern", ""),
                    keyword_id=kw.get("id"),
                    user_id=user_id,
                    is_anonymous=is_anonymous,
                )
                break  # 每个用户每条消息只推送一次


async def _handle_hit(
    account_id: int,
    hit_type: str,
    chat_id: int,
    chat_title: str,
    chat_username: Optional[str],
    sender_id: Optional[int],
    sender_username: Optional[str],
    sender_first_name: str,
    sender_last_name: str,
    message_id: int,
    text: str,
    matched_keyword: str,
    keyword_id: Optional[int],
    user_id: Optional[int],
    is_anonymous: bool = False,
) -> None:
    """处理命中：写入数据库 + 触发 Bot 推送"""
    logger.info(
        f"[HIT] type={hit_type} user={user_id} "
        f"chat={chat_title}({chat_id}) "
        f"sender={sender_username or sender_id} "
        f"keyword={matched_keyword!r} "
        f"text={text[:60]!r}"
    )

    payload = {
        "accountId": account_id,
        "hitType": hit_type,
        "chatId": str(chat_id),
        "chatTitle": chat_title,
        "chatUsername": chat_username or "",
        "senderId": str(sender_id) if sender_id else "",
        "senderUsername": sender_username or "",
        "senderFirstName": sender_first_name,
        "senderLastName": sender_last_name,
        "messageId": message_id,
        "messageText": text,
        "matchedKeyword": matched_keyword,
        "keywordId": keyword_id,
        "userId": user_id,
        "isAnonymous": is_anonymous,
    }

    result = await api.post("/engine/hit", payload)
    if result:
        logger.debug(f"[HIT] 写入成功: hitId={result.get('hitId')}")
    else:
        logger.warning(f"[HIT] 写入失败: {payload}")


# ─── 账号 Worker ───────────────────────────────────────────
class AccountWorker:
    """
    单个 TG 账号的 Pyrofork 客户端封装
    负责：连接管理、消息监听、状态上报
    """

    def __init__(self, account: dict):
        self.account_id: int = account["id"]
        self.phone: str = account.get("phone", "")
        self.session_string: str = account.get("sessionString", "")
        self.proxy: Optional[dict] = self._parse_proxy(account)
        self.client: Optional[Client] = None
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._status = "stopped"  # stopped / connecting / running / error / banned

    def _parse_proxy(self, account: dict) -> Optional[dict]:
        """解析代理配置"""
        host = account.get("proxyHost")
        port = account.get("proxyPort")
        proxy_type = account.get("proxyType", "socks5")
        if not host or not port:
            return None
        proxy = {"scheme": proxy_type, "hostname": host, "port": int(port)}
        username = account.get("proxyUsername")
        password = account.get("proxyPassword")
        if username:
            proxy["username"] = username
        if password:
            proxy["password"] = password
        return proxy

    def _get_session_path(self) -> str:
        """获取 session 文件路径（用于 string session 或文件 session）"""
        return os.path.join(SESSIONS_DIR, f"account_{self.account_id}")

    async def start(self) -> bool:
        """启动账号客户端"""
        if not self.session_string:
            logger.warning(f"[Account {self.account_id}] 无 session_string，跳过")
            return False

        try:
            self.client = Client(
                name=f"account_{self.account_id}",
                api_id=TG_API_ID,
                api_hash=TG_API_HASH,
                session_string=self.session_string,
                proxy=self.proxy,
                workdir=SESSIONS_DIR,
                # 关键配置：不下载媒体，节省带宽
                no_updates=False,
            )

            # 注册消息处理器
            @self.client.on_message(filters.group & ~filters.service)
            async def on_group_message(client: Client, message: Message):
                await self._handle_message(message)

            # 注册频道消息处理器（频道转发到群组的消息）
            @self.client.on_message(filters.channel & ~filters.service)
            async def on_channel_message(client: Client, message: Message):
                # 只处理被转发到群组的频道消息（通过 forward_from_chat 判断）
                # 纯频道消息不在群组监控范围内
                pass

            await self.client.start()
            self._status = "running"
            self._running = True

            # 获取账号信息并上报
            me = await self.client.get_me()
            logger.info(
                f"[Account {self.account_id}] 启动成功: "
                f"@{me.username or 'N/A'} ({me.first_name})"
            )

            # 上报账号状态
            await api.post("/engine/account/status", {
                "accountId": self.account_id,
                "status": "active",
                "tgUserId": str(me.id),
                "tgUsername": me.username or "",
                "tgFirstName": me.first_name or "",
            })

            return True

        except (AuthKeyUnregistered, SessionExpired, SessionRevoked) as e:
            logger.error(f"[Account {self.account_id}] Session 失效: {e}")
            self._status = "expired"
            await api.post("/engine/account/status", {
                "accountId": self.account_id,
                "status": "expired",
            })
            return False

        except (UserDeactivated, PhoneNumberBanned) as e:
            logger.error(f"[Account {self.account_id}] 账号被封禁: {e}")
            self._status = "banned"
            await api.post("/engine/account/status", {
                "accountId": self.account_id,
                "status": "banned",
            })
            return False

        except Exception as e:
            logger.error(f"[Account {self.account_id}] 启动失败: {e}", exc_info=True)
            self._status = "error"
            return False

    async def stop(self) -> None:
        """停止账号客户端"""
        self._running = False
        if self.client:
            try:
                await self.client.stop()
            except Exception:
                pass
            self.client = None
        self._status = "stopped"
        logger.info(f"[Account {self.account_id}] 已停止")

    async def _handle_message(self, message: Message) -> None:
        """处理收到的群组消息"""
        try:
            # 提取消息文本（支持文字消息和带说明的媒体消息）
            text = message.text or message.caption or ""
            if not text or not text.strip():
                return

            text = text.strip()
            chat_id = message.chat.id
            message_id = message.id

            # 消息去重（防止多账号重复处理同一条消息）
            if is_dedup(chat_id, message_id):
                return

            # 提取群组信息
            chat_title = message.chat.title or str(chat_id)
            chat_username = message.chat.username  # 可能为 None

            # ── 发送者信息提取（关键改进：支持所有发送者类型）──────
            sender_id: Optional[int] = None
            sender_username: Optional[str] = None
            sender_first_name: str = ""
            sender_last_name: str = ""
            is_bot: bool = False
            is_anonymous: bool = False

            if message.from_user:
                # 普通用户消息
                sender_id = message.from_user.id
                sender_username = message.from_user.username
                sender_first_name = message.from_user.first_name or ""
                sender_last_name = message.from_user.last_name or ""
                is_bot = message.from_user.is_bot

            elif message.sender_chat:
                # 匿名管理员 或 频道身份发言
                sender_chat = message.sender_chat
                is_anonymous = True

                if sender_chat.id == chat_id:
                    # 匿名管理员（以群组名义发言）
                    sender_id = None
                    sender_first_name = f"[匿名管理员] {chat_title}"
                    sender_username = chat_username
                else:
                    # 关联频道转发（频道身份发言）
                    sender_id = sender_chat.id
                    sender_username = sender_chat.username
                    sender_first_name = sender_chat.title or f"频道{sender_chat.id}"

            else:
                # 无法识别发送者，仍然处理消息（不丢弃）
                sender_first_name = "[未知发送者]"

            logger.info(
                f"[Account {self.account_id}] 收到消息: "
                f"chat={chat_title}({chat_id}) "
                f"sender={sender_username or sender_id or '匿名'} "
                f"is_bot={is_bot} is_anon={is_anonymous} "
                f"len={len(text)} text={text[:80]!r}"
            )

            await process_message(
                account_id=self.account_id,
                chat_id=chat_id,
                chat_title=chat_title,
                chat_username=chat_username,
                sender_id=sender_id,
                sender_username=sender_username,
                sender_first_name=sender_first_name,
                sender_last_name=sender_last_name,
                message_id=message_id,
                text=text,
                is_bot=is_bot,
                is_anonymous=is_anonymous,
            )

        except FloodWait as e:
            logger.warning(f"[Account {self.account_id}] FloodWait {e.value}s")
            await asyncio.sleep(e.value)
        except Exception as e:
            logger.warning(
                f"[Account {self.account_id}] 处理消息异常: {e}",
                exc_info=True
            )


# ─── 配置同步 ──────────────────────────────────────────────
async def sync_config() -> None:
    """从 Web API 拉取最新监控配置"""
    global _monitor_config, _config_lock

    config = await api.get("/engine/config", timeout=30)
    if not config:
        logger.warning("[Config] 拉取配置失败，使用缓存配置")
        return

    async with _config_lock:
        _monitor_config = config

    account_count = len(config.get("accounts", []))
    user_count = len(config.get("userConfigs", {}))
    public_group_count = len(config.get("publicGroups", []))
    logger.info(
        f"[Config] 配置已更新: "
        f"accounts={account_count} "
        f"users={user_count} "
        f"publicGroups={public_group_count}"
    )


async def config_sync_loop() -> None:
    """定时配置同步循环"""
    while True:
        try:
            await sync_config()
        except Exception as e:
            logger.error(f"[Config] 同步异常: {e}")
        await asyncio.sleep(POLL_INTERVAL)


# ─── 账号管理 ──────────────────────────────────────────────
async def sync_accounts() -> None:
    """
    同步账号列表：
    - 新增账号：创建并启动 AccountWorker
    - 删除账号：停止并移除 AccountWorker
    - Session 变更：重启 AccountWorker
    """
    global _active_workers, _monitor_config

    async with _config_lock:
        accounts = _monitor_config.get("accounts", [])

    current_ids = set(_active_workers.keys())
    new_ids = {a["id"] for a in accounts}

    # 停止已删除的账号
    for acc_id in current_ids - new_ids:
        worker = _active_workers.pop(acc_id)
        await worker.stop()
        logger.info(f"[AccountSync] 账号 {acc_id} 已移除")

    # 启动新增的账号
    for account in accounts:
        acc_id = account["id"]
        if acc_id not in _active_workers:
            worker = AccountWorker(account)
            success = await worker.start()
            if success:
                _active_workers[acc_id] = worker
                logger.info(f"[AccountSync] 账号 {acc_id} 已启动")
        else:
            # 检查 session 是否变更
            existing = _active_workers[acc_id]
            if existing.session_string != account.get("sessionString", ""):
                logger.info(f"[AccountSync] 账号 {acc_id} session 已变更，重启")
                await existing.stop()
                worker = AccountWorker(account)
                success = await worker.start()
                if success:
                    _active_workers[acc_id] = worker


async def account_sync_loop() -> None:
    """定时账号同步循环"""
    # 首次等待配置加载完成
    await asyncio.sleep(5)
    while True:
        try:
            await sync_accounts()
        except Exception as e:
            logger.error(f"[AccountSync] 同步异常: {e}", exc_info=True)
        await asyncio.sleep(60)  # 每分钟检查一次账号变更


# ─── 健康度上报 ────────────────────────────────────────────
async def health_report_loop() -> None:
    """定时上报各账号健康状态"""
    while True:
        await asyncio.sleep(300)  # 每5分钟上报一次
        for acc_id, worker in list(_active_workers.items()):
            try:
                status = worker._status
                is_connected = (
                    worker.client is not None
                    and worker.client.is_connected
                )
                await api.post("/engine/account-health", {
                    "accountId": acc_id,
                    "status": status,
                    "isConnected": is_connected,
                })
            except Exception as e:
                logger.debug(f"[Health] 账号 {acc_id} 上报失败: {e}")


# ─── HTTP 服务（供 Web 后台调用）─────────────────────────────
from aiohttp import web as aiohttp_web

ENGINE_HTTP_PORT = int(os.getenv("ENGINE_HTTP_PORT", "7001"))


async def http_status(request):
    """引擎状态接口"""
    secret = request.headers.get("X-Engine-Secret", "")
    if secret != ENGINE_SECRET:
        return aiohttp_web.json_response({"error": "Unauthorized"}, status=401)

    workers_status = {}
    for acc_id, worker in _active_workers.items():
        workers_status[str(acc_id)] = {
            "status": worker._status,
            "phone": worker.phone,
            "connected": worker.client is not None and worker.client.is_connected,
        }

    return aiohttp_web.json_response({
        "status": "running",
        "activeAccounts": len(_active_workers),
        "workers": workers_status,
        "dedupCacheSize": len(_dedup_cache),
    })


async def http_reload(request):
    """强制重新加载配置"""
    secret = request.headers.get("X-Engine-Secret", "")
    if secret != ENGINE_SECRET:
        return aiohttp_web.json_response({"error": "Unauthorized"}, status=401)

    await sync_config()
    await sync_accounts()
    return aiohttp_web.json_response({"ok": True, "message": "Config reloaded"})


async def http_batch_join_groups(request: aiohttp_web.Request) -> aiohttp_web.Response:
    """批量让指定账号加入群组"""
    secret = request.headers.get("X-Engine-Secret", "")
    if secret != ENGINE_SECRET:
        return aiohttp_web.json_response({"error": "unauthorized"}, status=401)
    try:
        body = await request.json()
    except Exception:
        body = {}

    account_ids = body.get("account_ids", [])
    group_ids = body.get("group_ids", [])   # 群组链接列表，空则用公共群组池
    interval_min = int(body.get("interval_min", 10))
    interval_max = int(body.get("interval_max", 30))

    # 确定要操作的账号
    target_workers = []
    if account_ids:
        for aid in account_ids:
            w = _active_workers.get(int(aid))
            if w and w.client and w.client.is_connected:
                target_workers.append((int(aid), w))
    else:
        for aid, w in _active_workers.items():
            if w.client and w.client.is_connected:
                target_workers.append((aid, w))

    if not target_workers:
        return aiohttp_web.json_response({"error": "没有可用的活跃账号"}, status=400)

    # 确定要加入的群组
    config = _monitor_config
    public_groups = config.get("publicGroups", [])
    # 构建 groupId -> db_id 的映射，用于加群后回调
    group_id_to_db_id = {pg.get("groupId", ""): pg.get("id") for pg in public_groups}
    if group_ids:
        target_groups = group_ids  # 直接用传入的链接列表
    else:
        target_groups = [pg.get("groupId", "") for pg in public_groups if pg.get("isActive", True)]

    if not target_groups:
        return aiohttp_web.json_response({"error": "没有需要加入的群组"}, status=400)

    logger.info(f"[batch-join] 开始批量加群（多账号轮流模式）：{len(target_workers)} 个账号，{len(target_groups)} 个群组")

    results = []
    joined = 0
    failed = 0
    skipped = 0

    # 多账号轮流加群：
    # - 用一个双端队列维护「可用账号」
    # - 每个群组取队首账号来加，加完后把账号放回队尾（轮换）
    # - 遇到 FloodWait 时跳过该账号，记录冷却结束时间，换下一个账号重试同一个群组
    # - 所有账号都在冷却中时，等待最近一个冷却结束后继续
    import collections, time as _time
    account_queue = collections.deque(target_workers)  # (account_id, worker)
    flood_cooldown = {}  # account_id -> 冷却结束时间戳

    for group_id in target_groups:
        if not group_id:
            continue

        # 找一个当前可用（不在冷却中）的账号
        tried = 0
        success = False
        while tried < len(account_queue):
            account_id, worker = account_queue[0]
            account_queue.rotate(-1)  # 先轮换，无论成功失败

            # 检查该账号是否还在冷却中
            cooldown_until = flood_cooldown.get(account_id, 0)
            now = _time.time()
            if cooldown_until > now:
                wait_left = int(cooldown_until - now)
                logger.info(f"[batch-join] 账号 {account_id} 冷却中（剩余 {wait_left}s），跳过")
                tried += 1
                continue

            # 尝试加入群组
            try:
                chat = await worker.client.join_chat(group_id)
                real_id = chat.id if chat else None
                results.append({"account_id": account_id, "group_id": group_id, "status": "subscribed", "real_id": real_id})
                joined += 1
                logger.info(f"[batch-join] 账号 {account_id} 成功加入 {group_id} -> {real_id}")
                # 回调 Web 服务，更新 public_group_join_status 表
                db_group_id = group_id_to_db_id.get(group_id)
                if db_group_id:
                    try:
                        await api.post("/engine/public-group/join-status", {
                            "publicGroupId": db_group_id,
                            "monitorAccountId": account_id,
                            "status": "subscribed",
                            "realId": str(real_id) if real_id else None,
                        })
                    except Exception as cb_err:
                        logger.warning(f"[batch-join] 回调 join-status 失败: {cb_err}")
                success = True
                break
            except FloodWait as e:
                logger.warning(f"[batch-join] 账号 {account_id} FloodWait {e.value}s，切换到下一个账号")
                flood_cooldown[account_id] = _time.time() + e.value
                tried += 1
                # 不 sleep，直接换下一个账号重试同一个群组
                continue
            except Exception as e:
                err_msg = str(e)
                if "already" in err_msg.lower() or "USER_ALREADY_PARTICIPANT" in err_msg:
                    results.append({"account_id": account_id, "group_id": group_id, "status": "skipped", "reason": "already_member"})
                    skipped += 1
                    # 已是成员，也回调更新状态
                    db_group_id = group_id_to_db_id.get(group_id)
                    if db_group_id:
                        try:
                            await api.post("/engine/public-group/join-status", {
                                "publicGroupId": db_group_id,
                                "monitorAccountId": account_id,
                                "status": "subscribed",
                            })
                        except Exception as cb_err:
                            logger.warning(f"[batch-join] 回调 join-status(already) 失败: {cb_err}")
                    success = True  # already_member 也算处理完毕
                    break
                else:
                    results.append({"account_id": account_id, "group_id": group_id, "status": "failed", "reason": err_msg})
                    failed += 1
                    logger.warning(f"[batch-join] 账号 {account_id} 加入 {group_id} 失败: {err_msg}")
                    success = True  # 其他错误不重试，继续下一个群组
                    break

        if not success:
            # 所有账号都在冷却中，等待最短冷却结束
            if flood_cooldown:
                min_cooldown = min(flood_cooldown.values())
                wait_sec = max(0, int(min_cooldown - _time.time()) + 1)
                logger.info(f"[batch-join] 所有账号冷却中，等待 {wait_sec}s 后继续")
                await asyncio.sleep(wait_sec)
                # 清除已过期的冷却
                now = _time.time()
                flood_cooldown = {k: v for k, v in flood_cooldown.items() if v > now}
                # 重新尝试当前群组（放回队列头部再试一次）
                # 找任意一个不在冷却中的账号
                for account_id, worker in list(account_queue):
                    if flood_cooldown.get(account_id, 0) <= _time.time():
                        try:
                            chat = await worker.client.join_chat(group_id)
                            real_id = chat.id if chat else None
                            results.append({"account_id": account_id, "group_id": group_id, "status": "subscribed", "real_id": real_id})
                            joined += 1
                            logger.info(f"[batch-join] 账号 {account_id} 成功加入 {group_id} -> {real_id}（冷却后重试）")
                            db_group_id = group_id_to_db_id.get(group_id)
                            if db_group_id:
                                try:
                                    await api.post("/engine/public-group/join-status", {
                                        "publicGroupId": db_group_id,
                                        "monitorAccountId": account_id,
                                        "status": "subscribed",
                                        "realId": str(real_id) if real_id else None,
                                    })
                                except Exception as cb_err:
                                    logger.warning(f"[batch-join] 回调 join-status 失败: {cb_err}")
                        except FloodWait as e:
                            flood_cooldown[account_id] = _time.time() + e.value
                            failed += 1
                        except Exception as e:
                            err_msg = str(e)
                            results.append({"account_id": account_id, "group_id": group_id, "status": "failed", "reason": err_msg})
                            failed += 1
                        break
            else:
                results.append({"account_id": None, "group_id": group_id, "status": "failed", "reason": "no_available_account"})
                failed += 1

        # 加群间隔，防封号
        delay = random.uniform(interval_min, interval_max)
        await asyncio.sleep(delay)

    logger.info(f"[batch-join] 完成：加入 {joined}，失败 {failed}，跳过 {skipped}")
    return aiohttp_web.json_response({
        "success": True,
        "joined": joined,
        "failed": failed,
        "skipped": skipped,
        "results": results,
    })


async def http_scan_joined_groups(request: aiohttp_web.Request) -> aiohttp_web.Response:
    """扫描账号已加入的群组"""
    secret = request.headers.get("X-Engine-Secret", "")
    if secret != ENGINE_SECRET:
        return aiohttp_web.json_response({"error": "unauthorized"}, status=401)
    try:
        body = await request.json()
    except Exception:
        body = {}

    account_ids = body.get("account_ids", [])
    target_workers = []
    if account_ids:
        for aid in account_ids:
            w = _active_workers.get(int(aid))
            if w and w.client and w.client.is_connected:
                target_workers.append((int(aid), w))
    else:
        for aid, w in _active_workers.items():
            if w.client and w.client.is_connected:
                target_workers.append((aid, w))

    results = {}
    for account_id, worker in target_workers:
        try:
            dialogs = []
            async for dialog in worker.client.get_dialogs():
                if dialog.chat and dialog.chat.type.name in ("GROUP", "SUPERGROUP"):
                    dialogs.append({
                        "chatId": str(dialog.chat.id),
                        "title": dialog.chat.title or "",
                        "username": dialog.chat.username or "",
                    })
            results[str(account_id)] = dialogs
        except Exception as e:
            results[str(account_id)] = []
            logger.warning(f"[scan-joined] 账号 {account_id} 扫描失败: {e}")

    return aiohttp_web.json_response({"success": True, "results": results})


async def start_http_server() -> None:
    """启动引擎 HTTP 服务"""
    app = aiohttp_web.Application()
    app.router.add_get("/engine/status", http_status)
    app.router.add_post("/engine/reload", http_reload)
    app.router.add_post("/batch-join-groups", http_batch_join_groups)
    app.router.add_post("/scan-joined-groups", http_scan_joined_groups)

    runner = aiohttp_web.AppRunner(app)
    await runner.setup()
    site = aiohttp_web.TCPSite(runner, "0.0.0.0", ENGINE_HTTP_PORT)
    await site.start()
    logger.info(f"[HTTP] 引擎 HTTP 服务已启动: port={ENGINE_HTTP_PORT}")


# ─── 主入口 ────────────────────────────────────────────────
async def main():
    global _process_lock, _config_lock

    logger.info("=" * 60)
    logger.info("  神探监控机器人 - Pyrofork 引擎 v1.0")
    logger.info(f"  API_BASE: {API_BASE}")
    logger.info(f"  POLL_INTERVAL: {POLL_INTERVAL}s")
    logger.info(f"  TG_API_ID: {TG_API_ID}")
    logger.info("=" * 60)

    if not TG_API_ID or not TG_API_HASH:
        logger.error("TG_API_ID 或 TG_API_HASH 未配置，退出")
        return

    # 初始化锁
    _process_lock = asyncio.Lock()
    _config_lock = asyncio.Lock()

    # 启动 HTTP 服务
    await start_http_server()

    # 首次拉取配置
    await sync_config()

    # 首次启动账号
    await sync_accounts()

    # 启动后台任务
    tasks = [
        asyncio.create_task(config_sync_loop()),
        asyncio.create_task(account_sync_loop()),
        asyncio.create_task(health_report_loop()),
    ]

    logger.info("[Main] 所有服务已启动，开始监控...")

    try:
        await asyncio.gather(*tasks)
    except KeyboardInterrupt:
        logger.info("[Main] 收到停止信号，正在关闭...")
    finally:
        # 停止所有账号
        for worker in list(_active_workers.values()):
            await worker.stop()
        logger.info("[Main] 引擎已停止")


if __name__ == "__main__":
    asyncio.run(main())
