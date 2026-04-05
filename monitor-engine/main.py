#!/usr/bin/env python3
"""
TG Monitor Pro - TDLib 监控引擎 (基于 pytdbot + tdjson)
功能：
  1. 从 Web API 拉取监控配置（账号、群组、关键词、消息模板）
  2. 为每个激活的 TG 账号启动独立的 TDLib 客户端（持久化 SQLite 状态）
  3. TDLib 内置 getDifference / updates gap 处理，断线重连后自动补发漏抓消息
  4. 监听群组消息，匹配关键词规则
  5. 命中后：推送通知到目标群 + 加入私信发送队列
  6. 私信发送队列：按防封策略调度，随机延迟，频率限制
  7. 账号健康度监控与告警
"""
import asyncio
import json
import logging
import os
import re
import random
import time
import shutil

try:
    from dotenv import load_dotenv
    _env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    load_dotenv(_env_path, override=True)
except ImportError:
    pass

from datetime import datetime, timedelta
from typing import Optional
import aiohttp

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
logger = logging.getLogger("tg-monitor")

API_BASE = os.getenv("WEB_API_BASE", "http://localhost:3002/api")
ENGINE_SECRET = os.getenv("ENGINE_SECRET", "c9a64a70df17752d00de552b4e01ca94e22835909230539552c9a9a18a79a7ac")
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "30"))
DM_WORKER_INTERVAL = int(os.getenv("DM_WORKER_INTERVAL", "2"))  # 兜底轮询间隔（秒），事件触发时立即处理
TG_API_ID = int(os.getenv("TG_API_ID", "0"))
TG_API_HASH = os.getenv("TG_API_HASH", "")
BOT_TOKEN = os.getenv("BOT_TOKEN", "")
TDLIB_DATA_DIR = os.getenv("TDLIB_DATA_DIR", os.path.join(_BASE_DIR, "tdlib_data"))

active_workers: dict = {}
dm_trigger_event: asyncio.Event = asyncio.Event()  # 用于立即触发 DM 发送
monitor_config: dict = {}
public_groups: list = []
force_sync_event: asyncio.Event = None  # 将在 main() 中初始化
global_client_manager = None  # 全局 ClientManager，统一管理所有账号的 TDLib 客户端
public_group_real_ids: dict = {}
join_config: dict = {
    "joinIntervalMin": 30,
    "joinIntervalMax": 60,
    "maxGroupsPerAccount": 200,
    "joinEnabled": True,
}
sent_dm_cache: dict = {}
collab_chat_id_cache: dict = {}
processed_messages: dict = {}
PROCESSED_MSG_TTL = 3600  # 1小时内同一条消息只推送一次
process_lock = None  # asyncio.Lock，在事件循环启动后初始化
daily_hit_cache: dict = {}
rate_hit_cache: dict = {}
global_anti_spam: dict = {
    "enabled": True,
    "dailyLimit": 100,
    "rateWindow": 0,
    "rateLimit": 1000,
    "minMsgLen": 0,
    "maxMsgLen": 0,
    # 全局消息过滤规则（管理员统一配置）
    "filterAds": False,       # 过滤广告内容
    "filterBot": True,        # 过滤 Bot 账号消息
    "globalMaxMsgLen": 0,   # 全局消息字数上限（0=不限制）
    "globalRateWindow": 0,   # 防刷屏：时间窗口（秒，0=不限制）
    "globalRateLimit": 0,     # 防刷屏：窗口内最大消息数（0=不限制）
}
# 防刷屏：记录每个发送者在时间窗口内的消息计数 {sender_id: [timestamp, ...]}
_rate_window_cache: dict = {}


class ApiClient:
    def __init__(self, base: str, secret: str):
        self.base = base
        self.headers = {"X-Engine-Secret": secret, "Content-Type": "application/json"}

    async def get(self, path: str) -> Optional[dict]:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{self.base}{path}", headers=self.headers,
                    timeout=aiohttp.ClientTimeout(total=10)
                ) as r:
                    if r.status == 200:
                        return await r.json()
        except Exception as e:
            logger.warning(f"API GET {path} failed: {e}")
        return None

    async def post(self, path: str, data: dict) -> Optional[dict]:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.base}{path}", headers=self.headers, json=data,
                    timeout=aiohttp.ClientTimeout(total=10)
                ) as r:
                    if r.status == 200:
                        return await r.json()
        except Exception as e:
            logger.warning(f"API POST {path} failed: {e}")
        return None


api = ApiClient(API_BASE, ENGINE_SECRET)


def match_keyword(text: str, keyword: dict, user_match_mode: str = "fuzzy") -> bool:
    """
    关键词匹配函数（支持用户级全局匹配模式）
    
    user_match_mode（用户在设置中心配置）:
      - fuzzy: 模糊匹配（包含即命中，默认）
      - exact: 精确匹配（完整单词/句子匹配）
      - leftmost: 最左匹配（消息以关键词开头）
      - rightmost: 最右匹配（消息以关键词结尾）
    
    keyword.matchType（关键词级别配置，优先级更高）:
      - contains/exact: 包含匹配
      - regex: 正则匹配
      - and/or/not: 多词逻辑匹配
    """
    if not text:
        return False
    match_type = keyword.get("matchType", "contains")
    pattern = keyword.get("pattern", "")
    sub_keywords = keyword.get("subKeywords", [])
    case_sensitive = keyword.get("caseSensitive", False)
    compare_text = text if case_sensitive else text.lower()
    compare_pattern = pattern if case_sensitive else pattern.lower()
    
    # 正则、and、or、not 模式优先处理（不受 user_match_mode 影响）
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
    
    # contains/exact 模式：受 user_match_mode 影响
    if not compare_pattern:
        return False
    
    # 用户级全局匹配模式
    if user_match_mode == "leftmost":
        # 最左匹配：消息文本以关键词开头（忽略前导空白）
        return compare_text.lstrip().startswith(compare_pattern)
    elif user_match_mode == "rightmost":
        # 最右匹配：消息文本以关键词结尾（忽略尾部空白）
        return compare_text.rstrip().endswith(compare_pattern)
    elif user_match_mode == "exact":
        # 精确匹配：关键词作为完整词出现（前后为非字母数字字符或边界）
        import re as _re
        escaped = _re.escape(compare_pattern)
    else:
        # fuzzy（默认）：包含匹配
        return compare_pattern in compare_text


def render_template(template: str, variables: dict) -> str:
    result = template
    for key, value in variables.items():
        # 支持两种格式：{key} 单花括号 和 {{key}} 双花括号
        result = result.replace(f"{{{key}}}", str(value or ""))
        result = result.replace(f"{{{{{key}}}}}", str(value or ""))
    return result


def is_likely_spam(sender_id: int, sender_username: Optional[str], text: str) -> bool:
    spam_patterns = [
        r"t\.me/\+", r"t\.me/[a-zA-Z0-9_]+",
        r"https?://", r"@[a-zA-Z0-9_]{5,}", r"\+?\d[\d\s\-\(\)]{8,}",
    ]
    spam_count = sum(1 for p in spam_patterns if re.search(p, text))
    if spam_count >= 2:
        return True
    if sender_id > 7_000_000_000 and spam_count >= 1:
        return True
    return False


def check_anti_spam(sender_tg_id: str, text: str, anti_spam_cfg: dict):
    from datetime import date as _date
    if not anti_spam_cfg.get("enabled", True):
        return False, ""
    min_len = int(anti_spam_cfg.get("minMsgLen", 0))
    if min_len > 0 and len(text.strip()) < min_len:
        return True, f"msg too short ({len(text.strip())} < {min_len})"
    max_len = int(anti_spam_cfg.get("maxMsgLen", 0))
    if max_len > 0 and len(text.strip()) > max_len:
        return True, f"msg too long ({len(text.strip())} > {max_len})"
    daily_limit = int(anti_spam_cfg.get("dailyLimit", 10))
    rate_window = int(anti_spam_cfg.get("rateWindow", 60))
    rate_limit_n = int(anti_spam_cfg.get("rateLimit", 3))
    today = _date.today().isoformat()
    now = time.time()
    if sender_tg_id not in daily_hit_cache:
        daily_hit_cache[sender_tg_id] = {}
    day_counts = daily_hit_cache[sender_tg_id]
    for d in list(day_counts.keys()):
        if d != today:
            del day_counts[d]
    today_count = day_counts.get(today, 0)
    if today_count >= daily_limit:
        return True, f"daily limit {today_count}/{daily_limit}"
    if sender_tg_id not in rate_hit_cache:
        rate_hit_cache[sender_tg_id] = []
    timestamps = rate_hit_cache[sender_tg_id]
    timestamps[:] = [t for t in timestamps if now - t < rate_window]
    if len(timestamps) >= rate_limit_n:
        return True, f"rate limit {len(timestamps)}/{rate_limit_n} in {rate_window}s"
    day_counts[today] = today_count + 1
    timestamps.append(now)
    return False, ""


async def send_bot_notification(
    bot_chat_id: str, sender_username: Optional[str], sender_tg_id: str,
    matched_keyword: str, group_name: str, group_username: Optional[str],
    message_text: str, sender_name: str = "", hit_record_id: Optional[int] = None,
    dm_status: str = "disabled", chat_id: Optional[str] = None,
    message_id: Optional[int] = None, owner_user_id: int = 0,
):
    if not BOT_TOKEN:
        return
    try:
        if sender_username:
            user_display = f'<a href="https://t.me/{sender_username}">{sender_name or "@" + sender_username}</a>'
            mention_entity = None  # 有 username 时用 HTML 链接，不需要 entity
        else:
            # 无用户名：用 text_mention 实体，桌面/手机/网页版均可点击
            _display_name = sender_name or f"用户{sender_tg_id}"
            user_display = _display_name  # 纯文本占位，实际通过 entity 渲染
            mention_entity = {
                "type": "text_mention",
                "offset": 4,  # "用户：" 占4个字符
                "length": len(_display_name),
                "user": {"id": int(sender_tg_id)}
            }
        # 用户名行（@username 可点击链接，显示在用户名下方）
        username_line = ""
        if sender_username:
            username_line = f'  <a href="https://t.me/{sender_username}">@{sender_username}</a>\n'
        # 群组名称：优先使用真实名称，不是数字ID
        _group_display_name = group_name if (group_name and not str(group_name).lstrip("-").isdigit()) else None
        # 如果 group_name 是数字ID但有 group_username，尝试从 username 生成名称
        if not _group_display_name and group_username:
            _group_display_name = f"@{group_username}"
        if group_username:
            # 有 username，生成消息直链 t.me/username/messageId
            _label = _group_display_name or f"@{group_username}"
            if message_id:
                source_display = f'<a href="https://t.me/{group_username}/{message_id}">{_label}</a>'
            else:
                source_display = f'<a href="https://t.me/{group_username}">{_label}</a>'
        elif _group_display_name:
            # 无 username 但有名称，尝试生成 t.me/c/ 消息直链（超级群组格式）
            _raw_id = str(chat_id) if chat_id else str(group_name)
            # 超级群组 ID 格式：-100xxxxxxxxx -> t.me/c/xxxxxxxxx
            if _raw_id.startswith("-100"):
                _clean_id = _raw_id[4:]
                if message_id:
                    source_display = f'<a href="https://t.me/c/{_clean_id}/{message_id}">{_group_display_name}</a>'
                else:
                    source_display = f'<a href="https://t.me/c/{_clean_id}">{_group_display_name}</a>'
            else:
                source_display = _group_display_name
        else:
            # 只有数字ID，尝试生成链接，使用群名代替群组
            _raw_id = str(chat_id) if chat_id else str(group_name)
            _fallback_name = _group_display_name or "群组"
            if _raw_id.startswith("-100"):
                _clean_id = _raw_id[4:]
                if message_id:
                    source_display = f'<a href="https://t.me/c/{_clean_id}/{message_id}">{_fallback_name}</a>'
                else:
                    source_display = f'<a href="https://t.me/c/{_clean_id}">{_fallback_name}</a>'
            else:
                source_display = _fallback_name
        highlighted_text = message_text[:200]
        if matched_keyword and matched_keyword in highlighted_text:
            highlighted_text = highlighted_text.replace(matched_keyword, f"<b>#{matched_keyword}</b>")
        if len(message_text) > 200:
            highlighted_text += "..."
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        # 查询该用户的最近搜索词，直接显示在消息正文中
        recent_line = ""
        try:
            _hist = await api.get(
                f"/engine/sender-history?userId={owner_user_id}&senderTgId={sender_tg_id}&limit=20"
            )
            if _hist and _hist.get("keywords"):
                _kws = _hist["keywords"]
                _kw_parts = []
                for _k in _kws[:8]:  # 最多显岈8个
                    _kw_parts.append(f"{_k['keyword']}({_k['count']})"
                        if _k['count'] > 1 else _k['keyword'])
                if _kw_parts:
                    recent_line = f"\n----------\n最近搜索：{'  '.join(_kw_parts)}"
        except Exception as _e:
            logger.debug(f"[BotNotify] 获取最近搜索词失败: {_e}")
        text = (
            f"用户：{user_display}\n"
            f"{username_line}"
            f"来源：{source_display}\n"
            f"内容：{highlighted_text}\n"
            f"时间：{now_str}"
            f"{recent_line}"
        )
        rid = str(hit_record_id) if hit_record_id else "0"
        uname = sender_username or ""
        # 私聊按钮：有 username 直接用 url 跳转（无需中间消息），无 username 才用 callback
        if uname:
            dm_btn = {"text": "私聊", "url": f"https://t.me/{uname}"}
        else:
            dm_btn = {"text": "私聊", "callback_data": f"dm_user:{rid}:{sender_tg_id}:"}
        inline_keyboard = [
            [
                {"text": "历史", "callback_data": f"history:{rid}:{sender_tg_id}"},
                {"text": "屏蔽", "callback_data": f"block:{rid}:{sender_tg_id}:{owner_user_id}"},
                {"text": "处理", "callback_data": f"done:{rid}:{sender_tg_id}"},
            ],
            [
                {"text": "删除", "callback_data": f"delete:{rid}:{sender_tg_id}"},
                dm_btn,
            ]
        ]
        # 无用户名时用 entities 模式（text_mention），有用户名时用 HTML 模式
        if mention_entity:
            # entities 模式：不能同时用 parse_mode，需要把 HTML 标签转为纯文本
            # source_display 里有 HTML 链接，需要单独处理
            # 最简方案：source 部分也改用 entities，或者只对用户名用 entity，其余保持 HTML
            # 实际上 Telegram 支持同时传 entities + parse_mode，entities 优先级更高
            # 但为简单起见，改为：text 全部纯文本 + entities 列表
            import re as _re
            def _strip_html(s):
                return _re.sub(r'<[^>]+>', '', s)
            plain_source = _strip_html(source_display)
            plain_highlighted = _strip_html(highlighted_text)
            plain_text = (
                f"用户：{user_display}\n"
                f"来源：{plain_source}\n"
                f"内容：{plain_highlighted}\n"
                f"时间：{now_str}"
                f"{recent_line}"
            )
            # 重新计算 mention offset（"用户：" 在 plain_text 中的偏移）
            mention_entity["offset"] = plain_text.index(user_display)
            # 构建 source 链接 entity（如果有 URL）
            source_entities = []
            src_match = _re.search(r'href="([^"]+)"', source_display)
            src_text_match = _re.search(r'>([^<]+)<', source_display)
            if src_match and src_text_match:
                src_url = src_match.group(1)
                src_text = src_text_match.group(1)
                src_offset = plain_text.index(src_text)
                source_entities.append({
                    "type": "text_link",
                    "offset": src_offset,
                    "length": len(src_text),
                    "url": src_url
                })
            # 构建 keyword 加粗 entity
            bold_entities = []
            if matched_keyword and matched_keyword in plain_highlighted:
                kw_offset = plain_text.index(matched_keyword)
                bold_entities.append({
                    "type": "bold",
                    "offset": kw_offset,
                    "length": len(matched_keyword)
                })
            all_entities = [mention_entity] + source_entities + bold_entities
            payload = {
                "chat_id": bot_chat_id, "text": plain_text,
                "entities": all_entities,
                "disable_web_page_preview": True,
                "reply_markup": {"inline_keyboard": inline_keyboard},
            }
        else:
            payload = {
                "chat_id": bot_chat_id, "text": text, "parse_mode": "HTML",
                "disable_web_page_preview": True,
                "reply_markup": {"inline_keyboard": inline_keyboard},
            }
        logger.info(f"[BotNotify] payload keys={list(payload.keys())} entities={payload.get('entities', 'NONE')}")
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
                json=payload, timeout=aiohttp.ClientTimeout(total=10)
            ) as r:
                resp = await r.text()
                if r.status != 200:
                    logger.warning(f"[BotNotify] 推送失败 {r.status}: {resp[:200]}")
                    return False
                else:
                    logger.info(f"[BotNotify] 推送成功, resp_keys={list(__import__('json').loads(resp).get('result',{}).keys()) if r.status==200 else []}")
                    return True
    except Exception as e:
        logger.warning(f"[BotNotify] 推送异常: {e}")
        return False


