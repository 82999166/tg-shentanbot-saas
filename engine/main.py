#!/usr/bin/env python3
"""
神探监控机器人 - 引擎 v4.2 (架构加固版)
v4.2 变更：
1. 对话内存缓存 (Dialog Cache)：启动时同步，监听 Update 实时更新。
2. 零延迟 API：/dialogs 接口直接返回缓存，不请求 Telegram。
3. 稳定性增强：处理加群/退群事件，确保缓存与实际一致。
4. [v4.2] PID 文件锁：防止同一账号多次启动。
5. [v4.2] HTTP 端口冲突自愈：启动前检测并清理旧进程。
6. [v4.2] 启动失败时完整清理 Pyrogram 客户端，防止僵尸连接。
7. [v4.2] 缓存 me 信息，避免 on_chat_member_updated 重复网络请求。
8. [v4.2] 使用 OrderedDict 替代 set 管理已处理消息ID，保证清理顺序。
9. [v4.2] 添加 /health 端点，支持健康检查。
10. [v4.2] 添加定时缓存刷新机制，每30分钟增量刷新对话缓存。
"""
import asyncio
import json
import logging
import os
import re
import sys
import signal
import time
import argparse
import subprocess
import socket
from collections import OrderedDict
from typing import Optional, Dict, List, Any

from aiohttp import web

try:
    from dotenv import load_dotenv
    _env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    load_dotenv(_env_path, override=True)
except ImportError:
    pass

import aiohttp
from pyrogram import Client, filters, idle, handlers, raw
from pyrogram.handlers import RawUpdateHandler
from pyrogram.types import Message, Chat
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
parser = argparse.ArgumentParser(description="神探监控引擎 v4.2")
parser.add_argument("--account_id", type=int, help="启动特定账号的监控进程")
parser.add_argument("--master", action="store_true", help="以主控模式启动")
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

# ─── 环境变量 ──────────────────────
API_BASE        = os.getenv("WEB_API_BASE", "http://localhost:7000/api")
ENGINE_SECRET   = os.getenv("ENGINE_SECRET", "")
TG_API_ID       = int(os.getenv("TG_API_ID", "0"))
TG_API_HASH     = os.getenv("TG_API_HASH", "")
SESSIONS_DIR    = os.getenv("SESSIONS_DIR", os.path.join(_BASE_DIR, "sessions"))
HTTP_PORT_BASE  = int(os.getenv("ENGINE_HTTP_PORT_BASE", "7100"))
POLL_INTERVAL   = int(os.getenv("POLL_INTERVAL", "30"))
MASTER_CHECK_INTERVAL = int(os.getenv("MASTER_CHECK_INTERVAL", "10"))
CACHE_REFRESH_INTERVAL = int(os.getenv("CACHE_REFRESH_INTERVAL", "1800"))  # 30分钟刷新缓存

os.makedirs(SESSIONS_DIR, exist_ok=True)

# ─── PID 文件目录 ──────────────────────
_PID_DIR = os.path.join(_BASE_DIR, "pids")
os.makedirs(_PID_DIR, exist_ok=True)

# ─── 全局状态 ──────────────────────────────────────────────
_dedup_cache: Dict[str, float] = {}
DEDUP_TTL = 3600
_rate_cache: Dict[str, List[float]] = {}
_monitor_config: Dict[str, Any] = {}
_config_lock = asyncio.Lock()

# ─── PM2 路径 ──────────────────
_PM2_SCRIPT = os.getenv("PM2_SCRIPT", "/home/hjroot/.local/lib/node_modules/pm2/bin/pm2")
_NODE_BIN   = os.getenv("NODE_BIN", "/usr/bin/node")
_PYTHON_PATH = os.getenv("ENGINE_PYTHON", "/home/hjroot/shentanbot/engine/venv/bin/python3")
_PM2_ENV = {
    **os.environ,
    "HOME": os.getenv("HOME", "/home/hjroot"),
    "PM2_HOME": os.getenv("PM2_HOME", "/home/hjroot/.pm2"),
    "PATH": os.getenv("PATH", "/usr/bin:/bin:/home/hjroot/.local/bin"),
}

# ─── PID 文件管理 ──────────────────
def _pid_file_path(account_id: int) -> str:
    return os.path.join(_PID_DIR, f"engine-acc{account_id}.pid")

