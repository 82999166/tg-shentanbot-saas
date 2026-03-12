#!/usr/bin/env python3
"""
TG Monitor Pro - Pyrogram 监控引擎
功能：
  1. 从 Web API 拉取监控配置（账号、群组、关键词、消息模板）
  2. 为每个激活的 TG 账号启动独立的 Pyrogram 客户端
  3. 监听群组消息，匹配关键词规则
  4. 命中后：推送通知到目标群 + 加入私信发送队列
  5. 私信发送队列：按防封策略调度，随机延迟，频率限制
"""

import asyncio
import json
import logging
import os
import re
import random
import time

# 加载 .env 文件
try:
    from dotenv import load_dotenv
    _env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    load_dotenv(_env_path, override=True)
except ImportError:
    pass  # python-dotenv 未安装时直接从环境变量读取
from datetime import datetime, timedelta
from typing import Optional
import aiohttp
from pyrogram import Client, filters
from pyrogram.types import Message
from pyrogram.errors import (
    FloodWait,
    PeerFlood,
    UserPrivacyRestricted,
    UserIsBlocked,
    InputUserDeactivated,
    SessionPasswordNeeded,
)

# ── 日志配置 ─────────────────────────────────────────────────
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

# ── 配置 ─────────────────────────────────────────────────────
API_BASE = os.getenv("WEB_API_BASE", "http://localhost:3000/api")
ENGINE_SECRET = os.getenv("ENGINE_SECRET", "tg-monitor-engine-secret")
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "30"))   # 每 30 秒从 API 拉取配置
DM_WORKER_INTERVAL = int(os.getenv("DM_WORKER_INTERVAL", "10"))  # 每 10 秒处理一批私信

# Telegram API 凭证（从 https://my.telegram.org 获取）
TG_API_ID = int(os.getenv("TG_API_ID", "0"))
TG_API_HASH = os.getenv("TG_API_HASH", "")

# ── 全局状态 ─────────────────────────────────────────────────
active_clients: dict[int, Client] = {}   # account_id -> Client
monitor_config: dict = {}                 # 从 API 拉取的完整配置
sent_dm_cache: dict[str, float] = {}      # "account_id:target_id" -> timestamp（去重）


# ── API 客户端 ───────────────────────────────────────────────
class ApiClient:
    def __init__(self, base: str, secret: str):
        self.base = base
        self.headers = {"X-Engine-Secret": secret, "Content-Type": "application/json"}

    async def get(self, path: str) -> Optional[dict]:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(f"{self.base}{path}", headers=self.headers, timeout=aiohttp.ClientTimeout(total=10)) as r:
                    if r.status == 200:
                        return await r.json()
        except Exception as e:
            logger.warning(f"API GET {path} failed: {e}")
        return None

    async def post(self, path: str, data: dict) -> Optional[dict]:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(f"{self.base}{path}", headers=self.headers, json=data, timeout=aiohttp.ClientTimeout(total=10)) as r:
                    if r.status == 200:
                        return await r.json()
        except Exception as e:
            logger.warning(f"API POST {path} failed: {e}")
        return None


api = ApiClient(API_BASE, ENGINE_SECRET)


# ── 关键词匹配引擎 ───────────────────────────────────────────
def match_keyword(text: str, keyword: dict) -> bool:
    """
    支持四种匹配模式：
    - exact: 精确包含
    - regex: 正则表达式
    - and: 所有子关键词都包含
    - or: 任一子关键词包含
    """
    if not text:
        return False

    match_type = keyword.get("matchType", "exact")
    pattern = keyword.get("pattern", "")
    sub_keywords = keyword.get("subKeywords", [])
    case_sensitive = keyword.get("caseSensitive", False)

    compare_text = text if case_sensitive else text.lower()
    compare_pattern = pattern if case_sensitive else pattern.lower()

    if match_type == "exact":
        return compare_pattern in compare_text

    elif match_type == "regex":
        try:
            flags = 0 if case_sensitive else re.IGNORECASE
            return bool(re.search(pattern, text, flags))
        except re.error:
            return False

    elif match_type == "and":
        keywords_list = [k.strip() for k in sub_keywords if k.strip()]
        if not keywords_list:
            keywords_list = [compare_pattern]
        return all(
            (k if case_sensitive else k.lower()) in compare_text
            for k in keywords_list
        )

    elif match_type == "or":
        keywords_list = [k.strip() for k in sub_keywords if k.strip()]
        if not keywords_list:
            keywords_list = [compare_pattern]
        return any(
            (k if case_sensitive else k.lower()) in compare_text
            for k in keywords_list
        )

    return False