async def update_account_health(account_id: int, delta: int, status: str = None, reason: str = None):
    data = {"accountId": account_id, "delta": delta}
    if status:
        data["status"] = status
    if reason:
        data["reason"] = reason
    await api.post("/engine/account/health", data)


async def process_message(
    account_id: int, user_id: int, chat_id: str, chat_title: str,
    chat_username: Optional[str], sender_id: int, sender_username: Optional[str],
    sender_first_name: str, sender_last_name: str, message_id: int, text: str,
    is_bot: bool = False,
):
    # 全局消息过滤规则（管理员统一配置）
    # 1. 过滤 Bot 账号消息
    if global_anti_spam.get("filterBot", True) and is_bot:
        logger.debug(f"[FILTER] 过滤 Bot 消息: sender_id={sender_id}")
        return
    if not text or not text.strip():
        return
    # 2. 过滤超长消息（防长内容广告）
    _global_max_len = global_anti_spam.get("globalMaxMsgLen", 0)
    if _global_max_len and _global_max_len > 0 and len(text) > _global_max_len:
        logger.debug(f"[FILTER] 过滤超长消息: len={len(text)} > {_global_max_len}")
        return
    # 3. 防刷屏：同一发送者在时间窗口内消息数超限
    _rate_window = global_anti_spam.get("globalRateWindow", 0)
    _rate_limit = global_anti_spam.get("globalRateLimit", 0)
    if _rate_window > 0 and _rate_limit > 0:
        import time as _time
        _now = _time.time()
        _sender_key = str(sender_id)
        _timestamps = _rate_window_cache.get(_sender_key, [])
        # 清理过期时间戳
        _timestamps = [t for t in _timestamps if _now - t < _rate_window]
        if len(_timestamps) >= _rate_limit:
            logger.debug(f"[FILTER] 防刷屏：sender={sender_id} 在 {_rate_window}s 内发送 {len(_timestamps)+1} 条消息，已忽略")
            return
        _timestamps.append(_now)
        _rate_window_cache[_sender_key] = _timestamps
        # 定期清理缓存（超过1000个sender时清理最旧的）
        if len(_rate_window_cache) > 1000:
            _oldest = sorted(_rate_window_cache.keys(), key=lambda k: min(_rate_window_cache[k]) if _rate_window_cache[k] else 0)[:200]
            for k in _oldest:
                del _rate_window_cache[k]
    global process_lock
    import asyncio as _asyncio
    if process_lock is None:
        process_lock = _asyncio.Lock()
    sender_tg_id = str(sender_id)
    sender_name = f"{sender_first_name} {sender_last_name}".strip()
    now_ts = time.time()

    # ── 全局去重：用 Lock 保护 check-and-set，防止多账号并发竞态 ──────────────
    async with process_lock:
        expired_keys = [k for k, v in processed_messages.items() if now_ts - v > PROCESSED_MSG_TTL]
        for k in expired_keys:
            del processed_messages[k]
        # 对整条消息做全局去重（account 无关），防止两个账号同时处理同一条消息
        global_msg_key = f"msg:{chat_id}:{message_id}"
        if global_msg_key in processed_messages:
            logger.debug(f"[DEDUP] 全局消息去重跳过: {global_msg_key}")
            return
        processed_messages[global_msg_key] = now_ts

    config = monitor_config.get(str(user_id), {})
    groups = config.get("groups", [])
    push_settings_cfg = config.get("pushSettings", {})

    if push_settings_cfg.get("pushEnabled", True):
        blocked_ids = set(config.get("blockedTgIds", []))
        if sender_tg_id not in blocked_ids:
            if not (push_settings_cfg.get("filterAds", False) and is_likely_spam(sender_id, sender_username, text)):
                # 优先使用用户自定义的 globalAntiSpam，否则使用全局配置
                anti_spam_cfg = config.get("globalAntiSpam") or global_anti_spam
                is_spam, spam_reason = check_anti_spam(sender_tg_id, text, anti_spam_cfg)
                if not is_spam:
                    for group in groups:
                        if not group.get("isActive"):
                            continue
                        group_id_cfg = str(group.get("groupId", ""))
                        if group_id_cfg != chat_id:
                            continue
                        dedup_key = f"priv:{chat_id}:{message_id}:{user_id}"
                        if dedup_key in processed_messages:
                            continue
                        # 先占位，防止并发重复推送
                        processed_messages[dedup_key] = now_ts
                        keywords_list = [kw for kw in group.get("keywords", []) if kw.get("isActive", True)]
                        matched_keywords = [kw for kw in keywords_list if match_keyword(text, kw)]
                        if not matched_keywords:
                            del processed_messages[dedup_key]  # 未命中，释放占位
                            continue
                        logger.info(
                            f"[PRIVATE_MATCH] account={account_id} user={user_id} "
                            f"group={chat_title} sender={sender_username or sender_id} "
                            f"keywords={[k['pattern'] for k in matched_keywords]}"
                        )
                        await _handle_match(
                            account_id=account_id, user_id=user_id, config=config,
                            chat_id=chat_id, chat_title=chat_title, chat_username=chat_username,
                            sender_tg_id=sender_tg_id, sender_username=sender_username,
                            sender_name=sender_name, text=text, matched_keywords=matched_keywords, message_id=message_id,
                        )

    matched_public_group = None
    for pg in public_groups:
        pg_group_id = str(pg.get("groupId", ""))
        real_id = public_group_real_ids.get(pg_group_id)
        if real_id and str(real_id) == chat_id:
            matched_public_group = pg
            break
        if pg_group_id == chat_id:
            matched_public_group = pg
            break

    if matched_public_group:
        notified_users_for_msg: set = set()
        for uid_str, uconfig in monitor_config.items():
            uid = int(uid_str)
            # 全局去重 key（不含 account_id），防止多账号重复推送给同一用户
            pub_dedup_key = f"pub:{chat_id}:{message_id}:{uid}"
            if pub_dedup_key in processed_messages:
                notified_users_for_msg.add(uid)
                continue
            # 跨路径去重：若该用户已通过私有匹配推送过此消息，则跳过
            priv_dedup_key = f"priv:{chat_id}:{message_id}:{uid}"
            if priv_dedup_key in processed_messages:
                notified_users_for_msg.add(uid)
                continue
            if uid in notified_users_for_msg:
                continue
            # 先占位（原子写入），防止并发时重复推送
            processed_messages[pub_dedup_key] = now_ts
            notified_users_for_msg.add(uid)
            u_push_settings = uconfig.get("pushSettings", {})
            if not u_push_settings.get("pushEnabled", True):
                continue
            u_blocked_ids = set(uconfig.get("blockedTgIds", []))
            if sender_tg_id in u_blocked_ids:
                continue
            if u_push_settings.get("filterAds", False) and is_likely_spam(sender_id, sender_username, text):
                continue
            # 方案A：过滤机器人消息
            if u_push_settings.get("filterBots", False) and is_bot:
                continue
            # 方案A：只推送有媒体的消息（mediaOnly 暂时基于文本长度判断，实际需消息对象支持）
            # mediaOnly 过滤在 process_message 调用层处理（需传入 has_media 参数）
            # 优先使用用户自定义的 globalAntiSpam，否则使用全局配置
            u_anti_spam = uconfig.get("globalAntiSpam") or global_anti_spam
            is_spam, _ = check_anti_spam(sender_tg_id, text, u_anti_spam)
            if is_spam:
                continue
            # 方案A：黑名单关键词过滤（命中则跳过推送）
            u_blacklist_kws_raw = u_push_settings.get("blacklistKeywords") or ""
            u_blacklist_mode = u_push_settings.get("blacklistMatchMode", "fuzzy")
            if u_blacklist_kws_raw:
                u_blacklist_kws = [k.strip() for k in u_blacklist_kws_raw.replace("，", ",").split(",") if k.strip()]
                _compare_text = text.lower()
                _blacklisted = False
                for _bkw in u_blacklist_kws:
                    _bkw_lower = _bkw.lower()
                    if u_blacklist_mode == "exact":
                        import re as _re2
                        _escaped = _re2.escape(_bkw_lower)
                        if _re2.search(r'\b' + _escaped + r'\b', _compare_text):
                            _blacklisted = True
                            break
                    else:  # fuzzy
                        if _bkw_lower in _compare_text:
                            _blacklisted = True
                            break
                if _blacklisted:
                    logger.debug(f"[BLACKLIST] user={uid} 黑名单关键词命中，跳过推送")
                    del processed_messages[pub_dedup_key]
                    continue
            # 方案A：用户级去重时间窗口（dedupeMinutes > 0 时启用）
            u_dedupe_minutes = u_push_settings.get("dedupeMinutes", 0)
            if u_dedupe_minutes > 0:
                u_dedupe_key = f"udedup:{uid}:{sender_tg_id}"
                u_last_ts = processed_messages.get(u_dedupe_key, 0)
                if now_ts - u_last_ts < u_dedupe_minutes * 60:
                    logger.debug(f"[DEDUP_USER] user={uid} sender={sender_tg_id} 在 {u_dedupe_minutes}min 内已推送，跳过")
                    del processed_messages[pub_dedup_key]
                    continue
                processed_messages[u_dedupe_key] = now_ts
            global_kws = uconfig.get("globalKeywords", [])
            if not global_kws:
                for g in uconfig.get("groups", []):
                    if g.get("isActive"):
                        global_kws.extend([k for k in g.get("keywords", []) if k.get("isActive")])
            # 方案A：使用用户配置的关键词匹配模式
            u_kw_match_mode = u_push_settings.get("keywordMatchMode", "fuzzy")
            u_matched_keywords = [kw for kw in global_kws if kw.get("isActive", True) and match_keyword(text, kw, u_kw_match_mode)]
            if not u_matched_keywords:
                continue
            logger.debug(f"[DEDUP] 公共群组消息去重标记: {pub_dedup_key}")
            # 优先使用 publicGroups 中已存储的 groupTitle，避免 _get_chat_info 失败时显示数字ID
            pg_title = matched_public_group.get("groupTitle") or chat_title
            # 从 groupId 提取 username（@username 格式或数字ID）
            _raw_group_id = matched_public_group.get("groupId", "")
            if _raw_group_id and (str(_raw_group_id).startswith("@") or not str(_raw_group_id).lstrip("-").isdigit()):
                pg_username = str(_raw_group_id).lstrip("@")
            else:
                pg_username = matched_public_group.get("groupUsername") or chat_username
            logger.info(
                f"[PUBLIC_MATCH] user={uid} public_group={pg_title} "
                f"sender={sender_username or sender_id} "
                f"keywords={[k['pattern'] for k in u_matched_keywords]}"
            )
            await _handle_match(
                account_id=account_id, user_id=uid, config=uconfig,
                chat_id=chat_id, chat_title=pg_title, chat_username=pg_username,
                sender_tg_id=sender_tg_id, sender_username=sender_username,
                sender_name=sender_name, text=text, matched_keywords=u_matched_keywords, message_id=message_id,
            )