def _acquire_pid_lock(account_id: int) -> bool:
    """尝试获取 PID 文件锁。如果已有同账号进程在运行，先尝试清理。
    返回 True 表示成功获取锁，False 表示失败。
    """
    pid_file = _pid_file_path(account_id)
    if os.path.exists(pid_file):
        try:
            with open(pid_file, "r") as f:
                old_pid = int(f.read().strip())
            # 检查旧进程是否还在运行
            os.kill(old_pid, 0)  # 不发送信号，只检查进程是否存在
            # 旧进程还在运行，尝试优雅终止
            logger.warning(f"[Account {account_id}] 检测到旧进程 PID={old_pid} 仍在运行，发送 SIGTERM...")
            os.kill(old_pid, signal.SIGTERM)
            # 等待最多5秒
            for _ in range(10):
                time.sleep(0.5)
                try:
                    os.kill(old_pid, 0)
                except OSError:
                    break  # 进程已退出
            else:
                # 5秒后仍未退出，强制杀掉
                logger.warning(f"[Account {account_id}] 旧进程 PID={old_pid} 未响应 SIGTERM，发送 SIGKILL...")
                try:
                    os.kill(old_pid, signal.SIGKILL)
                    time.sleep(0.5)
                except OSError:
                    pass
        except (ValueError, OSError):
            # PID 文件内容无效或进程已不存在，可以安全覆盖
            pass
    # 写入当前 PID
    try:
        with open(pid_file, "w") as f:
            f.write(str(os.getpid()))
        return True
    except Exception as e:
        logger.error(f"[Account {account_id}] 无法写入 PID 文件: {e}")
        return False

def _release_pid_lock(account_id: int):
    """释放 PID 文件锁"""
    pid_file = _pid_file_path(account_id)
    try:
        if os.path.exists(pid_file):
            with open(pid_file, "r") as f:
                stored_pid = int(f.read().strip())
            if stored_pid == os.getpid():
                os.remove(pid_file)
    except Exception:
        pass