def render_template(template: str, variables: dict) -> str:
    """渲染消息模板，替换变量"""
    result = template
    for key, value in variables.items():
        result = result.replace(f"{{{{{key}}}}}", str(value or ""))
    return result


# ── 账号健康度更新 ───────────────────────────────────────────
async def update_account_health(account_id: int, delta: int, status: str = None):
    data = {"accountId": account_id, "delta": delta}
    if status:
        data["status"] = status
    await api.post("/engine/account/health", data)


# ── 私信发送队列处理器 ───────────────────────────────────────
async def process_dm_queue():
    """从 API 获取待发送的私信，按防封策略调度发送"""
    while True:
        try:
            # 获取待发送队列（每次最多 5 条）
            queue_data = await api.get("/engine/dm-queue?limit=5")
            if not queue_data or not queue_data.get("items"):
                await asyncio.sleep(DM_WORKER_INTERVAL)
                continue

            for item in queue_data["items"]:
                account_id = item.get("senderAccountId")
                target_tg_id = item.get("targetTgId")
                target_username = item.get("targetUsername")
                content = item.get("content")
                queue_id = item.get("id")

                # 去重检查
                cache_key = f"{account_id}:{target_tg_id or target_username}"
                if cache_key in sent_dm_cache:
                    last_sent = sent_dm_cache[cache_key]
                    cooldown = item.get("cooldownHours", 24) * 3600
                    if time.time() - last_sent < cooldown:
                        await api.post("/engine/dm-queue/skip", {"id": queue_id, "reason": "cooldown"})
                        continue

                # 获取发信账号的客户端
                client = active_clients.get(account_id)
                if not client or not client.is_connected:
                    await api.post("/engine/dm-queue/fail", {"id": queue_id, "error": "sender_offline"})
                    continue

                # 防封延迟（高斯随机，均值 2 分钟）
                antiban = item.get("antiban", {})
                min_delay = antiban.get("minDelay", 60)
                max_delay = antiban.get("maxDelay", 180)
                delay = random.gauss((min_delay + max_delay) / 2, (max_delay - min_delay) / 6)
                delay = max(min_delay, min(max_delay, delay))

                logger.info(f"[DM] 准备发送 account={account_id} target={target_username or target_tg_id} delay={delay:.0f}s")
                await asyncio.sleep(delay)

                # 发送私信
                try:
                    target = target_username or int(target_tg_id)
                    await client.send_message(target, content)

                    # 标记成功
                    sent_dm_cache[cache_key] = time.time()
                    await api.post("/engine/dm-queue/success", {"id": queue_id})
                    await update_account_health(account_id, 0)  # 成功不扣分
                    logger.info(f"[DM] ✅ 发送成功 -> {target_username or target_tg_id}")

                except FloodWait as e:
                    logger.warning(f"[DM] FloodWait {e.value}s for account {account_id}")
                    await update_account_health(account_id, -5)
                    await api.post("/engine/dm-queue/retry", {"id": queue_id, "retryAfter": e.value})
                    await asyncio.sleep(e.value)

                except PeerFlood:
                    logger.error(f"[DM] PeerFlood for account {account_id} - 暂停该账号发信")
                    await update_account_health(account_id, -20, "limited")
                    await api.post("/engine/dm-queue/fail", {"id": queue_id, "error": "peer_flood"})

                except UserPrivacyRestricted:
                    logger.info(f"[DM] 用户隐私设置限制，跳过 {target_username or target_tg_id}")
                    await api.post("/engine/dm-queue/fail", {"id": queue_id, "error": "privacy_restricted"})

                except UserIsBlocked:
                    logger.info(f"[DM] 用户已拉黑，跳过 {target_username or target_tg_id}")
                    await api.post("/engine/dm-queue/fail", {"id": queue_id, "error": "user_blocked"})

                except InputUserDeactivated:
                    logger.info(f"[DM] 用户账号已注销，跳过 {target_username or target_tg_id}")
                    await api.post("/engine/dm-queue/fail", {"id": queue_id, "error": "user_deactivated"})

                except Exception as e:
                    logger.error(f"[DM] 发送失败: {e}")
                    await update_account_health(account_id, -2)
                    await api.post("/engine/dm-queue/fail", {"id": queue_id, "error": str(e)[:200]})

        except Exception as e:
            logger.error(f"[DM Worker] 异常: {e}")

        await asyncio.sleep(DM_WORKER_INTERVAL)


