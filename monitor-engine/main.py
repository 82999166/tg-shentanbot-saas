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

API_BASE = os.getenv("WEB_API_BASE", "http://localhost:3000/api")
ENGINE_SECRET = os.getenv("ENGINE_SECRET", "tg-monitor-engine-secret")
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "30"))
DM_WORKER_INTERVAL = int(os.getenv("DM_WORKER_INTERVAL", "10"))
TG_API_ID = int(os.getenv("TG_API_ID", "0"))
TG_API_HASH = os.getenv("TG_API_HASH", "")
BOT_TOKEN = os.getenv("BOT_TOKEN", "")
TDLIB_DATA_DIR = os.getenv("TDLIB_DATA_DIR", os.path.join(_BASE_DIR, "tdlib_data"))

active_workers: dict = {}
monitor_config: dict = {}
public_groups: list = []
force_sync_event: asyncio.Event = None  # 将在 main() 中初始化
global_client_manager = None  # 全局 ClientManager，统一管理所有账号的 TDLib 客户端
public_group_real_ids: dict = {}
join_config: dict = {
    "joinIntervalMin": 30,
    "joinIntervalMax": 60,
    "maxGroupsPerAccount": 100,
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
    "globalMaxMsgLen": 500,   # 全局消息字数上限（0=不限制）
    "globalRateWindow": 60,   # 防刷屏：时间窗口（秒，0=不限制）
    "globalRateLimit": 5,     # 防刷屏：窗口内最大消息数（0=不限制）
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


def match_keyword(text: str, keyword: dict) -> bool:
    if not text:
        return False
    match_type = keyword.get("matchType", "contains")
    pattern = keyword.get("pattern", "")
    sub_keywords = keyword.get("subKeywords", [])
    case_sensitive = keyword.get("caseSensitive", False)
    compare_text = text if case_sensitive else text.lower()
    compare_pattern = pattern if case_sensitive else pattern.lower()
    if match_type in ("exact", "contains"):
        return compare_pattern in compare_text
    elif match_type == "regex":
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
    return False


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
    message_id: Optional[int] = None,
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
        text = (
            f"用户：{user_display}\n"
            f"来源：{source_display}\n"
            f"内容：{highlighted_text}\n"
            f"时间：{now_str}"
        )
        rid = str(hit_record_id) if hit_record_id else "0"
        # 私聊按钮：有 username 用 t.me 链接，无 username 用 callback_data 方式
        # 注意：Telegram Bot API InlineKeyboardButton url 不支持 tg:// 协议
        # 私聊按钮：有 username 用 t.me 链接，无 username 用 tg://openmessage 直接拉起对话
        # InlineKeyboardButton.url 支持 tg:// 协议，点击后客户端直接打开私信窗口，无需中间消息
        if sender_username:
            chat_btn = {"text": "私聊", "url": f"https://t.me/{sender_username}"}
        else:
            chat_btn = {"text": "私聊", "url": f"tg://openmessage?user_id={sender_tg_id}"}
        inline_keyboard = [
            [
                {"text": "历史", "callback_data": f"history:{rid}:{sender_tg_id}"},
                {"text": "屏蔽", "callback_data": f"block:{rid}:{sender_tg_id}"},
                {"text": "处理", "callback_data": f"done:{rid}:{sender_tg_id}"},
            ],
            [
                {"text": "删除", "callback_data": f"delete:{rid}:{sender_tg_id}"},
                chat_btn,
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
                else:
                    logger.info(f"[BotNotify] 推送成功, resp_keys={list(__import__("json").loads(resp).get("result",{}).keys()) if r.status==200 else []}")
    except Exception as e:
        logger.warning(f"[BotNotify] 推送异常: {e}")


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
            # 优先使用用户自定义的 globalAntiSpam，否则使用全局配置
            u_anti_spam = uconfig.get("globalAntiSpam") or global_anti_spam
            is_spam, _ = check_anti_spam(sender_tg_id, text, u_anti_spam)
            if is_spam:
                continue
            global_kws = uconfig.get("globalKeywords", [])
            if not global_kws:
                for g in uconfig.get("groups", []):
                    if g.get("isActive"):
                        global_kws.extend([k for k in g.get("keywords", []) if k.get("isActive")])
            u_matched_keywords = [kw for kw in global_kws if kw.get("isActive", True) and match_keyword(text, kw)]
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

    # ── 推送去重：botChatId 和 collabChatId 相同时只推一次 ────────────────────
    # 优先使用 collabChatId（带完整按钮），如果两者不同则都推
    already_pushed_to: set = set()

    if collab_chat_id_str and BOT_TOKEN:
        # 使用 Bot API 推送到协作群（带完整按钮）
        try:
            await send_bot_notification(
                bot_chat_id=str(collab_chat_id_str),
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
            )
            already_pushed_to.add(str(collab_chat_id_str))
        except Exception as e:
            logger.warning(f"[CollabPush] 协作群推送失败: {e}")

    if bot_chat_id and str(bot_chat_id) not in already_pushed_to:
        # botChatId 与 collabChatId 不同时才额外推送，避免重复
        await send_bot_notification(
            bot_chat_id=str(bot_chat_id), sender_username=sender_username,
            sender_tg_id=sender_tg_id, matched_keyword=matched_keywords[0]["pattern"],
            group_name=chat_title, group_username=chat_username, message_text=text,
            sender_name=sender_name, hit_record_id=hit_record_id,
            dm_status="queued" if dm_will_send else "disabled",
            chat_id=str(chat_id),
                message_id=message_id,
        )

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
            is_outgoing = getattr(message, "is_outgoing", False)
            if is_outgoing:
                return
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
        if not self.client or not self.is_running:
            return False
        try:
            import pytdbot.types as _tdt
            # TDLib 发送私信前必须先通过 createPrivateChat 确保对话已建立
            # 否则会报 Chat not found (400)
            chat_result = await self.client.invoke({
                "@type": "createPrivateChat",
                "user_id": chat_id,
                "force": True
            })
            if isinstance(chat_result, _tdt.Error):
                logger.warning(f"[Account {self.account_id}] 创建私聊失败: code={chat_result.code} msg={chat_result.message}")
                return False
            # 使用返回的真实 chat_id（可能与 user_id 不同）
            real_chat_id = getattr(chat_result, 'id', chat_id)
            result = await self.client.invoke({
                "@type": "sendMessage", "chat_id": real_chat_id,
                "input_message_content": {
                    "@type": "inputMessageText",
                    "text": {"@type": "formattedText", "text": text}
                }
            })
            # 检查返回值是否为错误（pytdbot.invoke 失败时返回 Error 对象而非抛异常）
            if isinstance(result, _tdt.Error):
                logger.warning(f"[Account {self.account_id}] 发送消息失败: code={result.code} msg={result.message}")
                return False
            return True
        except Exception as e:
            logger.warning(f"[Account {self.account_id}] 发送消息异常: {e}")
            return False

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


async def join_public_groups(worker: AccountWorker, account_id: int):
    """让账号加入所有公共群组，支持速度控制和每账号条数限制"""
    global public_group_real_ids, join_config
    if not public_groups:
        return

    # 读取加群配置
    enabled = join_config.get("joinEnabled", True)
    if not enabled:
        logger.info(f"[Account {account_id}] 自动加群已禁用，跳过")
        return

    interval_min = max(5, int(join_config.get("joinIntervalMin", 30)))
    interval_max = max(interval_min, int(join_config.get("joinIntervalMax", 60)))
    max_groups = int(join_config.get("maxGroupsPerAccount", 100))

    # 只处理活跃的群组，并限制每账号条数
    active_groups = [pg for pg in public_groups if pg.get("isActive", True)]
    groups_to_join = active_groups[:max_groups]

    logger.info(f"[Account {account_id}] 开始加群：共 {len(groups_to_join)} 个群组，间隔 {interval_min}-{interval_max}s，上限 {max_groups}")

    joined_count = 0
    for pg in groups_to_join:
        pg_id = pg.get("id")
        group_id = pg.get("groupId", "")
        if not group_id:
            continue
        try:
            real_id = await worker.join_chat(group_id)
            if real_id:
                public_group_real_ids[group_id] = real_id
                joined_count += 1
                logger.info(f"[Account {account_id}] 已加入群组 {group_id} -> 真实ID: {real_id} ({joined_count}/{len(groups_to_join)})")
                if pg_id:
                    await api.post("/engine/public-group/join-status", {
                        "publicGroupId": pg_id, "monitorAccountId": account_id, "status": "joined",
                        "realId": str(real_id),  # 回写真实 ID 到数据库，下次重启可预加载
                    })
            else:
                logger.warning(f"[Account {account_id}] 加入群组失败: {group_id}")
                if pg_id:
                    await api.post("/engine/public-group/join-status", {
                        "publicGroupId": pg_id, "monitorAccountId": account_id,
                        "status": "failed", "errorMsg": "join_failed",
                    })
        except Exception as e:
            logger.warning(f"[Account {account_id}] 处理群组 {group_id} 异常: {e}")
            if pg_id:
                try:
                    await api.post("/engine/public-group/join-status", {
                        "publicGroupId": pg_id, "monitorAccountId": account_id,
                        "status": "failed", "errorMsg": str(e)[:200],
                    })
                except Exception:
                    pass

        # 随机间隔防封号
        delay = random.uniform(interval_min, interval_max)
        await asyncio.sleep(delay)

    logger.info(
        f"[Account {account_id}] ===== 加群全部完成 =====\n"
        f"  成功: {joined_count}/{len(groups_to_join)} 个群组\n"
        f"  当前 real_ids 映射数: {len(public_group_real_ids)}\n"
        f"  监控已全面生效，不会漏报任何群组的消息"
    )


async def process_dm_queue():
    while True:
        try:
            queue = await api.get("/engine/dm-queue?limit=5")
            if not queue:
                await asyncio.sleep(DM_WORKER_INTERVAL)
                continue
            items = queue if isinstance(queue, list) else queue.get("items", [])
            for item in items[:5]:
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
                    target_id = int(target_tg_id) if target_tg_id.lstrip("-").isdigit() else None
                    if target_id:
                        success = await worker.send_message(target_id, content)
                    else:
                        resolved_id = await worker.resolve_chat_id(f"@{target_username}" if target_username else target_tg_id)
                        success = await worker.send_message(resolved_id, content) if resolved_id else False
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
        await asyncio.sleep(DM_WORKER_INTERVAL)


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
            if public_groups_changed and public_groups:
                logger.info("[Config] 公共群组列表已更新，所有账号重新加入...")
                # 构建 account_id -> role 映射
                account_role_map = {a["id"]: a.get("role", "monitor") for a in accounts}
                for aid, worker in active_workers.items():
                    if account_role_map.get(aid) != "sender":
                        asyncio.create_task(join_public_groups(worker, aid))
                    else:
                        logger.info(f"[Account {aid}] 发信账号，跳过群组更新加群")
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
        return web.json_response({
            "activeAccounts": len(active_workers),
            "publicGroups": len(public_groups),
            "monitorUsers": len(monitor_config),
        })
    app = web.Application()
    app.router.add_post("/force-sync", handle_force_sync)
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
    await asyncio.gather(sync_config(), process_dm_queue(), heartbeat(), http_server())


if __name__ == "__main__":
    asyncio.run(main())