def _check_port_available(port: int) -> bool:
    """检查端口是否可用"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False

def _kill_port_occupant(port: int) -> bool:
    """尝试杀掉占用指定端口的进程"""
    try:
        result = subprocess.run(
            ["fuser", f"{port}/tcp"],
            capture_output=True, text=True, timeout=5
        )
        if result.stdout.strip():
            pids = result.stdout.strip().split()
            my_pid = str(os.getpid())
            for pid in pids:
                pid = pid.strip()
                if pid and pid != my_pid:
                    logger.warning(f"端口 {port} 被 PID={pid} 占用，尝试终止...")
                    try:
                        os.kill(int(pid), signal.SIGTERM)
                    except OSError:
                        pass
            time.sleep(1)
            return _check_port_available(port)
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass
    return False

# ─── REST API 客户端 ──────────────
class ApiClient:
    def __init__(self, base: str, secret: str):
        self.base = base.rstrip("/")
        self.headers = {
            "X-Engine-Secret": secret,
            "Content-Type": "application/json",
        }

    async def get(self, path: str, timeout: int = 30) -> Optional[dict]:
        url = f"{self.base}{path}"
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=self.headers, timeout=aiohttp.ClientTimeout(total=timeout)) as r:
                    if r.status == 200: return await r.json()
                    else: logger.warning(f"GET {path} -> HTTP {r.status}")
        except Exception as e: logger.warning(f"GET {path} 失败: {e}")
        return None

    async def post(self, path: str, data: dict, timeout: int = 15) -> Optional[dict]:
        url = f"{self.base}{path}"
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, headers=self.headers, json=data, timeout=aiohttp.ClientTimeout(total=timeout)) as r:
                    if r.status == 200: return await r.json()
                    else: logger.warning(f"POST {path} -> HTTP {r.status}")
        except Exception as e: logger.warning(f"POST {path} 失败: {e}")
        return None

    async def fetch_config(self) -> Optional[dict]: return await self.get("/engine/config")
    async def report_hit(self, payload: dict) -> Optional[dict]: return await self.post("/engine/hit", payload)
    async def report_heartbeat(self, data: dict) -> Optional[dict]: return await self.post("/engine/heartbeat", data)

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
    key = f"{chat_id}:{message_id}"; now = time.time()
    expired = [k for k, v in _dedup_cache.items() if now - v > DEDUP_TTL]
    for k in expired: del _dedup_cache[k]
    if key in _dedup_cache: return True
    _dedup_cache[key] = now; return False

def check_rate_limit(sender_id: int, chat_id: int, window: int, limit: int) -> bool:
    if window <= 0 or limit <= 0: return False
    key = f"{sender_id}:{chat_id}"; now = time.time()
    timestamps = _rate_cache.get(key, [])
    timestamps = [ts for ts in timestamps if now - ts <= window]
    if len(timestamps) >= limit: return True
    timestamps.append(now); _rate_cache[key] = timestamps; return False

# ─── AccountWorker 类 ────────────────────────────────────────
class AccountWorker:
    def __init__(self, account_id: int, phone: str, session_string: str):
        self.account_id = account_id
        self.phone = phone
        self.session_string = session_string
        self.client: Optional[Client] = None
        self._running = False
        self._http_runner: Optional[web.AppRunner] = None
        self._http_site = None
        self._me = None  # [v4.2] 缓存 me 信息
        self._start_time = time.time()
        # 对话缓存: chatId -> { chatId, title, username, memberCount, type }
        self._dialog_cache: Dict[str, Dict[str, Any]] = {}
        self._cache_lock = asyncio.Lock()
        # [v4.2] 使用 OrderedDict 管理已处理消息ID，保证清理顺序正确
        self._processed_msg_ids: OrderedDict = OrderedDict()
        self._processed_msg_ids_max = 10000

    async def _update_cache_from_chat(self, chat: Chat):
        """从 Chat 对象更新缓存"""
        if not chat or chat.type.value not in ("group", "supergroup", "channel"):
            return
        cid = str(chat.id)
        member_count = getattr(chat, "members_count", None) or getattr(chat, "participants_count", None)
        async with self._cache_lock:
            self._dialog_cache[cid] = {
                "chatId": cid,
                "title": chat.title or "",
                "username": chat.username or "",
                "memberCount": member_count,
                "type": chat.type.value,
            }
            logger.debug(f"[Account {self.account_id}] 缓存已更新: {chat.title} ({cid})")

    async def start(self):
        if self._running: return
        self._running = True
        self._start_time = time.time()
        logger.info(f"[Account {self.account_id}] 正在启动客户端... (PID={os.getpid()})")
        try:
            self.client = Client(
                name=f"acc_{self.account_id}",
                api_id=TG_API_ID, api_hash=TG_API_HASH,
                session_string=self.session_string,
                workdir=SESSIONS_DIR, in_memory=True,
            )

            # 1. 实时消息监听（高层 Handler，优先处理）
            @self.client.on_message(filters.group & (filters.incoming | filters.outgoing))
            async def on_message_handler(client, message):
                # 标记为已处理，防止 RawUpdateHandler 重复处理
                msg_key = (message.chat.id, message.id)
                self._processed_msg_ids[msg_key] = True
                # [v4.2] OrderedDict 清理：删除最旧的条目
                while len(self._processed_msg_ids) > self._processed_msg_ids_max:
                    self._processed_msg_ids.popitem(last=False)
                await self._process_message(message)

            # 1b. Monkey-patch dispatcher 的 handler_worker，确保 parser 异常时消息不丢失
            self._patch_dispatcher()

            # 2. 实时对话状态监听 (加群/退群/信息变更)
            @self.client.on_chat_member_updated()
            async def on_chat_member_updated_handler(client, update):
                # [v4.2] 使用缓存的 me 信息，避免每次都发网络请求
                if not self._me:
                    self._me = await client.get_me()
                me_id = self._me.id
                if update.new_chat_member and update.new_chat_member.user.id == me_id:
                    logger.info(f"[Account {self.account_id}] 检测到加入新群组: {update.chat.title}")
                    await self._update_cache_from_chat(update.chat)
                elif update.old_chat_member and update.old_chat_member.user.id == me_id and not update.new_chat_member:
                    cid = str(update.chat.id)
                    async with self._cache_lock:
                        if cid in self._dialog_cache:
                            del self._dialog_cache[cid]
                            logger.info(f"[Account {self.account_id}] 检测到退出群组，移除缓存: {update.chat.title}")

            await self.client.start()
            self._me = await self.client.get_me()
            logger.info(f"[Account {self.account_id}] 客户端启动成功: @{self._me.username or self._me.id}")

            # 3. 初始同步全量对话到缓存
            logger.info(f"[Account {self.account_id}] 正在同步全量对话缓存...")
            try:
                async for dialog in self.client.get_dialogs(limit=0):
                    try:
                        await self._update_cache_from_chat(dialog.chat)
                    except Exception as e:
                        logger.warning(f"[Account {self.account_id}] 缓存单个对话失败: {e}")
            except Exception as e:
                logger.warning(f"[Account {self.account_id}] get_dialogs遍历中断: {e}，已缓存 {len(self._dialog_cache)} 个对话，继续启动")
            logger.info(f"[Account {self.account_id}] 缓存同步完成，共 {len(self._dialog_cache)} 个对话")

            # 4. [v4.2] 启动 HTTP 服务器（带端口冲突自愈）
            await self._start_http_server_safe()

            # 5. [v4.2] 启动定时缓存刷新任务
            asyncio.create_task(self._periodic_cache_refresh())

        except Exception as e:
            logger.error(f"[Account {self.account_id}] 启动失败: {e}", exc_info=True)
            # [v4.2] 启动失败时完整清理，防止僵尸连接
            await self._cleanup_on_failure()

    async def _cleanup_on_failure(self):
        """启动失败时的完整清理"""
        self._running = False
        if self._http_runner:
            try:
                await self._http_runner.cleanup()
            except Exception:
                pass
            self._http_runner = None
        if self.client:
            try:
                if self.client.is_connected:
                    await self.client.stop()
            except Exception:
                pass
            self.client = None
        logger.info(f"[Account {self.account_id}] 启动失败后已完成清理")

    async def stop(self):
        self._running = False
        if self._http_runner:
            try:
                await self._http_runner.cleanup()
            except Exception:
                pass
        if self.client:
            try:
                await self.client.stop()
            except Exception:
                pass
        _release_pid_lock(self.account_id)
        logger.info(f"[Account {self.account_id}] 客户端已停止")

    async def _periodic_cache_refresh(self):
        """[v4.2] 定时增量刷新对话缓存，确保长时间运行后缓存不过期"""
        while self._running:
            await asyncio.sleep(CACHE_REFRESH_INTERVAL)
            if not self._running or not self.client or not self.client.is_connected:
                continue
            try:
                logger.info(f"[Account {self.account_id}] 定时刷新对话缓存...")
                count_before = len(self._dialog_cache)
                async for dialog in self.client.get_dialogs(limit=0):
                    try:
                        await self._update_cache_from_chat(dialog.chat)
                    except Exception:
                        pass
                count_after = len(self._dialog_cache)
                logger.info(f"[Account {self.account_id}] 缓存刷新完成: {count_before} -> {count_after} 个对话")
            except Exception as e:
                logger.warning(f"[Account {self.account_id}] 定时缓存刷新失败: {e}")

    def _patch_dispatcher(self):
        """Monkey-patch Pyrogram 的 dispatcher.handler_worker，
        确保当 message_parser 抛异常时，消息不会被丢弃，
        而是通过原始更新数据进行兜底处理。
        """
        import inspect
        import pyrogram
        from pyrogram.handlers import RawUpdateHandler as _RawUpdateHandler

        dispatcher = self.client.dispatcher
        worker_ref = self  # 闭包引用

        async def patched_handler_worker(lock):
            while True:
                packet = await dispatcher.updates_queue.get()
                if packet is None:
                    break
                try:
                    update, users, chats = packet
                    parser = dispatcher.update_parsers.get(type(update), None)

                    # ─── 核心补丁：将 parser 调用包裹在 try/except 中 ───
                    parsed_update = None
                    handler_type = type(None)
                    parser_failed = False
                    if parser is not None:
                        try:
                            parsed_update, handler_type = await parser(update, users, chats)
                        except Exception as parse_err:
                            parser_failed = True
                            logger.warning(
                                f"[Account {worker_ref.account_id}] [DISPATCHER_PATCH] "
                                f"parser 异常，启用兜底: {type(parse_err).__name__}: {parse_err}"
                            )

                    # 如果 parser 成功，正常流程
                    if not parser_failed:
                        async with lock:
                            for group in dispatcher.groups.values():
                                for handler in group:
                                    args = None
                                    if isinstance(handler, handler_type):
                                        try:
                                            if await handler.check(dispatcher.client, parsed_update):
                                                args = (parsed_update,)
                                        except Exception as e:
                                            logging.getLogger(__name__).exception(e)
                                            continue
                                    elif isinstance(handler, _RawUpdateHandler):
                                        args = (update, users, chats)
                                    if args is None:
                                        continue
                                    try:
                                        if inspect.iscoroutinefunction(handler.callback):
                                            await handler.callback(dispatcher.client, *args)
                                        else:
                                            await dispatcher.loop.run_in_executor(
                                                dispatcher.client.executor,
                                                handler.callback, dispatcher.client, *args
                                            )
                                    except pyrogram.StopPropagation:
                                        raise
                                    except pyrogram.ContinuePropagation:
                                        continue
                                    except Exception as e:
                                        logging.getLogger(__name__).exception(e)
                                    break
                    else:
                        # ─── parser 失败，直接从原始更新中提取消息并处理 ───
                        await worker_ref._handle_raw_update(update, users, chats)

                except pyrogram.StopPropagation:
                    pass
                except Exception as e:
                    logging.getLogger(__name__).exception(e)

        # 替换所有 handler_worker 任务
        dispatcher.handler_worker = patched_handler_worker
        logger.info(f"[Account {self.account_id}] Dispatcher handler_worker 已补丁，启用消息兜底机制")

    async def _handle_raw_update(self, update, users, chats):
        """RawUpdateHandler 兜底：从原始 MTProto 更新中提取消息
        只处理那些高层 on_message 未能捕获的消息（因 ChannelInvalid 等异常被丢弃的）
        """
        try:
            # 只处理新消息类型的更新
            if not isinstance(update, (raw.types.UpdateNewMessage, raw.types.UpdateNewChannelMessage)):
                return
            msg = update.message
            if not isinstance(msg, raw.types.Message):
                return
            if not msg.message:  # 没有文本内容
                return

            # 提取 chat_id
            peer = msg.peer_id
            if isinstance(peer, raw.types.PeerChannel):
                chat_id = -1000000000000 - peer.channel_id
            elif isinstance(peer, raw.types.PeerChat):
                chat_id = -peer.chat_id
            else:
                return  # 私聊消息不处理

            # 检查是否已被高层 handler 处理过
            msg_key = (chat_id, msg.id)
            if msg_key in self._processed_msg_ids:
                return

            logger.warning(
                f"[Account {self.account_id}] [RAW_FALLBACK] "
                f"捕获到被 parser 丢弃的消息: chat_id={chat_id}, msg_id={msg.id}, "
                f"text={msg.message[:80]!r}"
            )

            # 提取发送者信息
            sender_id = getattr(msg, 'from_id', None)
            sender_user = None
            if sender_id and isinstance(sender_id, raw.types.PeerUser):
                uid = sender_id.user_id
                sender_user = users.get(uid)

            # 提取群组信息
            chat_title = ""
            chat_username = ""
            if isinstance(peer, raw.types.PeerChannel):
                channel = chats.get(peer.channel_id)
                if channel:
                    chat_title = getattr(channel, 'title', '')
                    chat_username = getattr(channel, 'username', '') or ''

            # 构造简化消息结构，复用关键词匹配逻辑
            await self._process_raw_message(
                chat_id=chat_id,
                chat_title=chat_title,
                chat_username=chat_username,
                message_id=msg.id,
                text=msg.message,
                sender_id=sender_user.id if sender_user else (
                    sender_id.user_id if sender_id and isinstance(sender_id, raw.types.PeerUser) else 0
                ),
                sender_username=getattr(sender_user, 'username', None) if sender_user else None,
                sender_name=(
                    f"{getattr(sender_user, 'first_name', '') or ''} "
                    f"{getattr(sender_user, 'last_name', '') or ''}"
                ).strip() if sender_user else None,
                sender_is_bot=getattr(sender_user, 'bot', False) if sender_user else False,
            )
        except Exception as e:
            logger.debug(f"[Account {self.account_id}] [RAW_FALLBACK] 处理原始更新时出错: {e}")

    async def _process_raw_message(self, chat_id: int, chat_title: str, chat_username: str,
                                    message_id: int, text: str, sender_id: int,
                                    sender_username: str, sender_name: str, sender_is_bot: bool):
        """处理从 RawUpdateHandler 提取的消息，复用关键词匹配逻辑"""
        if not text:
            return
        if is_dedup(chat_id, message_id):
            return

        chat_id_str = str(chat_id)
        logger.info(f"[Account {self.account_id}] [MSG-RAW] chat={chat_title!r}({chat_id_str}), text={text[:50]!r}")

        async with _config_lock:
            config = dict(_monitor_config)
        if not config:
            return

        anti_spam = config.get("globalAntiSpam", {})
        user_configs = config.get("userConfigs", {})
        max_len = anti_spam.get("globalMaxMsgLen", 0)
        if max_len > 0 and len(text) > max_len:
            return
        if anti_spam.get("filterBot", True) and sender_is_bot:
            return

        for uid_str, user_cfg in user_configs.items():
            user_id = int(uid_str)
            push_settings = user_cfg.get("pushSettings", {})
            if push_settings.get("filterBots", False) and sender_is_bot:
                continue
            rate_window = anti_spam.get("globalRateWindow", 60)
            rate_limit = anti_spam.get("globalRateLimit", 5)
            if sender_id and check_rate_limit(sender_id, chat_id, rate_window, rate_limit):
                continue

            mode = push_settings.get("keywordMatchMode", "fuzzy")
            for kw in user_cfg.get("globalKeywords", []):
                if kw.get("isActive", True) and kw.get("pattern") and match_keyword(text, kw, mode):
                    # 构造 payload 并上报
                    tg_group_id = f"-100{abs(chat_id)}" if chat_id < -1000000000 and not str(chat_id).startswith("-100") else str(chat_id)
                    payload = {
                        "userId": user_id,
                        "monitorAccountId": self.account_id,
                        "tgGroupId": tg_group_id,
                        "groupName": chat_title,
                        "senderTgId": str(sender_id) if sender_id else "",
                        "senderUsername": sender_username,
                        "senderName": sender_name,
                        "messageText": text,
                        "matchedKeywords": [kw.get("pattern", "")],
                        "messageId": str(message_id),
                    }
                    await api.report_hit(payload)
                    break

    async def _process_message(self, message: Message):
        if not message or not message.text: return
        if is_dedup(message.chat.id, message.id): return
        
        # 实时更新当前群组缓存（确保成员数等信息较新）
        await self._update_cache_from_chat(message.chat)

        text = str(message.text or ""); chat_id_str = str(message.chat.id)
        logger.info(f"[Account {self.account_id}] [MSG] chat={message.chat.title!r}({chat_id_str}), text={text[:50]!r}")

        async with _config_lock: config = dict(_monitor_config)
        if not config: return

        anti_spam = config.get("globalAntiSpam", {}); user_configs = config.get("userConfigs", {})
        max_len = anti_spam.get("globalMaxMsgLen", 0)
        if max_len > 0 and len(text) > max_len: return
        if anti_spam.get("filterBot", True) and message.from_user and message.from_user.is_bot: return

        sender_id = message.from_user.id if message.from_user else 0
        for uid_str, user_cfg in user_configs.items():
            user_id = int(uid_str); push_settings = user_cfg.get("pushSettings", {})
            if push_settings.get("filterBots", False) and message.from_user and message.from_user.is_bot: continue
            rate_window = anti_spam.get("globalRateWindow", 60); rate_limit = anti_spam.get("globalRateLimit", 5)
            if sender_id and check_rate_limit(sender_id, message.chat.id, rate_window, rate_limit): continue

            mode = push_settings.get("keywordMatchMode", "fuzzy")
            for kw in user_cfg.get("globalKeywords", []):
                if kw.get("isActive", True) and kw.get("pattern") and match_keyword(text, kw, mode):
                    await self._handle_hit(message, kw, user_id); break

    async def _handle_hit(self, message: Message, kw: dict, user_id: int):
        sender = message.from_user
        payload = {
            "userId": user_id, "monitorAccountId": self.account_id,
            "tgGroupId": (lambda cid: f"-100{abs(cid)}" if cid < -1000000000 and not str(cid).startswith("-100") else str(cid))(message.chat.id),
            "groupName": message.chat.title or "",
            "senderTgId": str(sender.id) if sender else "",
            "senderUsername": sender.username if sender else None,
            "senderName": f"{sender.first_name or ''} {sender.last_name or ''}".strip() if sender else None,
            "messageText": str(message.text or ""),
            "matchedKeywords": [kw.get("pattern", "")],
            "messageId": str(message.id),
        }
        await api.report_hit(payload)

    async def _start_http_server_safe(self):
        """[v4.2] 安全启动 HTTP 服务器，带端口冲突自愈"""
        port = HTTP_PORT_BASE + self.account_id

        # 检查端口是否可用
        if not _check_port_available(port):
            logger.warning(f"[Account {self.account_id}] 端口 {port} 被占用，尝试清理...")
            if _kill_port_occupant(port):
                logger.info(f"[Account {self.account_id}] 端口 {port} 已清理成功")
            else:
                # 等待2秒后重试
                await asyncio.sleep(2)
                if not _check_port_available(port):
                    logger.error(f"[Account {self.account_id}] 端口 {port} 仍被占用，HTTP 服务器启动失败。消息监控仍正常运行。")
                    return  # [v4.2] 不再抛异常，消息监控仍然正常工作

        await self._start_http_server(port)

    async def _start_http_server(self, port: int):
        app = web.Application()
        app.router.add_get("/health", self._http_health)  # [v4.2] 新增 health 端点
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

    async def _http_health(self, request: web.Request) -> web.Response:
        """[v4.2] 健康检查端点"""
        uptime = int(time.time() - self._start_time)
        return web.json_response({
            "status": "ok",
            "accountId": self.account_id,
            "connected": self.client and self.client.is_connected,
            "cacheSize": len(self._dialog_cache),
            "uptime": uptime,
            "version": "v4.2",
            "pid": os.getpid(),
        })

    async def _http_join_group(self, request: web.Request) -> web.Response:
        try:
            body = await request.json(); group_input = body.get("group", "").strip()
            if not group_input: return web.json_response({"success": False, "error": "group 不能为空"}, status=400)
            try:
                chat = await self.client.join_chat(group_input)
                await self._update_cache_from_chat(chat)
                return web.json_response({"success": True, "chatId": str(chat.id), "chatTitle": chat.title, "chatUsername": chat.username})
            except UserAlreadyParticipant:
                chat = await self.client.get_chat(group_input)
                await self._update_cache_from_chat(chat)
                return web.json_response({"success": True, "alreadyJoined": True, "chatId": str(chat.id)})
            except Exception as e: return web.json_response({"success": False, "error": str(e)}, status=500)
        except Exception as e: return web.json_response({"success": False, "error": str(e)}, status=400)

    async def _http_dialogs(self, request: web.Request) -> web.Response:
        """从内存缓存获取对话列表，零延迟"""
        async with self._cache_lock:
            groups = list(self._dialog_cache.values())
        return web.json_response({"success": True, "groups": groups, "count": len(groups)})

    async def _http_scrape_members(self, request: web.Request) -> web.Response:
        try:
            body = await request.json(); group_id = body.get("group", "").strip()
            user_limit = int(body.get("limit", 500)); msg_limit = int(body.get("msg_limit", 3000))
            members = []; seen_ids = set()
            async for msg in self.client.get_chat_history(group_id, limit=msg_limit):
                if len(members) >= user_limit: break
                for u in [msg.from_user, msg.forward_from, msg.reply_to_message.from_user if msg.reply_to_message else None]:
                    if u and not u.is_deleted and str(u.id) not in seen_ids:
                        seen_ids.add(str(u.id))
                        members.append({"tgId": str(u.id), "username": u.username or "", "displayName": f"{u.first_name or ''} {u.last_name or ''}".strip(), "isBot": bool(u.is_bot)})
            return web.json_response({"success": True, "members": members, "total": len(members)})
        except Exception as e: return web.json_response({"success": False, "error": str(e)}, status=500)

    async def _http_scrape_links(self, request: web.Request) -> web.Response:
        try:
            body = await request.json(); group_id = body.get("group", "").strip(); limit = int(body.get("limit", 200))
            tg_link_pattern = re.compile(r"(?:https?://)?t\.me/(?:joinchat/|\+)?([a-zA-Z0-9_\-]{4,})")
            found = set(); results = []
            async for msg in self.client.get_chat_history(group_id, limit=limit):
                text = msg.text or msg.caption or ""
                for match in tg_link_pattern.finditer(text):
                    username = match.group(1)
                    if len(username) < 4 or username.lower() in ("joinchat", "share") or username in found: continue
                    found.add(username)
                    try:
                        chat = await self.client.get_chat(username)
                        results.append({"type": str(chat.type).lower(), "tgId": str(chat.id), "username": chat.username or "", "title": chat.title or ""})
                    except: pass
            return web.json_response({"success": True, "results": results})
        except Exception as e: return web.json_response({"success": False, "error": str(e)}, status=500)

    async def _http_leave_group(self, request: web.Request) -> web.Response:
        try:
            body = await request.json(); cid = body.get("chatId")
            await self.client.leave_chat(int(cid))
            async with self._cache_lock: self._dialog_cache.pop(str(cid), None)
            return web.json_response({"success": True})
        except Exception as e: return web.json_response({"success": False, "error": str(e)}, status=500)

    async def _http_status(self, request: web.Request) -> web.Response:
        async with _config_lock: cfg = dict(_monitor_config)
        return web.json_response({
            "accountId": self.account_id,
            "connected": self.client and self.client.is_connected,
            "cacheSize": len(self._dialog_cache),
            "version": "v4.2",
            "pid": os.getpid(),
            "uptime": int(time.time() - self._start_time),
        })

    async def _http_check_group_health(self, request: web.Request) -> web.Response:
        try:
            body = await request.json(); gids = body.get("group_ids", []); normal = []; abnormal = []
            for gid in gids:
                try:
                    chat = await self.client.get_chat(gid)
                    if getattr(chat, 'is_scam', False) or getattr(chat, 'is_fake', False):
                        abnormal.append({"groupId": str(gid), "reason": "scam/fake"})
                    else: normal.append({"groupId": str(gid)})
                except: abnormal.append({"groupId": str(gid), "reason": "inaccessible"})
            return web.json_response({"success": True, "normal": normal, "abnormal": abnormal})
        except Exception as e: return web.json_response({"success": False, "error": str(e)}, status=500)

# ─── 主控模式 ──────────────────────────────────
async def master_loop():
    logger.info("神探监控主控模式 v4.2 启动...")
    script_path = os.path.abspath(__file__)
    while True:
        try:
            config = await api.fetch_config()
            if config:
                accounts = config.get("accounts", [])
                await api.report_heartbeat({"activeAccounts": len(accounts), "version": "v4.2"})
                jlist_result = subprocess.run([_NODE_BIN, _PM2_SCRIPT, "jlist"], capture_output=True, text=True, env=_PM2_ENV)
                running_names = {p.get("name") for p in json.loads(jlist_result.stdout)} if jlist_result.returncode == 0 else set()
                expected_names = {f"神探-引擎-Acc{acc.get('id')}" for acc in accounts if acc.get('id')}
                for proc_name in running_names:
                    if proc_name.startswith("神探-引擎-Acc") and proc_name not in expected_names:
                        subprocess.run([_NODE_BIN, _PM2_SCRIPT, "delete", proc_name], env=_PM2_ENV)
                for acc in accounts:
                    acc_id = acc.get("id"); proc_name = f"神探-引擎-Acc{acc_id}"
                    if proc_name not in running_names:
                        subprocess.run([_NODE_BIN, _PM2_SCRIPT, "start", _PYTHON_PATH, "--name", proc_name, "--", script_path, "--account_id", str(acc_id)], env=_PM2_ENV)
                subprocess.run([_NODE_BIN, _PM2_SCRIPT, "save"], env=_PM2_ENV)
            await asyncio.sleep(MASTER_CHECK_INTERVAL)
        except Exception as e: logger.error(f"主控异常: {e}"); await asyncio.sleep(5)

async def account_worker_main(account_id: int):
    # [v4.2] PID 文件锁：防止同一账号多次启动
    if not _acquire_pid_lock(account_id):
        logger.error(f"[Account {account_id}] 无法获取 PID 锁，退出")
        return

    async def config_sync():
        global _monitor_config
        while True:
            try:
                cfg = await api.fetch_config()
                if cfg:
                    async with _config_lock: _monitor_config = cfg
                await asyncio.sleep(POLL_INTERVAL)
            except: await asyncio.sleep(10)
    asyncio.create_task(config_sync())
    for _ in range(12):
        await asyncio.sleep(5)
        async with _config_lock:
            if _monitor_config: break
    else:
        _release_pid_lock(account_id)
        return
    acc_data = next((a for a in _monitor_config.get("accounts", []) if a["id"] == account_id), None)
    if not acc_data:
        _release_pid_lock(account_id)
        return
    worker = AccountWorker(acc_data["id"], acc_data.get("phone", ""), acc_data["sessionString"])
    await worker.start()
    if worker._running: await idle()
    # 清理
    _release_pid_lock(account_id)

async def main():
    if args.master: await master_loop()
    elif args.account_id: await account_worker_main(args.account_id)

if __name__ == "__main__":
    asyncio.run(main())
