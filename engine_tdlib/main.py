"""
神探监控机器人 - 引擎 v5.1 (TDLib 架构版 - 百分百监控增强)

基于 TDLib (Telegram Database Library) 官方 C++ 引擎重构。
彻底解决 Pyrogram in_memory 模式导致的 95% 群组消息丢失问题。

核心优势：
1. TDLib 自动管理 SQLite 数据库（peers/access_hash/pts 全部持久化）
2. 完整的 updates gap 处理（断线重连后自动补全丢失消息）
3. C++ 原生引擎性能（单实例轻松支持上万群组）
4. 零配置消息推送（加入群组后自动接收所有消息）

v5.1 增强（百分百监控）：
5. 连接状态实时监控（updateConnectionState 事件监听）
6. 连接看门狗（断连超时/静默失败自动检测与恢复）
7. 定时重载群组列表（防止启动失败后永久丢失群组）
8. 心跳上报含连接状态（管理后台可视化监控）

兼容性：
- HTTP API 接口与 v4.x 完全兼容，Web 端无需修改
- 命令行参数保持一致（--account_id / --master）
- 环境变量保持一致

所有配置从 .env 和 Web API 动态获取，零硬编码。
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
import threading
from collections import OrderedDict
from typing import Optional, Dict, List, Any
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# ─── 环境变量加载 ──────────────────────────────────────────────
try:
    from dotenv import load_dotenv
    _env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(_env_path):
        load_dotenv(_env_path, override=True)
except ImportError:
    pass

import requests
from telegram.client import Telegram

# jieba 分词（可选，用于中文模糊匹配）
try:
    import jieba
    _HAS_JIEBA = True
except ImportError:
    _HAS_JIEBA = False

# ─── 命令行参数 ──────────────────────────────────────────────
parser = argparse.ArgumentParser(description="神探监控引擎 v5.0 (TDLib)")
parser.add_argument("--account_id", type=int, help="启动特定账号的监控进程")
parser.add_argument("--master", action="store_true", help="以主控模式启动")
args = parser.parse_args()

# ─── 基础目录 ──────────────────────────────────────────────
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ─── 日志配置 ──────────────────────────────────────────────
_LOG_DIR = os.path.join(_BASE_DIR, "logs")
os.makedirs(_LOG_DIR, exist_ok=True)
log_suffix = f"-acc{args.account_id}" if args.account_id else "-master" if args.master else ""
_LOG_FILE = os.path.join(_LOG_DIR, f"engine{log_suffix}.log")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(_LOG_FILE, encoding="utf-8"),
    ],
)
# 使用 RotatingFileHandler 避免日志文件无限增长
try:
    from logging.handlers import RotatingFileHandler
    for handler in logging.root.handlers[:]:
        if isinstance(handler, logging.FileHandler) and not isinstance(handler, RotatingFileHandler):
            logging.root.removeHandler(handler)
    rotating_handler = RotatingFileHandler(
        _LOG_FILE, maxBytes=50*1024*1024, backupCount=3, encoding="utf-8"
    )
    rotating_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s"))
    logging.root.addHandler(rotating_handler)
except Exception:
    pass

logger = logging.getLogger(f"shentanbot-engine{log_suffix}")

# ─── 所有配置从环境变量读取（零硬编码）──────────────────────────────
API_BASE = os.getenv("WEB_API_BASE", "http://127.0.0.1:7000/api")
ENGINE_SECRET = os.getenv("ENGINE_SECRET", "")
TG_API_ID = int(os.getenv("TG_API_ID", "0"))
TG_API_HASH = os.getenv("TG_API_HASH", "")
HTTP_PORT_BASE = int(os.getenv("ENGINE_HTTP_PORT_BASE", "7100"))
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "30"))
MASTER_CHECK_INTERVAL = int(os.getenv("MASTER_CHECK_INTERVAL", "10"))
TDLIB_DATA_DIR = os.getenv("TDLIB_DATA_DIR", os.path.join(_BASE_DIR, "tdlib_data"))
TDLIB_VERBOSITY = int(os.getenv("TDLIB_VERBOSITY", "2"))
DB_ENCRYPTION_KEY = os.getenv("TDLIB_DB_KEY", "")
CACHE_REFRESH_INTERVAL = int(os.getenv("CACHE_REFRESH_INTERVAL", "1800"))  # 30分钟
HEARTBEAT_INTERVAL = int(os.getenv("HEARTBEAT_INTERVAL", "60"))
CHAT_RELOAD_INTERVAL = int(os.getenv("CHAT_RELOAD_INTERVAL", "14400"))  # 4小时定时重载群组列表
CONNECTION_WATCHDOG_INTERVAL = int(os.getenv("CONNECTION_WATCHDOG_INTERVAL", "60"))  # 连接状态检查间隔

# 验证必要配置
if not ENGINE_SECRET:
    logger.warning("ENGINE_SECRET 未设置，API 通信可能失败")
if not TG_API_ID or not TG_API_HASH:
    logger.warning("TG_API_ID 或 TG_API_HASH 未设置")

os.makedirs(TDLIB_DATA_DIR, exist_ok=True)

# ─── PID 文件目录 ──────────────────────────────────────────
_PID_DIR = os.path.join(_BASE_DIR, "pids")
os.makedirs(_PID_DIR, exist_ok=True)

# ─── 全局状态 ──────────────────────────────────────────────
_dedup_cache: OrderedDict = OrderedDict()
DEDUP_TTL = 3600
DEDUP_MAX_SIZE = 50000
_rate_cache: Dict[str, List[float]] = {}
_monitor_config: Dict[str, Any] = {}
_config_lock = threading.Lock()

VERSION = "v5.1-tdlib"


# ═══════════════════════════════════════════════════════════════
# 工具函数
# ═══════════════════════════════════════════════════════════════

def is_dedup(chat_id: int, message_id: int) -> bool:
    """消息去重检查（线程安全 OrderedDict）"""
    key = f"{chat_id}:{message_id}"
    if key in _dedup_cache:
        return True
    _dedup_cache[key] = time.time()
    # 清理超出容量的旧条目
    while len(_dedup_cache) > DEDUP_MAX_SIZE:
        _dedup_cache.popitem(last=False)
    return False


def check_rate_limit(sender_id: int, chat_id: int, window: int, limit: int, user_id: int = 0) -> bool:
    """发送者频率限制（按用户独立计算，避免跨用户干扰）"""
    if window <= 0 or limit <= 0:
        return False
    key = f"{user_id}:{sender_id}:{chat_id}"
    now = time.time()
    timestamps = _rate_cache.get(key, [])
    timestamps = [ts for ts in timestamps if now - ts <= window]
    if len(timestamps) >= limit:
        return True
    timestamps.append(now)
    _rate_cache[key] = timestamps
    return False


def match_keyword(text: str, keyword: dict, user_match_mode: str = "fuzzy") -> bool:
    """关键词匹配引擎

    支持匹配类型：
    - contains: 包含匹配（默认）
    - regex: 正则匹配
    - and: 所有子关键词都匹配
    - or: 任一子关键词匹配
    - not: 所有子关键词都不包含
    - fuzzy_cn: 中文分词模糊匹配
    - leftmost/rightmost/exact: 位置匹配
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
        if _HAS_JIEBA:
            words = jieba.cut(text)
            return compare_pattern in " ".join(words)
        else:
            return compare_pattern in compare_text

    # 默认 contains 模式，根据 user_match_mode 调整
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
        return compare_pattern in compare_text


# ═══════════════════════════════════════════════════════════════
# API 客户端（与 Web 端通信）
# ═══════════════════════════════════════════════════════════════

class ApiClient:
    """同步 HTTP 客户端，与 Web 管理端通信

    所有 URL 和认证信息从环境变量获取。
    """

    def __init__(self, base: str, secret: str):
        self.base = base.rstrip("/")
        self.headers = {
            "X-Engine-Secret": secret,
            "Content-Type": "application/json",
        }
        self._session = requests.Session()
        self._session.headers.update(self.headers)

    def get(self, path: str, timeout: int = 30) -> Optional[dict]:
        url = f"{self.base}{path}"
        try:
            r = self._session.get(url, timeout=timeout)
            if r.status_code == 200:
                return r.json()
            else:
                logger.warning(f"API GET {path} -> HTTP {r.status_code}")
        except Exception as e:
            logger.warning(f"API GET {path} 失败: {e}")
        return None

    def post(self, path: str, data: dict, timeout: int = 15) -> Optional[dict]:
        url = f"{self.base}{path}"
        try:
            r = self._session.post(url, json=data, timeout=timeout)
            if r.status_code == 200:
                return r.json()
            else:
                logger.warning(f"API POST {path} -> HTTP {r.status_code}")
        except Exception as e:
            logger.warning(f"API POST {path} 失败: {e}")
        return None

    def fetch_config(self) -> Optional[dict]:
        """获取完整监控配置"""
        return self.get("/engine/config")

    def report_hit(self, payload: dict) -> Optional[dict]:
        """上报关键词命中"""
        return self.post("/engine/hit", payload)

    def report_heartbeat(self, data: dict) -> Optional[dict]:
        """上报心跳"""
        return self.post("/engine/heartbeat", data)


api = ApiClient(API_BASE, ENGINE_SECRET)


# ═══════════════════════════════════════════════════════════════
# PID 文件管理
# ═══════════════════════════════════════════════════════════════

def _pid_file_path(account_id: int) -> str:
    return os.path.join(_PID_DIR, f"engine-acc{account_id}.pid")


