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
public_group_real_ids: dict = {}
sent_dm_cache: dict = {}
collab_chat_id_cache: dict = {}
processed_messages: dict = {}
PROCESSED_MSG_TTL = 300
daily_hit_cache: dict = {}
rate_hit_cache: dict = {}


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
    dm_status: str = "disabled",
):
    if not BOT_TOKEN:
        return
    try:
        if sender_name:
            user_display = sender_name
        elif sender_username:
            user_display = f"@{sender_username}"
        else:
            user_display = f"ID:{sender_tg_id}"
        if group_username:
            source_display = f'<a href="https://t.me/{group_username}">{group_name}</a>'
        else:
            source_display = group_name
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
        inline_keyboard = [
            [
                {"text": "历史", "callback_data": f"history:{rid}:{sender_tg_id}"},
                {"text": "屏蔽", "callback_data": f"block:{rid}:{sender_tg_id}"},
                {"text": "处理", "callback_data": f"done:{rid}:{sender_tg_id}"},
            ],
            [
                {"text": "删除", "callback_data": f"delete:{rid}:{sender_tg_id}"},
                {"text": "私聊", "url": f"https://t.me/{sender_username}" if sender_username else f"https://t.me/+{sender_tg_id}"},
            ]
        ]
        payload = {
            "chat_id": bot_chat_id, "text": text, "parse_mode": "HTML",
            "disable_web_page_preview": True,
            "reply_markup": {"inline_keyboard": inline_keyboard},
        }
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
                json=payload, timeout=aiohttp.ClientTimeout(total=10)
            ) as r:
                if r.status != 200:
                    resp = await r.text()
                    logger.warning(f"[BotNotify] 推送失败 {r.status}: {resp[:100]}")
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
    if not text or not text.strip() or is_bot:
        return
    sender_tg_id = str(sender_id)
    sender_name = f"{sender_first_name} {sender_last_name}".strip()
    now_ts = time.time()
    expired_keys = [k for k, v in processed_messages.items() if now_ts - v > PROCESSED_MSG_TTL]
    for k in expired_keys:
        del processed_messages[k]

    config = monitor_config.get(str(user_id), {})
    groups = config.get("groups", [])
    push_settings_cfg = config.get("pushSettings", {})

    if push_settings_cfg.get("pushEnabled", True):
        blocked_ids = set(config.get("blockedTgIds", []))
        if sender_tg_id not in blocked_ids:
            if not (push_settings_cfg.get("filterAds", False) and is_likely_spam(sender_id, sender_username, text)):
                anti_spam_cfg = config.get("globalAntiSpam", {})
                is_spam, spam_reason = check_anti_spam(sender_tg_id, text, anti_spam_cfg)
                if not is_spam:
                    for group in groups:
                        if not group.get("isActive"):
                            continue
                        group_id_cfg = str(group.get("groupId", ""))
                        if group_id_cfg != chat_id:
                            continue
                        dedup_key = f"{chat_id}:{message_id}:{user_id}"
                        if dedup_key in processed_messages:
                            continue
                        keywords_list = [kw for kw in group.get("keywords", []) if kw.get("isActive", True)]
                        matched_keywords = [kw for kw in keywords_list if match_keyword(text, kw)]
                        if not matched_keywords:
                            continue
                        processed_messages[dedup_key] = now_ts
                        logger.info(
                            f"[PRIVATE_MATCH] account={account_id} user={user_id} "
                            f"group={chat_title} sender={sender_username or sender_id} "
                            f"keywords={[k['pattern'] for k in matched_keywords]}"
                        )
                        await _handle_match(
                            account_id=account_id, user_id=user_id, config=config,
                            chat_id=chat_id, chat_title=chat_title, chat_username=chat_username,
                            sender_tg_id=sender_tg_id, sender_username=sender_username,
                            sender_name=sender_name, text=text, matched_keywords=matched_keywords,
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
            pub_dedup_key = f"{chat_id}:{message_id}:{uid}"
            if pub_dedup_key in processed_messages:
                notified_users_for_msg.add(uid)
                continue
            if uid in notified_users_for_msg:
                continue
            u_push_settings = uconfig.get("pushSettings", {})
            if not u_push_settings.get("pushEnabled", True):
                continue
            u_blocked_ids = set(uconfig.get("blockedTgIds", []))
            if sender_tg_id in u_blocked_ids:
                continue
            if u_push_settings.get("filterAds", False) and is_likely_spam(sender_id, sender_username, text):
                continue
            u_anti_spam = uconfig.get("globalAntiSpam", {})
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
            processed_messages[pub_dedup_key] = now_ts
            notified_users_for_msg.add(uid)
            logger.info(
                f"[PUBLIC_MATCH] user={uid} public_group={chat_title} "
                f"sender={sender_username or sender_id} "
                f"keywords={[k['pattern'] for k in u_matched_keywords]}"
            )
            await _handle_match(
                account_id=account_id, user_id=uid, config=uconfig,
                chat_id=chat_id, chat_title=chat_title, chat_username=chat_username,
                sender_tg_id=sender_tg_id, sender_username=sender_username,
                sender_name=sender_name, text=text, matched_keywords=u_matched_keywords,
            )


async def _handle_match(
    account_id: int, user_id: int, config: dict, chat_id: str, chat_title: str,
    chat_username: Optional[str], sender_tg_id: str, sender_username: Optional[str],
    sender_name: str, text: str, matched_keywords: list,
):
    variables = {
        "username": sender_username or "",
        "keyword": matched_keywords[0]["pattern"] if matched_keywords else "",
        "group_name": chat_title,
        "message": text[:200],
        "date": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "sender_name": sender_name,
    }
    hit_record_id = None
    try:
        hit_result = await api.post("/engine/hit", {
            "userId": user_id, "senderTgId": sender_tg_id,
            "senderUsername": sender_username, "senderName": sender_name,
            "tgGroupId": chat_id, "groupName": chat_title,
            "matchedKeyword": matched_keywords[0]["pattern"],
            "messageContent": text[:500], "keywordId": matched_keywords[0].get("id"),
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

    bot_chat_id = config.get("botChatId")
    if bot_chat_id:
        await send_bot_notification(
            bot_chat_id=str(bot_chat_id), sender_username=sender_username,
            sender_tg_id=sender_tg_id, matched_keyword=matched_keywords[0]["pattern"],
            group_name=chat_title, group_username=chat_username, message_text=text,
            sender_name=sender_name, hit_record_id=hit_record_id,
            dm_status="queued" if dm_will_send else "disabled",
        )

    push_settings_cfg = config.get("pushSettings", {})
    collab_chat_id_str = push_settings_cfg.get("collabChatId")
    if collab_chat_id_str:
        worker = active_workers.get(account_id)
        if worker and worker.is_running:
            try:
                real_collab_id = await worker.resolve_chat_id(collab_chat_id_str)
                if real_collab_id:
                    collab_text = (
                        f"关键词命中\n"
                        f"用户：{sender_name or sender_username or sender_tg_id}\n"
                        f"来源：{chat_title}\n"
                        f"关键词：{matched_keywords[0]['pattern']}\n"
                        f"内容：{text[:200]}"
                    )
                    await worker.send_message(real_collab_id, collab_text)
            except Exception as e:
                logger.warning(f"[CollabPush] 协作群推送失败: {e}")

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
        self._task = None
        self._chat_id_cache: dict = {}
        self.files_directory = os.path.join(TDLIB_DATA_DIR, f"account_{self.account_id}")
        os.makedirs(self.files_directory, exist_ok=True)

    async def start(self) -> bool:
        if not TG_API_ID or not TG_API_HASH:
            logger.error("TG_API_ID 或 TG_API_HASH 未配置")
            return False
        if not self.session_string and not self.phone:
            logger.warning(f"[Account {self.account_id}] 无 Session 或手机号，跳过")
            return False
        try:
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

            self._task = asyncio.create_task(self._run_client())
            self.is_running = True
            logger.info(f"[Account {self.account_id}] TDLib Worker 已启动 (数据目录: {self.files_directory})")
            return True
        except Exception as e:
            logger.error(f"[Account {self.account_id}] 启动失败: {e}")
            await update_account_health(self.account_id, -15, "error", reason=str(e)[:100])
            return False

    async def _run_client(self):
        try:
            async with self.client:
                await self.client.idle()
        except Exception as e:
            logger.error(f"[Account {self.account_id}] TDLib 客户端异常: {e}")
            self.is_running = False

    async def _on_auth_state(self, update):
        try:
            state_type = update.authorization_state.get("@type", "") if hasattr(update, 'authorization_state') else ""
            logger.info(f"[Account {self.account_id}] 认证状态: {state_type}")
            if state_type == "authorizationStateReady":
                await api.post("/engine/account/status", {"accountId": self.account_id, "status": "active"})
                await update_account_health(self.account_id, 0, "healthy")
            elif state_type == "authorizationStateClosed":
                self.is_running = False
                await update_account_health(self.account_id, -10, "error", reason="session_closed")
        except Exception as e:
            logger.warning(f"[Account {self.account_id}] 处理认证状态异常: {e}")

    async def _on_new_message(self, update):
        try:
            message = update.message if hasattr(update, 'message') else None
            if not message:
                return
            content = message.get("content", {}) if isinstance(message, dict) else {}
            content_type = content.get("@type", "")
            text = ""
            if content_type == "messageText":
                text = content.get("text", {}).get("text", "")
            elif content_type in ("messagePhoto", "messageVideo", "messageDocument"):
                caption = content.get("caption", {})
                text = caption.get("text", "") if caption else ""
            if not text:
                return
            chat_id_int = message.get("chat_id", 0) if isinstance(message, dict) else 0
            if not chat_id_int or chat_id_int > 0:
                return
            chat_id = str(chat_id_int)
            sender_info = message.get("sender_id", {}) if isinstance(message, dict) else {}
            sender_type = sender_info.get("@type", "")
            if sender_type != "messageSenderUser":
                return
            sender_user_id = sender_info.get("user_id", 0)
            if not sender_user_id:
                return
            chat_info = await self._get_chat_info(chat_id_int)
            chat_title = chat_info.get("title", str(chat_id_int))
            chat_username = chat_info.get("username", "") or None
            user_info = await self._get_user_info(sender_user_id)
            sender_username = user_info.get("username", "") or None
            sender_first_name = user_info.get("first_name", "")
            sender_last_name = user_info.get("last_name", "")
            is_bot = user_info.get("is_bot", False)
            message_id = message.get("id", 0) if isinstance(message, dict) else 0
            await process_message(
                account_id=self.account_id, user_id=self.user_id,
                chat_id=chat_id, chat_title=chat_title, chat_username=chat_username,
                sender_id=sender_user_id, sender_username=sender_username,
                sender_first_name=sender_first_name, sender_last_name=sender_last_name,
                message_id=message_id, text=text, is_bot=is_bot,
            )
        except Exception as e:
            logger.warning(f"[Account {self.account_id}] 处理消息异常: {e}")

    async def _get_chat_info(self, chat_id: int) -> dict:
        try:
            result = await self.client.invoke({"@type": "getChat", "chat_id": chat_id})
            if result and result.get("@type") == "chat":
                title = result.get("title", "")
                chat_type = result.get("type", {})
                username = ""
                if chat_type.get("@type") == "chatTypeSupergroup":
                    sg_id = chat_type.get("supergroup_id", 0)
                    sg_info = await self.client.invoke({"@type": "getSupergroup", "supergroup_id": sg_id})
                    if sg_info:
                        username = sg_info.get("username", "")
                return {"title": title, "username": username}
        except Exception:
            pass
        return {"title": str(chat_id), "username": ""}

    async def _get_user_info(self, user_id: int) -> dict:
        try:
            result = await self.client.invoke({"@type": "getUser", "user_id": user_id})
            if result and result.get("@type") == "user":
                return {
                    "username": result.get("username", ""),
                    "first_name": result.get("first_name", ""),
                    "last_name": result.get("last_name", ""),
                    "is_bot": result.get("type", {}).get("@type") == "userTypeBot",
                }
        except Exception:
            pass
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
            if result and result.get("id"):
                real_id = result["id"]
                self._chat_id_cache[chat_id_str] = real_id
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
                try:
                    return int(chat_id_str) if chat_id_str.lstrip("-").isdigit() else None
                except Exception:
                    pass
            logger.warning(f"[Account {self.account_id}] 加入群组 {chat_id_str} 失败: {e}")
        return None

    async def send_message(self, chat_id: int, text: str) -> bool:
        if not self.client or not self.is_running:
            return False
        try:
            await self.client.invoke({
                "@type": "sendMessage", "chat_id": chat_id,
                "input_message_content": {
                    "@type": "inputMessageText",
                    "text": {"@type": "formattedText", "text": text}
                }
            })
            return True
        except Exception as e:
            logger.warning(f"[Account {self.account_id}] 发送消息失败: {e}")
            return False

    async def stop(self):
        self.is_running = False
        if self.client:
            try:
                await self.client.close()
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
    global public_group_real_ids
    if not public_groups:
        return
    for pg in public_groups:
        pg_id = pg.get("id")
        group_id = pg.get("groupId", "")
        if not group_id:
            continue
        try:
            real_id = await worker.join_chat(group_id)
            if real_id:
                public_group_real_ids[group_id] = real_id
                logger.info(f"[Account {account_id}] 已加入公共群组 {group_id} -> 真实ID: {real_id}")
                if pg_id:
                    await api.post("/engine/public-group/join-status", {
                        "publicGroupId": pg_id, "monitorAccountId": account_id, "status": "joined",
                    })
            else:
                if pg_id:
                    await api.post("/engine/public-group/join-status", {
                        "publicGroupId": pg_id, "monitorAccountId": account_id,
                        "status": "failed", "errorMsg": "join_failed",
                    })
        except Exception as e:
            logger.warning(f"[Account {account_id}] 处理公共群组 {group_id} 异常: {e}")
        await asyncio.sleep(2)


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
                config = monitor_config.get(str(user_id), {})
                antiban = config.get("antiban", {})
                min_delay = antiban.get("minDelay", 60)
                max_delay = antiban.get("maxDelay", 180)
                delay = random.gauss((min_delay + max_delay) / 2, (max_delay - min_delay) / 6)
                delay = max(min_delay, min(max_delay, delay))
                logger.info(f"[DM] 准备发送 account={account_id} target={target_username or target_tg_id} delay={delay:.0f}s")
                await asyncio.sleep(delay)
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
    global monitor_config, public_groups
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
            public_groups_changed = new_public_groups != public_groups
            public_groups = new_public_groups
            if public_groups:
                logger.info(f"[Config] 公共群组: {len([g for g in public_groups if g.get('isActive')])} 个活跃")
            target_ids = {
                a["id"] for a in accounts
                if a.get("isActive") and a.get("role") in ("monitor", "both")
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
                        asyncio.create_task(join_public_groups(worker, account["id"]))
            if public_groups_changed and public_groups:
                logger.info("[Config] 公共群组列表已更新，所有账号重新加入...")
                for aid, worker in active_workers.items():
                    asyncio.create_task(join_public_groups(worker, aid))
            logger.info(
                f"[Config] 同步完成 活跃账号={len(active_workers)} "
                f"监控用户={len(monitor_config)} 公共群组={len(public_groups)}"
            )
        except Exception as e:
            logger.error(f"[Config] 同步异常: {e}")
        await asyncio.sleep(POLL_INTERVAL)


async def heartbeat():
    while True:
        try:
            await api.post("/engine/heartbeat", {
                "activeAccounts": len(active_workers),
                "timestamp": int(time.time()),
                "engineType": "tdlib",
                "tdlibVersion": "1.8.x",
            })
        except Exception as e:
            logger.warning(f"[Heartbeat] 上报失败: {e}")
        await asyncio.sleep(60)


async def main():
    logger.info("=" * 60)
    logger.info("TG Monitor Pro - TDLib 监控引擎启动")
    logger.info(f"API Base: {API_BASE}")
    logger.info(f"TG API ID: {TG_API_ID}")
    logger.info(f"TDLib 数据目录: {TDLIB_DATA_DIR}")
    logger.info("=" * 60)
    os.makedirs(TDLIB_DATA_DIR, exist_ok=True)
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
    await asyncio.gather(sync_config(), process_dm_queue(), heartbeat())


if __name__ == "__main__":
    asyncio.run(main())