async def _handle_match(
    account_id: int, user_id: int, config: dict, chat_id: str, chat_title: str,
    chat_username: Optional[str], sender_tg_id: str, sender_username: Optional[str],
    sender_name: str, text: str, matched_keywords: list, message_id: int = 0,
):
    # 提取 first_name（sender_name 可能是 "first last" 格式）
    _name_parts = sender_name.split(" ", 1) if sender_name else ["", ""]
    _first_name = _name_parts[0] if _name_parts else ""
    variables = {
        "username": sender_username or "",
        "keyword": matched_keywords[0]["pattern"] if matched_keywords else "",
        "group_name": chat_title,
        "group": chat_title,  # 别名：{group}
        "message": text[:200],
        "date": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "sender_name": sender_name,
        "first_name": _first_name,  # 别名：{first_name}
        "name": sender_name,  # 别名：{name}
    }
    hit_record_id = None
    try:
        hit_result = await api.post("/engine/hit", {
            "userId": user_id, "senderTgId": sender_tg_id,
            "senderUsername": sender_username, "senderName": sender_name,
            "tgGroupId": chat_id, "groupName": chat_title,
            # 同时发送两种格式，兼容新旧接口
            "matchedKeyword": matched_keywords[0]["pattern"],
            "matchedKeywords": [k["pattern"] for k in matched_keywords],
            "messageContent": text[:500], "messageText": text[:500],
            "keywordId": matched_keywords[0].get("id"),
            "messageId": message_id if message_id else None,
        })
        if hit_result:
            hit_record_id = hit_result.get("id")
    except Exception as e:
        logger.warning(f"[Hit] 写入命中记录失败: {e}")

    dm_will_send = False
    if config.get("dmEnabled") and config.get("dmTemplates"):
        cache_key = f"{config.get('dmSenderAccountId', account_id)}:{sender_tg_id}"
        antiban = config.get("antiban", {})
        cooldown_hours = antiban.get("cooldownHours", 24)
        last_sent = sent_dm_cache.get(cache_key, 0)
        if time.time() - last_sent > cooldown_hours * 3600:
            dm_will_send = True

    push_settings_cfg = config.get("pushSettings", {})
    collab_chat_id_str = push_settings_cfg.get("collabChatId")
    bot_chat_id = config.get("botChatId")

    # ── 推送逻辑：二选一 ─────────────────────────────────────────────────────────
    # 用户设置了协作群 → 只推协作群，不推个人（协作群失败时才降级到个人）
    # 用户未设置协作群 → 只推个人私聊
    already_pushed_to: set = set()
    _notify_kwargs = dict(
        sender_username=sender_username,
        sender_tg_id=sender_tg_id,
        matched_keyword=matched_keywords[0]["pattern"],
        group_name=chat_title,
        group_username=chat_username,
        message_text=text,
        sender_name=sender_name,
        hit_record_id=hit_record_id,
        dm_status="queued" if dm_will_send else "disabled",
        chat_id=str(chat_id),
        message_id=message_id,
        owner_user_id=user_id,
    )
    if collab_chat_id_str and BOT_TOKEN:
        # 有协作群 → 只推协作群，不推个人
        try:
            collab_ok = await send_bot_notification(
                bot_chat_id=str(collab_chat_id_str), **_notify_kwargs
            )
        except Exception as e:
            logger.warning(f"[CollabPush] 协作群推送异常: {e}")
            collab_ok = False
        if collab_ok:
            already_pushed_to.add(str(collab_chat_id_str))
            logger.info(f"[CollabPush] 已推送到协作群 {collab_chat_id_str}，跳过个人推送")
        else:
            # 协作群推送失败 → 自动降级到用户私聊
            _fallback_id = str(bot_chat_id) if bot_chat_id else None
            if _fallback_id:
                logger.info(f"[CollabPush] 协作群推送失败，降级到私聊 {_fallback_id}")
                try:
                    await send_bot_notification(bot_chat_id=_fallback_id, **_notify_kwargs)
                    already_pushed_to.add(_fallback_id)
                except Exception as e2:
                    logger.warning(f"[CollabPush] 降级私聊推送也失败: {e2}")
            else:
                logger.warning(f"[CollabPush] 协作群推送失败且无可用私聊 fallback (collab={collab_chat_id_str})")
    elif bot_chat_id and BOT_TOKEN:
        # 无协作群 → 只推个人私聊
        await send_bot_notification(
            bot_chat_id=str(bot_chat_id), **_notify_kwargs
        )
        already_pushed_to.add(str(bot_chat_id))

    for kw in matched_keywords:
        await api.post("/engine/keyword-stat", {
            "userId": user_id, "keywordId": kw.get("id"),
            "senderTgId": sender_tg_id, "senderUsername": sender_username,
            "senderName": sender_name, "tgGroupId": chat_id,
            "groupName": chat_title, "messageContent": text[:200],
        })

    if dm_will_send:
        templates = config["dmTemplates"]
        template = random.choices(templates, weights=[t.get("weight", 1) for t in templates], k=1)[0]
        dm_content = render_template(template["content"], variables)
        dm_data = {
            "userId": user_id, "senderAccountId": config.get("dmSenderAccountId", account_id),
            "targetTgId": sender_tg_id, "targetUsername": sender_username,
            "content": dm_content, "templateId": template.get("id"),
            "hitGroupId": chat_id, "matchedKeyword": matched_keywords[0]["pattern"],
            "hitRecordId": hit_record_id,
        }
        await api.post("/engine/dm-queue/add", dm_data)


class AccountWorker:
    """
    封装单个 TG 账号的 TDLib 客户端生命周期。
    TDLib 持久化 SQLite 数据库，天然支持断线重连后的 updates gap 补全。
    每个账号独立数据目录，互不干扰。
    """

    def __init__(self, account: dict):
        self.account_id = account["id"]
        self.user_id = account.get("userId", 0)
        self.is_admin_account = account.get("isAdminAccount", False)  # 是否为管理员账号
        self.session_string = account.get("sessionString", "")
        self.phone = account.get("phone", "")
        self.proxy = {
            "host": account.get("proxyHost"),
            "port": account.get("proxyPort"),
            "type": account.get("proxyType", "socks5"),
            "username": account.get("proxyUsername"),
            "password": account.get("proxyPassword"),
        }
        self.client = None
        self.is_running = False
        self.has_been_ready = False  # 是否曾经成功认证（用于区分初始化状态和session失效）
        self._task = None
        self._chat_id_cache: dict = {}
        self._cached_group_count: int = -1  # 缓存的真实群组数，-1 表示未计算
        self.files_directory = os.path.join(TDLIB_DATA_DIR, f"account_{self.account_id}")
        os.makedirs(self.files_directory, exist_ok=True)

    async def start(self) -> bool:
        global global_client_manager
        if not TG_API_ID or not TG_API_HASH:
            logger.error("TG_API_ID 或 TG_API_HASH 未配置")
            return False
        if not self.session_string and not self.phone:
            logger.warning(f"[Account {self.account_id}] 无 Session 或手机号，跳过")
            return False
        try:
            # 如果session_string是一个目录路径（TDLib files_dir），迁移session数据
            if self.session_string and os.path.isdir(self.session_string):
                # 尝试从 login_temp 目录迁移 td.binlog（支持 database/ 和 db/ 两种子目录结构）
                dst_db_dir = os.path.join(self.files_directory, "database")
                dst_db = os.path.join(dst_db_dir, "td.binlog")
                if not os.path.exists(dst_db):
                    for sub in ("database", "db"):
                        src_db = os.path.join(self.session_string, sub, "td.binlog")
                        if os.path.exists(src_db):
                            os.makedirs(dst_db_dir, exist_ok=True)
                            shutil.copy2(src_db, dst_db)
                            logger.info(f"[Account {self.account_id}] 已迁移 session: {src_db} -> {dst_db}")
                            break
            from pytdbot import Client as TDClient
            self.client = TDClient(
                api_id=TG_API_ID,
                api_hash=TG_API_HASH,
                files_directory=self.files_directory,
                use_message_database=True,
                use_chat_info_database=True,
                use_file_database=True,
                td_verbosity=1,
                user_bot=True,
            )

            @self.client.on_updateNewMessage()
            async def on_new_message(c, update):
                await self._on_new_message(update)

            @self.client.on_updateAuthorizationState()
            async def on_auth_state(c, update):
                await self._on_auth_state(update)

            # 使用全局 ClientManager 统一管理，避免多个 receiver 并发导致 TDLib 崩溃
            if global_client_manager is None:
                from pytdbot import ClientManager
                global_client_manager = ClientManager(loop=asyncio.get_event_loop())
                await global_client_manager.start()
                logger.info("[Engine] 全局 ClientManager 已创建并启动")

            # 将客户端注册到全局 ClientManager
            await global_client_manager.add_client(self.client, start_client=True)
            self.is_running = True
            logger.info(f"[Account {self.account_id}] TDLib Worker 已启动 (数据目录: {self.files_directory})")
            return True
        except Exception as e:
            logger.error(f"[Account {self.account_id}] 启动失败: {e}")
            await update_account_health(self.account_id, -15, "error", reason=str(e)[:100])
            return False

    async def _on_auth_state(self, update):
        try:
            # pytdbot returns objects, use .ID or type() to get state type
            auth_state = update.authorization_state if hasattr(update, "authorization_state") else update
            if hasattr(auth_state, "ID"):
                state_type = auth_state.ID
            elif isinstance(auth_state, dict):
                state_type = auth_state.get("@type", "")
            else:
                state_type = type(auth_state).__name__
            logger.info(f"[Account {self.account_id}] 认证状态: {state_type}")
            if state_type in ("authorizationStateReady", "AuthorizationStateReady"):
                self.has_been_ready = True
                await api.post("/engine/account/status", {"accountId": self.account_id, "status": "active"})
                await update_account_health(self.account_id, 0, "healthy")
            elif state_type in ("authorizationStateClosed", "AuthorizationStateClosed"):
                self.is_running = False
                await update_account_health(self.account_id, -10, "error", reason="session_closed")
            elif state_type in ("authorizationStateWaitPhoneNumber", "AuthorizationStateWaitPhoneNumber"):
                if self.has_been_ready:
                    # 曾经成功认证后再次出现WaitPhoneNumber，才说明session真的失效了
                    logger.warning(f"[Account {self.account_id}] Session失效，需要重新登录")
                    await update_account_health(self.account_id, -5, "expired", reason="session_expired")
                else:
                    # TDLib初始化时正常经过此状态，不代表session失效，忽略
                    logger.info(f"[Account {self.account_id}] TDLib初始化中，等待认证完成...")
        except Exception as e:
            logger.warning(f"[Account {self.account_id}] 处理认证状态异常: {e}")
    async def _on_new_message(self, update):
        try:
            from pytdbot.types import (
                MessageText, MessagePhoto, MessageVideo, MessageDocument,
                MessageSenderUser
            )
            message = update.message if hasattr(update, "message") else None
            if not message:
                return
            text = ""
            content_obj = getattr(message, "content", None)
            if content_obj is None:
                return
            if isinstance(content_obj, MessageText):
                ft = getattr(content_obj, "text", None)
                text = getattr(ft, "text", "") if ft else ""
            elif isinstance(content_obj, (MessagePhoto, MessageVideo, MessageDocument)):
                caption = getattr(content_obj, "caption", None)
                text = getattr(caption, "text", "") if caption else ""
            if not text or not text.strip():
                return
            chat_id_int = getattr(message, "chat_id", 0)
            if not chat_id_int or chat_id_int > 0:
                return
            chat_id = str(chat_id_int)
            sender_id_obj = getattr(message, "sender_id", None)
            if sender_id_obj is None:
                return
            if not isinstance(sender_id_obj, MessageSenderUser):
                return
            sender_user_id = getattr(sender_id_obj, "user_id", 0)
            if not sender_user_id:
                return
            message_id = getattr(message, "id", 0)
            chat_info = await self._get_chat_info(chat_id_int)
            chat_title = chat_info.get("title", str(chat_id_int))
            chat_username = chat_info.get("username", "") or None
            user_info = await self._get_user_info(sender_user_id)
            sender_username = user_info.get("username", "") or None
            sender_first_name = user_info.get("first_name", "")
            sender_last_name = user_info.get("last_name", "")
            is_bot = user_info.get("is_bot", False)
            logger.info(
                f"[Account {self.account_id}] 收到消息: "
                f"chat={chat_title}({chat_id}) "
                f"sender={sender_username or sender_user_id} "
                f"is_bot={is_bot} len={len(text)} "
                f"text={text[:80]!r}"
            )
            await process_message(
                account_id=self.account_id, user_id=self.user_id,
                chat_id=chat_id, chat_title=chat_title, chat_username=chat_username,
                sender_id=sender_user_id, sender_username=sender_username,
                sender_first_name=sender_first_name, sender_last_name=sender_last_name,
                message_id=message_id, text=text, is_bot=is_bot,
            )
        except Exception as e:
            logger.warning(f"[Account {self.account_id}] 处理消息异常: {e}", exc_info=True)
    async def _get_chat_info(self, chat_id: int) -> dict:
        try:
            result = await self.client.invoke({"@type": "getChat", "chat_id": chat_id})
            if result:
                # pytdbot 返回 Chat 对象（属性访问）或字典（键访问）
                def _get(obj, key, default=None):
                    if hasattr(obj, key):
                        return getattr(obj, key, default)
                    elif isinstance(obj, dict):
                        return obj.get(key, default)
                    return default
                obj_type = _get(result, "@type") or type(result).__name__
                if "chat" in obj_type.lower() or hasattr(result, "title"):
                    title = _get(result, "title", "")
                    chat_type_obj = _get(result, "type", {})
                    username = ""
                    type_name = (_get(chat_type_obj, "@type") or type(chat_type_obj).__name__) if chat_type_obj else ""
                    if "supergroup" in type_name.lower():
                        sg_id = _get(chat_type_obj, "supergroup_id", 0)
                        if sg_id:
                            sg_info = await self.client.invoke({"@type": "getSupergroup", "supergroup_id": sg_id})
                            if sg_info:
                                username = _get(sg_info, "username", "") or ""
                    return {"title": title, "username": username}
        except Exception:
            pass
        return {"title": str(chat_id), "username": ""}

    async def _get_user_info(self, user_id: int) -> dict:
        try:
            result = await self.client.invoke({"@type": "getUser", "user_id": user_id})
            if result:
                def _get(obj, key, default=None):
                    if hasattr(obj, key):
                        return getattr(obj, key, default)
                    elif isinstance(obj, dict):
                        return obj.get(key, default)
                    return default
                obj_type = _get(result, "@type") or type(result).__name__
                if "user" in obj_type.lower() or hasattr(result, "first_name"):
                    user_type_obj = _get(result, "type", {})
                    type_name = (_get(user_type_obj, "@type") or type(user_type_obj).__name__) if user_type_obj else ""
                    # TDLib 1.8.x+ usernames 对象：active_usernames 列表存储主用户名
                    username = ""
                    usernames_obj = _get(result, "usernames", None)
                    if usernames_obj is not None:
                        # 方法1：直接属性/字典访问 active_usernames
                        active = None
                        if hasattr(usernames_obj, "active_usernames"):
                            active = getattr(usernames_obj, "active_usernames", None)
                        elif isinstance(usernames_obj, dict):
                            active = usernames_obj.get("active_usernames")
                        if active and len(active) > 0:
                            username = active[0]
                        # 方法2：fallback 到 editable_username
                        if not username:
                            editable = None
                            if hasattr(usernames_obj, "editable_username"):
                                editable = getattr(usernames_obj, "editable_username", "")
                            elif isinstance(usernames_obj, dict):
                                editable = usernames_obj.get("editable_username", "")
                            if editable:
                                username = editable
                        # 方法3：str 解析（兜底，处理 pytdbot 特殊对象）
                        if not username:
                            import re as _re
                            s = str(usernames_obj)
                            m = _re.search(r'"active_usernames"\s*:\s*\[\s*"([^"]+)"', s)
                            if m:
                                username = m.group(1)
                    return {
                        "username": username,
                        "first_name": _get(result, "first_name", ""),
                        "last_name": _get(result, "last_name", ""),
                        "is_bot": "bot" in type_name.lower(),
                    }
        except Exception as e:
            import logging
            logging.getLogger(__name__).debug(f"[_get_user_info] error for user_id={user_id}: {e}")
        return {"username": "", "first_name": "", "last_name": "", "is_bot": False}

    async def resolve_chat_id(self, chat_id_str: str) -> Optional[int]:
        if not chat_id_str:
            return None
        try:
            return int(chat_id_str)
        except (ValueError, TypeError):
            pass
        if chat_id_str in self._chat_id_cache:
            return self._chat_id_cache[chat_id_str]
        try:
            if "t.me/+" in chat_id_str or "t.me/joinchat" in chat_id_str:
                result = await self.client.invoke({"@type": "joinChatByInviteLink", "invite_link": chat_id_str})
            else:
                username = chat_id_str.lstrip("@").split("/")[-1]
                result = await self.client.invoke({"@type": "searchPublicChat", "username": username})
            if result:
                # pytdbot 返回 Chat 对象（属性访问）或字典（键访问）
                if hasattr(result, 'id'):
                    real_id = result.id
                elif isinstance(result, dict):
                    real_id = result.get("id")
                else:
                    real_id = None
                if real_id:
                    self._chat_id_cache[chat_id_str] = real_id
                    logger.info(f"[Resolve] {chat_id_str} -> {real_id}")
                    return real_id
        except Exception as e:
            logger.warning(f"[Resolve] 无法解析 {chat_id_str}: {e}")
        return None

    async def join_chat(self, chat_id_str: str) -> Optional[int]:
        if not self.client or not self.is_running:
            return None
        try:
            chat_id_val = int(chat_id_str) if chat_id_str.lstrip("-").isdigit() else None
            if chat_id_val:
                await self.client.invoke({"@type": "joinChat", "chat_id": chat_id_val})
                return chat_id_val
            else:
                result = await self.resolve_chat_id(chat_id_str)
                if result:
                    await self.client.invoke({"@type": "joinChat", "chat_id": result})
                    return result
        except Exception as e:
            err_str = str(e).lower()
            if "already" in err_str or "member" in err_str:
                # 已经是成员，尝试解析真实 chat_id
                try:
                    resolved = await self.resolve_chat_id(chat_id_str)
                    if resolved:
                        logger.info(f"[Account {self.account_id}] 已是成员: {chat_id_str} -> {resolved}")
                        return resolved
                    return int(chat_id_str) if chat_id_str.lstrip("-").isdigit() else None
                except Exception:
                    pass
            logger.warning(f"[Account {self.account_id}] 加入群组 {chat_id_str} 失败: {e}")
        return None

    async def send_message(self, chat_id: int, text: str) -> bool:
        """兼容旧接口，内部调用 send_dm"""
        return await self.send_dm(str(chat_id), text)

    async def send_dm(self, target: str, text: str) -> bool:
        """
        发送私信。target 可以是数字 user_id（字符串）或 @username。
        流程：
          1. 若 target 是数字 → 直接 createPrivateChat(user_id)
          2. 若 target 是 username → searchPublicChat 获取 chat，直接用 chat.id 发送
          3. createPrivateChat 失败时，尝试 searchPublicChat 兜底
        """
        if not self.client or not self.is_running:
            return False
        try:
            import pytdbot.types as _tdt

            def _attr(obj, key, default=None):
                if hasattr(obj, key): return getattr(obj, key, default)
                if isinstance(obj, dict): return obj.get(key, default)
                return default

            real_chat_id = None
            target_str = str(target).strip()
            is_numeric = target_str.lstrip("-").isdigit()

            if is_numeric:
                # 数字 user_id：先尝试 createPrivateChat
                user_id = int(target_str)
                chat_result = await self.client.invoke({
                    "@type": "createPrivateChat",
                    "user_id": user_id,
                    "force": True
                })
                if isinstance(chat_result, _tdt.Error):
                    logger.warning(f"[Account {self.account_id}] createPrivateChat({user_id}) 失败: {chat_result.message}")
                    return False
                real_chat_id = _attr(chat_result, 'id', user_id)
            else:
                # username：用 searchPublicChat 从服务器查询，不依赖本地缓存
                username = target_str.lstrip("@")
                search_result = await self.client.invoke({
                    "@type": "searchPublicChat",
                    "username": username
                })
                if isinstance(search_result, _tdt.Error):
                    logger.warning(f"[Account {self.account_id}] searchPublicChat(@{username}) 失败: {search_result.message}")
                    return False
                real_chat_id = _attr(search_result, 'id')
                if not real_chat_id:
                    logger.warning(f"[Account {self.account_id}] searchPublicChat(@{username}) 未返回 chat id")
                    return False
                logger.info(f"[Account {self.account_id}] searchPublicChat @{username} -> chat_id={real_chat_id}")

            # 发送消息
            result = await self.client.invoke({
                "@type": "sendMessage",
                "chat_id": real_chat_id,
                "input_message_content": {
                    "@type": "inputMessageText",
                    "text": {"@type": "formattedText", "text": text}
                }
            })
            if isinstance(result, _tdt.Error):
                logger.warning(f"[Account {self.account_id}] sendMessage 失败: code={result.code} msg={result.message}")
                return False
            return True
        except Exception as e:
            logger.warning(f"[Account {self.account_id}] send_dm 异常: {e}")
            return False

    async def get_chat_count(self) -> int:
        """获取该账号在 Telegram 中实际加入的群组/频道数量"""
        if not self.client or not self.is_running:
            return -1
        try:
            import pytdbot.types as _tdt_cc
            # 多次 loadChats 确保本地缓存尽量完整
            for _ in range(3):
                try:
                    load_result = await self.client.invoke({
                        "@type": "loadChats",
                        "chat_list": {"@type": "chatListMain"},
                        "limit": 500,
                    })
                    # 如果返回 Error 说明已加载完毕
                    if isinstance(load_result, _tdt_cc.Error):
                        break
                except Exception:
                    break
            # 获取对话列表，limit=9999 尽量拿全部
            result = await self.client.invoke({
                "@type": "getChats",
                "chat_list": {"@type": "chatListMain"},
                "limit": 9999,
            })
            if result is None:
                return 0
            # 检查是否为错误对象
            if isinstance(result, _tdt_cc.Error):
                logger.warning(f"[Account {self.account_id}] getChats 返回错误: {result.message}")
                return -1
            # 优先使用 total_count（Chats 对象的真实总数字段）
            if hasattr(result, "total_count") and result.total_count and result.total_count > 0:
                return result.total_count
            # 其次用 chat_ids 列表长度
            if hasattr(result, "chat_ids") and result.chat_ids:
                return len(result.chat_ids)
            if isinstance(result, dict):
                tc = result.get("total_count", 0)
                if tc and tc > 0:
                    return tc
                ids = result.get("chat_ids", [])
                return len(ids) if ids else 0
            return 0
        except Exception as e:
            logger.warning(f"[Account {self.account_id}] get_chat_count 失败: {e}")
            return -1

    async def get_group_count(self) -> int:
        """返回缓存的真实群组数（由 _refresh_group_count 后台异步计算）"""
        return self._cached_group_count

    async def _refresh_group_count(self):
        """后台异步计算真实群组数（只统计 supergroup 和 basicGroup），结果写入缓存"""
        if not self.client or not self.is_running:
            return
        try:
            import pytdbot.types as _tdt_cc
            # 多次 loadChats 确保本地缓存尽量完整
            for _ in range(5):
                try:
                    load_result = await self.client.invoke({
                        "@type": "loadChats",
                        "chat_list": {"@type": "chatListMain"},
                        "limit": 500,
                    })
                    if isinstance(load_result, _tdt_cc.Error):
                        break
                    await asyncio.sleep(0.5)
                except Exception:
                    break
            # 获取所有对话 ID
            result = await self.client.invoke({
                "@type": "getChats",
                "chat_list": {"@type": "chatListMain"},
                "limit": 9999,
            })
            if result is None or isinstance(result, _tdt_cc.Error):
                return
            chat_ids = []
            if hasattr(result, 'chat_ids') and result.chat_ids:
                chat_ids = result.chat_ids
            elif isinstance(result, dict):
                chat_ids = result.get('chat_ids', [])
            if not chat_ids:
                self._cached_group_count = 0
                return
            # 逐个获取对话信息，统计群组类型
            group_count = 0
            for chat_id in chat_ids:
                try:
                    chat = await self.client.invoke({
                        "@type": "getChat",
                        "chat_id": chat_id,
                    })
                    if chat is None:
                        continue
                    chat_type = None
                    if hasattr(chat, 'type') and chat.type:
                        t = chat.type
                        chat_type = getattr(t, '@type', None) or (t.get('@type') if isinstance(t, dict) else None)
                    elif isinstance(chat, dict):
                        t = chat.get('type', {})
                        chat_type = t.get('@type') if isinstance(t, dict) else None
                    if chat_type in ('chatTypeSupergroup', 'chatTypeBasicGroup'):
                        group_count += 1
                except Exception:
                    continue
            self._cached_group_count = group_count
            logger.info(f"[Account {self.account_id}] 真实群组数已更新: {group_count}")
        except Exception as e:
            logger.warning(f"[Account {self.account_id}] _refresh_group_count 失败: {e}")

    async def stop(self):
        global global_client_manager
        self.is_running = False
        if self.client:
            try:
                # 先从全局 ClientManager 中移除客户端
                if global_client_manager and hasattr(self.client, 'client_id') and self.client.client_id:
                    try:
                        await global_client_manager.delete_client(self.client.client_id, close_client=True)
                    except Exception:
                        await self.client.stop()
                else:
                    await self.client.stop()
            except Exception:
                pass
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info(f"[Account {self.account_id}] TDLib Worker 已停止")