# ── 消息处理器 ───────────────────────────────────────────────
def create_message_handler(account_id: int, user_id: int):
    """为每个账号创建消息处理器闭包"""

    async def handle_message(client: Client, message: Message):
        try:
            # 只处理群组/频道消息
            if not message.chat or message.chat.type.name not in ("GROUP", "SUPERGROUP"):
                return

            # 获取发送者信息
            sender = message.from_user
            if not sender or sender.is_bot:
                return

            chat_id = str(message.chat.id)
            text = message.text or message.caption or ""
            if not text.strip():
                return

            # 从配置中查找该群组的监控规则
            config = monitor_config.get(str(user_id), {})
            groups = config.get("groups", [])

            for group in groups:
                if str(group.get("tgGroupId")) != chat_id:
                    continue
                if not group.get("isActive"):
                    continue

                # 检查关键词规则
                keywords = group.get("keywords", [])
                matched_keywords = []

                for kw in keywords:
                    if not kw.get("isActive"):
                        continue
                    if match_keyword(text, kw):
                        matched_keywords.append(kw)

                if not matched_keywords:
                    continue

                logger.info(
                    f"[MATCH] user={user_id} group={message.chat.title} "
                    f"sender={sender.username or sender.id} "
                    f"keywords={[k['pattern'] for k in matched_keywords]}"
                )

                # 构建变量
                variables = {
                    "sender_username": sender.username or "",
                    "sender_id": str(sender.id),
                    "sender_name": f"{sender.first_name or ''} {sender.last_name or ''}".strip(),
                    "group_name": message.chat.title or "",
                    "group_id": str(message.chat.id),
                    "message_text": text[:200],
                    "keyword": matched_keywords[0]["pattern"],
                    "matched_keywords": ", ".join(k["pattern"] for k in matched_keywords),
                    "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                }

                # 上报命中记录到 API
                hit_data = {
                    "userId": user_id,
                    "monitorAccountId": account_id,
                    "tgGroupId": chat_id,
                    "groupName": message.chat.title,
                    "senderTgId": str(sender.id),
                    "senderUsername": sender.username,
                    "senderName": variables["sender_name"],
                    "messageText": text[:1000],
                    "matchedKeywords": [k["pattern"] for k in matched_keywords],
                    "messageId": str(message.id),
                }
                await api.post("/engine/hit", hit_data)

                # 如果配置了自动私信，加入发送队列
                if config.get("dmEnabled") and config.get("dmTemplates"):
                    templates = config["dmTemplates"]
                    # 按权重随机选择模板
                    template = random.choices(
                        templates,
                        weights=[t.get("weight", 1) for t in templates],
                        k=1,
                    )[0]

                    dm_content = render_template(template["content"], variables)

                    dm_data = {
                        "userId": user_id,
                        "senderAccountId": config.get("dmSenderAccountId", account_id),
                        "targetTgId": str(sender.id),
                        "targetUsername": sender.username,
                        "content": dm_content,
                        "templateId": template.get("id"),
                        "hitGroupId": chat_id,
                        "matchedKeyword": matched_keywords[0]["pattern"],
                    }
                    await api.post("/engine/dm-queue/add", dm_data)

        except Exception as e:
            logger.error(f"[Handler] 消息处理异常: {e}")

    return handle_message


# ── 账号客户端管理 ───────────────────────────────────────────
async def start_account(account: dict) -> Optional[Client]:
    """启动单个 TG 账号的 Pyrogram 客户端"""
    account_id = account["id"]
    session_string = account.get("sessionString")

    if not session_string:
        logger.warning(f"[Account {account_id}] 无 Session，跳过")
        return None

    if not TG_API_ID or not TG_API_HASH:
        logger.error("TG_API_ID 或 TG_API_HASH 未配置，无法启动客户端")
        return None

    try:
        client = Client(
            name=f"account_{account_id}",
            api_id=TG_API_ID,
            api_hash=TG_API_HASH,
            session_string=session_string,
            in_memory=True,
        )

        user_id = account.get("userId", 0)
        handler = create_message_handler(account_id, user_id)
        client.add_handler(
            # 监听所有群组消息
            __import__("pyrogram.handlers", fromlist=["MessageHandler"]).MessageHandler(
                handler,
                filters.group & ~filters.bot,
            )
        )

        await client.start()
        me = await client.get_me()
        logger.info(f"[Account {account_id}] ✅ 已连接: @{me.username or me.id}")

        # 更新账号状态
        await api.post("/engine/account/status", {
            "accountId": account_id,
            "status": "active",
            "tgUserId": str(me.id),
            "tgUsername": me.username,
        })

        return client

    except SessionPasswordNeeded:
        logger.error(f"[Account {account_id}] 需要二步验证密码")
        await update_account_health(account_id, -10, "needs_2fa")
        return None

    except Exception as e:
        logger.error(f"[Account {account_id}] 启动失败: {e}")
        await update_account_health(account_id, -15, "error")
        return None


async def stop_account(account_id: int):
    """停止账号客户端"""
    client = active_clients.pop(account_id, None)
    if client:
        try:
            await client.stop()
            logger.info(f"[Account {account_id}] 已停止")
        except Exception as e:
            logger.warning(f"[Account {account_id}] 停止时异常: {e}")


# ── 配置同步 ─────────────────────────────────────────────────
async def sync_config():
    """从 API 拉取最新配置，启停账号"""
    global monitor_config

    while True:
        try:
            data = await api.get("/engine/config")
            if not data:
                logger.warning("[Config] 无法获取配置，稍后重试")
                await asyncio.sleep(POLL_INTERVAL)
                continue

            monitor_config = data.get("userConfigs", {})
            accounts = data.get("accounts", [])

            # 需要激活的账号 ID 集合
            target_ids = {
                a["id"] for a in accounts
                if a.get("isActive") and a.get("role") in ("monitor", "both")
                and a.get("sessionString")
            }

            # 停止不再需要的账号
            to_stop = set(active_clients.keys()) - target_ids
            for aid in to_stop:
                logger.info(f"[Config] 停止账号 {aid}（配置已移除或停用）")
                await stop_account(aid)

            # 启动新增的账号
            to_start = target_ids - set(active_clients.keys())
            for account in accounts:
                if account["id"] in to_start:
                    client = await start_account(account)
                    if client:
                        active_clients[account["id"]] = client

            logger.info(
                f"[Config] 同步完成 活跃账号={len(active_clients)} "
                f"监控用户={len(monitor_config)}"
            )

        except Exception as e:
            logger.error(f"[Config] 同步异常: {e}")

        await asyncio.sleep(POLL_INTERVAL)


# ── 心跳上报 ─────────────────────────────────────────────────
async def heartbeat():
    """每分钟上报引擎状态"""
    while True:
        try:
            await api.post("/engine/heartbeat", {
                "activeAccounts": len(active_clients),
                "timestamp": int(time.time()),
            })
        except Exception as e:
            logger.warning(f"[Heartbeat] 上报失败: {e}")
        await asyncio.sleep(60)


# ── 主入口 ───────────────────────────────────────────────────
async def main():
    logger.info("=" * 60)
    logger.info("TG Monitor Pro - 监控引擎启动")
    logger.info(f"API Base: {API_BASE}")
    logger.info(f"TG API ID: {TG_API_ID}")
    logger.info("=" * 60)

    if not TG_API_ID or not TG_API_HASH:
        logger.warning("⚠️  TG_API_ID 或 TG_API_HASH 未配置，引擎将每60秒重试检查")
        logger.warning("   请在 monitor-engine/.env 中填入从 https://my.telegram.org/apps 获取的凭证")
        # 不退出，每60秒检查一次配置是否已填入
        while True:
            await asyncio.sleep(60)
            new_api_id = int(os.getenv("TG_API_ID", "0"))
            new_api_hash = os.getenv("TG_API_HASH", "")
            if new_api_id and new_api_hash:
                logger.info("✅ 检测到 TG API 凭证已配置，重启引擎...")
                import sys
                os.execv(sys.executable, [sys.executable] + sys.argv)
            logger.info("⏳ 等待 TG_API_ID 和 TG_API_HASH 配置...")
        return

    # 并发运行所有任务
    await asyncio.gather(
        sync_config(),
        process_dm_queue(),
        heartbeat(),
    )


if __name__ == "__main__":
    asyncio.run(main())