def _check_and_write_pid(account_id: int) -> bool:
    """检查并写入 PID 文件，防止重复启动"""
    pid_file = _pid_file_path(account_id)
    if os.path.exists(pid_file):
        try:
            with open(pid_file) as f:
                old_pid = int(f.read().strip())
            os.kill(old_pid, 0)
            logger.error(f"[ACC{account_id}] 已有运行中的进程 PID={old_pid}，退出")
            return False
        except (ProcessLookupError, ValueError):
            os.remove(pid_file)
        except PermissionError:
            logger.error(f"[ACC{account_id}] PID {old_pid} 存在但无权限检查，退出")
            return False
    with open(pid_file, "w") as f:
        f.write(str(os.getpid()))
    return True


def _remove_pid(account_id: int):
    """清理 PID 文件"""
    try:
        os.remove(_pid_file_path(account_id))
    except FileNotFoundError:
        pass


# ═══════════════════════════════════════════════════════════════
# TDLib AccountWorker - 核心监控类
# ═══════════════════════════════════════════════════════════════

class TDLibAccountWorker:
    """基于 TDLib 的账号监控 Worker

    每个账号一个实例，运行在独立进程中。
    TDLib 自动管理：
    - Session 持久化（SQLite 数据库）
    - Peers/access_hash 缓存
    - Updates state (pts/qts/seq) 持久化
    - 断线重连 + 消息补全
    """

    def __init__(self, account_id: int, phone: str):
        self.account_id = account_id
        self.phone = phone
        self.tg: Optional[Telegram] = None
        self._running = False
        self._start_time = time.time()
        self._msg_count = 0
        self._hit_count = 0
        self._error_count = 0
        self._me_info: Optional[dict] = None
        self._me_id: int = 0

        # 对话缓存
        self._dialog_cache: Dict[int, dict] = {}
        self._subscribed_total: int = 0  # 订阅的对话总数（用于前端展示）
        self._dialog_cache_lock = threading.Lock()
        self._is_loading_dialogs = False  # 防止并发加载群组详情

        # TDLib 连接状态监控
        self._connection_state = 'unknown'  # TDLib 连接状态
        self._last_connection_ready_time = time.time()  # 最后一次连接就绪时间
        self._last_message_time = time.time()  # 最后一次收到消息的时间
        self._connection_lost_count = 0  # 连接丢失次数

        # TDLib 数据目录（每个账号独立）
        self._data_dir = os.path.join(TDLIB_DATA_DIR, f"account_{account_id}")
        os.makedirs(self._data_dir, exist_ok=True)

    # ─── 启动流程 ──────────────────────────────────────────────

    def start(self):
        """启动 TDLib Worker（完整生命周期管理）"""
        logger.info(f"[ACC{self.account_id}] ═══ 启动 TDLib Worker {VERSION} ═══")
        logger.info(f"[ACC{self.account_id}] phone={self.phone}, data_dir={self._data_dir}")

        # PID 文件锁防止重复启动
        if not _check_and_write_pid(self.account_id):
            return

        try:
            self._init_tdlib()
            self._login()
            self._load_me_info()
            # 先启动 HTTP 服务器，确保管理接口可用（对话加载可能很慢）
            self._start_http_server()
            self._register_handlers()
            self._start_background_tasks()
            self._running = True
            # 对话加载放到最后，在后台线程中异步执行
            threading.Thread(
                target=self._load_chats_safe,
                daemon=True,
                name=f"chat-loader-{self.account_id}"
            ).start()
            logger.info(
                f"[ACC{self.account_id}] ✓ Worker 启动成功 "
                f"(对话数={len(self._dialog_cache)}, version={VERSION})"
            )
            self._run_forever()
        except Exception as e:
            logger.error(f"[ACC{self.account_id}] ✗ 启动失败: {e}", exc_info=True)
            self._error_count += 1
        finally:
            self._cleanup()

    def _init_tdlib(self):
        """初始化 TDLib 客户端

        所有参数从环境变量获取，不硬编码。
        TDLib 会在 files_directory 下创建 SQLite 数据库，
        自动持久化所有 session、peer、update state 信息。
        """
        if not TG_API_ID or not TG_API_HASH:
            raise RuntimeError("TG_API_ID 和 TG_API_HASH 必须在 .env 中配置")

        self.tg = Telegram(
            api_id=TG_API_ID,
            api_hash=TG_API_HASH,
            phone=self.phone,
            database_encryption_key=DB_ENCRYPTION_KEY,
            files_directory=self._data_dir,
            tdlib_verbosity=TDLIB_VERBOSITY,
            use_message_database=True,
        )
        logger.info(f"[ACC{self.account_id}] TDLib 客户端已初始化 (api_id={TG_API_ID})")

    def _login(self):
        """TDLib 登录（非阻塞模式）

        - 如果本地已有 session 文件（之前登录过），自动复用，无需验证码
        - 如果是首次登录（需要验证码/密码），抛出异常提示用户通过 Web 后台完成
        - 使用 login(blocking=False) 避免在后台进程中调用 input()
        """
        from telegram.client import AuthorizationState

        state = self.tg.login(blocking=False)
        logger.info(f"[ACC{self.account_id}] TDLib 登录状态: {state}")

        if state == AuthorizationState.READY:
            logger.info(f"[ACC{self.account_id}] TDLib 登录成功（session 已存在）")
            return

        if state == AuthorizationState.WAIT_CODE:
            raise RuntimeError(
                f"账号 {self.phone} 需要验证码登录。"
                f"请通过管理后台「账号管理」→「登录」完成首次验证。"
                f"登录成功后重启引擎即可。"
            )

        if state == AuthorizationState.WAIT_PASSWORD:
            raise RuntimeError(
                f"账号 {self.phone} 需要二步验证密码。"
                f"请通过管理后台「账号管理」→「登录」完成验证。"
            )

        if state == AuthorizationState.WAIT_REGISTRATION:
            raise RuntimeError(
                f"账号 {self.phone} 未注册 Telegram，无法使用。"
            )

        # 其他未知状态
        raise RuntimeError(
            f"TDLib 登录异常，当前状态: {state}。"
            f"请检查网络连接或通过管理后台重新登录。"
        )

    def _load_me_info(self):
        """获取当前账号信息"""
        result = self.tg.get_me()
        result.wait(timeout=10)
        if result.update:
            self._me_info = result.update
            self._me_id = self._me_info.get('id', 0)
            uname = self._extract_username_from_user(self._me_info)
            logger.info(
                f"[ACC{self.account_id}] 当前用户: "
                f"{self._me_info.get('first_name', '')} (@{uname}) [ID: {self._me_id}]"
            )

    def _load_chats_safe(self):
        """在后台线程中安全地订阅对话（仅调用 getChats，不获取详情）"""
        try:
            self._subscribe_chats()
        except Exception as e:
            logger.error(f"[ACC{self.account_id}] 后台订阅对话失败: {e}")

    def _subscribe_chats(self):
        """订阅所有对话的消息推送（最优方案：循环 loadChats 确保全量加载）

        TDLib 工作原理：
        - loadChats 触发 TDLib 从服务器拉取对话列表到本地 SQLite 缓存
        - 需要循环调用直到返回 "Already loading" 或无更多对话
        - getChats 从本地缓存读取已加载的对话 ID
        - 只要 chat_id 在 _dialog_cache 中，TDLib 就会推送该群的消息

        关键：loadChats 必须循环调用，确保所有已加入群组（包括不活跃小群）
        都被加载到 TDLib 本地缓存，否则排序靠后的小群会被遗漏。
        """
        logger.info(f"[ACC{self.account_id}] 开始订阅对话列表（全量加载模式，循环至 CHAT_LIST_IS_EMPTY）...")

        # 第一步：循环调用 loadChats，直到 TDLib 返回 CHAT_LIST_IS_EMPTY
        # ---------------------------------------------------------------
        # TDLib 官方约定：
        #   - loadChats 成功（无错误）：本批加载完成，继续下一轮
        #   - 返回 CHAT_LIST_IS_EMPTY（error code 404）：所有对话已全部加载完毕
        #   - 返回 "Already loading" (error code 400)：TDLib 内部正在加载，稍等重试
        # 不设轮次上限，确保 100% 加载所有已加入群组（包括不活跃小群）
        load_round = 0
        while True:
            try:
                result = self.tg.call_method('loadChats', {
                    'chat_list': {'@type': 'chatListMain'},
                    'limit': 100,
                })
                result.wait(timeout=30)
                if result.error:
                    err_msg = str(result.error_info) if result.error_info else ''
                    # 兼容 dict 和 object 两种类型获取 error code
                    if isinstance(result.error_info, dict):
                        err_code = result.error_info.get('code', 0)
                    else:
                        err_code = getattr(result.error_info, 'code', 0) if result.error_info else 0

                    # CHAT_LIST_IS_EMPTY / Not Found (404)：所有对话已全部加载完毕
                    # TDLib python-telegram 库返回 {'code': 404, 'message': 'Not Found'}
                    if (err_code == 404
                            or 'CHAT_LIST_IS_EMPTY' in err_msg
                            or 'chat list is empty' in err_msg.lower()
                            or 'Not Found' in err_msg
                            or 'not found' in err_msg.lower()
                            or 'no more' in err_msg.lower()):
                        logger.info(
                            f"[ACC{self.account_id}] ✓ loadChats 全量加载完毕 "
                            f"（共 {load_round} 轮，TDLib 返回: code={err_code}）"
                        )
                        break

                    # Already loading (400)：TDLib 内部正在加载，等待后重试
                    if (err_code == 400
                            or 'already' in err_msg.lower()
                            or 'loading' in err_msg.lower()):
                        logger.debug(
                            f"[ACC{self.account_id}] loadChats 第{load_round+1}轮：TDLib 正在加载，等待1秒..."
                        )
                        time.sleep(1)
                        continue

                    # 其他错误：记录并退出（避免无限循环）
                    logger.warning(f"[ACC{self.account_id}] loadChats 未知错误: code={err_code}, msg={err_msg}，停止加载")
                    break

                # 成功加载一批，继续下一轮
                load_round += 1
                logger.debug(f"[ACC{self.account_id}] loadChats 第{load_round}轮完成，继续...")
                time.sleep(0.3)  # 短暂间隔，避免频率限制

            except Exception as e:
                err_str = str(e)
                if ('chat list is empty' in err_str.lower()
                        or 'no more' in err_str.lower()
                        or 'not found' in err_str.lower()
                        or 'CHAT_LIST_IS_EMPTY' in err_str
                        or '404' in err_str):
                    logger.info(f"[ACC{self.account_id}] ✓ loadChats 全量加载完毕（第{load_round}轮）")
                    break
                logger.warning(f"[ACC{self.account_id}] loadChats 异常: {e}，停止加载")
                break

        logger.info(f"[ACC{self.account_id}] loadChats 循环结束，共执行 {load_round} 轮")
        time.sleep(1)

        # 第二步：用 getChats 分页获取所有已加入群组（从本地缓存读取）
        total_ids = 0
        offset_order = "9223372036854775807"
        offset_chat_id = 0
        page = 0
        while page < 100:  # 最多100页，每页100个，最多10000个群组
            try:
                result = self.tg.call_method('getChats', {
                    'chat_list': {'@type': 'chatListMain'},
                    'limit': 100,
                    'offset_order': offset_order,
                    'offset_chat_id': offset_chat_id,
                })
                result.wait(timeout=30)
                if result.error:
                    logger.warning(f"[ACC{self.account_id}] getChats 错误: {result.error_info}")
                    break
                if not result.update:
                    break
                chat_ids = result.update.get('chat_ids', [])
                if not chat_ids:
                    break
                with self._dialog_cache_lock:
                    for cid in chat_ids:
                        if cid not in self._dialog_cache:
                            self._dialog_cache[cid] = None
                total_ids += len(chat_ids)
                page += 1
                if len(chat_ids) < 100:
                    break
                # 获取最后一个 chat 的 order 值用于正确分页
                last_cid = chat_ids[-1]
                try:
                    chat_result = self.tg.call_method('getChat', {'chat_id': last_cid})
                    chat_result.wait(timeout=10)
                    if not chat_result.error and chat_result.update:
                        positions = chat_result.update.get('positions', [])
                        last_order = None
                        for pos in positions:
                            if pos.get('list', {}).get('@type') == 'chatListMain':
                                last_order = pos.get('order', '0')
                                break
                        if last_order and last_order != '0':
                            offset_order = last_order
                            offset_chat_id = last_cid
                        else:
                            # 无法获取 order，停止分页
                            break
                    else:
                        break
                except Exception:
                    break
                time.sleep(0.2)
            except Exception as e:
                logger.warning(f"[ACC{self.account_id}] 订阅对话异常: {e}")
                break
        with self._dialog_cache_lock:
            self._subscribed_total = len(self._dialog_cache)
        logger.info(f"[ACC{self.account_id}] ✓ 对话订阅完成: {self._subscribed_total} 个对话已注册（消息推送已激活）")
    def _load_dialogs_on_demand(self) -> list:
        """按需加载对话详情（前端请求 /dialogs 时调用）

        逐个获取详情，严格限速（每秒最多 2 个），避免 FLOOD_WAIT。
        已加载的直接返回缓存，未加载的实时获取。
        """
        results = []
        to_fetch = []

        with self._dialog_cache_lock:
            for chat_id, info in self._dialog_cache.items():
                if info is not None:
                    results.append(info)
                else:
                    to_fetch.append(chat_id)

        if not to_fetch:
            return results

        logger.info(f"[ACC{self.account_id}] 按需加载 {len(to_fetch)} 个对话详情...")
        loaded = 0
        for chat_id in to_fetch:
            try:
                info = self._fetch_chat_info(chat_id)
                if info:
                    with self._dialog_cache_lock:
                        self._dialog_cache[chat_id] = info
                    results.append(info)
                    loaded += 1
                else:
                    # 非群组/频道，标记为已处理（空字典表示已检查但非群组）
                    with self._dialog_cache_lock:
                        self._dialog_cache[chat_id] = {}
                time.sleep(0.5)  # 每秒最多 2 个，严格限速
            except Exception as e:
                logger.debug(f"[ACC{self.account_id}] 加载对话 {chat_id} 详情失败: {e}")
                time.sleep(1)  # 出错时等更久

        logger.info(f"[ACC{self.account_id}] 按需加载完成: 新增 {loaded} 个群组/频道")
        return results

    def _fetch_chat_info(self, chat_id: int) -> Optional[dict]:
        """获取单个对话的详细信息"""
        try:
            result = self.tg.call_method('getChat', {'chat_id': chat_id})
            result.wait(timeout=10)
            if result.update:
                chat = result.update
                chat_type = chat.get('type', {}).get('@type', '')
                # 只缓存群组和超级群组
                if chat_type in ('chatTypeSupergroup', 'chatTypeBasicGroup'):
                    return {
                        'chatId': str(chat_id),
                        'title': chat.get('title', ''),
                        'username': self._extract_username_from_chat(chat),
                        'memberCount': chat.get('member_count', 0) or 0,
                        'type': 'supergroup' if chat_type == 'chatTypeSupergroup' else 'group',
                    }
        except Exception as e:
            logger.debug(f"[ACC{self.account_id}] 获取对话 {chat_id} 详情失败: {e}")
        return None

    # ─── 用户名提取工具 ──────────────────────────────────────────

    def _extract_username_from_chat(self, chat: dict) -> str:
        """从 TDLib chat 对象提取 username"""
        # TDLib 1.8.x+ 使用 usernames 对象
        usernames = chat.get('usernames', {})
        if usernames and isinstance(usernames, dict):
            return usernames.get('editable_username', '') or ''
        # 旧版兼容
        return chat.get('username', '') or ''

    def _extract_username_from_user(self, user: dict) -> str:
        """从 TDLib user 对象提取 username"""
        usernames = user.get('usernames', {})
        if usernames and isinstance(usernames, dict):
            return usernames.get('editable_username', '') or ''
        return user.get('username', '') or ''


    # ─── 消息处理 ──────────────────────────────────────────────

    def _register_handlers(self):
        """注册 TDLib 事件处理器"""
        # 新消息处理器
        self.tg.add_message_handler(self._on_new_message)
        # 群组成员变更处理器（自动更新缓存）
        self.tg.add_update_handler('updateChatMember', self._on_chat_member_update)
        # 【方案一】监听 updateNewChat：TDLib 加载到任何对话时自动补录到 _dialog_cache
        self.tg.add_update_handler('updateNewChat', self._on_new_chat)
        # 【新增】监听 TDLib 连接状态变更，及时感知断连/重连
        self.tg.add_update_handler('updateConnectionState', self._on_connection_state)
        logger.info(f"[ACC{self.account_id}] 事件处理器已注册（updateNewMessage + updateNewChat + updateConnectionState）")

    def _on_new_chat(self, update: dict):
        """【方案一】处理 updateNewChat 事件：TDLib 加载到新对话时自动补录到 _dialog_cache

        TDLib 在以下情况会触发 updateNewChat：
        1. 引擎启动时，loadChats 加载每一个对话
        2. 账号加入新群组时
        3. 有人给账号发消息时（私聊）

        通过监听此事件，无论群组活跃度高低，只要 TDLib 加载到它，
        引擎就会自动把它加入 _dialog_cache，确保零漏报。
        """
        try:
            chat = update.get('chat', {})
            if not chat:
                return
            chat_id = chat.get('id', 0)
            if not chat_id or chat_id >= 0:
                return  # 只处理群组（负数 chat_id）
            chat_type = chat.get('type', {}).get('@type', '')
            # 只缓存群组和超级群组，忽略私聊和频道
            if chat_type not in ('chatTypeSupergroup', 'chatTypeBasicGroup'):
                return
            with self._dialog_cache_lock:
                if chat_id not in self._dialog_cache:
                    title = chat.get('title', '')
                    username = self._extract_username_from_chat(chat)
                    self._dialog_cache[chat_id] = {
                        'chatId': str(chat_id),
                        'title': title,
                        'username': username,
                        'memberCount': chat.get('member_count', 0) or 0,
                        'type': 'supergroup' if chat_type == 'chatTypeSupergroup' else 'group',
                    }
                    logger.info(
                        f"[ACC{self.account_id}] [AUTO-DISCOVER] 自动发现新群组: "
                        f"{title!r}({chat_id}), username={username!r}"
                    )
        except Exception as e:
            logger.debug(f"[ACC{self.account_id}] _on_new_chat 异常: {e}")

    def _on_connection_state(self, update: dict):
        """监控 TDLib 连接状态变更

        TDLib 连接状态：
        - connectionStateWaitingForNetwork: 等待网络
        - connectionStateConnectingToProxy: 连接代理
        - connectionStateConnecting: 正在连接
        - connectionStateUpdating: 同步更新中
        - connectionStateReady: 连接就绪（正常工作状态）
        """
        try:
            state = update.get('state', {}).get('@type', 'unknown')
            old_state = self._connection_state
            self._connection_state = state

            if state == 'connectionStateReady':
                self._last_connection_ready_time = time.time()
                if old_state != 'connectionStateReady' and old_state != 'unknown':
                    # 从断连状态恢复
                    logger.info(
                        f"[ACC{self.account_id}] ✅ TDLib 连接已恢复 "
                        f"(上次状态: {old_state})"
                    )
            elif state in ('connectionStateConnecting', 'connectionStateWaitingForNetwork'):
                self._connection_lost_count += 1
                logger.warning(
                    f"[ACC{self.account_id}] ⚠️ TDLib 连接中断: {state} "
                    f"(累计断连 {self._connection_lost_count} 次)"
                )
            else:
                logger.info(f"[ACC{self.account_id}] TDLib 连接状态: {state}")
        except Exception as e:
            logger.debug(f"[ACC{self.account_id}] _on_connection_state 异常: {e}")

    def _on_new_message(self, update: dict):
        """处理新消息事件

        TDLib 的 updateNewMessage 包含完整的 message 对象。
        支持 text 消息和 caption（图片/视频/文件的文字说明）。
        """
        try:
            message = update.get('message', {})
            if not message:
                return

            chat_id = message.get('chat_id', 0)
            # 只处理群组消息（chat_id 为负数）
            if not chat_id or chat_id >= 0:
                return

            # 忽略自己发的消息
            if message.get('is_outgoing', False):
                return

            # 提取文本（支持 text + caption）
            text = self._extract_message_text(message)
            if not text:
                return

            # 消息去重
            msg_id = message.get('id', 0)
            if is_dedup(chat_id, msg_id):
                return

            self._msg_count += 1
            self._last_message_time = time.time()

            # 发送者信息
            sender = message.get('sender_id', {})
            sender_type = sender.get('@type', '')
            sender_id = 0
            sender_is_bot = False
            if sender_type == 'messageSenderUser':
                sender_id = sender.get('user_id', 0)
            elif sender_type == 'messageSenderChat':
                sender_id = sender.get('chat_id', 0)

            # 【方案二】群组信息（从缓存获取，缓存未命中时自动补录完整信息）
            # 即使 _subscribe_chats 没有加载到该群，收到消息时也不会丢弃，
            # 而是动态获取群组信息并补录到缓存，确保后续消息也能正常处理。
            chat_info = self._dialog_cache.get(chat_id)
            if chat_info:
                chat_title = chat_info.get('title', '')
                chat_username = chat_info.get('username', '')
            else:
                # 缓存未命中：动态获取完整群组信息并补录到 _dialog_cache
                fetched_info = self._fetch_chat_info(chat_id)
                if fetched_info:
                    with self._dialog_cache_lock:
                        self._dialog_cache[chat_id] = fetched_info
                    chat_title = fetched_info.get('title', '')
                    chat_username = fetched_info.get('username', '')
                    logger.info(
                        f"[ACC{self.account_id}] [AUTO-RECOVER] 缓存未命中，已自动补录: "
                        f"{chat_title!r}({chat_id})"
                    )
                else:
                    # getChat 失败（可能是私聊或已退出的群），仍然尝试处理消息
                    chat_title = self._get_and_cache_chat_title(chat_id)
                    chat_username = ''

            # 日志记录
            logger.info(
                f"[ACC{self.account_id}] [MSG] "
                f"chat={chat_title!r}({chat_id}), sender={sender_id}, "
                f"text={text[:80]!r}"
            )

            # 关键词匹配
            self._process_keywords(
                chat_id=chat_id,
                chat_title=chat_title,
                chat_username=chat_username,
                message_id=msg_id,
                text=text,
                sender_id=sender_id,
                sender_is_bot=sender_is_bot,
                message=message,
            )

        except Exception as e:
            self._error_count += 1
            logger.error(f"[ACC{self.account_id}] 消息处理异常: {e}", exc_info=True)

    def _extract_message_text(self, message: dict) -> str:
        """从 TDLib 消息对象提取文本

        支持所有包含文本的消息类型：
        - messageText: 纯文本消息
        - messagePhoto/Video/Document/Animation/Audio/VoiceNote: caption
        """
        content = message.get('content', {})
        content_type = content.get('@type', '')

        if content_type == 'messageText':
            text_obj = content.get('text', {})
            return text_obj.get('text', '')
        elif content_type in (
            'messagePhoto', 'messageVideo', 'messageDocument',
            'messageAnimation', 'messageAudio', 'messageVoiceNote',
            'messageVideoNote', 'messageSticker',
        ):
            caption = content.get('caption', {})
            return caption.get('text', '')
        return ''

    def _get_and_cache_chat_title(self, chat_id: int) -> str:
        """获取群组标题并缓存"""
        try:
            result = self.tg.call_method('getChat', {'chat_id': chat_id})
            result.wait(timeout=5)
            if result.update:
                title = result.update.get('title', '')
                chat_type = result.update.get('type', {}).get('@type', '')
                if chat_type in ('chatTypeSupergroup', 'chatTypeBasicGroup'):
                    with self._dialog_cache_lock:
                        self._dialog_cache[chat_id] = {
                            'chatId': str(chat_id),
                            'title': title,
                            'username': self._extract_username_from_chat(result.update),
                            'memberCount': result.update.get('member_count', 0) or 0,
                            'type': 'supergroup' if chat_type == 'chatTypeSupergroup' else 'group',
                        }
                return title
        except Exception:
            pass
        return ''

    def _get_sender_info(self, sender_id: int) -> dict:
        """获取发送者详细信息"""
        if sender_id <= 0:
            return {'id': sender_id, 'username': '', 'first_name': '', 'last_name': '', 'is_bot': False}
        try:
            result = self.tg.call_method('getUser', {'user_id': sender_id})
            result.wait(timeout=5)
            if result.update:
                user = result.update
                return {
                    'id': sender_id,
                    'username': self._extract_username_from_user(user),
                    'first_name': user.get('first_name', ''),
                    'last_name': user.get('last_name', ''),
                    'is_bot': user.get('type', {}).get('@type', '') == 'userTypeBot',
                }
        except Exception:
            pass
        return {'id': sender_id, 'username': '', 'first_name': '', 'last_name': '', 'is_bot': False}

    # ─── 关键词匹配引擎 ──────────────────────────────────────────

    def _process_keywords(self, chat_id: int, chat_title: str, chat_username: str,
                          message_id: int, text: str, sender_id: int,
                          sender_is_bot: bool, message: dict):
        """关键词匹配和命中上报

        遍历所有用户的配置，检查：
        1. 全局反垃圾规则
        2. 每个用户的全局关键词
        3. 每个用户的群组级关键词
        """
        with _config_lock:
            config = dict(_monitor_config)
        if not config:
            return

        anti_spam = config.get("globalAntiSpam", {})
        user_configs = config.get("userConfigs", {})

        # 全局反垃圾检查
        max_len = anti_spam.get("globalMaxMsgLen", 0)
        if max_len > 0 and len(text) > max_len:
            return
        if anti_spam.get("filterBot", True) and sender_is_bot:
            return

        # 遍历每个用户的配置
        for uid_str, user_cfg in user_configs.items():
            user_id = int(uid_str)
            push_settings = user_cfg.get("pushSettings", {})

            # 用户级 bot 过滤
            if push_settings.get("filterBots", False) and sender_is_bot:
                continue

            # 频率限制
            rate_window = anti_spam.get("globalRateWindow", 60)
            rate_limit = anti_spam.get("globalRateLimit", 5)
            if sender_id and check_rate_limit(sender_id, chat_id, rate_window, rate_limit, user_id):
                continue

            mode = push_settings.get("keywordMatchMode", "fuzzy")
            hit = False

            # 1. 全局关键词匹配
            for kw in user_cfg.get("globalKeywords", []):
                if kw.get("isActive", True) and kw.get("pattern") and match_keyword(text, kw, mode):
                    self._report_hit(
                        chat_id=chat_id,
                        chat_title=chat_title,
                        message_id=message_id,
                        text=text,
                        sender_id=sender_id,
                        keyword=kw,
                        user_id=user_id,
                        message=message,
                    )
                    self._hit_count += 1
                    hit = True
                    break

            if hit:
                continue

            # 2. 群组级关键词匹配
            for group in user_cfg.get("groups", []):
                group_id = group.get("groupId", "")
                # 匹配群组（支持 chatId 和 username）
                if str(chat_id) == group_id or chat_username == group.get("groupUsername", ""):
                    for kw in group.get("keywords", []):
                        if kw.get("isActive", True) and kw.get("pattern") and match_keyword(text, kw, mode):
                            self._report_hit(
                                chat_id=chat_id,
                                chat_title=chat_title,
                                message_id=message_id,
                                text=text,
                                sender_id=sender_id,
                                keyword=kw,
                                user_id=user_id,
                                message=message,
                            )
                            self._hit_count += 1
                            hit = True
                            break
                    break  # 已找到匹配的群组，不再继续

    def _report_hit(self, chat_id: int, chat_title: str, message_id: int,
                    text: str, sender_id: int, keyword: dict, user_id: int,
                    message: dict):
        """上报命中记录到 Web 端（异步，不阻塞消息处理）"""
        sender_info = self._get_sender_info(sender_id) if sender_id > 0 else {}

        payload = {
            "userId": user_id,
            "monitorAccountId": self.account_id,
            "tgGroupId": str(chat_id),
            "groupName": chat_title,
            "senderTgId": str(sender_id) if sender_id else "",
            "senderUsername": sender_info.get('username', ''),
            "senderName": f"{sender_info.get('first_name', '')} {sender_info.get('last_name', '')}".strip(),
            "messageText": text,
            "matchedKeywords": [keyword.get("pattern", "")],
            "messageId": str(message_id),
        }

        # 异步上报，不阻塞消息处理主线程
        threading.Thread(target=api.report_hit, args=(payload,), daemon=True).start()
        logger.info(
            f"[ACC{self.account_id}] [HIT] "
            f"user={user_id}, keyword={keyword.get('pattern', '')!r}, "
            f"chat={chat_title!r}, text={text[:50]!r}"
        )

    # ─── 群组成员变更事件 ──────────────────────────────────────────

    def _on_chat_member_update(self, update: dict):
        """处理群组成员变更事件（自动更新缓存）"""
        try:
            chat_id = update.get('chat_id', 0)
            new_member = update.get('new_chat_member', {})
            new_status = new_member.get('status', {}).get('@type', '')
            member_id = new_member.get('member_id', {})
            member_user_id = member_id.get('user_id', 0) if member_id.get('@type') == 'messageSenderUser' else 0

            # 只关心自己的加入/退出事件
            if member_user_id == self._me_id:
                if new_status in ('chatMemberStatusMember', 'chatMemberStatusAdministrator',
                                  'chatMemberStatusCreator'):
                    logger.info(f"[ACC{self.account_id}] [EVENT] 加入群组 {chat_id}")
                    # 获取群组信息并加入缓存
                    info = self._fetch_chat_info(chat_id)
                    if info:
                        with self._dialog_cache_lock:
                            self._dialog_cache[chat_id] = info
                elif new_status in ('chatMemberStatusLeft', 'chatMemberStatusBanned'):
                    logger.info(f"[ACC{self.account_id}] [EVENT] 离开群组 {chat_id}")
                    with self._dialog_cache_lock:
                        self._dialog_cache.pop(chat_id, None)
        except Exception as e:
            logger.debug(f"[ACC{self.account_id}] 处理成员变更事件出错: {e}")


    # ─── 后台定时任务 ──────────────────────────────────────────────

    def _start_background_tasks(self):
        """启动后台定时任务线程"""
        threading.Thread(target=self._config_poll_loop, daemon=True, name="config-poll").start()
        threading.Thread(target=self._heartbeat_loop, daemon=True, name="heartbeat").start()
        threading.Thread(target=self._cache_refresh_loop, daemon=True, name="cache-refresh").start()
        threading.Thread(target=self._connection_watchdog_loop, daemon=True, name="conn-watchdog").start()
        logger.info(
            f"[ACC{self.account_id}] 后台任务已启动 "
            f"(poll={POLL_INTERVAL}s, heartbeat={HEARTBEAT_INTERVAL}s, "
            f"cache_refresh={CACHE_REFRESH_INTERVAL}s, conn_watchdog={CONNECTION_WATCHDOG_INTERVAL}s)"
        )

    def _config_poll_loop(self):
        """定时拉取监控配置"""
        global _monitor_config
        # 首次立即拉取
        time.sleep(2)
        while self._running or not self._running:  # 启动前也要拉取
            try:
                config = api.fetch_config()
                if config:
                    with _config_lock:
                        _monitor_config = config
            except Exception as e:
                logger.warning(f"[ACC{self.account_id}] 配置拉取失败: {e}")
            time.sleep(POLL_INTERVAL)

    def _heartbeat_loop(self):
        """定时心跳上报"""
        time.sleep(5)
        while True:
            try:
                if self._running:
                    # 计算群组统计
                    subscribed_count = 0
                    cached_count = 0
                    pending_count = 0
                    with self._dialog_cache_lock:
                        for chat_id, info in self._dialog_cache.items():
                            subscribed_count += 1
                            if info is None:
                                pending_count += 1
                            elif info:
                                cached_count += 1
                    # 已订阅总数（分页订阅记录的全量数）
                    subscribed_total = getattr(self, '_subscribed_total', subscribed_count)

                    data = {
                        "accountId": self.account_id,
                        "status": "online" if self._connection_state == 'connectionStateReady' else "degraded",
                        "version": VERSION,
                        "dialogCount": cached_count,
                        "subscribedCount": subscribed_count,
                        "subscribedTotal": subscribed_total,
                        "cachedCount": cached_count,
                        "pendingCount": pending_count,
                        "msgCount": self._msg_count,
                        "hitCount": self._hit_count,
                        "errorCount": self._error_count,
                        "uptime": int(time.time() - self._start_time),
                        "engine": "tdlib",
                        "connectionState": self._connection_state,
                        "connectionLostCount": self._connection_lost_count,
                        "lastMsgAge": int(time.time() - self._last_message_time),
                    }
                    api.report_heartbeat(data)

                    # 如果有待加载的群组且未在加载中，自动触发后台加载
                    if pending_count > 0 and not self._is_loading_dialogs:
                        threading.Thread(
                            target=self._auto_load_pending,
                            daemon=True,
                            name="auto-load-pending"
                        ).start()
            except Exception as e:
                logger.warning(f"[ACC{self.account_id}] 心跳上报失败: {e}")
            time.sleep(HEARTBEAT_INTERVAL)

    def _auto_load_pending(self):
        """自动在后台加载待获取详情的群组（心跳触发）"""
        if self._is_loading_dialogs:
            return
        self._is_loading_dialogs = True
        try:
            to_fetch = []
            with self._dialog_cache_lock:
                for chat_id, info in self._dialog_cache.items():
                    if info is None:
                        to_fetch.append(chat_id)

            if not to_fetch:
                return

            logger.info(f"[ACC{self.account_id}] 自动加载 {len(to_fetch)} 个待缓存群组...")
            loaded = 0
            for chat_id in to_fetch:
                if not self._running:
                    break
                try:
                    info = self._fetch_chat_info(chat_id)
                    if info:
                        with self._dialog_cache_lock:
                            self._dialog_cache[chat_id] = info
                        loaded += 1
                    else:
                        with self._dialog_cache_lock:
                            self._dialog_cache[chat_id] = {}
                    time.sleep(0.5)
                except Exception:
                    time.sleep(1)

            logger.info(f"[ACC{self.account_id}] 自动加载完成: 新增 {loaded} 个群组")
        finally:
            self._is_loading_dialogs = False

    def _cache_refresh_loop(self):
        """定时刷新对话订阅（轻量级，只获取新加入的群组 ID）"""
        while True:
            time.sleep(CACHE_REFRESH_INTERVAL)
            try:
                if self._running:
                    logger.info(f"[ACC{self.account_id}] 定时刷新对话订阅...")
                    self._subscribe_chats()
            except Exception as e:
                logger.warning(f"[ACC{self.account_id}] 订阅刷新失败: {e}")

    def _connection_watchdog_loop(self):
        """连接看门狗：定时检查 TDLib 连接状态和消息流量

        检测两种异常：
        1. TDLib 连接状态非 Ready 超过 5 分钟（严重断连）
        2. 超过 30 分钟未收到任何消息（可能静默失败）

        当检测到异常时，尝试触发重新订阅群组列表以确保消息推送正常。
        """
        time.sleep(30)  # 启动后等待一段时间再开始监控
        while True:
            time.sleep(CONNECTION_WATCHDOG_INTERVAL)
            if not self._running:
                continue
            try:
                now = time.time()
                conn_state = self._connection_state

                # 检查 1：TDLib 连接状态异常
                if conn_state != 'connectionStateReady':
                    disconnected_duration = now - self._last_connection_ready_time
                    if disconnected_duration > 300:  # 5分钟未恢复
                        logger.error(
                            f"[ACC{self.account_id}] 🚨 TDLib 断连超过 {disconnected_duration:.0f}秒! "
                            f"当前状态: {conn_state}"
                        )
                        # 尝试触发重新订阅（TDLib 内部会自动重连，我们只需确保重连后群组列表完整）
                        if disconnected_duration > 600:  # 10分钟后尝试重新订阅
                            logger.warning(f"[ACC{self.account_id}] 断连超过10分钟，触发重新订阅群组...")
                            try:
                                self._subscribe_chats()
                            except Exception as e:
                                logger.error(f"[ACC{self.account_id}] 重新订阅失败: {e}")

                # 检查 2：长时间未收到消息（静默失败检测）
                msg_silence_duration = now - self._last_message_time
                if msg_silence_duration > 1800:  # 30分钟无消息
                    logger.warning(
                        f"[ACC{self.account_id}] ⚠️ 超过 {msg_silence_duration:.0f}秒未收到消息 "
                        f"(连接状态: {conn_state}, 群组数: {len(self._dialog_cache)})"
                    )
                    # 如果连接正常但无消息，可能是群组订阅丢失，触发重新订阅
                    if conn_state == 'connectionStateReady' and msg_silence_duration > 3600:
                        logger.warning(f"[ACC{self.account_id}] 连接正常但无消息超过1小时，触发重新订阅...")
                        try:
                            self._subscribe_chats()
                            self._last_message_time = time.time()  # 重置计时器避免重复触发
                        except Exception as e:
                            logger.error(f"[ACC{self.account_id}] 重新订阅失败: {e}")

            except Exception as e:
                logger.error(f"[ACC{self.account_id}] 连接看门狗异常: {e}")

    # ─── HTTP API 服务器（兼容 v4.x 接口）──────────────────────────

    def _start_http_server(self):
        """启动 HTTP API 服务器

        端口 = ENGINE_HTTP_PORT_BASE + account_id（从环境变量读取）
        完全兼容 v4.x 的所有接口，Web 端无需修改。
        """
        port = HTTP_PORT_BASE + self.account_id
        worker = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format, *args):
                pass  # 静默 HTTP 日志

            def do_GET(self):
                path = urlparse(self.path).path
                handlers = {
                    '/health': worker._handle_health,
                    '/stats': worker._handle_stats,
                    '/dialogs': worker._handle_dialogs,
                    '/status': worker._handle_status,
                }
                handler = handlers.get(path)
                if handler:
                    self._respond(handler())
                else:
                    self._respond({"error": "Not found"}, 404)

            def do_POST(self):
                path = urlparse(self.path).path
                body = self._read_body()
                handlers = {
                    '/join-group': worker._handle_join_group,
                    '/resubscribe': lambda b: worker._handle_resubscribe(b),
                    '/leave-group': worker._handle_leave_group,
                    '/scrape-members': worker._handle_scrape_members,
                    '/scrape-links': worker._handle_scrape_links,
                    '/check-group-health': worker._handle_check_group_health,
                    '/send-message': worker._handle_send_message,
                    '/get-chat-history': worker._handle_get_chat_history,
                    '/activate-groups': lambda b: {"status": "ok", "message": "TDLib 自动管理，无需手动激活"},
                }
                handler = handlers.get(path)
                if handler:
                    self._respond(handler(body))
                else:
                    self._respond({"error": "Not found"}, 404)

            def _read_body(self) -> dict:
                try:
                    length = int(self.headers.get('Content-Length', 0))
                    if length > 0:
                        return json.loads(self.rfile.read(length))
                except Exception:
                    pass
                return {}

            def _respond(self, data: dict, status: int = 200):
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(data, ensure_ascii=False).encode())

        # 端口冲突处理
        if not self._check_port_available(port):
            logger.warning(f"[ACC{self.account_id}] 端口 {port} 被占用，尝试清理...")
            self._kill_port_occupant(port)
            time.sleep(1)

        try:
            server = HTTPServer(('0.0.0.0', port), Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True, name=f"http-{port}")
            thread.start()
            logger.info(f"[ACC{self.account_id}] HTTP 服务器启动: port={port}")
        except Exception as e:
            logger.error(f"[ACC{self.account_id}] HTTP 服务器启动失败: {e}")
            logger.info(f"[ACC{self.account_id}] 消息监控仍正常运行（HTTP 不影响核心功能）")

    def _check_port_available(self, port: int) -> bool:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            return s.connect_ex(('127.0.0.1', port)) != 0

    def _kill_port_occupant(self, port: int):
        try:
            subprocess.run(['fuser', '-k', f'{port}/tcp'], capture_output=True, timeout=5)
        except Exception:
            pass

    # ─── HTTP 处理方法 ──────────────────────────────────────────

    def _handle_health(self) -> dict:
        uname = ""
        fname = ""
        uid = self._me_id
        if self._me_info:
            usernames = self._me_info.get("usernames", {})
            if usernames:
                uname = usernames.get("editable_username", "")
            else:
                uname = self._me_info.get("username", "")
            fname = self._me_info.get("first_name", "")

        # 群组监控统计
        subscribed_count = 0  # 已订阅（TDLib 已知的群组 ID 总数）
        cached_count = 0      # 已缓存（已加载详情的群组数）
        pending_count = 0     # 待加载（已知 ID 但未获取详情）
        with self._dialog_cache_lock:
            for chat_id, info in self._dialog_cache.items():
                subscribed_count += 1
                if info is None:
                    pending_count += 1
                elif info:  # 非空字典 = 有效群组
                    cached_count += 1
                # 空字典 {} = 已检查但非群组（私聊等），不计入

        return {
            "status": "ok",
            "version": VERSION,
            "accountId": self.account_id,
            "userId": uid,
            "username": uname,
            "firstName": fname,
            "dialogCount": cached_count,
            "subscribedCount": subscribed_count,
            "cachedCount": cached_count,
            "pendingCount": pending_count,
            "msgCount": self._msg_count,
            "hitCount": self._hit_count,
            "errorCount": self._error_count,
            "uptime": int(time.time() - self._start_time),
            "pid": os.getpid(),
            "engine": "tdlib",
            "connectionState": self._connection_state,
            "connectionLostCount": self._connection_lost_count,
            "lastMsgAge": int(time.time() - self._last_message_time),
        }

    def _handle_stats(self) -> dict:
        """GET /stats - 返回账号订阅统计数据
        subscribed_count: _dialog_cache 中已知对话数（实时，含未加载详情的占位）
        subscribed_total: _subscribe_chats 完成后的去重总数；未完成时用 subscribed_count 兜底
        """
        with self._dialog_cache_lock:
            subscribed_count = len(self._dialog_cache)
        # _subscribed_total 在 _subscribe_chats 完成后才有值（且已去重）
        # 若还未完成（值为0），用 dialog_cache 当前长度作为兜底
        raw_total = getattr(self, '_subscribed_total', 0)
        subscribed_total = raw_total if raw_total > 0 else subscribed_count
        return {
            "subscribed_count": subscribed_count,
            "subscribed_total": subscribed_total,
            "account_id": self.account_id,
        }

    def _handle_resubscribe(self, body: dict) -> dict:
        """POST /resubscribe - 重新执行全量订阅，修复漏订阅问题"""
        logger.info(f"[ACC{self.account_id}] 收到重新订阅请求，开始全量重新订阅...")
        try:
            # 在后台线程执行，避免阻塞 HTTP 响应
            import threading
            def do_resubscribe():
                self._subscribe_chats()
                logger.info(f"[ACC{self.account_id}] 重新订阅完成，共订阅 {self._subscribed_total} 个对话")
            t = threading.Thread(target=do_resubscribe, daemon=True, name=f"resubscribe-{self.account_id}")
            t.start()
            return {"status": "ok", "message": f"重新订阅已在后台启动，当前已订阅 {getattr(self, '_subscribed_total', 0)} 个对话"}
        except Exception as e:
            logger.error(f"[ACC{self.account_id}] 重新订阅失败: {e}")
            return {"status": "error", "message": str(e)}

    def _handle_dialogs(self) -> dict:
        """处理 /dialogs 请求：立即返回已缓存数据，同时后台加载未获取的

        设计原则：
        - 不阻塞 HTTP 请求（避免前端超时）
        - 立即返回已加载的群组信息
        - 如果有未加载的，后台线程异步加载
        - 前端可通过 pending 字段判断是否还有更多数据
        """
        cached_results = []
        pending_count = 0

        with self._dialog_cache_lock:
            for chat_id, info in self._dialog_cache.items():
                if info is None:
                    pending_count += 1
                elif info:  # 非空字典才是有效群组
                    cached_results.append(info)

        # 如果有未加载的，启动后台线程加载（不阻塞当前请求）
        if pending_count > 0 and not getattr(self, '_dialogs_loading', False):
            self._dialogs_loading = True
            threading.Thread(
                target=self._background_load_dialogs,
                daemon=True,
                name=f"dialogs-loader-{self.account_id}"
            ).start()

        return {
            "dialogs": cached_results,
            "total": len(cached_results),
            "pending": pending_count,
            "loading": getattr(self, '_dialogs_loading', False),
        }

    def _background_load_dialogs(self):
        """后台线程：逐个加载未获取详情的对话"""
        try:
            self._load_dialogs_on_demand()
        except Exception as e:
            logger.error(f"[ACC{self.account_id}] 后台加载对话详情失败: {e}")
        finally:
            self._dialogs_loading = False

    def _handle_status(self) -> dict:
        return {
            "accountId": self.account_id,
            "running": self._running,
            "version": VERSION,
            "dialogCount": len(self._dialog_cache),
            "msgCount": self._msg_count,
            "hitCount": self._hit_count,
            "uptime": int(time.time() - self._start_time),
        }

    def _handle_join_group(self, body: dict) -> dict:
        """加入群组（支持公开链接和邀请链接）"""
        link = body.get("link", "").strip()
        if not link:
            return {"success": False, "error": "缺少 link 参数"}

        try:
            if 't.me/+' in link or 'joinchat/' in link:
                # 邀请链接
                result = self.tg.call_method('joinChatByInviteLink', {'invite_link': link})
            else:
                # 公开群组 username
                username = link.replace('https://t.me/', '').replace('http://t.me/', '').replace('@', '').strip('/')
                search_result = self.tg.call_method('searchPublicChat', {'username': username})
                search_result.wait(timeout=15)
                if search_result.error:
                    return {"success": False, "error": f"搜索群组失败: {search_result.error_info}"}
                if not search_result.update:
                    return {"success": False, "error": "未找到群组"}
                chat_id = search_result.update.get('id', 0)
                result = self.tg.call_method('joinChat', {'chat_id': chat_id})

            result.wait(timeout=30)
            if result.error:
                return {"success": False, "error": f"加入失败: {result.error_info}"}

            # 更新缓存
            if result.update:
                chat_id = result.update.get('id', 0)
                if chat_id:
                    info = self._fetch_chat_info(chat_id)
                    if info:
                        with self._dialog_cache_lock:
                            self._dialog_cache[chat_id] = info

            return {"success": True, "message": "加入成功"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _handle_leave_group(self, body: dict) -> dict:
        """退出群组"""
        chat_id = body.get("chatId")
        if not chat_id:
            return {"success": False, "error": "缺少 chatId 参数"}

        try:
            chat_id = int(chat_id)
            result = self.tg.call_method('leaveChat', {'chat_id': chat_id})
            result.wait(timeout=10)
            if result.error:
                return {"success": False, "error": f"退出失败: {result.error_info}"}

            with self._dialog_cache_lock:
                self._dialog_cache.pop(chat_id, None)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _handle_scrape_members(self, body: dict) -> dict:
        """采集群组成员"""
        chat_id = body.get("chatId")
        limit = body.get("limit", 200)
        if not chat_id:
            return {"success": False, "error": "缺少 chatId 参数"}

        try:
            chat_id = int(chat_id)
            # 获取 supergroup_id
            chat_result = self.tg.call_method('getChat', {'chat_id': chat_id})
            chat_result.wait(timeout=10)
            if not chat_result.update:
                return {"success": False, "error": "无法获取群组信息"}

            chat_type = chat_result.update.get('type', {})
            if chat_type.get('@type') != 'chatTypeSupergroup':
                return {"success": False, "error": "不是超级群组，无法采集成员"}

            supergroup_id = chat_type.get('supergroup_id', 0)
            members = []
            offset = 0

            while len(members) < limit:
                result = self.tg.call_method('getSupergroupMembers', {
                    'supergroup_id': supergroup_id,
                    'filter': {'@type': 'supergroupMembersFilterRecent'},
                    'offset': offset,
                    'limit': min(200, limit - len(members)),
                })
                result.wait(timeout=30)
                if not result.update or not result.update.get('members'):
                    break

                for member in result.update['members']:
                    mid = member.get('member_id', {})
                    if mid.get('@type') == 'messageSenderUser':
                        uid = mid.get('user_id', 0)
                        info = self._get_sender_info(uid)
                        members.append({
                            'userId': uid,
                            'username': info.get('username', ''),
                            'firstName': info.get('first_name', ''),
                            'lastName': info.get('last_name', ''),
                            'isBot': info.get('is_bot', False),
                        })

                batch_size = len(result.update['members'])
                offset += batch_size
                if batch_size < 200:
                    break

            return {"success": True, "members": members, "total": len(members)}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _handle_scrape_links(self, body: dict) -> dict:
        """采集群组消息中的链接"""
        chat_id = body.get("chatId")
        limit = body.get("limit", 100)
        if not chat_id:
            return {"success": False, "error": "缺少 chatId 参数"}

        try:
            chat_id = int(chat_id)
            messages = []
            from_message_id = 0

            while len(messages) < limit:
                result = self.tg.call_method('getChatHistory', {
                    'chat_id': chat_id,
                    'from_message_id': from_message_id,
                    'offset': 0,
                    'limit': min(100, limit - len(messages)),
                    'only_local': False,
                })
                result.wait(timeout=30)
                if not result.update or not result.update.get('messages'):
                    break

                for msg in result.update['messages']:
                    text = self._extract_message_text(msg)
                    if text:
                        urls = re.findall(r'https?://[^\s<>"{}|\\^`\[\]]+', text)
                        tg_links = re.findall(r't\.me/[^\s<>"{}|\\^`\[\]]+', text)
                        if urls or tg_links:
                            messages.append({
                                'messageId': msg.get('id', 0),
                                'text': text[:200],
                                'urls': urls,
                                'tgLinks': ['https://' + l if not l.startswith('http') else l for l in tg_links],
                                'date': msg.get('date', 0),
                            })
                    from_message_id = msg.get('id', 0)

                if len(result.update['messages']) < 100:
                    break

            return {"success": True, "messages": messages, "total": len(messages)}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _handle_check_group_health(self, body: dict) -> dict:
        """检查群组健康状态（支持单个 chatId 或批量 group_ids）"""
        # 批量模式：传入 group_ids 数组
        group_ids = body.get("group_ids")
        if group_ids and isinstance(group_ids, list):
            normal = []
            abnormal = []
            for gid in group_ids:
                try:
                    # group_ids 可能是 username 或数字 ID
                    gid_str = str(gid)
                    # 尝试用缓存中的 chatId 查找
                    chat_id = None
                    with self._dialog_cache_lock:
                        for cid, info in self._dialog_cache.items():
                            if info.get('chatId') == gid_str or info.get('username') == gid_str:
                                chat_id = cid
                                break
                    if chat_id is None:
                        # 尝试直接解析为数字 ID
                        try:
                            chat_id = int(gid_str)
                        except ValueError:
                            # 是 username，尝试搜索
                            try:
                                sr = self.tg.call_method('searchPublicChat', {'username': gid_str})
                                sr.wait(timeout=10)
                                if sr.update:
                                    chat_id = sr.update.get('id', 0)
                                else:
                                    abnormal.append({'groupId': gid_str, 'reason': '未找到群组'})
                                    continue
                            except Exception:
                                abnormal.append({'groupId': gid_str, 'reason': '搜索失败'})
                                continue
                    # 检查群组是否可访问
                    result = self.tg.call_method('getChat', {'chat_id': chat_id})
                    result.wait(timeout=10)
                    if result.error:
                        abnormal.append({'groupId': gid_str, 'reason': str(result.error_info)})
                    elif result.update:
                        normal.append({'groupId': gid_str, 'title': result.update.get('title', '')})
                    else:
                        abnormal.append({'groupId': gid_str, 'reason': '无法访问'})
                except Exception as e:
                    abnormal.append({'groupId': str(gid), 'reason': str(e)})
                # 避免触发 FLOOD_WAIT
                time.sleep(0.3)
            return {'success': True, 'normal': normal, 'abnormal': abnormal}

        # 单个模式：传入 chatId
        chat_id = body.get("chatId")
        if not chat_id:
            return {"success": False, "error": "缺少 chatId 或 group_ids 参数"}

        try:
            chat_id = int(chat_id)
            result = self.tg.call_method('getChat', {'chat_id': chat_id})
            result.wait(timeout=10)
            if result.error:
                return {"success": False, "accessible": False, "error": str(result.error_info)}
            if result.update:
                return {
                    "success": True,
                    "accessible": True,
                    "title": result.update.get('title', ''),
                    "memberCount": result.update.get('member_count', 0) or 0,
                }
            return {"success": False, "accessible": False, "error": "未知错误"}
        except Exception as e:
            return {"success": False, "accessible": False, "error": str(e)}

    def _handle_send_message(self, body: dict) -> dict:
        """发送消息（用于私聊触达）"""
        chat_id = body.get("chatId")
        text = body.get("text", "")
        if not chat_id or not text:
            return {"success": False, "error": "缺少 chatId 或 text 参数"}

        try:
            chat_id = int(chat_id)
            result = self.tg.call_method('sendMessage', {
                'chat_id': chat_id,
                'input_message_content': {
                    '@type': 'inputMessageText',
                    'text': {
                        '@type': 'formattedText',
                        'text': text,
                    },
                },
            })
            result.wait(timeout=15)
            if result.error:
                return {"success": False, "error": str(result.error_info)}
            return {"success": True, "messageId": result.update.get('id', 0) if result.update else 0}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _handle_get_chat_history(self, body: dict) -> dict:
        """获取群组历史消息"""
        chat_id = body.get("chatId")
        limit = body.get("limit", 20)
        from_message_id = body.get("fromMessageId", 0)
        if not chat_id:
            return {"success": False, "error": "缺少 chatId 参数"}

        try:
            chat_id = int(chat_id)
            result = self.tg.call_method('getChatHistory', {
                'chat_id': chat_id,
                'from_message_id': from_message_id,
                'offset': 0,
                'limit': min(limit, 100),
                'only_local': False,
            })
            result.wait(timeout=30)
            if result.error:
                return {"success": False, "error": str(result.error_info)}

            messages = []
            if result.update and result.update.get('messages'):
                for msg in result.update['messages']:
                    messages.append({
                        'id': msg.get('id', 0),
                        'date': msg.get('date', 0),
                        'text': self._extract_message_text(msg),
                        'senderId': msg.get('sender_id', {}).get('user_id', 0),
                    })
            return {"success": True, "messages": messages, "total": len(messages)}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ─── 主循环和清理 ──────────────────────────────────────────

    def _run_forever(self):
        """主循环

        首次拉取配置后，TDLib idle() 会阻塞直到收到停止信号。
        TDLib 在 idle 期间自动处理所有 updates 并调用注册的 handlers。
        """
        # 首次拉取配置
        global _monitor_config
        config = api.fetch_config()
        if config:
            with _config_lock:
                _monitor_config = config
            logger.info(f"[ACC{self.account_id}] 初始配置已加载 "
                       f"(users={len(config.get('userConfigs', {}))})")

        # TDLib idle - 阻塞式事件循环
        self.tg.idle()

    def _cleanup(self):
        """清理资源"""
        self._running = False
        if self.tg:
            try:
                self.tg.stop()
            except Exception:
                pass
        _remove_pid(self.account_id)
        logger.info(f"[ACC{self.account_id}] Worker 已停止，资源已清理")


# ═══════════════════════════════════════════════════════════════
# Master 模式（进程管理器）
# ═══════════════════════════════════════════════════════════════

class EngineMaster:
    """主控进程：管理所有 AccountWorker 子进程

    职责：
    1. 定时从 Web API 获取活跃账号列表
    2. 为每个活跃账号启动/维护一个 Worker 子进程
    3. 监控子进程健康，自动重启崩溃的 Worker
    4. 停止不再活跃的 Worker
    5. 定时通过 HTTP 接口检测 Worker 健康状态，异常时发送 TG 通知
    """

    # Worker 健康检测配置
    HEALTH_CHECK_INTERVAL = 60       # 每60秒检测一次
    HEALTH_FAIL_THRESHOLD = 2        # 连续2次失败才报警
    ALERT_COOLDOWN = 300             # 同一账号报警间隔最少5分钟
    DEFAULT_BOT_TOKEN = "8678159362:AAFqfg8uoL7RBQ_tWvd7YgklsoeShuEF2QU"

    def __init__(self):
        self._workers: Dict[int, subprocess.Popen] = {}
        self._running = True
        self._restart_counts: Dict[int, int] = {}
        self._max_restarts = 5  # 短时间内最大重启次数
        self._restart_window = 300  # 5分钟内
        self._restart_times: Dict[int, List[float]] = {}
        # 健康检测状态
        self._health_fail_counts: Dict[int, int] = {}  # acc_id -> 连续失败次数
        self._last_alert_time: Dict[int, float] = {}   # acc_id -> 上次报警时间
        self._account_phones: Dict[int, str] = {}      # acc_id -> phone（缓存）
        self._bot_token: str = self.DEFAULT_BOT_TOKEN
        self._alert_tg_id: str = ""

    def start(self):
        """启动主控"""
        logger.info(f"═══ 神探监控引擎 {VERSION} - Master 启动 ═══")
        logger.info(f"配置: API_BASE={API_BASE}, PORT_BASE={HTTP_PORT_BASE}")
        logger.info(f"配置: TDLIB_DATA_DIR={TDLIB_DATA_DIR}")

        signal.signal(signal.SIGTERM, self._signal_handler)
        signal.signal(signal.SIGINT, self._signal_handler)

        # 启动 Worker 健康检测线程
        threading.Thread(
            target=self._worker_health_check_loop,
            daemon=True,
            name="master-health-check"
        ).start()

        while self._running:
            try:
                self._check_and_start_workers()
            except Exception as e:
                logger.error(f"[Master] 检查循环异常: {e}", exc_info=True)
            time.sleep(MASTER_CHECK_INTERVAL)

        self._stop_all_workers()
        logger.info("═══ Master 已停止 ═══")

    def _check_and_start_workers(self):
        """检查并启动需要运行的 Worker"""
        config = api.fetch_config()
        if not config:
            return

        accounts = config.get("accounts", [])
        active_ids = set()

        for acc in accounts:
            acc_id = acc.get("id")
            phone = acc.get("phone", "")
            if not acc_id or not phone:
                continue
            if not acc.get("isActive"):
                continue
            # 只启动 role 包含 monitor 的账号
            role = acc.get("role", "")
            if role not in ("monitor", "both"):
                continue

            active_ids.add(acc_id)

            # 检查是否已有运行中的 Worker
            if acc_id in self._workers:
                proc = self._workers[acc_id]
                if proc.poll() is None:
                    continue  # 进程正常运行
                else:
                    # 进程已退出
                    exit_code = proc.returncode
                    logger.warning(
                        f"[Master] ACC{acc_id} 进程已退出 (code={exit_code})，"
                        f"准备重启..."
                    )
                    del self._workers[acc_id]

                    # 防止无限重启
                    if not self._can_restart(acc_id):
                        logger.error(
                            f"[Master] ACC{acc_id} 短时间内重启次数过多，暂停重启"
                        )
                        continue

            # 检查 TDLib session 是否存在（首次需要通过登录服务完成）
            session_dir = os.path.join(TDLIB_DATA_DIR, f"account_{acc_id}")
            td_db = os.path.join(session_dir, "database", "td.binlog")
            if not os.path.exists(td_db):
                # 没有 TDLib session，需要先通过管理后台登录
                logger.info(
                    f"[Master] ACC{acc_id} 无 TDLib session，"
                    f"请通过管理后台完成登录"
                )
                continue

            self._start_worker(acc_id)

        # 停止不再需要的 Worker
        for acc_id in list(self._workers.keys()):
            if acc_id not in active_ids:
                logger.info(f"[Master] ACC{acc_id} 不再活跃，停止...")
                self._stop_worker(acc_id)

    def _can_restart(self, account_id: int) -> bool:
        """检查是否可以重启（防止无限重启循环）"""
        now = time.time()
        times = self._restart_times.get(account_id, [])
        # 清理超出窗口的记录
        times = [t for t in times if now - t <= self._restart_window]
        if len(times) >= self._max_restarts:
            return False
        times.append(now)
        self._restart_times[account_id] = times
        return True

    def _start_worker(self, account_id: int):
        """启动单个 Worker 子进程"""
        cmd = [
            sys.executable, os.path.abspath(__file__),
            "--account_id", str(account_id)
        ]
        # Worker 日志输出到文件（方便排查问题）
        log_dir = os.path.join(_BASE_DIR, "logs")
        os.makedirs(log_dir, exist_ok=True)
        log_file = open(os.path.join(log_dir, f"worker_acc{account_id}.log"), "a")
        proc = subprocess.Popen(
            cmd,
            stdout=log_file,
            stderr=log_file,
            cwd=_BASE_DIR,
        )
        self._workers[account_id] = proc
        logger.info(f"[Master] 启动 ACC{account_id} Worker (PID={proc.pid})")
        # 不关闭 log_file，让子进程持续写入

    def _stop_worker(self, account_id: int):
        """优雅停止单个 Worker"""
        proc = self._workers.pop(account_id, None)
        if proc and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                logger.warning(f"[Master] ACC{account_id} 强制杀死")

    def _stop_all_workers(self):
        """停止所有 Worker"""
        logger.info(f"[Master] 正在停止所有 Worker ({len(self._workers)} 个)...")
        for acc_id in list(self._workers.keys()):
            self._stop_worker(acc_id)

    def _signal_handler(self, signum, frame):
        logger.info(f"[Master] 收到信号 {signum}，准备停止...")
        self._running = False

    # --- Worker 健康检测和 TG 通知 -----------------------------

    def _worker_health_check_loop(self):
        """定时检测所有 Worker 的 HTTP 健康接口，异常时发送 TG 通知"""
        # 等待 Master 启动稳定后再开始检测
        time.sleep(30)
        logger.info("[Master] Worker 健康检测循环已启动")

        while self._running:
            try:
                self._do_health_check()
            except Exception as e:
                logger.error(f"[Master] 健康检测循环异常: {e}")
            time.sleep(self.HEALTH_CHECK_INTERVAL)

    def _do_health_check(self):
        """执行一轮健康检测"""
        # 从 config 中获取通知配置
        config = api.fetch_config()
        if config:
            sys_config = config.get("systemConfig", {})
            if sys_config:
                self._bot_token = sys_config.get("bot_token", "") or self.DEFAULT_BOT_TOKEN
                self._alert_tg_id = sys_config.get("alert_tg_id", "") or ""
            # 缓存账号手机号
            for acc in config.get("accounts", []):
                acc_id = acc.get("id")
                if acc_id:
                    self._account_phones[acc_id] = acc.get("phone", f"ID:{acc_id}")

        # 检测每个正在运行的 Worker
        for acc_id, proc in list(self._workers.items()):
            if proc.poll() is not None:
                # 进程已退出，不需要 HTTP 检测（会在 _check_and_start_workers 中处理）
                continue

            port = HTTP_PORT_BASE + acc_id
            is_healthy = self._check_worker_http(port)

            if is_healthy:
                # 恢复正常，清除失败计数
                if acc_id in self._health_fail_counts:
                    if self._health_fail_counts[acc_id] >= self.HEALTH_FAIL_THRESHOLD:
                        logger.info(f"[Master] ACC{acc_id} Worker 已恢复正常")
                    del self._health_fail_counts[acc_id]
            else:
                # 检测失败，累加计数
                fail_count = self._health_fail_counts.get(acc_id, 0) + 1
                self._health_fail_counts[acc_id] = fail_count
                logger.warning(
                    f"[Master] ACC{acc_id} 健康检测失败 "
                    f"({fail_count}/{self.HEALTH_FAIL_THRESHOLD})"
                )

                # 达到阈值，发送报警
                if fail_count == self.HEALTH_FAIL_THRESHOLD:
                    self._send_worker_alert(acc_id, port)

    def _check_worker_http(self, port: int) -> bool:
        """通过 HTTP 检测 Worker 是否存活"""
        try:
            r = requests.get(
                f"http://127.0.0.1:{port}/health",
                timeout=5
            )
            return r.status_code == 200
        except Exception:
            return False

    def _send_worker_alert(self, acc_id: int, port: int):
        """发送 Worker 异常的 TG 通知"""
        # 检查冷却时间
        now = time.time()
        last_alert = self._last_alert_time.get(acc_id, 0)
        if now - last_alert < self.ALERT_COOLDOWN:
            return

        if not self._alert_tg_id:
            logger.warning(f"[Master] 未配置 alert_tg_id，无法发送通知")
            return

        self._last_alert_time[acc_id] = now
        phone = self._account_phones.get(acc_id, f"ID:{acc_id}")
        now_str = time.strftime("%Y-%m-%d %H:%M:%S")

        message = (
            "⚠️ <b>监控引擎异常</b>\n\n"
            f"⏰ 时间：{now_str}\n"
            f"📛 账号：{phone} (Acc{acc_id})\n"
            f"❌ 状态：Worker 无响应 (端口 {port})\n\n"
            "系统将自动尝试重启，如持续异常请登录管理后台检查！"
        )

        try:
            url = f"https://api.telegram.org/bot{self._bot_token}/sendMessage"
            payload = {
                "chat_id": self._alert_tg_id,
                "text": message,
                "parse_mode": "HTML"
            }
            requests.post(url, json=payload, timeout=10)
            logger.info(f"[Master] 已发送 ACC{acc_id} 异常通知到 TG")
        except Exception as e:
            logger.error(f"[Master] 发送 TG 通知失败: {e}")



# ═══════════════════════════════════════════════════════════════
# 入口点
# ═══════════════════════════════════════════════════════════════

def main():
    if args.master:
        master = EngineMaster()
        master.start()
    elif args.account_id:
        # 单账号模式：从 API 获取账号信息
        config = api.fetch_config()
        if not config:
            logger.error("无法获取配置，退出")
            sys.exit(1)

        accounts = config.get("accounts", [])
        target_acc = None
        for acc in accounts:
            if acc.get("id") == args.account_id:
                target_acc = acc
                break

        if not target_acc:
            logger.error(f"未找到账号 ID={args.account_id}")
            sys.exit(1)

        phone = target_acc.get("phone", "")
        if not phone:
            logger.error(f"账号 {args.account_id} 缺少手机号，请在管理后台配置")
            sys.exit(1)

        worker = TDLibAccountWorker(args.account_id, phone)
        worker.start()
    else:
        print(f"神探监控引擎 {VERSION}")
        print(f"用法:")
        print(f"  {sys.argv[0]} --master          # 主控模式（管理所有账号）")
        print(f"  {sys.argv[0]} --account_id N    # 单账号模式")
        sys.exit(1)


if __name__ == "__main__":
    main()