async def join_public_groups(worker: AccountWorker, account_id: int, force: bool = False):
    """
    加入公共监控群组（分片分配、真正加群、详细日志）：
    1. 从服务器获取所有管理员监控账号列表（按 ID 排序）
    2. 根据当前账号在列表中的序号（rank）分片：group_index % account_count == rank
    3. 只处理分配到当前账号的群组，确保账号间群组不重复
    4. 真正调用 joinChat 加入群组，并上报详细日志
    """
    global public_group_real_ids
    if not public_groups:
        return
    active_groups = [pg for pg in public_groups if pg.get("isActive", True)]
    if not active_groups:
        return

    # 步骤 1：获取所有管理员监控账号列表（用于分片）
    admin_accounts = []
    try:
        resp = await api.get("/engine/admin-accounts")
        admin_accounts = resp.get("accounts", []) if isinstance(resp, dict) else []
        admin_accounts.sort(key=lambda x: x.get("id", 0))  # 按 ID 排序，保证分片顺序一致
    except Exception as e:
        logger.warning(f"[Account {account_id}] 获取管理员账号列表失败: {e}")

    # 步骤 2：计算当前账号的分片序号
    account_count = len(admin_accounts)
    account_rank = -1
    for i, acc in enumerate(admin_accounts):
        if acc.get("id") == account_id:
            account_rank = i
            break

    # 步骤 3：确定当前账号负责的群组（分片分配）
    max_groups = int(join_config.get("maxGroupsPerAccount", 200))
    if account_rank >= 0 and account_count > 0:
        assigned_groups = [pg for i, pg in enumerate(active_groups) if i % account_count == account_rank]
        # 应用每账号加群上限
        if len(assigned_groups) > max_groups:
            logger.info(f"[Account {account_id}] 分片分配 {len(assigned_groups)} 个群组，超过上限 {max_groups}，截断至 {max_groups} 个")
            assigned_groups = assigned_groups[:max_groups]
        logger.info(f"[Account {account_id}] 分片分配：账号序号 {account_rank}/{account_count}，负责 {len(assigned_groups)}/{len(active_groups)} 个群组（上限 {max_groups}）")
    else:
        logger.info(f"[Account {account_id}] 账号不在管理员列表，仅建立群组映射不执行加群")
        assigned_groups = []
    assigned_group_ids = set(pg.get("id") for pg in assigned_groups)

    # 步骤 4：获取当前账号已加入的群组列表
    joined_chat_ids: set = set()
    try:
        import pytdbot.types as _tdt_bj
        for _ in range(3):
            try:
                await worker.client.invoke({"@type": "loadChats", "chat_list": {"@type": "chatListMain"}, "limit": 500})
            except Exception:
                break
        chats_r = await worker.client.invoke({"@type": "getChats", "chat_list": {"@type": "chatListMain"}, "limit": 9999})
        if chats_r and not isinstance(chats_r, _tdt_bj.Error):
            cids = getattr(chats_r, "chat_ids", None) or (chats_r.get("chat_ids", []) if isinstance(chats_r, dict) else [])
            joined_chat_ids = set(int(c) for c in (cids or []))
        logger.info(f"[Account {account_id}] 已加入 {len(joined_chat_ids)} 个群组")
    except Exception as e:
        logger.warning(f"[Account {account_id}] 获取已加入群组列表失败: {e}")

    import random as _rand
    subscribed_count = 0
    joined_count = 0
    not_found_count = 0
    failed_count = 0

    for pg in active_groups:
        pg_id = pg.get("id")
        group_id = str(pg.get("groupId", "")).strip()
        if not group_id:
            continue

        # 先尝试解析 real_id
        real_id = public_group_real_ids.get(group_id)
        if not real_id and pg.get("realId"):
            real_id = int(pg["realId"])
            public_group_real_ids[group_id] = real_id
        if not real_id:
            try:
                if group_id.lstrip("-").isdigit():
                    real_id = int(group_id)
                else:
                    username = group_id.lstrip("@")
                    result = await worker.client.invoke({"@type": "searchPublicChat", "username": username})
                    if result:
                        _rid = getattr(result, "id", None) or (result.get("id") if isinstance(result, dict) else None)
                        if _rid:
                            real_id = int(_rid)
            except Exception as e:
                logger.debug(f"[Account {account_id}] 解析群组 {group_id} 失败: {e}")
        if real_id:
            public_group_real_ids[group_id] = int(real_id)

        # 判断是否分配给当前账号
        is_assigned = pg_id in assigned_group_ids

        if not is_assigned:
            # 未分配给当前账号，只建立映射
            if real_id:
                subscribed_count += 1
            await asyncio.sleep(0.02)
            continue

        # 分配给当前账号：判断是否已加入
        already_joined = real_id and int(real_id) in joined_chat_ids

        if already_joined:
            subscribed_count += 1
            logger.debug(f"[Account {account_id}] 群组 {group_id} 已加入，建立映射")
            if pg_id:
                try:
                    await api.post("/engine/public-group/join-log", {
                        "publicGroupId": pg_id, "monitorAccountId": account_id,
                        "status": "subscribed", "realId": str(real_id) if real_id else None,
                        "logEntry": "账号已在群组中，建立监控映射",
                    })
                except Exception:
                    pass
        else:
            # 尝试加入群组
            logger.info(f"[Account {account_id}] 正在加入群组 {group_id}...")
            if pg_id:
                try:
                    await api.post("/engine/public-group/join-log", {
                        "publicGroupId": pg_id, "monitorAccountId": account_id,
                        "status": "pending", "logEntry": "正在尝试加入群组...",
                    })
                except Exception:
                    pass
            try:
                joined_real_id = await worker.join_chat(group_id)
                if joined_real_id:
                    public_group_real_ids[group_id] = int(joined_real_id)
                    joined_chat_ids.add(int(joined_real_id))
                    joined_count += 1
                    logger.info(f"[Account {account_id}] 成功加入群组 {group_id} -> {joined_real_id}")
                    if pg_id:
                        try:
                            await api.post("/engine/public-group/join-log", {
                                "publicGroupId": pg_id, "monitorAccountId": account_id,
                                "status": "subscribed", "realId": str(joined_real_id),
                                "logEntry": f"成功加入，real_id={joined_real_id}",
                            })
                        except Exception:
                            pass
                    # 加群间隔（防封）
                    delay = _rand.uniform(
                        join_config.get("joinIntervalMin", 30),
                        join_config.get("joinIntervalMax", 60)
                    )
                    await asyncio.sleep(delay)
                else:
                    failed_count += 1
                    logger.warning(f"[Account {account_id}] 加入群组 {group_id} 失败（返回 None）")
                    if pg_id:
                        try:
                            await api.post("/engine/public-group/join-log", {
                                "publicGroupId": pg_id, "monitorAccountId": account_id,
                                "status": "not_found", "errorMsg": "加入失败（返回 None）",
                                "logEntry": "加入失败，群组可能不存在或需要邀请链接",
                            })
                        except Exception:
                            pass
            except Exception as e:
                err_msg = str(e)
                failed_count += 1
                logger.warning(f"[Account {account_id}] 加入群组 {group_id} 异常: {e}")
                if pg_id:
                    try:
                        await api.post("/engine/public-group/join-log", {
                            "publicGroupId": pg_id, "monitorAccountId": account_id,
                            "status": "not_found", "errorMsg": err_msg[:200],
                            "logEntry": f"加入异常: {err_msg[:100]}",
                        })
                    except Exception:
                        pass

        await asyncio.sleep(0.05)

    logger.info(
        f"[Account {account_id}] ===== 加群完成 =====\n"
        f"  分配群组数: {len(assigned_groups)}/{len(active_groups)}\n"
        f"  已在群中: {subscribed_count}\n"
        f"  新加入: {joined_count}\n"
        f"  失败: {failed_count}\n"
        f"  real_ids 映射总数: {len(public_group_real_ids)}"
    )
    if worker and worker.is_running:
        asyncio.create_task(worker._refresh_group_count())


async def scrape_groups_task():
    """群组采集任务：轮询 pending 任务，调用 TDLib searchPublicChats 采集群组"""
    SCRAPE_INTERVAL = 60  # 每 60 秒轮询一次待执行任务
    while True:
        try:
            # 选一个活跃的 monitor 账号来执行采集
            worker = None
            for w in active_workers.values():
                if w.is_running and w.client:
                    worker = w
                    break
            if not worker:
                await asyncio.sleep(SCRAPE_INTERVAL)
                continue

            # 查询待执行任务
            tasks = await api.get("/engine/scrape-tasks")
            if not tasks:
                await asyncio.sleep(SCRAPE_INTERVAL)
                continue

            for task in tasks:
                task_id = task.get("id")
                keywords = task.get("keywords", [])
                min_members = task.get("minMemberCount", 1000)
                max_results = task.get("maxResults", 50)
                fission_enabled = task.get("fissionEnabled", False)
                fission_depth = min(int(task.get("fissionDepth", 1)), 3)
                fission_max_per_seed = min(int(task.get("fissionMaxPerSeed", 10)), 50)

                if not task_id or not keywords:
                    continue

                logger.info(f"[Scrape] 开始采集任务 #{task_id}，关键词: {keywords}")

                # 标记任务开始运行
                await api.post(f"/engine/scrape-task/{task_id}/start", {})

                all_results = []
                try:
                    for kw in keywords:
                        try:
                            # 调用 TDLib searchPublicChats
                            search_result = await worker.client.invoke({
                                "@type": "searchPublicChats",
                                "query": kw
                            })

                            if not search_result:
                                continue

                            # 解析返回的群组列表
                            def _get(obj, key, default=None):
                                if hasattr(obj, key):
                                    return getattr(obj, key, default)
                                elif isinstance(obj, dict):
                                    return obj.get(key, default)
                                return default

                            # searchPublicChats 返回 Chats 对象，包含 chat_ids 列表
                            chat_ids = _get(search_result, "chat_ids") or _get(search_result, "chatIds") or []
                            if not chat_ids and hasattr(search_result, '__iter__'):
                                chat_ids = list(search_result)

                            logger.info(f"[Scrape] 关键词 '{kw}' 搜索到 {len(chat_ids)} 个群组")

                            kw_count = 0
                            for chat_id in chat_ids:
                                if kw_count >= max_results:
                                    break
                                try:
                                    # 获取群组详细信息
                                    chat_info = await worker.client.invoke({
                                        "@type": "getChat",
                                        "chat_id": chat_id
                                    })
                                    if not chat_info:
                                        continue

                                    title = _get(chat_info, "title", "") or ""
                                    chat_type_obj = _get(chat_info, "type", {})
                                    type_name = (_get(chat_type_obj, "@type") or type(chat_type_obj).__name__) if chat_type_obj else ""

                                    # 确定群组类型
                                    if "channel" in type_name.lower():
                                        group_type = "channel"
                                    elif "supergroup" in type_name.lower():
                                        group_type = "supergroup"
                                    elif "basic" in type_name.lower():
                                        group_type = "group"
                                    else:
                                        group_type = "group"

                                    # 获取 username 和成员数
                                    username = ""
                                    member_count = 0
                                    description = ""

                                    if "supergroup" in type_name.lower():
                                        sg_id = _get(chat_type_obj, "supergroup_id", 0)
                                        if sg_id:
                                            sg_info = await worker.client.invoke({
                                                "@type": "getSupergroup",
                                                "supergroup_id": sg_id
                                            })
                                            if sg_info:
                                                username = _get(sg_info, "username", "") or ""
                                                member_count = _get(sg_info, "member_count", 0) or 0
                                            # 获取群组简介
                                            try:
                                                sg_full = await worker.client.invoke({
                                                    "@type": "getSupergroupFullInfo",
                                                    "supergroup_id": sg_id
                                                })
                                                if sg_full:
                                                    description = _get(sg_full, "description", "") or ""
                                                    if not member_count:
                                                        member_count = _get(sg_full, "member_count", 0) or 0
                                            except Exception:
                                                pass

                                    # 成员数过滤
                                    if member_count < min_members:
                                        logger.debug(f"[Scrape] 跳过 {title}({username}): 成员数 {member_count} < {min_members}")
                                        continue

                                    group_id = f"@{username}" if username else str(chat_id)

                                    all_results.append({
                                        "keyword": kw,
                                        "groupId": group_id,
                                        "groupTitle": title,
                                        "groupType": group_type,
                                        "memberCount": member_count,
                                        "description": description[:500] if description else "",
                                        "username": username,
                                        "realId": str(chat_id),
                                    })
                                    kw_count += 1
                                    logger.info(f"[Scrape] 采集到: {title} ({group_id}) 成员数: {member_count}")

                                    # 防止请求过快
                                    await asyncio.sleep(0.5)

                                except Exception as e:
                                    logger.warning(f"[Scrape] 获取群组详情失败 {chat_id}: {e}")
                                    continue

                            # 关键词间延迟
                            await asyncio.sleep(2)

                        except Exception as e:
                            logger.warning(f"[Scrape] 搜索关键词 '{kw}' 失败: {e}")
                            continue

                    # ── 裂变采集：对每个种子群获取相似群 ──────────────────────
                    if fission_enabled and all_results:
                        logger.info(f"[Scrape] 开始裂变采集，种子群数量: {len(all_results)}，深度: {fission_depth}，每种子最多: {fission_max_per_seed}")
                        seen_ids = set(r["realId"] for r in all_results if r.get("realId"))
                        seen_usernames = set(r["username"] for r in all_results if r.get("username"))
                        seed_queue = list(all_results)
                        
                        # ── 辅助函数：从文本中提取 @username 和 t.me/xxx ──
                        def _extract_usernames(text: str) -> list:
                            if not text:
                                return []
                            found = []
                            # 匹配 @username
                            found += re.findall(r'@([a-zA-Z][a-zA-Z0-9_]{4,})', text)
                            # 匹配 t.me/xxx 或 telegram.me/xxx
                            found += re.findall(r'(?:t\.me|telegram\.me)/([a-zA-Z][a-zA-Z0-9_]{4,})', text)
                            return list(set(found))
                        
                        # ── 辅助函数：从群名中提取有效搜索关键词 ──
                        def _extract_keywords_from_title(title: str) -> list:
                            if not title:
                                return []
                            # 去除 emoji 和特殊符号，提取中文词组和英文词
                            clean = re.sub(r'[\U00010000-\U0010ffff]', ' ', title)  # 去 emoji
                            clean = re.sub(r'[^\w\s\u4e00-\u9fff]', ' ', clean)
                            # 提取2-4字的中文词组（连续汉字）- 更短的词覆盖更广
                            cn_words_long = re.findall(r'[\u4e00-\u9fff]{3,6}', clean)
                            cn_words_short = re.findall(r'[\u4e00-\u9fff]{2,4}', clean)
                            # 提取长度>=3的英文词
                            en_words = re.findall(r'[a-zA-Z]{3,}', clean)
                            # 过滤常见无意义词
                            stopwords = {'tg', 'telegram', 'the', 'and', 'for', 'bot', 'channel', 'group', '超级', '中文', '搜索', '导航', '群组', '频道'}
                            en_words = [w.lower() for w in en_words if w.lower() not in stopwords]
                            cn_words = [w for w in cn_words_long + cn_words_short if w not in stopwords]
                            # 去重并返回最多8个关键词（优先长词）
                            seen = set()
                            result = []
                            for w in cn_words + en_words:
                                if w not in seen:
                                    seen.add(w)
                                    result.append(w)
                            return result[:8]  # 最多8个关键词
                        
                        for depth_i in range(fission_depth):
                            next_seeds = []
                            new_this_depth = 0
                            logger.info(f"[Scrape][裂变] 第 {depth_i+1} 层，处理 {len(seed_queue)} 个种子群")
                            
                            for seed in seed_queue:
                                if new_this_depth >= fission_max_per_seed * len(seed_queue):
                                    break
                                seed_title = seed.get("groupTitle", "") or ""
                                seed_desc = seed.get("description", "") or ""
                                seed_kw = seed.get("keyword", "?")
                                added_for_seed = 0
                                
                                # ── 引擎A：解析简介和名称中的 @username / t.me 链接 ──
                                candidate_usernames = _extract_usernames(seed_desc) + _extract_usernames(seed_title)
                                logger.info(f"[Scrape][裂变诊断] 种子群: {seed_title[:30]} | desc长度:{len(seed_desc)} | 提取@: {candidate_usernames}")
                                for uname in candidate_usernames:
                                    if added_for_seed >= fission_max_per_seed:
                                        break
                                    if uname in seen_usernames:
                                        continue
                                    try:
                                        chat_info = await worker.client.invoke({
                                            "@type": "searchPublicChat",
                                            "username": uname
                                        })
                                        if not chat_info:
                                            continue
                                        sim_chat_id = chat_info.get("id", 0)
                                        sim_id_str = str(sim_chat_id)
                                        if sim_id_str in seen_ids:
                                            continue
                                        sim_title = chat_info.get("title", "") or ""
                                        sim_type_obj = chat_info.get("type", {})
                                        sim_type_name = (sim_type_obj.get("@type") or "") if sim_type_obj else ""
                                        sim_username = uname
                                        sim_member_count = 0
                                        sim_description = ""
                                        if "supergroup" in sim_type_name.lower():
                                            sg_id = sim_type_obj.get("supergroup_id", 0) if sim_type_obj else 0
                                            if sg_id:
                                                sg_info = await worker.client.invoke({
                                                    "@type": "getSupergroup",
                                                    "supergroup_id": sg_id
                                                })
                                                if sg_info:
                                                    sim_member_count = sg_info.get("member_count", 0) or 0
                                                try:
                                                    sg_full = await worker.client.invoke({
                                                        "@type": "getSupergroupFullInfo",
                                                        "supergroup_id": sg_id
                                                    })
                                                    if sg_full:
                                                        sim_description = sg_full.get("description", "") or ""
                                                        if not sim_member_count:
                                                            sim_member_count = sg_full.get("member_count", 0) or 0
                                                except Exception:
                                                    pass
                                        elif "channel" in sim_type_name.lower():
                                            # channel类型：通过supergroup_id获取成员数
                                            ch_sg_id = sim_type_obj.get("supergroup_id", 0) if sim_type_obj else 0
                                            if ch_sg_id:
                                                try:
                                                    ch_sg_info = await worker.client.invoke({
                                                        "@type": "getSupergroup",
                                                        "supergroup_id": ch_sg_id
                                                    })
                                                    if ch_sg_info:
                                                        sim_member_count = ch_sg_info.get("member_count", 0) or 0
                                                    ch_sg_full = await worker.client.invoke({
                                                        "@type": "getSupergroupFullInfo",
                                                        "supergroup_id": ch_sg_id
                                                    })
                                                    if ch_sg_full:
                                                        sim_description = ch_sg_full.get("description", "") or ""
                                                        if not sim_member_count:
                                                            sim_member_count = ch_sg_full.get("member_count", 0) or 0
                                                except Exception:
                                                    pass
                                        # 裂变时使用较低的成员数门槛（种子的50%或1000，取较小值）
                                        fission_min = min(min_members, max(1000, min_members // 2))
                                        if sim_member_count < fission_min:
                                            logger.info(f"[Scrape][裂变@] 过滤 @{uname}: 成员数 {sim_member_count} < {fission_min} (类型:{sim_type_name})")
                                            continue
                                        sim_group_type = "channel" if "channel" in sim_type_name.lower() else "supergroup"
                                        new_entry = {
                                            "keyword": f"[裂变@]{seed_kw}",
                                            "groupId": f"@{sim_username}",
                                            "groupTitle": sim_title,
                                            "groupType": sim_group_type,
                                            "memberCount": sim_member_count,
                                            "description": sim_description[:500] if sim_description else "",
                                            "username": sim_username,
                                            "realId": sim_id_str,
                                        }
                                        all_results.append(new_entry)
                                        next_seeds.append(new_entry)
                                        seen_ids.add(sim_id_str)
                                        seen_usernames.add(sim_username)
                                        added_for_seed += 1
                                        new_this_depth += 1
                                        logger.info(f"[Scrape][裂变@] 发现: {sim_title} (@{sim_username}) 成员: {sim_member_count}")
                                    except Exception as e:
                                        logger.debug(f"[Scrape][裂变@] 解析 @{uname} 失败: {e}")
                                    await asyncio.sleep(0.5)
                                
                                # ── 引擎B：从群名提取关键词继续搜索 ──
                                kw_candidates = _extract_keywords_from_title(seed_title)
                                logger.info(f"[Scrape][裂变诊断] 引擎B关键词: {kw_candidates} (来自: {seed_title[:30]})")
                                for kw_new in kw_candidates:
                                    if added_for_seed >= fission_max_per_seed:
                                        break
                                    try:
                                        search_res = await worker.client.invoke({
                                            "@type": "searchPublicChats",
                                            "query": kw_new
                                        })
                                        if not search_res:
                                            continue
                                        chat_ids_new = search_res.get("chat_ids", []) or []
                                        for new_cid in chat_ids_new[:5]:
                                            new_id_str = str(new_cid)
                                            if new_id_str in seen_ids:
                                                continue
                                            if added_for_seed >= fission_max_per_seed:
                                                break
                                            try:
                                                nc_info = await worker.client.invoke({
                                                    "@type": "getChat",
                                                    "chat_id": new_cid
                                                })
                                                if not nc_info:
                                                    continue
                                                nc_title = nc_info.get("title", "") or ""
                                                nc_type_obj = nc_info.get("type", {})
                                                nc_type_name = (nc_type_obj.get("@type") or "") if nc_type_obj else ""
                                                nc_username = ""
                                                nc_member_count = 0
                                                nc_description = ""
                                                if "supergroup" in nc_type_name.lower() or "channel" in nc_type_name.lower():
                                                    sg_id2 = nc_type_obj.get("supergroup_id", 0) if nc_type_obj else 0
                                                    if sg_id2:
                                                        sg_info2 = await worker.client.invoke({
                                                            "@type": "getSupergroup",
                                                            "supergroup_id": sg_id2
                                                        })
                                                        if sg_info2:
                                                            nc_username = sg_info2.get("username", "") or ""
                                                            nc_member_count = sg_info2.get("member_count", 0) or 0
                                                        try:
                                                            sg_full2 = await worker.client.invoke({
                                                                "@type": "getSupergroupFullInfo",
                                                                "supergroup_id": sg_id2
                                                            })
                                                            if sg_full2:
                                                                nc_description = sg_full2.get("description", "") or ""
                                                                if not nc_member_count:
                                                                    nc_member_count = sg_full2.get("member_count", 0) or 0
                                                        except Exception:
                                                            pass
                                                # 裂变时使用较低的成员数门槛
                                                fission_min_b = min(min_members, max(1000, min_members // 2))
                                                if nc_member_count < fission_min_b:
                                                    logger.info(f"[Scrape][裂变词] 过滤 {nc_title}: 成员数 {nc_member_count} < {fission_min_b}")
                                                    continue
                                                if nc_username in seen_usernames:
                                                    continue
                                                nc_group_type = "channel" if "channel" in nc_type_name.lower() else "supergroup"
                                                nc_group_id = f"@{nc_username}" if nc_username else new_id_str
                                                new_entry2 = {
                                                    "keyword": f"[裂变词]{kw_new}",
                                                    "groupId": nc_group_id,
                                                    "groupTitle": nc_title,
                                                    "groupType": nc_group_type,
                                                    "memberCount": nc_member_count,
                                                    "description": nc_description[:500] if nc_description else "",
                                                    "username": nc_username,
                                                    "realId": new_id_str,
                                                }
                                                all_results.append(new_entry2)
                                                next_seeds.append(new_entry2)
                                                seen_ids.add(new_id_str)
                                                if nc_username:
                                                    seen_usernames.add(nc_username)
                                                added_for_seed += 1
                                                new_this_depth += 1
                                                logger.info(f"[Scrape][裂变词] 发现: {nc_title} ({nc_group_id}) 成员: {nc_member_count}")
                                                await asyncio.sleep(0.5)
                                            except Exception as e2:
                                                logger.debug(f"[Scrape][裂变词] 获取群详情失败 {new_cid}: {e2}")
                                                continue
                                    except Exception as e:
                                        logger.debug(f"[Scrape][裂变词] 搜索 '{kw_new}' 失败: {e}")
                                    await asyncio.sleep(1)
                                
                            seed_queue = next_seeds
                            logger.info(f"[Scrape][裂变] 第 {depth_i+1} 层完成，新增 {new_this_depth} 个群组")
                            if not seed_queue:
                                logger.info(f"[Scrape][裂变] 无新种子，停止裂变")
                                break
                        logger.info(f"[Scrape] 裂变采集完成，总计 {len(all_results)} 个群组（含种子）")

                    # ── 任务完成，回写结果 ──────────────────────────────────────
                    logger.info(f"[Scrape] 任务 #{task_id} 完成，共采集 {len(all_results)} 个群组")
                    await api.post(f"/engine/scrape-task/{task_id}/finish", {
                        "status": "done",
                        "results": all_results,
                    })

                except Exception as e:
                    logger.error(f"[Scrape] 任务 #{task_id} 异常: {e}")
                    await api.post(f"/engine/scrape-task/{task_id}/finish", {
                        "status": "failed",
                        "results": all_results,
                    })

        except Exception as e:
            logger.error(f"[Scrape] 采集循环异常: {e}")

        await asyncio.sleep(SCRAPE_INTERVAL)


async def process_dm_queue():
    global dm_trigger_event
    while True:
        try:
            # 等待触发事件或超时兜底（whichever comes first）
            try:
                await asyncio.wait_for(dm_trigger_event.wait(), timeout=DM_WORKER_INTERVAL)
            except asyncio.TimeoutError:
                pass
            dm_trigger_event.clear()
            queue = await api.get("/engine/dm-queue?limit=20")
            if not queue:
                continue
            items = queue if isinstance(queue, list) else queue.get("items", [])
            for item in items[:20]:
                queue_id = item.get("id")
                account_id = item.get("senderAccountId")
                target_tg_id = str(item.get("targetTgId", ""))
                target_username = item.get("targetUsername")
                content = item.get("content", "")
                user_id = item.get("userId")
                if not account_id or not content:
                    continue
                worker = active_workers.get(account_id)
                if not worker or not worker.is_running:
                    logger.warning(f"[DM] 账号 {account_id} 不可用，跳过")
                    continue
                # 直接发送，不等待延迟（用户要求立即触发）
                logger.info(f"[DM] 准备发送 account={account_id} target={target_username or target_tg_id}")
                try:
                    # 优先用 username（searchPublicChat 直接从服务器查，不依赖本地缓存）
                    # 若只有数字 ID，则用 createPrivateChat
                    if target_username:
                        success = await worker.send_dm(f"@{target_username}", content)
                    elif target_tg_id:
                        success = await worker.send_dm(target_tg_id, content)
                    else:
                        success = False
                    if success:
                        cache_key = f"{account_id}:{target_tg_id}"
                        sent_dm_cache[cache_key] = time.time()
                        await api.post("/engine/dm-queue/success", {"id": queue_id})
                        await update_account_health(account_id, 0)
                        logger.info(f"[DM] 发送成功 -> {target_username or target_tg_id}")
                    else:
                        await api.post("/engine/dm-queue/fail", {"id": queue_id, "error": "send_failed"})
                except Exception as e:
                    logger.error(f"[DM] 发送失败: {e}")
                    await update_account_health(account_id, -2, reason="error")
                    await api.post("/engine/dm-queue/fail", {"id": queue_id, "error": str(e)[:200]})
        except Exception as e:
            logger.error(f"[DM Worker] 异常: {e}")


async def sync_config():
    global monitor_config, public_groups, force_sync_event, global_anti_spam
    while True:
        try:
            data = await api.get("/engine/config")
            if not data:
                logger.warning("[Config] 无法获取配置，稍后重试")
                await asyncio.sleep(POLL_INTERVAL)
                continue
            monitor_config = data.get("userConfigs", {})
            accounts = data.get("accounts", [])
            new_public_groups = data.get("publicGroups", [])
            # 读取全局反垃圾配置
            new_anti_spam = data.get("globalAntiSpam", {})
            if new_anti_spam:
                global_anti_spam.update(new_anti_spam)
            old_ids = {g.get("groupId") for g in public_groups}
            new_ids = {g.get("groupId") for g in new_public_groups}
            public_groups_changed = old_ids != new_ids
            public_groups = new_public_groups
            # 立即从配置预加载已知的 real_ids（引擎首次解析后回写到数据库的）
            preloaded = 0
            for g in new_public_groups:
                gid = g.get("groupId", "")
                rid = g.get("realId")
                if gid and rid and gid not in public_group_real_ids:
                    public_group_real_ids[gid] = int(rid)
                    preloaded += 1
            if preloaded > 0:
                logger.info(f"[Config] 预加载 {preloaded} 个群组 real_id 映射，监控立即生效")
            # 读取加群配置
            new_join_config = data.get("joinConfig", {})
            if new_join_config:
                join_config.update(new_join_config)
            if public_groups:
                logger.info(f"[Config] 公共群组: {len([g for g in public_groups if g.get('isActive')])} 个活跃")
            target_ids = {
                a["id"] for a in accounts
                if a.get("isActive") and a.get("role") in ("monitor", "sender", "both")
                and (a.get("sessionString") or a.get("phone"))
            }
            to_stop = set(active_workers.keys()) - target_ids
            for aid in to_stop:
                logger.info(f"[Config] 停止账号 {aid}")
                worker = active_workers.pop(aid, None)
                if worker:
                    await worker.stop()
            to_start = target_ids - set(active_workers.keys())
            for account in accounts:
                if account["id"] in to_start:
                    worker = AccountWorker(account)
                    success = await worker.start()
                    if success:
                        active_workers[account["id"]] = worker
                        # sender角色只发信，不需要加群监听
                        if account.get("role") != "sender":
                            asyncio.create_task(join_public_groups(worker, account["id"]))
                        else:
                            logger.info(f"[Account {account['id']}] 发信账号，跳过自动加群")
                        # 延迟 180 秒后刷新真实群组数（等待 TDLib 本地缓存完全就绪）
                        async def _delayed_refresh(w=worker):
                            await asyncio.sleep(180)
                            await w._refresh_group_count()
                        asyncio.create_task(_delayed_refresh())
            if public_groups_changed and public_groups:
                logger.info("[Config] 公共群组列表已更新，所有账号重新加入...")
                # 构建 account_id -> role 映射
                account_role_map = {a["id"]: a.get("role", "monitor") for a in accounts}
                for aid, worker in active_workers.items():
                    if account_role_map.get(aid) == "sender":
                        logger.info(f"[Account {aid}] 发信账号，跳过群组更新加群")
                    else:
                        asyncio.create_task(join_public_groups(worker, aid))
            logger.info(
                f"[Config] 同步完成 活跃账号={len(active_workers)} "
                f"监控用户={len(monitor_config)} 公共群组={len(public_groups)}"
            )
        except Exception as e:
            logger.error(f"[Config] 同步异常: {e}")
        # 支持手动触发立即同步（force_sync_event.set()）
        if force_sync_event:
            try:
                await asyncio.wait_for(force_sync_event.wait(), timeout=POLL_INTERVAL)
                force_sync_event.clear()
                logger.info("[Config] 收到强制同步信号，立即重新加载配置...")
            except asyncio.TimeoutError:
                pass
        else:
            await asyncio.sleep(POLL_INTERVAL)


async def heartbeat():
    while True:
        try:
            await api.post("/engine/heartbeat", {
                "activeAccounts": len(active_workers),
                "timestamp": int(time.time()),
                "engineType": "tdlib",
                "tdlibVersion": "1.8.x",
                "totalGroups": len(public_groups),
            })
        except Exception as e:
            logger.warning(f"[Heartbeat] 上报失败: {e}")
        await asyncio.sleep(60)


async def http_server():
    """HTTP 服务器，接收强制同步请求"""
    from aiohttp import web
    async def handle_force_sync(request: web.Request):
        secret = request.headers.get("X-Engine-Secret", "")
        if secret != ENGINE_SECRET:
            return web.json_response({"error": "unauthorized"}, status=401)
        if force_sync_event:
            force_sync_event.set()
        return web.json_response({"success": True, "message": "已触发强制同步"})
    async def handle_status(request: web.Request):
        # 收集每个运行中账号的状态信息
        accounts_info = []
        for aid, worker in active_workers.items():
            try:
                chat_count = await worker.get_chat_count()
            except Exception:
                chat_count = -1
            # groupCount 直接读取缓存属性，不需要异步调用
            group_count = getattr(worker, '_cached_group_count', -1)
            accounts_info.append({
                "accountId": aid,
                "chatCount": chat_count,
                "groupCount": group_count,
                "isRunning": worker.is_running,
            })
        return web.json_response({
            "activeAccounts": len(active_workers),
            "publicGroups": len(public_groups),
            "monitorUsers": len(monitor_config),
            "accounts": accounts_info,
        })
    async def handle_sync_account(request: web.Request):
        # 触发指定账号立即加入所有公共群组
        secret = request.headers.get("X-Engine-Secret", "")
        if secret != ENGINE_SECRET:
            return web.json_response({"error": "unauthorized"}, status=401)
        try:
            body = await request.json()
        except Exception:
            body = {}
        account_id = body.get("account_id")
        if not account_id:
            return web.json_response({"error": "account_id required"}, status=400)
        account_id = int(account_id)
        worker = active_workers.get(account_id)
        if not worker:
            return web.json_response({"error": f"账号 {account_id} 未在引擎中运行，请先启用该账号并等待引擎加载"}, status=404)
        if not worker.is_running:
            return web.json_response({"error": f"账号 {account_id} 未就绪，请稍后重试"}, status=503)
        # 异步触发加群，不等待完成
        asyncio.create_task(join_public_groups(worker, account_id, force=True))
        return web.json_response({"success": True, "message": f"账号 {account_id} 已开始同步群组，请稍后刷新查看"})
    async def handle_get_account_chats(request: web.Request):
        """获取指定账号已加入的群组/频道列表，用于导入到公共群组池"""
        secret = request.headers.get("X-Engine-Secret", "")
        if secret != ENGINE_SECRET:
            return web.json_response({"error": "unauthorized"}, status=401)
        try:
            body = await request.json()
        except Exception:
            body = {}
        account_id = body.get("account_id")
        if not account_id:
            return web.json_response({"error": "account_id required"}, status=400)
        account_id = int(account_id)
        worker = active_workers.get(account_id)
        if not worker:
            return web.json_response({"error": f"账号 {account_id} 未在引擎中运行，请先启用该账号并等待引擎加载"}, status=404)
        if not worker.is_running:
            return web.json_response({"error": f"账号 {account_id} 未就绪，请稍后重试"}, status=503)
        try:
            import pytdbot.types as _tdt_cc
            # 先多次 loadChats 确保缓存完整
            for _ in range(5):
                try:
                    load_result = await worker.client.invoke({
                        "@type": "loadChats",
                        "chat_list": {"@type": "chatListMain"},
                        "limit": 500,
                    })
                    if isinstance(load_result, _tdt_cc.Error):
                        break
                except Exception:
                    break
            # 获取所有对话 ID
            chats_result = await worker.client.invoke({
                "@type": "getChats",
                "chat_list": {"@type": "chatListMain"},
                "limit": 9999,
            })
            if chats_result is None or isinstance(chats_result, _tdt_cc.Error):
                return web.json_response({"error": "获取群组列表失败", "chats": []}, status=200)
            chat_ids = []
            if hasattr(chats_result, "chat_ids") and chats_result.chat_ids:
                chat_ids = chats_result.chat_ids
            elif isinstance(chats_result, dict):
                chat_ids = chats_result.get("chat_ids", [])
            # 逐个获取群组详情（只取群组和超级群组，跳过私聊和频道）
            chats = []
            for cid in chat_ids[:500]:  # 最多取 500 个
                try:
                    chat = await worker.client.invoke({
                        "@type": "getChat",
                        "chat_id": cid,
                    })
                    if chat is None or isinstance(chat, _tdt_cc.Error):
                        continue
                    # 解析 chat 对象
                    if isinstance(chat, dict):
                        chat_type = chat.get("type", {}).get("@type", "")
                        title = chat.get("title", "")
                        chat_id = chat.get("id", cid)
                    else:
                        chat_type_obj = getattr(chat, "type", None)
                        chat_type = getattr(chat_type_obj, "@type", "") if chat_type_obj else ""
                        if not chat_type and chat_type_obj:
                            chat_type = str(type(chat_type_obj).__name__)
                        title = getattr(chat, "title", "") or ""
                        chat_id = getattr(chat, "id", cid)
                    # 只保留群组和超级群组（跳过私聊 chatTypePrivate 和频道 isChannel=true）
                    is_group = False
                    is_channel = False
                    if "supergroup" in chat_type.lower() or "Supergroup" in chat_type:
                        # 检查是否是频道
                        if isinstance(chat, dict):
                            is_channel = chat.get("type", {}).get("is_channel", False)
                        else:
                            ct = getattr(chat, "type", None)
                            is_channel = getattr(ct, "is_channel", False) if ct else False
                        if not is_channel:
                            is_group = True
                    elif "basicgroup" in chat_type.lower() or "BasicGroup" in chat_type:
                        is_group = True
                    if not is_group:
                        continue
                    # 尝试获取 username
                    username = ""
                    if isinstance(chat, dict):
                        username = chat.get("username", "") or ""
                    else:
                        username = getattr(chat, "username", "") or ""
                    chats.append({
                        "chatId": str(chat_id),
                        "title": title,
                        "username": username,
                        "type": "supergroup" if "supergroup" in chat_type.lower() else "group",
                    })
                except Exception as e:
                    logger.debug(f"[get-account-chats] 获取 chat {cid} 失败: {e}")
                    continue
            return web.json_response({"success": True, "chats": chats, "total": len(chats)})
        except Exception as e:
            logger.warning(f"[get-account-chats] 账号 {account_id} 获取群组列表失败: {e}")
            return web.json_response({"error": str(e), "chats": []}, status=500)

    app = web.Application()

    async def handle_extract_group_links(request: web.Request):
        """从指定群组的历史消息中提取 t.me 群组链接"""
        secret = request.headers.get("X-Engine-Secret", "")
        if secret != ENGINE_SECRET:
            return web.json_response({"error": "unauthorized"}, status=401)
        try:
            body = await request.json()
        except Exception:
            body = {}
        account_id = body.get("account_id")
        group_url = body.get("group_url", "").strip()
        limit = int(body.get("limit", 500))  # 最多读取消息数，默认 500
        if not account_id:
            return web.json_response({"error": "account_id required"}, status=400)
        if not group_url:
            return web.json_response({"error": "group_url required"}, status=400)
        account_id = int(account_id)
        worker = active_workers.get(account_id)
        if not worker:
            return web.json_response({"error": f"账号 {account_id} 未在引擎中运行"}, status=404)
        if not worker.is_running:
            return web.json_response({"error": f"账号 {account_id} 未就绪，请稍后重试"}, status=503)
        try:
            import re as _re
            import asyncio as _asyncio

            # ── 1. 解析 chat_id ──────────────────────────────────────────────
            # 对私密群（t.me/+xxx 或 t.me/joinchat/xxx）：
            #   先用 checkChatInviteLink 获取 chat_id（不重复加入），
            #   若账号未加入则再用 joinChatByInviteLink 加入后获取 id。
            # 对公开群（@username）：用 searchPublicChat。
            is_invite = ("t.me/+" in group_url or "t.me/joinchat" in group_url)
            chat_id = None

            if is_invite:
                # 优先 checkChatInviteLink（已加入的群可直接拿到 chat_id）
                try:
                    check_result = await worker.client.invoke({
                        "@type": "checkChatInviteLink",
                        "invite_link": group_url,
                    })
                    if check_result:
                        cid = None
                        if hasattr(check_result, "chat_id"):
                            cid = check_result.chat_id
                        elif isinstance(check_result, dict):
                            cid = check_result.get("chat_id")
                        if cid:
                            chat_id = int(cid)
                            logger.info(f"[extract-group-links] checkChatInviteLink -> chat_id={chat_id}")
                except Exception as e_check:
                    logger.info(f"[extract-group-links] checkChatInviteLink 失败: {e_check}")

                # 若还没拿到，尝试 joinChatByInviteLink（未加入时加入并返回 Chat 对象）
                if not chat_id:
                    try:
                        join_result = await worker.client.invoke({
                            "@type": "joinChatByInviteLink",
                            "invite_link": group_url,
                        })
                        if join_result:
                            cid = None
                            if hasattr(join_result, "id"):
                                cid = join_result.id
                            elif isinstance(join_result, dict):
                                cid = join_result.get("id") or join_result.get("chatId")
                            if cid:
                                chat_id = int(cid)
                                logger.info(f"[extract-group-links] joinChatByInviteLink -> chat_id={chat_id}")
                    except Exception as e_join:
                        logger.info(f"[extract-group-links] joinChatByInviteLink 失败: {e_join}")
            else:
                # 公开群
                username = group_url.lstrip("@").split("/")[-1]
                try:
                    pub_result = await worker.client.invoke({
                        "@type": "searchPublicChat",
                        "username": username,
                    })
                    if pub_result:
                        cid = getattr(pub_result, "id", None) if hasattr(pub_result, "id") else (pub_result.get("id") if isinstance(pub_result, dict) else None)
                        if cid:
                            chat_id = int(cid)
                except Exception as e_pub:
                    logger.warning(f"[extract-group-links] searchPublicChat 失败: {e_pub}")

            # 兜底：原 resolve_chat_id
            if not chat_id:
                chat_id = await worker.resolve_chat_id(group_url)

            if not chat_id:
                return web.json_response({"error": f"无法解析群组: {group_url}，请确认账号已加入该群"}, status=400)

            logger.info(f"[extract-group-links] 开始扫描群组 chat_id={chat_id}, limit={limit}")

            # ── 2. 开启群组并预热 TDLib 历史消息缓存 ───────────────────────────
            # TDLib 对未打开过的群组不会自动同步历史消息，
            # 必须先 openChat 触发同步，等待一段时间再读取。
            try:
                await worker.client.invoke({"@type": "openChat", "chat_id": chat_id})
                logger.info(f"[extract-group-links] openChat 成功，等待 TDLib 加载历史...")
            except Exception as e_open:
                logger.info(f"[extract-group-links] openChat 失败（可忽略）: {e_open}")

            # 预热：先触发一次 getChatHistory，让 TDLib 开始异步拉取历史
            await _asyncio.sleep(1)
            _warmup = await worker.client.invoke({
                "@type": "getChatHistory",
                "chat_id": chat_id,
                "from_message_id": 0,
                "offset": 0,
                "limit": 10,
                "only_local": False,
            })
            _warmup_msgs = []
            if _warmup:
                if hasattr(_warmup, "messages"):
                    _warmup_msgs = _warmup.messages or []
                elif isinstance(_warmup, dict):
                    _warmup_msgs = _warmup.get("messages") or []
            logger.info(f"[extract-group-links] 预热获取 {len(_warmup_msgs)} 条消息")

            # ── 3. 分页读取历史消息 ──────────────────────────────────────────
            # TDLib getChatHistory 正确分页方式：
            #   第一次 from_message_id=0, offset=0 → 返回最新 N 条
            #   后续用上一批最旧的消息 id 作为 from_message_id, offset=0
            #   直到返回空列表为止
            TG_LINK_RE = _re.compile(
                r"(?:https?://)?t\.me/(?:joinchat/|\+)?([A-Za-z0-9_\-]{5,})",
                _re.IGNORECASE
            )
            found_links = {}  # url -> {url, slug}
            from_msg_id = 0
            fetched = 0
            batch_size = 100
            empty_count = 0

            def _extract_text_from_msg(msg):
                """从消息对象提取文本内容"""
                text = ""
                content = getattr(msg, "content", None) if hasattr(msg, "content") else (msg.get("content") if isinstance(msg, dict) else None)
                if content is not None:
                    if hasattr(content, "text"):
                        text_obj = content.text
                        if hasattr(text_obj, "text"):
                            text = text_obj.text or ""
                        elif isinstance(text_obj, str):
                            text = text_obj
                    elif isinstance(content, dict):
                        text_obj = content.get("text", {})
                        if isinstance(text_obj, dict):
                            text = text_obj.get("text", "")
                        elif isinstance(text_obj, str):
                            text = text_obj
                    if not text:
                        if hasattr(content, "caption"):
                            cap = content.caption
                            if hasattr(cap, "text"):
                                text = cap.text or ""
                            elif isinstance(cap, str):
                                text = cap
                        elif isinstance(content, dict):
                            cap = content.get("caption", {})
                            if isinstance(cap, dict):
                                text = cap.get("text", "")
                            elif isinstance(cap, str):
                                text = cap
                return text

            def _extract_btn_urls(msg):
                """从消息的 reply_markup 按钮中提取 t.me URL"""
                urls = []
                reply_markup = getattr(msg, "reply_markup", None) if hasattr(msg, "reply_markup") else (msg.get("reply_markup") if isinstance(msg, dict) else None)
                if reply_markup:
                    rows = getattr(reply_markup, "rows", None) if hasattr(reply_markup, "rows") else (reply_markup.get("rows") if isinstance(reply_markup, dict) else None)
                    if rows:
                        for row in rows:
                            btns = row if isinstance(row, list) else (getattr(row, "buttons", []) or [])
                            for btn in btns:
                                btn_url = getattr(btn, "url", None) if hasattr(btn, "url") else (btn.get("url") if isinstance(btn, dict) else None)
                                if btn_url and "t.me" in str(btn_url):
                                    urls.append(btn_url)
                return urls

            def _process_messages(messages):
                """处理消息列表，提取链接并返回最旧消息 id"""
                oldest = None
                for msg in messages:
                    texts = [_extract_text_from_msg(msg)] + _extract_btn_urls(msg)

                    # ── 额外解析 entities 中的 textUrl 隐藏链接 ──────────────
                    # 消息里蓝色文字（如「中文搜索」「搜黄-只搜黄的」）背后的真实 URL
                    # 存储在 content.text.entities 数组中，类型为 textEntityTypeTextUrl
                    content = getattr(msg, "content", None) if hasattr(msg, "content") else (msg.get("content") if isinstance(msg, dict) else None)
                    if content is not None:
                        # 获取 text 对象（FormattedText）
                        text_obj = None
                        if hasattr(content, "text"):
                            text_obj = content.text
                        elif isinstance(content, dict):
                            text_obj = content.get("text")
                        # 也检查 caption（图片/视频消息）
                        if text_obj is None:
                            if hasattr(content, "caption"):
                                text_obj = content.caption
                            elif isinstance(content, dict):
                                text_obj = content.get("caption")
                        # 从 FormattedText 的 entities 中提取 textUrl
                        if text_obj is not None:
                            entities = None
                            if hasattr(text_obj, "entities"):
                                entities = text_obj.entities
                            elif isinstance(text_obj, dict):
                                entities = text_obj.get("entities")
                            if entities:
                                for entity in entities:
                                    # entity 可能是对象或字典
                                    etype = None
                                    eurl = None
                                    if hasattr(entity, "type"):
                                        etype_obj = entity.type
                                        # pytdbot 对象：entity.type 是 TextEntityTypeTextUrl 对象
                                        etype = getattr(etype_obj, "ID", None) or type(etype_obj).__name__
                                        eurl = getattr(etype_obj, "url", None)
                                    elif isinstance(entity, dict):
                                        etype_obj = entity.get("type", {})
                                        if isinstance(etype_obj, dict):
                                            etype = etype_obj.get("@type", "")
                                            eurl = etype_obj.get("url", "")
                                    # 判断是否为 textUrl 类型
                                    is_text_url = etype and (
                                        "TextUrl" in str(etype) or
                                        "textEntityTypeTextUrl" in str(etype).lower()
                                    )
                                    if is_text_url and eurl and "t.me" in str(eurl):
                                        texts.append(str(eurl))

                    for search_text in texts:
                        if not search_text:
                            continue
                        for m in TG_LINK_RE.finditer(search_text):
                            raw = m.group(0)
                            slug = m.group(1)
                            if "t.me/+" in raw or "t.me/joinchat" in raw.lower():
                                normalized = f"https://t.me/+{slug}" if "t.me/+" in raw else f"https://t.me/joinchat/{slug}"
                            else:
                                normalized = f"https://t.me/{slug}"
                            if normalized not in found_links:
                                found_links[normalized] = {"url": normalized, "slug": slug}
                    msg_id = getattr(msg, "id", None) if hasattr(msg, "id") else (msg.get("id") if isinstance(msg, dict) else None)
                    if msg_id is not None:
                        if oldest is None or int(msg_id) < oldest:
                            oldest = int(msg_id)
                return oldest

            async def _get_history(from_id, n):
                """调用 getChatHistory，返回消息列表"""
                try:
                    r = await worker.client.invoke({
                        "@type": "getChatHistory",
                        "chat_id": chat_id,
                        "from_message_id": from_id,
                        "offset": 0,
                        "limit": n,
                        "only_local": False,
                    })
                    if r is None:
                        return []
                    if hasattr(r, "messages"):
                        return r.messages or []
                    elif isinstance(r, dict):
                        return r.get("messages") or []
                    return []
                except Exception as e_h:
                    logger.warning(f"[extract-group-links] getChatHistory 失败: {e_h}")
                    return []

            # ── 核心分页循环 ──────────────────────────────────────────────────
            # TDLib 历史消息是异步后台拉取的，每次调用 getChatHistory 后
            # TDLib 会异步从服务器拉取更多历史。策略：
            # 1. 每批正常获取后等待 1s
            # 2. 消息不足时，最多重试 12 次（每次等待 4s，总计最多等待 48s）
            # 3. 连续空消息超过 5 次才认为已到最早
            MAX_EMPTY_RETRIES = 12   # 空消息最大重试次数
            EMPTY_WAIT = 4.0         # 每次空消息等待秒数
            SHORT_WAIT = 1.0         # 正常批次间隔
            LESS_WAIT = 3.0          # 消息不足时等待

            while fetched < limit:
                batch = min(batch_size, limit - fetched)
                messages = await _get_history(from_msg_id, batch)
                logger.info(f"[extract-group-links] 批次获取: {len(messages)} 条 (from_id={from_msg_id}, fetched={fetched})")

                if not messages:
                    empty_count += 1
                    if empty_count >= MAX_EMPTY_RETRIES:
                        logger.info(f"[extract-group-links] 连续 {empty_count} 次空消息，确认已到最早，共 {fetched} 条")
                        break
                    logger.info(f"[extract-group-links] 空消息，等待 {EMPTY_WAIT}s 后重试 ({empty_count}/{MAX_EMPTY_RETRIES})")
                    await _asyncio.sleep(EMPTY_WAIT)
                    continue

                empty_count = 0
                oldest_msg_id = _process_messages(messages)
                fetched += len(messages)

                if oldest_msg_id is not None:
                    from_msg_id = oldest_msg_id
                else:
                    break

                if len(messages) < batch:
                    # 本批消息不足，说明 TDLib 尚未加载完毕，等待后重试
                    logger.info(f"[extract-group-links] 消息不足 ({len(messages)}<{batch})，等待 {LESS_WAIT}s 再继续")
                    await _asyncio.sleep(LESS_WAIT)
                    # 不退出循环，继续尝试下一批（empty_count 会在下次返回空时计数）
                    continue

                # 正常批次，短暂延迟避免限流
                await _asyncio.sleep(SHORT_WAIT)
            links = list(found_links.values())
            logger.info(f"[extract-group-links] 群组 {group_url} 读取 {fetched} 条消息，提取 {len(links)} 个链接")
            return web.json_response({"success": True, "total": len(links), "links": links, "scanned": fetched})
        except Exception as e:
            logger.warning(f"[extract-group-links] 失败: {e}")
            return web.json_response({"error": str(e)}, status=500)

    # ── 一键加群接口 ──────────────────────────────────────────────────────────────
    async def handle_batch_join_groups(request: web.Request):
        """批量让指定账号加入公共群组池中所有未加入的群组"""
        secret = request.headers.get("X-Engine-Secret", "")
        if secret != ENGINE_SECRET:
            return web.json_response({"error": "unauthorized"}, status=401)
        try:
            body = await request.json()
        except Exception:
            body = {}
        account_ids = body.get("account_ids", [])  # 要执行加群的账号 ID 列表
        group_ids = body.get("group_ids", [])       # 要加入的群组 groupId 列表（为空则加全部）
        interval_min = int(body.get("interval_min", join_config.get("joinIntervalMin", 30)))
        interval_max = int(body.get("interval_max", join_config.get("joinIntervalMax", 60)))

        results = []  # [{account_id, group_id, status, real_id, error}]

        # 确定要操作的账号
        target_workers = []
        if account_ids:
            for aid in account_ids:
                w = active_workers.get(int(aid))
                if w and w.is_running and w.client:
                    target_workers.append((int(aid), w))
        else:
            for aid, w in active_workers.items():
                if w.is_running and w.client:
                    target_workers.append((aid, w))

        if not target_workers:
            return web.json_response({"error": "没有可用的活跃账号"}, status=400)

        # 确定要加入的群组
        target_groups = public_groups if public_groups else []
        if group_ids:
            target_groups = [pg for pg in target_groups if str(pg.get("groupId", "")) in [str(g) for g in group_ids]]
        target_groups = [pg for pg in target_groups if pg.get("isActive", True)]

        if not target_groups:
            return web.json_response({"error": "没有需要加入的群组"}, status=400)

        logger.info(f"[batch-join] 开始批量加群：{len(target_workers)} 个账号，{len(target_groups)} 个群组")

        import pytdbot.types as _tdt_bj
        for account_id, worker in target_workers:
            # 获取该账号已加入的群组 chat_id 集合（用于精确判断该账号是否已是成员）
            joined_chat_ids: set = set()
            try:
                for _ in range(3):
                    try:
                        await worker.client.invoke({"@type": "loadChats", "chat_list": {"@type": "chatListMain"}, "limit": 500})
                    except Exception:
                        break
                chats_r = await worker.client.invoke({"@type": "getChats", "chat_list": {"@type": "chatListMain"}, "limit": 9999})
                if chats_r and not isinstance(chats_r, _tdt_bj.Error):
                    cids = getattr(chats_r, "chat_ids", None) or (chats_r.get("chat_ids", []) if isinstance(chats_r, dict) else [])
                    joined_chat_ids = set(int(c) for c in (cids or []))
                logger.info(f"[batch-join] 账号 {account_id} 已加入 {len(joined_chat_ids)} 个群组")
            except Exception as e:
                logger.warning(f"[batch-join] 账号 {account_id} 获取已加入群列表失败: {e}")

            for pg in target_groups:
                group_id = str(pg.get("groupId", "")).strip()
                pg_id = pg.get("id")
                if not group_id:
                    continue

                # 判断该账号是否已加入：匹配账号已加入的群组列表
                _skip = False
                # 情况一：groupId 本身是负数 chat_id
                if group_id.lstrip("-").isdigit():
                    if int(group_id) in joined_chat_ids:
                        _skip = True
                else:
                    # 情况二：groupId 是 username/@xxx/+xxx
                    # 先查缓存，缓存没有则实时解析（解决引擎重启后缓存清空导致去重失效的问题）
                    real_id_cached = public_group_real_ids.get(group_id)
                    if not real_id_cached and joined_chat_ids:
                        # 缓存为空，尝试通过 searchPublicChat 解析真实 chat_id
                        try:
                            username = group_id.lstrip("@")
                            _r = await worker.client.invoke({"@type": "searchPublicChat", "username": username})
                            if _r and not isinstance(_r, _tdt_bj.Error):
                                def _get_id(obj):
                                    if hasattr(obj, 'id'): return getattr(obj, 'id')
                                    elif isinstance(obj, dict): return obj.get('id')
                                    return None
                                _rid = _get_id(_r)
                                if _rid:
                                    public_group_real_ids[group_id] = int(_rid)
                                    real_id_cached = int(_rid)
                        except Exception:
                            pass
                    if real_id_cached and int(real_id_cached) in joined_chat_ids:
                        _skip = True
                if _skip:
                    results.append({"account_id": account_id, "group_id": group_id, "status": "skipped", "reason": "already_member"})
                    # 已是成员，也上报 subscribed 状态，确保数据库记录完整
                    if pg_id:
                        try:
                            _real_id_for_report = public_group_real_ids.get(group_id)
                            await api.post("/engine/public-group/join-status", {
                                "publicGroupId": pg_id, "monitorAccountId": account_id,
                                "status": "subscribed",
                                "realId": str(_real_id_for_report) if _real_id_for_report else None,
                            })
                        except Exception:
                            pass
                    continue

                # 执行加群
                try:
                    real_id = await worker.join_chat(group_id)
                    if real_id:
                        public_group_real_ids[group_id] = int(real_id)
                        results.append({"account_id": account_id, "group_id": group_id, "status": "joined", "real_id": real_id})
                        logger.info(f"[batch-join] 账号 {account_id} 成功加入群组 {group_id} -> {real_id}")
                        if pg_id:
                            try:
                                await api.post("/engine/public-group/join-status", {
                                    "publicGroupId": pg_id, "monitorAccountId": account_id,
                                    "status": "subscribed", "realId": str(real_id),
                                })
                            except Exception:
                                pass
                    else:
                        results.append({"account_id": account_id, "group_id": group_id, "status": "failed", "reason": "join_returned_none"})
                        logger.warning(f"[batch-join] 账号 {account_id} 加入群组 {group_id} 失败（返回 None）")
                except Exception as e:
                    err_msg = str(e)
                    results.append({"account_id": account_id, "group_id": group_id, "status": "failed", "reason": err_msg})
                    logger.warning(f"[batch-join] 账号 {account_id} 加入群组 {group_id} 异常: {e}")

                # 防封间隔
                import random as _random
                delay = _random.uniform(interval_min, interval_max)
                await asyncio.sleep(delay)

        joined = sum(1 for r in results if r["status"] == "joined")
        failed = sum(1 for r in results if r["status"] == "failed")
        skipped = sum(1 for r in results if r["status"] == "skipped")
        logger.info(f"[batch-join] 完成：加入 {joined}，失败 {failed}，跳过 {skipped}")
        return web.json_response({
            "success": True,
            "joined": joined,
            "failed": failed,
            "skipped": skipped,
            "results": results,
        })

    async def _do_scan_joined_groups(account_ids_filter):
        """后台执行扫描任务"""
        # 获取所有公共监控群组（含 realId 缓存）
        try:
            config_resp = await api.get("/engine/config")
            all_public_groups = config_resp.get("publicGroups", []) if isinstance(config_resp, dict) else []
            all_accounts_raw = config_resp.get("accounts", []) if isinstance(config_resp, dict) else []
        except Exception as e:
            logger.error(f"[scan-joined] 获取配置失败: {e}")
            return

    async def handle_scan_joined_groups(request: web.Request):
        """扫描各账号已加入的群组，将已是成员的群组状态写入数据库（补录历史数据）"""
        secret = request.headers.get("X-Engine-Secret", "")
        if secret != ENGINE_SECRET:
            return web.json_response({"error": "unauthorized"}, status=401)
        try:
            body = await request.json()
        except Exception:
            body = {}
        account_ids_filter = body.get("account_ids", [])
        # 立即返回，后台执行扫描
        asyncio.ensure_future(_do_scan_joined_groups_full(account_ids_filter))
        return web.json_response({"success": True, "message": "扫描已开始，请稍后刷新查看结果", "scanned_accounts": len(active_workers), "total_recorded": 0, "details": []})

    async def _do_scan_joined_groups_full(account_ids_filter):
        """后台完整扫描任务"""
        # 获取所有公共监控群组（含 realId 缓存）
        try:
            config_resp = await api.get("/engine/config")
            all_public_groups = config_resp.get("publicGroups", []) if isinstance(config_resp, dict) else []
            all_accounts_raw = config_resp.get("accounts", []) if isinstance(config_resp, dict) else []
        except Exception as e:
            logger.error(f"[scan-joined] 获取配置失败: {e}")
            return
        # 筛选目标账号
        target_account_ids = set(account_ids_filter) if account_ids_filter else None
        details = []
        total_recorded = 0
        import pytdbot.types as _tdt_scan
        for account_id, worker in list(active_workers.items()):
            if target_account_ids and account_id not in target_account_ids:
                continue
            recorded = 0
            try:
                # 获取该账号已加入的所有群组 chat_id 集合
                joined_chat_ids: set = set()
                for _ in range(3):
                    try:
                        await worker.client.invoke({"@type": "loadChats", "chat_list": {"@type": "chatListMain"}, "limit": 500})
                    except Exception:
                        break
                chats_r = await worker.client.invoke({"@type": "getChats", "chat_list": {"@type": "chatListMain"}, "limit": 9999})
                if chats_r and not isinstance(chats_r, _tdt_scan.Error):
                    cids = getattr(chats_r, "chat_ids", None) or (chats_r.get("chat_ids", []) if isinstance(chats_r, dict) else [])
                    joined_chat_ids = set(int(c) for c in (cids or []))
                logger.info(f"[scan-joined] 账号 {account_id} 已加入 {len(joined_chat_ids)} 个群组")
                # 对每个公共群组判断该账号是否已加入
                for pg in all_public_groups:
                    pg_id = pg.get("id")
                    group_id = str(pg.get("groupId", "")).strip()
                    real_id_cached = pg.get("realId")
                    if not group_id or not pg_id:
                        continue
                    is_member = False
                    if group_id.lstrip("-").isdigit():
                        is_member = int(group_id) in joined_chat_ids
                    elif real_id_cached:
                        try:
                            is_member = int(real_id_cached) in joined_chat_ids
                        except Exception:
                            pass
                    else:
                        # 尝试实时解析 username
                        try:
                            username = group_id.lstrip("@")
                            _r = await worker.client.invoke({"@type": "searchPublicChat", "username": username})
                            if _r and not isinstance(_r, _tdt_scan.Error):
                                _rid = getattr(_r, "id", None) or (_r.get("id") if isinstance(_r, dict) else None)
                                if _rid:
                                    real_id_cached = int(_rid)
                                    is_member = int(_rid) in joined_chat_ids
                        except Exception:
                            pass
                    if is_member:
                        try:
                            await api.post("/engine/public-group/join-status", {
                                "publicGroupId": pg_id,
                                "monitorAccountId": account_id,
                                "status": "subscribed",
                                "realId": str(real_id_cached) if real_id_cached else None,
                            })
                            recorded += 1
                        except Exception as e2:
                            logger.warning(f"[scan-joined] 写入状态失败 pg={pg_id} acc={account_id}: {e2}")
            except Exception as e:
                logger.error(f"[scan-joined] 账号 {account_id} 扫描失败: {e}")
                details.append({"account_id": account_id, "recorded": recorded, "error": str(e)})
                continue
            total_recorded += recorded
            details.append({"account_id": account_id, "recorded": recorded})
            logger.info(f"[scan-joined] 账号 {account_id} 共补录 {recorded} 条状态")
        logger.info(f"[scan-joined] 扫描完成，共扫描 {len(details)} 个账号，补录 {total_recorded} 条状态")
    async def handle_trigger_dm(request: web.Request):
        secret = request.headers.get("X-Engine-Secret", "")
        if secret != ENGINE_SECRET:
            return web.json_response({"error": "unauthorized"}, status=401)
        dm_trigger_event.set()
        return web.json_response({"success": True, "message": "已触发 DM 发送"})
    app.router.add_post("/trigger-dm", handle_trigger_dm)
    app.router.add_post("/force-sync", handle_force_sync)
    app.router.add_post("/sync-account", handle_sync_account)
    app.router.add_post("/get-account-chats", handle_get_account_chats)
    app.router.add_post("/extract-group-links", handle_extract_group_links)
    app.router.add_post("/batch-join-groups", handle_batch_join_groups)
    app.router.add_post("/scan-joined-groups", handle_scan_joined_groups)
    app.router.add_get("/status", handle_status)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", 8765)
    await site.start()
    logger.info("[HTTP] 引擎 HTTP 服务器已启动在端口 8765")
    # 保持运行
    while True:
        await asyncio.sleep(3600)


async def main():
    global force_sync_event
    logger.info("=" * 60)
    logger.info("TG Monitor Pro - TDLib 监控引擎启动")
    logger.info(f"API Base: {API_BASE}")
    logger.info(f"TG API ID: {TG_API_ID}")
    logger.info(f"TDLib 数据目录: {TDLIB_DATA_DIR}")
    logger.info("=" * 60)
    os.makedirs(TDLIB_DATA_DIR, exist_ok=True)
    force_sync_event = asyncio.Event()
    if not TG_API_ID or not TG_API_HASH:
        logger.warning("TG_API_ID 或 TG_API_HASH 未配置，引擎将每60秒重试检查")
        while True:
            await asyncio.sleep(60)
            new_api_id = int(os.getenv("TG_API_ID", "0"))
            new_api_hash = os.getenv("TG_API_HASH", "")
            if new_api_id and new_api_hash:
                logger.info("检测到 TG API 凭证已配置，重启引擎...")
                import sys
                os.execv(sys.executable, [sys.executable] + sys.argv)
            logger.info("等待 TG_API_ID 和 TG_API_HASH 配置...")
        return
    await asyncio.gather(sync_config(), process_dm_queue(), heartbeat(), http_server(), scrape_groups_task())


if __name__ == "__main__":
    asyncio.run(main())
