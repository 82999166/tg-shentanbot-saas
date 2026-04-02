"""
TG Monitor Pro - Telegram Bot 主服务
功能：
- /start 自动注册账号（无需跳转网站）
- 关键词管理（套餐限制）
- 私信账号绑定
- 消息模板设置
- 监控群组管理
- 命中通知推送（带操作按钮）
- 统计数据查看
使用 python-telegram-bot (PTB) HTTP polling 模式
"""
import asyncio
import logging
import os
import json
import aiohttp
from telegram import (
    Update, InlineKeyboardMarkup, InlineKeyboardButton, BotCommand,
)
from telegram.ext import (
    Application, CommandHandler, CallbackQueryHandler,
    MessageHandler, ContextTypes, filters,
)
from telegram.constants import ParseMode

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

BOT_TOKEN = os.getenv("BOT_TOKEN", "8678159362:AAFqfg8uoL7RBQ_tWvd7YgklsoeShuEF2QU")
WEB_API_BASE = os.getenv("WEB_API_BASE", "http://127.0.0.1:3002/api")
ENGINE_SECRET = os.getenv("ENGINE_SECRET", "c9a64a70df17752d00de552b4e01ca94e22835909230539552c9a9a18a79a7ac")
WEB_SITE_URL = os.getenv("WEB_SITE_URL", "")  # 网站地址，用于 Bot 中的跳转链接

# 套餐名称
PLAN_NAMES = {"free": "免费版", "basic": "基础版", "pro": "专业版", "enterprise": "企业版"}

# 对话状态 key
STATE_KEY = "input_state"
STATE_KEYWORD = "wait_keyword"
STATE_TEMPLATE = "wait_template"
STATE_GROUP = "wait_group"
STATE_ACTIVATE = "wait_activate"
STATE_SENDER_PHONE = "wait_sender_phone"
STATE_SENDER_CODE = "wait_sender_code"
STATE_SENDER_2FA = "wait_sender_2fa"
STATE_SENDER_SESSION = "wait_sender_session"
STATE_EMAIL = "wait_email"
STATE_BLACKLIST_KWS = "wait_blacklist_kws"   # 等待输入黑名单关键词
STATE_DEDUPE_CUSTOM = "wait_dedupe_custom"   # 等待输入自定义去重分钟数

# ─── API 辅助 ─────────────────────────────────────────────────────────────────

async def api_get(path: str, params: dict = None):
    headers = {"x-engine-secret": ENGINE_SECRET}
    input_json = json.dumps({"json": params or {}})
    url = f"{WEB_API_BASE}/trpc/{path}"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers, params={"input": input_json}) as resp:
                data = await resp.json()
                return data.get("result", {}).get("data", {}).get("json")
    except Exception as e:
        logger.error(f"api_get {path} error: {e}")
        return None

async def api_post(path: str, data: dict = None):
    headers = {"x-engine-secret": ENGINE_SECRET, "Content-Type": "application/json"}
    url = f"{WEB_API_BASE}/trpc/{path}"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, headers=headers, json={"json": data or {}}) as resp:
                result = await resp.json()
                return result.get("result", {}).get("data", {}).get("json")
    except Exception as e:
        logger.error(f"api_post {path} error: {e}")
        return None

async def ensure_user(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int | None:
    if context.user_data.get("user_id"):
        return context.user_data["user_id"]
    tg = update.effective_user
    result = await api_post("engine.botAutoRegister", {
        "tgUserId": str(tg.id),
        "tgUsername": tg.username,
        "tgFirstName": tg.first_name,
        "tgLastName": tg.last_name,
    })
    if result:
        context.user_data["user_id"] = result["id"]
        return result["id"]
    return None

# ─── 主菜单（方案A：4按钮底部快捷菜单）────────────────────────────────────────
def main_menu_keyboard():
    """底部快捷菜单：我的信息 / 设置中心 / 常见问题 / 联系客服"""
    return InlineKeyboardMarkup([
        [
            InlineKeyboardButton("📋 关键词管理", callback_data="menu_keywords"),
            InlineKeyboardButton("📢 推送群组", callback_data="menu_push_group"),
        ],
        [
            InlineKeyboardButton("💬 私信模板", callback_data="menu_template"),
            InlineKeyboardButton("📱 私信账号", callback_data="menu_sender"),
        ],
        [
            InlineKeyboardButton("📊 今日统计", callback_data="menu_stats"),
            InlineKeyboardButton("💎 我的套餐", callback_data="menu_plan"),
        ],
        [
            InlineKeyboardButton("🔔 自动私信开关", callback_data="menu_dm_toggle"),
        ],
        [
            InlineKeyboardButton("🎟 激活套餐", callback_data="menu_activate"),
            InlineKeyboardButton("📖 使用教程", callback_data="menu_tutorial"),
        ],
        [
            InlineKeyboardButton("⏰ 到期时间", callback_data="menu_expiry"),
            InlineKeyboardButton("📢 官方频道", callback_data="menu_channel"),
        ],
        # ── 方案A：底部4快捷按钮 ──
        [
            InlineKeyboardButton("👤 我的信息", callback_data="menu_profile"),
            InlineKeyboardButton("⚙️ 设置中心", callback_data="menu_settings"),
        ],
        [
            InlineKeyboardButton("❓ 常见问题", callback_data="menu_faq"),
            InlineKeyboardButton("🎧 联系客服", callback_data="menu_support"),
        ],
    ])


def settings_menu_keyboard(cfg: dict) -> InlineKeyboardMarkup:
    """设置中心菜单（7项配置）"""
    kw_mode_map = {"fuzzy": "🔍 模糊匹配", "exact": "🎯 精确匹配", "leftmost": "⬅️ 最左匹配", "rightmost": "➡️ 最右匹配"}
    bl_mode_map = {"fuzzy": "🔍 模糊", "exact": "🎯 精确"}
    dedupe_map = {0: "❌ 不去重", 3: "3分钟", 5: "5分钟", 10: "10分钟", 30: "30分钟",
                  60: "1小时", 720: "12小时", 1440: "1天", 10080: "7天", 43200: "30天"}
    dedupe_min = cfg.get("dedupeMinutes", 0)
    dedupe_label = dedupe_map.get(dedupe_min, f"{dedupe_min}分钟")
    kw_mode = cfg.get("keywordMatchMode", "fuzzy")
    bl_mode = cfg.get("blacklistMatchMode", "fuzzy")
    filter_ads = cfg.get("filterAds", False)
    filter_bots = cfg.get("filterBots", False)
    media_only = cfg.get("mediaOnly", False)
    include_history = cfg.get("includeSearchHistory", False)
    bkws = cfg.get("blacklistKeywords") or ""
    bkw_count = len([k for k in bkws.replace("，", ",").split(",") if k.strip()]) if bkws else 0
    on = "✅"
    off = "❌"
    return InlineKeyboardMarkup([
        [InlineKeyboardButton(f"🔑 匹配模式：{kw_mode_map.get(kw_mode, kw_mode)}", callback_data="settings_kw_mode")],
        [InlineKeyboardButton(f"🚫 黑名单关键词：{bkw_count}个 [{bl_mode_map.get(bl_mode, bl_mode)}]", callback_data="settings_blacklist")],
        [InlineKeyboardButton(f"⏱ 去重窗口：{dedupe_label}", callback_data="settings_dedupe")],
        [InlineKeyboardButton(f"{on if filter_ads else off} 过滤广告消息", callback_data="settings_toggle_filterAds")],
        [InlineKeyboardButton(f"{on if filter_bots else off} 过滤机器人消息", callback_data="settings_toggle_filterBots")],
        [InlineKeyboardButton(f"{on if media_only else off} 仅推送含媒体消息", callback_data="settings_toggle_mediaOnly")],
        [InlineKeyboardButton(f"{on if include_history else off} 包含7日搜索历史", callback_data="settings_toggle_includeHistory")],
        [InlineKeyboardButton("◀️ 返回主菜单", callback_data="menu_main")],
    ])


def settings_kw_mode_keyboard(current: str) -> InlineKeyboardMarkup:
    """关键词匹配模式选择菜单"""
    modes = [
        ("fuzzy", "🔍 模糊匹配（包含即命中）"),
        ("exact", "🎯 精确匹配（完整词匹配）"),
        ("leftmost", "⬅️ 最左匹配（消息以关键词开头）"),
        ("rightmost", "➡️ 最右匹配（消息以关键词结尾）"),
    ]
    btns = []
    for mode, label in modes:
        prefix = "✅ " if mode == current else "   "
        btns.append([InlineKeyboardButton(f"{prefix}{label}", callback_data=f"settings_set_kwmode_{mode}")])
    btns.append([InlineKeyboardButton("◀️ 返回设置中心", callback_data="menu_settings")])
    return InlineKeyboardMarkup(btns)


def settings_dedupe_keyboard(current: int) -> InlineKeyboardMarkup:
    """去重时间窗口选择菜单"""
    options = [
        (0, "❌ 不去重"), (3, "3分钟"), (5, "5分钟"), (10, "10分钟"),
        (30, "30分钟"), (60, "1小时"), (720, "12小时"),
        (1440, "1天"), (10080, "7天"), (43200, "30天"),
    ]
    btns = []
    row = []
    for val, label in options:
        prefix = "✅ " if val == current else ""
        row.append(InlineKeyboardButton(f"{prefix}{label}", callback_data=f"settings_set_dedupe_{val}"))
        if len(row) == 2:
            btns.append(row)
            row = []
    if row:
        btns.append(row)
    btns.append([InlineKeyboardButton("◀️ 返回设置中心", callback_data="menu_settings")])
    return InlineKeyboardMarkup(btns)


def settings_blacklist_keyboard(cfg: dict) -> InlineKeyboardMarkup:
    """黑名单关键词管理菜单"""
    bl_mode = cfg.get("blacklistMatchMode", "fuzzy")
    bkws = cfg.get("blacklistKeywords") or ""
    bkw_list = [k.strip() for k in bkws.replace("，", ",").split(",") if k.strip()]
    mode_label = "🔍 模糊" if bl_mode == "fuzzy" else "🎯 精确"
    btns = [
        [InlineKeyboardButton("➕ 设置黑名单关键词（逗号分隔）", callback_data="settings_set_blacklist_kws")],
        [InlineKeyboardButton(f"匹配模式：{mode_label} → 点击切换", callback_data="settings_toggle_blmode")],
    ]
    if bkw_list:
        preview = "、".join(bkw_list[:5])
        if len(bkw_list) > 5:
            preview += f"...等{len(bkw_list)}个"
        btns.append([InlineKeyboardButton(f"🗑 清空黑名单（当前：{preview}）", callback_data="settings_clear_blacklist")])
    btns.append([InlineKeyboardButton("◀️ 返回设置中心", callback_data="menu_settings")])
    return InlineKeyboardMarkup(btns)


def main_menu_text(s: dict) -> str:
    plan = PLAN_NAMES.get(s.get("planId", "free"), "免费版")
    kw = s.get("keywordCount", 0)
    kw_max = s.get("limits", {}).get("maxKeywords", 10)
    grp = s.get("groupCount", 0)
    dm = "✅ 已开启" if s.get("dmEnabled") else "❌ 已关闭"
    sender = f"📱 {s.get('senderPhone')}" if s.get("hasSenderAccount") else "⚠️ 未绑定私信账号"
    return (
        f"🤖 **TG Monitor Pro**\n\n"
        f"👤 套餐：**{plan}**\n"
        f"🔑 关键词：**{kw}/{kw_max}**\n"
        f"📢 推送群组：**{grp}** 个\n"
        f"📬 自动私信：{dm}\n"
        f"📱 私信账号：{sender}\n\n"
        f"请选择操作："
    )

# ─── /start ───────────────────────────────────────────────────────────────────

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    tg = update.effective_user
    msg = await update.message.reply_text("⏳ 正在初始化...")
    try:
        result = await api_post("engine.botAutoRegister", {
            "tgUserId": str(tg.id),
            "tgUsername": tg.username,
            "tgFirstName": tg.first_name,
            "tgLastName": tg.last_name,
        })
        logger.warning(f"[DEBUG cmd_start] tg.id={tg.id} username={tg.username} result={result}")
    except Exception as ex:
        logger.error(f"[DEBUG cmd_start] exception: {ex}", exc_info=True)
        result = None
    if not result:
        await msg.edit_text("❌ 服务暂时不可用，请稍后重试。")
        return
    uid = result["id"]
    context.user_data["user_id"] = uid
    is_new = result.get("isNew", False)
    if is_new:
        # 新用户显示专属欢迎引导页
        await msg.edit_text(
            "🎉 **欢迎使用 TG Monitor Pro！**\n\n"
            "🔍 本工具可帮您实时监控 Telegram 群组关键词，\n"
            "自动发现目标用户并发送私信。\n\n"
            "🚀 **快速开始：**\n"
            "1️⃣ 激活套餐（点击下方按鈕）\n"
            "2️⃣ 添加监控群组\n"
            "3️⃣ 设置关键词\n"
            "4️⃣ 绑定推送群组\n"
            "5️⃣ 开启自动私信\n\n"
            "💡 如有卡密，点击「🎟 激活套餐」即可开通高级功能。",
            reply_markup=InlineKeyboardMarkup([
                [{"text": "🎟 激活套餐", "callback_data": "menu_activate"}],
                [{"text": "🚀 进入主菜单", "callback_data": "menu_main"}],
            ]),
            parse_mode=ParseMode.MARKDOWN,
        )
    else:
        status = await api_get("engine.botGetUserStatus", {"userId": uid}) or {}
        await msg.edit_text(
            main_menu_text(status),
            reply_markup=main_menu_keyboard(),
            parse_mode=ParseMode.MARKDOWN,
        )

# ─── /help ────────────────────────────────────────────────────────────────────

async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "📖 **使用指南**\n\n"
        "**快捷命令：**\n"
        "`/kw 词1 词2` — 批量添加关键词\n"
        "`/template 内容` — 设置私信模板\n"
        "`/group 群组链接` — 添加监控群组\n"
        "`/stats` — 今日统计\n"
        "`/activate 卡密` — 激活套餐\n\n"
        "**模板变量：**\n"
        "`{username}` `{first_name}` `{keyword}` `{group}` `{message}`\n\n"
        "**自动私信流程：**\n"
        "1️⃣ 绑定私信账号（📱 私信账号）\n"
        "2️⃣ 设置私信模板（💬 私信模板）\n"
        "3️⃣ 添加关键词（📋 关键词管理）\n"
        "4️⃣ 添加监控群组（👥 监控群组）\n"
        "5️⃣ 开启自动私信（🔔 自动私信开关）",
        parse_mode=ParseMode.MARKDOWN,
    )

# ─── /kw ─────────────────────────────────────────────────────────────────────

async def cmd_kw(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = await ensure_user(update, context)
    if not uid:
        await update.message.reply_text("❌ 服务异常，请重试")
        return
    if not context.args:
        await update.message.reply_text(
            "📋 用法：`/kw 关键词1 关键词2 关键词3`",
            parse_mode=ParseMode.MARKDOWN,
        )
        return
    status = await api_get("engine.botGetUserStatus", {"userId": uid}) or {}
    current = status.get("keywordCount", 0)
    max_kw = status.get("limits", {}).get("maxKeywords", 10)
    remaining = max_kw - current
    if remaining <= 0:
        await update.message.reply_text(
            f"⚠️ 关键词已达上限（{current}/{max_kw}）\n请升级套餐：`/activate 卡密`",
            parse_mode=ParseMode.MARKDOWN,
        )
        return
    added = []
    duplicates = []
    for kw in context.args[:remaining]:
        r = await api_post("engine.botAddKeyword", {"userId": uid, "keyword": kw, "matchType": "contains"})
        if r and r.get("success"):
            added.append(kw)
        elif r and r.get("duplicate"):
            duplicates.append(kw)
    msg = (f"✅ 成功添加 {len(added)} 个关键词：\n" + "\n".join(f"  • `{k}`" for k in added)) if added else ""
    if duplicates:
        msg += ("\n\n" if msg else "") + f"⚠️ 以下关键词已存在（跳过）：\n" + "\n".join(f"  • `{k}`" for k in duplicates)
    if not msg:
        msg = "❌ 未添加任何关键词"
    if len(context.args) > remaining:
        msg += f"\n\n⚠️ 仅处理了 {remaining} 个（套餐限制）"
    await update.message.reply_text(msg, parse_mode=ParseMode.MARKDOWN)

# ─── /template ────────────────────────────────────────────────────────────────

async def cmd_template(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = await ensure_user(update, context)
    if not uid:
        await update.message.reply_text("❌ 服务异常，请重试")
        return
    if not context.args:
        tpls = await api_get("engine.botGetTemplates", {"userId": uid})
        if tpls:
            await update.message.reply_text(
                f"💬 **当前模板：**\n\n`{tpls[0]['content']}`\n\n"
                f"修改：`/template 新模板内容`",
                parse_mode=ParseMode.MARKDOWN,
            )
        else:
            await update.message.reply_text(
                "💬 用法：`/template 你好 {first_name}，我看到你在群里提到了{keyword}~`\n\n"
                "变量：`{username}` `{first_name}` `{keyword}` `{group}` `{message}`",
                parse_mode=ParseMode.MARKDOWN,
            )
        return
    content = " ".join(context.args)
    r = await api_post("engine.botSetTemplate", {"userId": uid, "content": content, "name": "Bot模板"})
    if r and r.get("success"):
        await update.message.reply_text(
            f"✅ 模板已{'更新' if not r.get('isNew') else '创建'}！\n\n`{content}`",
            parse_mode=ParseMode.MARKDOWN,
        )
    else:
        await update.message.reply_text("❌ 设置失败，请重试")


# ─── /listen ──────────────────────────────────────────────────────────────────

async def cmd_listen(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """/listen 命令：在群组中发送，将该群组绑定为推送目标"""
    chat = update.effective_chat
    # 只允许在群组中使用
    if chat.type not in ("group", "supergroup"):
        await update.message.reply_text(
            "📢 /listen 命令介绍：\n\n"
            "/listen 命令可以控制机器人将监听到的消息推送至您创建的私有群组中，方便多人协作共同处理监听到的消息。\n\n"
            "**如何设置推送至群组：**\n"
            "1️⃣ 新建群组（已有群组也可）\n"
            "2️⃣ 将本机器人拉进群组\n"
            "3️⃣ 在群组中发送 /listen，跟着机器人提示操作即可。\n\n"
            "我们强烈推荐您设置将消息推送到群组，点击下方按钮将机器人添加至群组 👇👇",
            parse_mode=ParseMode.MARKDOWN,
        )
        return
    uid = await ensure_user(update, context)
    if not uid:
        await update.message.reply_text("❌ 请先在私聊中发送 /start 注册账号")
        return
    chat_id = str(chat.id)
    chat_title = chat.title or chat_id
    r = await api_post("engine.botSetPushGroup", {
        "userId": uid,
        "collabChatId": chat_id,
        "collabChatTitle": chat_title,
    })
    if r and r.get("success"):
        await update.message.reply_text(
            f"✅ **推送群组绑定成功！**\n\n"
            f"📢 群组：**{chat_title}**\n"
            f"🔑 ID：`{chat_id}`\n\n"
            f"此后关键词命中时，消息将自动推送到此群组，方便多人协作处理。",
            parse_mode=ParseMode.MARKDOWN,
        )
    else:
        await update.message.reply_text("❌ 绑定失败，请确认已在私聊中发送过 /start")

# ─── /group ───────────────────────────────────────────────────────────────────

async def cmd_group(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = await ensure_user(update, context)
    if not uid:
        await update.message.reply_text("❌ 服务异常，请重试")
        return
    if not context.args:
        await update.message.reply_text(
            "👥 用法：`/group https://t.me/example` 或 `/group -1001234567890`",
            parse_mode=ParseMode.MARKDOWN,
        )
        return
    raw = context.args[0].strip()
    gid = raw.replace("https://t.me/", "@").replace("t.me/", "@") if "t.me/" in raw else raw
    r = await api_post("engine.botAddGroup", {"userId": uid, "groupId": gid, "groupTitle": gid})
    if r and r.get("success"):
        await update.message.reply_text(
            f"✅ 群组 `{gid}` {'已添加' if r.get('isNew') else '已重新激活'}！",
            parse_mode=ParseMode.MARKDOWN,
        )
    else:
        await update.message.reply_text("❌ 添加失败，请检查格式")

# ─── /stats ───────────────────────────────────────────────────────────────────

async def cmd_stats(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = await ensure_user(update, context)
    if not uid:
        await update.message.reply_text("❌ 服务异常，请重试")
        return
    s = await api_get("engine.botGetStats", {"userId": uid})
    if s:
        await update.message.reply_text(
            f"📊 **今日统计**\n\n"
            f"🎯 今日命中：**{s.get('todayHits', 0)}** 次\n"
            f"📬 今日私信：**{s.get('todayDm', 0)}** 条\n"
            f"📈 累计命中：**{s.get('totalHits', 0)}** 次",
            parse_mode=ParseMode.MARKDOWN,
        )
    else:
        await update.message.reply_text("❌ 获取统计失败")

# ─── /activate ────────────────────────────────────────────────────────────────

async def cmd_activate(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = await ensure_user(update, context)
    if not uid:
        await update.message.reply_text("❌ 服务异常，请重试")
        return
    if not context.args:
        await update.message.reply_text("🎫 用法：`/activate XXXX-XXXX-XXXX`", parse_mode=ParseMode.MARKDOWN)
        return
    r = await api_post("engine.botActivateCode", {"userId": uid, "code": context.args[0]})
    if r and r.get("success"):
        plan = PLAN_NAMES.get(r.get("planId", ""), "未知")
        exp = str(r.get("expiresAt", ""))[:10]
        await update.message.reply_text(
            f"🎉 **激活成功！**\n\n套餐：**{plan}**\n有效期至：{exp or '永久'}",
            parse_mode=ParseMode.MARKDOWN,
        )
    else:
        msg = r.get("message", "卡密无效") if r else "激活失败"
        await update.message.reply_text(f"❌ {msg}")

# ─── Callback Query ───────────────────────────────────────────────────────────

async def handle_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    data = q.data
    uid = await ensure_user(update, context)
    if not uid:
        await q.answer()
        await q.edit_message_text("❌ 服务异常，请重试")
        return

    # 主菜单
    if data == "menu_main":
        await q.answer()
        s = await api_get("engine.botGetUserStatus", {"userId": uid}) or {}
        await q.edit_message_text(main_menu_text(s), reply_markup=main_menu_keyboard(), parse_mode=ParseMode.MARKDOWN)

    # ── 关键词 ──
    elif data == "menu_keywords":
        await q.answer()
        s = await api_get("engine.botGetUserStatus", {"userId": uid}) or {}
        kw = s.get("keywordCount", 0)
        kw_max = s.get("limits", {}).get("maxKeywords", 10)
        await q.edit_message_text(
            f"📋 **关键词管理**\n\n当前：**{kw}/{kw_max}**\n\n快捷添加：`/kw 词1 词2`",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("➕ 添加关键词", callback_data="kw_add"),
                 InlineKeyboardButton("📃 查看列表", callback_data="kw_list")],
                [InlineKeyboardButton("🗑️ 删除关键词", callback_data="kw_delete_menu")],
                [InlineKeyboardButton("◀️ 返回", callback_data="menu_main")],
            ]),
            parse_mode=ParseMode.MARKDOWN,
        )

    elif data == "kw_add":
        await q.answer()
        context.user_data[STATE_KEY] = STATE_KEYWORD
        await q.edit_message_text(
            "📋 **添加关键词**\n\n请发送关键词（多个用空格或换行分隔）：",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("❌ 取消", callback_data="menu_keywords")]]),
            parse_mode=ParseMode.MARKDOWN,
        )

    elif data == "kw_list":
        await q.answer()
        kws = await api_get("engine.botGetKeywords", {"userId": uid}) or []
        if not kws:
            text = "📋 暂无关键词"
        else:
            text = f"📋 **关键词列表**（{len(kws)} 个）\n\n" + "\n".join(f"{i+1}. `{k['keyword']}`" for i, k in enumerate(kws))
        await q.edit_message_text(
            text,
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("➕ 添加", callback_data="kw_add"),
                 InlineKeyboardButton("🗑️ 删除", callback_data="kw_delete_menu")],
                [InlineKeyboardButton("◀️ 返回", callback_data="menu_keywords")],
            ]),
            parse_mode=ParseMode.MARKDOWN,
        )

    elif data == "kw_delete_menu":
        await q.answer()
        kws = await api_get("engine.botGetKeywords", {"userId": uid}) or []
        if not kws:
            await q.edit_message_text("暂无关键词", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("◀️ 返回", callback_data="menu_keywords")]]))
            return
        btns = [[InlineKeyboardButton(f"🗑️ {k['keyword']}", callback_data=f"kw_del_{k['id']}")] for k in kws]
        btns.append([InlineKeyboardButton("◀️ 返回", callback_data="menu_keywords")])
        await q.edit_message_text("🗑️ 选择要删除的关键词：", reply_markup=InlineKeyboardMarkup(btns), parse_mode=ParseMode.MARKDOWN)

    elif data.startswith("kw_del_"):
        kid = int(data[7:])
        r = await api_post("engine.botDeleteKeyword", {"userId": uid, "keywordId": kid})
        s = await api_get("engine.botGetUserStatus", {"userId": uid}) or {}
        kw = s.get("keywordCount", 0)
        kw_max = s.get("limits", {}).get("maxKeywords", 10)
        await q.edit_message_text(
            f"✅ 已删除\n\n📋 **关键词管理**\n\n当前：**{kw}/{kw_max}**",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("➕ 添加关键词", callback_data="kw_add"),
                 InlineKeyboardButton("📃 查看列表", callback_data="kw_list")],
                [InlineKeyboardButton("🗑️ 继续删除", callback_data="kw_delete_menu")],
                [InlineKeyboardButton("◀️ 返回", callback_data="menu_main")],
            ]),
            parse_mode=ParseMode.MARKDOWN,
        )

    # ── 推送群组 ──
    elif data == "menu_push_group":
        await q.answer()
        push_cfg = await api_get("engine.botGetPushGroup", {"userId": uid}) or {}
        collab_id = push_cfg.get("collabChatId")
        collab_title = push_cfg.get("collabChatTitle") or collab_id
        if collab_id:
            text = (
                f"📢 **推送群组**\n\n"
                f"✅ 当前推送群组：**{collab_title}**\n"
                f"ID: `{collab_id}`\n\n"
                f"命中消息将自动推送到该群组，方便多人协作处理。\n\n"
                f"如需更换，将 Bot 拉入新群组后在群内发送 `/listen`"
            )
            btns = [
                [InlineKeyboardButton("🗑️ 解除绑定", callback_data="push_group_unbind")],
                [InlineKeyboardButton("◀️ 返回", callback_data="menu_main")],
            ]
        else:
            text = (
                "📢 **推送群组**\n\n"
                "⚠️ 尚未绑定推送群组\n\n"
                "**如何设置推送至群组：**\n"
                "1️⃣ 新建群组（已有群组也可）\n"
                "2️⃣ 将本机器人拉进群组\n"
                "3️⃣ 在群组中发送 `/listen`，跟着机器人提示操作即可\n\n"
                "我们强烈推荐您设置将消息推送到群组，点击下方按钮将机器人添加至群组 👇👇"
            )
            btns = [
                [InlineKeyboardButton("◀️ 返回", callback_data="menu_main")],
            ]
        await q.edit_message_text(text, reply_markup=InlineKeyboardMarkup(btns), parse_mode=ParseMode.MARKDOWN)
    elif data == "push_group_unbind":
        await q.answer()
        await api_post("engine.botSetPushGroup", {"userId": uid, "collabChatId": None, "collabChatTitle": None})
        await q.edit_message_text(
            "✅ 已解除推送群组绑定\n\n命中消息将不再推送到群组。",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("◀️ 返回", callback_data="menu_push_group")]]),
            parse_mode=ParseMode.MARKDOWN,
        )
    # ── 私信模板 ──
    elif data == "menu_template":
        await q.answer()
        tpls = await api_get("engine.botGetTemplates", {"userId": uid}) or []
        if tpls:
            text = f"💬 **私信模板**\n\n当前模板：\n`{tpls[0]['content']}`"
            btns = [[InlineKeyboardButton("✏️ 修改模板", callback_data="template_set")],
                    [InlineKeyboardButton("◀️ 返回", callback_data="menu_main")]]
        else:
            text = "💬 **私信模板**\n\n⚠️ 尚未设置\n\n快捷设置：`/template 模板内容`"
            btns = [[InlineKeyboardButton("✏️ 设置模板", callback_data="template_set")],
                    [InlineKeyboardButton("◀️ 返回", callback_data="menu_main")]]
        await q.edit_message_text(text, reply_markup=InlineKeyboardMarkup(btns), parse_mode=ParseMode.MARKDOWN)

    elif data == "template_set":
        await q.answer()
        context.user_data[STATE_KEY] = STATE_TEMPLATE
        await q.edit_message_text(
            "💬 **设置私信模板**\n\n请发送模板内容：\n\n"
            "变量：`{username}` `{first_name}` `{keyword}` `{group}` `{message}`\n\n"
            "示例：`你好 {first_name}，看到你在 {group} 提到了{keyword}，想和你聊聊~`",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("❌ 取消", callback_data="menu_template")]]),
            parse_mode=ParseMode.MARKDOWN,
        )

    # ── 私信账号 ──
    elif data == "menu_sender":
        await q.answer()
        # 获取账号列表
        acc_result = await api_get("engine.botGetSenderAccounts", {"userId": uid})
        accounts = acc_result.get("accounts", []) if acc_result else []
        if accounts:
            status_map = {"active": "✅", "pending": "⏳", "expired": "⚠️", "banned": "❌"}
            acc_lines = []
            for acc in accounts:
                icon = status_map.get(acc.get("sessionStatus", ""), "❓")
                phone_display = acc.get("phone") or acc.get("tgUsername") or f"ID:{acc.get('id')}"
                health = acc.get("healthScore", 0)
                acc_lines.append(f"{icon} `{phone_display}` 健康:{health}")
            acc_text = "\n".join(acc_lines)
            text = f"📱 **私信账号管理**\n\n共 {len(accounts)} 个账号：\n{acc_text}\n\n选择操作："
            btns = []
            for acc in accounts:
                phone_display = acc.get("phone") or acc.get("tgUsername") or f"ID:{acc.get('id')}"
                btns.append([InlineKeyboardButton(f"🗑 删除 {phone_display}", callback_data=f"sender_del:{acc['id']}")])
            btns.append([InlineKeyboardButton("➕ 手机号添加", callback_data="sender_add_bot"),
                         InlineKeyboardButton("📋 Session导入", callback_data="sender_import_session")])
            if len(accounts) > 1:
                btns.append([InlineKeyboardButton("🗑 批量删除全部", callback_data="sender_del_all")])
            btns.append([InlineKeyboardButton("◀️ 返回主菜单", callback_data="menu_main")])
        else:
            text = "📱 **私信账号管理**\n\n⚠️ 未绑定私信账号，无法发送私信\n\n请添加账号："
            btns = [
                [InlineKeyboardButton("📱 手机号添加", callback_data="sender_add_bot"),
                 InlineKeyboardButton("📋 Session导入", callback_data="sender_import_session")],
                [InlineKeyboardButton("◀️ 返回主菜单", callback_data="menu_main")],
            ]
        await q.edit_message_text(text, reply_markup=InlineKeyboardMarkup(btns), parse_mode=ParseMode.MARKDOWN)
    elif data.startswith("sender_del:"):
        account_id = int(data.split(":")[1])
        r = await api_post("engine.botDeleteSenderAccount", {"userId": uid, "accountId": account_id})
        if r and r.get("success"):
            await q.answer("✅ 账号已删除", show_alert=True)
        else:
            await q.answer("❌ 删除失败，请重试", show_alert=True)
        # 刷新账号列表
        acc_result = await api_get("engine.botGetSenderAccounts", {"userId": uid})
        accounts = acc_result.get("accounts", []) if acc_result else []
        if accounts:
            status_map = {"active": "✅", "pending": "⏳", "expired": "⚠️", "banned": "❌"}
            acc_lines = []
            for acc in accounts:
                icon = status_map.get(acc.get("sessionStatus", ""), "❓")
                phone_display = acc.get("phone") or acc.get("tgUsername") or f"ID:{acc.get('id')}"
                health = acc.get("healthScore", 0)
                acc_lines.append(f"{icon} `{phone_display}` 健康:{health}")
            acc_text = "\n".join(acc_lines)
            text = f"📱 **私信账号管理**\n\n共 {len(accounts)} 个账号：\n{acc_text}\n\n选择操作："
            btns = []
            for acc in accounts:
                phone_display = acc.get("phone") or acc.get("tgUsername") or f"ID:{acc.get('id')}"
                btns.append([InlineKeyboardButton(f"🗑 删除 {phone_display}", callback_data=f"sender_del:{acc['id']}")])
            btns.append([InlineKeyboardButton("➕ 手机号添加", callback_data="sender_add_bot"),
                         InlineKeyboardButton("📋 Session导入", callback_data="sender_import_session")])
            if len(accounts) > 1:
                btns.append([InlineKeyboardButton("🗑 批量删除全部", callback_data="sender_del_all")])
            btns.append([InlineKeyboardButton("◀️ 返回主菜单", callback_data="menu_main")])
        else:
            text = "📱 **私信账号管理**\n\n✅ 账号已全部删除\n\n请添加账号："
            btns = [
                [InlineKeyboardButton("📱 手机号添加", callback_data="sender_add_bot"),
                 InlineKeyboardButton("📋 Session导入", callback_data="sender_import_session")],
                [InlineKeyboardButton("◀️ 返回主菜单", callback_data="menu_main")],
            ]
        await q.edit_message_text(text, reply_markup=InlineKeyboardMarkup(btns), parse_mode=ParseMode.MARKDOWN)

    elif data == "sender_del_all":
        await q.answer()
        acc_result = await api_get("engine.botGetSenderAccounts", {"userId": uid})
        accounts = acc_result.get("accounts", []) if acc_result else []
        fail_count = 0
        for acc in accounts:
            r = await api_post("engine.botDeleteSenderAccount", {"userId": uid, "accountId": acc["id"]})
            if not (r and r.get("success")):
                fail_count += 1
        if fail_count == 0:
            text = "📱 **私信账号管理**\n\n✅ 全部账号已删除\n\n请添加账号："
        else:
            text = f"📱 **私信账号管理**\n\n⚠️ {fail_count} 个账号删除失败\n\n请重试："
        btns = [
            [InlineKeyboardButton("📱 手机号添加", callback_data="sender_add_bot"),
             InlineKeyboardButton("📋 Session导入", callback_data="sender_import_session")],
            [InlineKeyboardButton("◀️ 返回主菜单", callback_data="menu_main")],
        ]
        await q.answer()
        await q.edit_message_text(text, reply_markup=InlineKeyboardMarkup(btns), parse_mode=ParseMode.MARKDOWN)

    elif data == "sender_import_session":
        await q.answer()
        context.user_data[STATE_KEY] = STATE_SENDER_SESSION
        await q.edit_message_text(
            "📋 **Session 导入**\n\n"
            "请直接发送 Session 字符串（通常以 `1BQA` 开头的长字符串）\n\n"
            "可选：在 Session 字符串后**换行**输入手机号（如 `+8613800000000`）\n\n"
            "⚠️ Session 字符串请妥善保管，勿泄露给他人",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("❌ 取消", callback_data="menu_sender")]]),
            parse_mode=ParseMode.MARKDOWN,
        )

    elif data == "sender_add_bot":
        await q.answer()
        # Bot 内添加账号：引导输入手机号
        context.user_data[STATE_KEY] = STATE_SENDER_PHONE
        await q.edit_message_text(
            "📱 **Bot 内添加私信账号**\n\n"
            "请输入手机号（含国家代码，如 +8613800138000）：",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("❌ 取消", callback_data="menu_sender")]]),
            parse_mode=ParseMode.MARKDOWN,
        )
    elif data == "sender_guide":
        await q.answer()
        await q.edit_message_text(
            "📱 **更换私信账号**\n\n"
            "请在 Web 管理后台 → TG账号管理 中删除旧账号并重新绑定：",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🌐 TG账号管理", url=f"{WEB_SITE_URL}/tg-accounts" if WEB_SITE_URL else "https://t.me")],
                [InlineKeyboardButton("◀️ 返回", callback_data="menu_sender")],
            ]),
            parse_mode=ParseMode.MARKDOWN,
        )

    # ── 统计 ──
    elif data == "menu_stats":
        await q.answer()
        s = await api_get("engine.botGetStats", {"userId": uid}) or {}
        await q.edit_message_text(
            f"📊 **统计数据**\n\n"
            f"🎯 今日命中：**{s.get('todayHits', 0)}** 次\n"
            f"📬 今日私信：**{s.get('todayDm', 0)}** 条\n"
            f"📈 累计命中：**{s.get('totalHits', 0)}** 次",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("◀️ 返回", callback_data="menu_main")]]),
            parse_mode=ParseMode.MARKDOWN,
        )

    # ── 套餐 ──
    elif data == "menu_plan":
        await q.answer()
        s = await api_get("engine.botGetUserStatus", {"userId": uid}) or {}
        plan = PLAN_NAMES.get(s.get("planId", "free"), "免费版")
        limits = s.get("limits", {})
        _raw_exp = s.get("planExpiresAt"); exp = str(_raw_exp)[:10] if _raw_exp else "永久有效"
        await q.edit_message_text(
            f"💎 **我的套餐**\n\n当前：**{plan}**\n有效期：{exp}\n\n"
            f"🔑 关键词：{s.get('keywordCount',0)}/{limits.get('maxKeywords',10)}\n"
            f"📬 每日私信：{s.get('dailyDmSent',0)}/{limits.get('maxDailyDm',5)}\n"
            f"📱 TG账号上限：{limits.get('maxTgAccounts',1)} 个\n\n"
            f"如需升级，请点击「🎟 激活套餐」按鈕输入卡密。",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🎟 激活套餐", callback_data="menu_activate")],
                [InlineKeyboardButton("◀️ 返回", callback_data="menu_main")],
            ]),
            parse_mode=ParseMode.MARKDOWN,
        )

    # ── 激活套餐 ──
    elif data == "menu_activate":
        await q.answer()
        context.user_data[STATE_KEY] = STATE_ACTIVATE
        await q.edit_message_text(
            "🎟 **激活套餐**\n\n请直接发送卡密（格式：XXXX-XXXX-XXXX）：",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("❌ 取消", callback_data="menu_main")]]),
            parse_mode=ParseMode.MARKDOWN,
        )

    # ── 自动私信开关 ──
    elif data == "menu_dm_toggle":
        await q.answer()
        s = await api_get("engine.botGetUserStatus", {"userId": uid}) or {}
        current = s.get("dmEnabled", False)
        new_val = not current
        r = await api_post("engine.botSetDmEnabled", {"userId": uid, "enabled": new_val})
        state_text = "✅ 已开启" if new_val else "❌ 已关闭"
        tip = "系统将在关键词命中时自动发送私信。\n\n⚠️ 请确保已绑定私信账号并设置消息模板！" if new_val else "系统将不再自动发送私信，但仍会记录命中。"
        await q.edit_message_text(
            f"🔔 **自动私信{state_text}**\n\n{tip}",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("◀️ 返回主菜单", callback_data="menu_main")]]),
            parse_mode=ParseMode.MARKDOWN,
        )

    # ── 命中记录操作（推送消息按鈕）──
    elif data.startswith("dm:"):
        parts = data.split(":")
        sender_tg_id_str = parts[2] if len(parts) > 2 else "0"
        await q.answer()
        try:
            # 发送临时纯文本超链接消息，tg://openmessage 在纯文本链接中可被客户端识别
            import asyncio as _asyncio
            msg = await context.bot.send_message(
                chat_id=q.message.chat_id,
                text=f'<a href="tg://openmessage?user_id={sender_tg_id_str}">💬 点击此处打开私信</a>（3秒后自动消失）',
                parse_mode="HTML",
            )
            # 3秒后自动删除
            async def _delete_later(m):
                await _asyncio.sleep(3)
                try:
                    await m.delete()
                except Exception:
                    pass
            _asyncio.create_task(_delete_later(msg))
        except Exception as e:
            logger.warning(f"dm handler error: {e}")
    elif data.startswith("history:"):
        parts = data.split(":")
        sender_tg_id_str = parts[2] if len(parts) > 2 else "0"
        records = await api_get("engine.botGetSenderHistory", {"userId": uid, "senderTgId": sender_tg_id_str, "limit": 10}) or []
        if not records:
            await q.answer("该用户暂无命中记录", show_alert=True)
        else:
            # 统计关键词出现次数，仿截图格式：最近搜索：关键词1(N) 关键词2(M)
            kw_count: dict = {}
            for r in records:
                kw = r.get("matchedKeyword", "") or r.get("keyword", "")
                if kw:
                    for k in kw.split(","):
                        k = k.strip()
                        if k:
                            kw_count[k] = kw_count.get(k, 0) + 1
            recent_str = " ".join(f"{k}({v})" for k, v in list(kw_count.items())[:6])
            await q.answer(f"最近搜索：{recent_str}" if recent_str else "暂无命中记录", show_alert=True)
    elif data.startswith("block:"):
        parts = data.split(":")
        sender_tg_id_str = parts[2] if len(parts) > 2 else "0"
        # parts[3] 是命中记录所属用户的系统ID（由 main.py 写入），优先使用
        owner_uid = int(parts[3]) if len(parts) > 3 and parts[3].isdigit() else uid
        try:
            result = await api_post("engine.botBlockUser", {"userId": owner_uid, "targetTgId": sender_tg_id_str})
            if result and result.get("success"):
                await q.answer(f"🚫 已屏蔽用户 {sender_tg_id_str}", show_alert=True)
            else:
                await q.answer("❌ 屏蔽失败，请重试", show_alert=True)
        except Exception as e:
            await q.answer(f"❌ 操作失败: {e}", show_alert=True)
    elif data.startswith("done:"):
        parts = data.split(":")
        hit_id_str = parts[1] if len(parts) > 1 else "0"
        try:
            hit_id = int(hit_id_str)
            result = await api_post("engine.botMarkProcessed", {"hitRecordId": hit_id, "userId": uid})
            if result and result.get("success"):
                await q.answer("✅ 已标记为已处理", show_alert=False)
                try:
                    original_markup = q.message.reply_markup
                    if original_markup:
                        new_rows = []
                        for row in original_markup.inline_keyboard:
                            new_row = [btn for btn in row if getattr(btn, "callback_data", None) != data]
                            if new_row:
                                new_rows.append(new_row)
                        await q.edit_message_reply_markup(reply_markup=InlineKeyboardMarkup(new_rows))
                except Exception:
                    pass
            else:
                await q.answer("❌ 操作失败，请重试", show_alert=True)
        except Exception as e:
            await q.answer(f"❌ 操作失败: {e}", show_alert=True)
    elif data.startswith("delete:"):
        parts = data.split(":")
        hit_id_str = parts[1] if len(parts) > 1 else "0"
        try:
            hit_id = int(hit_id_str)
            result = await api_post("engine.botDeleteHit", {"hitRecordId": hit_id, "userId": uid})
            if result and result.get("success"):
                await q.answer("🗑️ 记录已删除", show_alert=False)
                try:
                    await q.message.delete()
                except Exception:
                    await q.edit_message_reply_markup(reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🗑️ 已删除", callback_data="noop")]]))
            else:
                await q.answer("❌ 删除失败，请重试", show_alert=True)
        except Exception as e:
            await q.answer(f"❌ 操作失败: {e}", show_alert=True)
    elif data.startswith("dm_user:"):
        # 私聊按鈕：弹窗显示用户名和私聊链接
        parts = data.split(":")
        rid_str = parts[1] if len(parts) > 1 else "0"
        sender_tg_id_str = parts[2] if len(parts) > 2 else "0"
        uname = parts[3] if len(parts) > 3 else ""

        # 如果 callback_data 中没有 username，尝试从数据库查询
        if not uname and rid_str != "0":
            try:
                hit = await api_get("engine.botGetHitById", {"hitRecordId": int(rid_str), "userId": uid})
                if hit:
                    uname = hit.get("senderUsername") or ""
            except Exception:
                pass

        if uname:
            tg_url = f"https://t.me/{uname}"
            await q.answer(
                f"用户：@{uname}\n点击下方按鈕开始私聊",
                show_alert=True
            )
            # 发送一条带跳转链接的消息
            try:
                await context.bot.send_message(
                    chat_id=q.message.chat_id,
                    text=f"💬 私聊用户 @{uname}",
                    reply_markup=InlineKeyboardMarkup([
                        [InlineKeyboardButton(f"💬 开始私聊 @{uname}", url=tg_url)]
                    ])
                )
            except Exception:
                pass
        else:
            # 没有 username，尝试用数字 ID 构造链接
            tg_url = f"https://t.me/+{sender_tg_id_str}"
            await q.answer(
                f"该用户未设置用户名\nID: {sender_tg_id_str}",
                show_alert=True
            )
            try:
                await context.bot.send_message(
                    chat_id=q.message.chat_id,
                    text=f"💬 私聊用户 ID:{sender_tg_id_str}",
                    reply_markup=InlineKeyboardMarkup([
                        [InlineKeyboardButton(f"💬 尝试私聊", url=tg_url)]
                    ])
                )
            except Exception:
                pass
    elif data == "menu_expiry":
        await q.answer()
        s = await api_get("engine.botGetUserStatus", {"userId": uid}) or {}
        plan = PLAN_NAMES.get(s.get("planId", "free"), "免费版")
        _raw_exp = s.get("planExpiresAt"); exp = str(_raw_exp)[:10] if _raw_exp else "永久有效"
        await q.edit_message_text(
            f"⏰ **套餐到期时间**\n\n当前套餐：**{plan}**\n到期时间：**{exp}**\n\n"
            f"如需续费或升级，请点击「🎟 激活套餐」输入卡密。",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🎟 激活套餐", callback_data="menu_activate")],
                [InlineKeyboardButton("◀️ 返回", callback_data="menu_main")],
            ]),
            parse_mode=ParseMode.MARKDOWN,
        )
    # ── 使用教程 ──
    elif data == "menu_tutorial":
        await q.answer()
        cfg = await api_get("engine.botGetSysConfig", {}) or {}
        tutorial = cfg.get("tutorial_text") or (
            "📖 **使用教程**\n\n"
            "1️⃣ **添加监控账号**\n   前往网站 TG账号 页面添加\n\n"
            "2️⃣ **设置关键词**\n   点击「关键词管理」添加要监控的词\n\n"
            "3️⃣ **添加监控群组**\n   前往网站 监控群组 页面添加\n\n"
            "4️⃣ **绑定推送群组**\n   将Bot拉入群组，发送 /listen 绑定\n\n"
            "5️⃣ **开启自动私信**\n   绑定私信账号并设置模板后开启"
        )
        await q.edit_message_text(
            tutorial,
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("◀️ 返回", callback_data="menu_main")]]),
            parse_mode=ParseMode.MARKDOWN,
        )
    # ── 技术支持 ──
    elif data == "menu_support":
        await q.answer()
        cfg = await api_get("engine.botGetSysConfig", {}) or {}
        support_username = cfg.get("support_username", "")
        if support_username:
            text = f"💬 **技术支持**\n\n如有问题，请联系客服：\n👉 @{support_username}"
            btns = [
                [InlineKeyboardButton(f"💬 联系客服 @{support_username}", url=f"https://t.me/{support_username}")],
                [InlineKeyboardButton("◀️ 返回", callback_data="menu_main")],
            ]
        else:
            text = "💬 **技术支持**\n\n客服账号暂未配置，请稍后再试。"
            btns = [[InlineKeyboardButton("◀️ 返回", callback_data="menu_main")]]
        await q.edit_message_text(text, reply_markup=InlineKeyboardMarkup(btns), parse_mode=ParseMode.MARKDOWN)
    # ── 官方频道 ──
    elif data == "menu_channel":
        await q.answer()
        cfg = await api_get("engine.botGetSysConfig", {}) or {}
        channel_url = cfg.get("official_channel", "")
        if channel_url:
            text = f"📢 **官方频道**\n\n点击下方按钮加入官方频道，获取最新公告和更新。"
            btns = [
                [InlineKeyboardButton("📢 加入官方频道", url=channel_url)],
                [InlineKeyboardButton("◀️ 返回", callback_data="menu_main")],
            ]
        else:
            text = "📢 **官方频道**\n\n官方频道暂未配置，请稍后再试。"
            btns = [[InlineKeyboardButton("◀️ 返回", callback_data="menu_main")]]
        await q.edit_message_text(text, reply_markup=InlineKeyboardMarkup(btns), parse_mode=ParseMode.MARKDOWN)
    # ─────────────────────────────────────────────────────────────────────────
    # ── 方案A：设置中心 ──────────────────────────────────────────────────────
    # ─────────────────────────────────────────────────────────────────────────
    # ─────────────────────────────────────────────────────────────────────────
    # ── 方案A：设置中心 ──────────────────────────────────────────────────────
    # ─────────────────────────────────────────────────────────────────────────
    elif data == "menu_settings":
        await q.answer()
        cfg = await api_get("engine.botGetPushSettings", {"userId": uid}) or {}
        text = (
            "\u2699\ufe0f **\u8bbe\u7f6e\u4e2d\u5fc3**\n\n"
            "\u5728\u8fd9\u91cc\u914d\u7f6e\u60a8\u7684\u76d1\u63a7\u63a8\u9001\u53c2\u6570\uff1a\n\n"
            "\U0001f511 **\u5339\u914d\u6a21\u5f0f** \u2014 \u63a7\u5236\u5173\u952e\u8bcd\u5982\u4f55\u5339\u914d\u6d88\u606f\n"
            "\U0001f6ab **\u9ed1\u540d\u5355\u5173\u952e\u8bcd** \u2014 \u547d\u4e2d\u540e\u8df3\u8fc7\u63a8\u9001\n"
            "\u23f1 **\u53bb\u91cd\u7a97\u53e3** \u2014 \u540c\u4e00\u53d1\u9001\u8005\u7684\u6d88\u606f\u53bb\u91cd\u65f6\u95f4\n"
            "\u2705/\u274c **\u5f00\u5173\u9879** \u2014 \u5404\u7c7b\u8fc7\u6ee4\u6761\u4ef6\n\n"
            "\u70b9\u51fb\u4e0b\u65b9\u6309\u9215\u8fdb\u884c\u914d\u7f6e\uff1a"
        )
        await q.edit_message_text(
            text,
            reply_markup=settings_menu_keyboard(cfg),
            parse_mode=ParseMode.MARKDOWN,
        )
    # ── 设置中心：关键词匹配模式 ──
    elif data == "settings_kw_mode":
        await q.answer()
        cfg = await api_get("engine.botGetPushSettings", {"userId": uid}) or {}
        current = cfg.get("keywordMatchMode", "fuzzy")
        text = (
            "\U0001f511 **\u5173\u952e\u8bcd\u5339\u914d\u6a21\u5f0f**\n\n"
            "\u9009\u62e9\u5173\u952e\u8bcd\u5982\u4f55\u4e0e\u6d88\u606f\u5185\u5bb9\u8fdb\u884c\u5339\u914d\uff1a\n\n"
            "\U0001f50d \u6a21\u7cca\u5339\u914d \u2014 \u6d88\u606f\u4e2d\u5305\u542b\u5173\u952e\u8bcd\u5373\u547d\u4e2d\uff08\u9ed8\u8ba4\uff09\n"
            "\U0001f3af \u7cbe\u786e\u5339\u914d \u2014 \u5173\u952e\u8bcd\u4f5c\u4e3a\u5b8c\u6574\u8bcd\u51fa\u73b0\u624d\u547d\u4e2d\n"
            "\u2b05\ufe0f \u6700\u5de6\u5339\u914d \u2014 \u6d88\u606f\u4ee5\u5173\u952e\u8bcd\u5f00\u5934\u624d\u547d\u4e2d\n"
            "\u27a1\ufe0f \u6700\u53f3\u5339\u914d \u2014 \u6d88\u606f\u4ee5\u5173\u952e\u8bcd\u7ed3\u5c3e\u624d\u547d\u4e2d"
        )
        await q.edit_message_text(
            text,
            reply_markup=settings_kw_mode_keyboard(current),
            parse_mode=ParseMode.MARKDOWN,
        )
    elif data.startswith("settings_set_kwmode_"):
        mode = data.replace("settings_set_kwmode_", "")
        if mode in ("fuzzy", "exact", "leftmost", "rightmost"):
            await api_post("engine.botSavePushSettings", {"userId": uid, "keywordMatchMode": mode})
            await q.answer("\u2705 \u5339\u914d\u6a21\u5f0f\u5df2\u66f4\u65b0")
            cfg = await api_get("engine.botGetPushSettings", {"userId": uid}) or {}
            await q.edit_message_text(
                "\u2699\ufe0f **\u8bbe\u7f6e\u4e2d\u5fc3**\n\n\u914d\u7f6e\u5df2\u4fdd\u5b58\uff0c\u70b9\u51fb\u4e0b\u65b9\u6309\u9215\u7ee7\u7eed\u914d\u7f6e\uff1a",
                reply_markup=settings_menu_keyboard(cfg),
                parse_mode=ParseMode.MARKDOWN,
            )
        else:
            await q.answer("\u274c \u65e0\u6548\u7684\u5339\u914d\u6a21\u5f0f")
    # ── 设置中心：去重时间窗口 ──
    elif data == "settings_dedupe":
        await q.answer()
        cfg = await api_get("engine.botGetPushSettings", {"userId": uid}) or {}
        current = cfg.get("dedupeMinutes", 0)
        text = (
            "\u23f1 **\u53bb\u91cd\u65f6\u95f4\u7a97\u53e3**\n\n"
            "\u8bbe\u7f6e\u540c\u4e00\u53d1\u9001\u8005\u7684\u6d88\u606f\u53bb\u91cd\u65f6\u95f4\uff1a\n\n"
            "\u5728\u7a97\u53e3\u65f6\u95f4\u5185\uff0c\u540c\u4e00\u53d1\u9001\u8005\u7684\u6d88\u606f\u53ea\u63a8\u9001\u4e00\u6b21\uff0c\n"
            "\u907f\u514d\u540c\u4e00\u4eba\u7684\u91cd\u590d\u6d88\u606f\u5237\u5c4f\u3002\n\n"
            "\u9009\u62e9\u53bb\u91cd\u65f6\u95f4\uff1a"
        )
        await q.edit_message_text(
            text,
            reply_markup=settings_dedupe_keyboard(current),
            parse_mode=ParseMode.MARKDOWN,
        )
    elif data.startswith("settings_set_dedupe_"):
        try:
            val = int(data.replace("settings_set_dedupe_", ""))
            await api_post("engine.botSavePushSettings", {"userId": uid, "dedupeMinutes": val})
            label = {0: "\u4e0d\u53bb\u91cd", 3: "3\u5206\u949f", 5: "5\u5206\u949f", 10: "10\u5206\u949f", 30: "30\u5206\u949f",
                     60: "1\u5c0f\u65f6", 720: "12\u5c0f\u65f6", 1440: "1\u5929", 10080: "7\u5929", 43200: "30\u5929"}.get(val, f"{val}\u5206\u949f")
            await q.answer(f"\u2705 \u53bb\u91cd\u7a97\u53e3\u5df2\u8bbe\u4e3a\uff1a{label}")
            cfg = await api_get("engine.botGetPushSettings", {"userId": uid}) or {}
            await q.edit_message_text(
                "\u2699\ufe0f **\u8bbe\u7f6e\u4e2d\u5fc3**\n\n\u914d\u7f6e\u5df2\u4fdd\u5b58\uff0c\u70b9\u51fb\u4e0b\u65b9\u6309\u9215\u7ee7\u7eed\u914d\u7f6e\uff1a",
                reply_markup=settings_menu_keyboard(cfg),
                parse_mode=ParseMode.MARKDOWN,
            )
        except ValueError:
            await q.answer("\u274c \u65e0\u6548\u7684\u53bb\u91cd\u65f6\u95f4")
    # ── 设置中心：黑名单关键词 ──
    elif data == "settings_blacklist":
        await q.answer()
        cfg = await api_get("engine.botGetPushSettings", {"userId": uid}) or {}
        text = (
            "\U0001f6ab **\u9ed1\u540d\u5355\u5173\u952e\u8bcd**\n\n"
            "\u8bbe\u7f6e\u9ed1\u540d\u5355\u5173\u952e\u8bcd\u540e\uff0c\u6d88\u606f\u4e2d\u5305\u542b\u8fd9\u4e9b\u8bcd\u65f6\u5c06\u8df3\u8fc7\u63a8\u9001\u3002\n\n"
            "**\u4f7f\u7528\u573a\u666f\uff1a** \u8fc7\u6ee4\u5e7f\u544a\u8bcd\u3001\u65e0\u5173\u5185\u5bb9\u7b49\n"
            "**\u683c\u5f0f\uff1a** \u591a\u4e2a\u5173\u952e\u8bcd\u7528\u9017\u53f7\u5206\u9694\uff0c\u5982\uff1a\u5e7f\u544a,\u63a8\u5e7f,\u4f18\u60e0\n\n"
            "\u70b9\u51fb\u4e0b\u65b9\u6309\u9215\u8fdb\u884c\u8bbe\u7f6e\uff1a"
        )
        await q.edit_message_text(
            text,
            reply_markup=settings_blacklist_keyboard(cfg),
            parse_mode=ParseMode.MARKDOWN,
        )
    elif data == "settings_set_blacklist_kws":
        await q.answer()
        context.user_data[STATE_KEY] = STATE_BLACKLIST_KWS
        text = (
            "\U0001f6ab **\u8bbe\u7f6e\u9ed1\u540d\u5355\u5173\u952e\u8bcd**\n\n"
            "\u8bf7\u53d1\u9001\u9ed1\u540d\u5355\u5173\u952e\u8bcd\uff0c\u591a\u4e2a\u5173\u952e\u8bcd\u7528\u9017\u53f7\u5206\u9694\uff1a\n\n"
            "\u4f8b\u5982\uff1a`\u5e7f\u544a,\u63a8\u5e7f,\u4f18\u60e0,\u62db\u52df`\n\n"
            "\u26a0\ufe0f \u53d1\u9001\u540e\u5c06\u66ff\u6362\u73b0\u6709\u9ed1\u540d\u5355"
        )
        await q.edit_message_text(
            text,
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("\u274c \u53d6\u6d88", callback_data="settings_blacklist")]]),
            parse_mode=ParseMode.MARKDOWN,
        )
    elif data == "settings_toggle_blmode":
        cfg = await api_get("engine.botGetPushSettings", {"userId": uid}) or {}
        current_mode = cfg.get("blacklistMatchMode", "fuzzy")
        new_mode = "exact" if current_mode == "fuzzy" else "fuzzy"
        await api_post("engine.botSavePushSettings", {"userId": uid, "blacklistMatchMode": new_mode})
        mode_name = "\u7cbe\u786e" if new_mode == "exact" else "\u6a21\u7cca"
        await q.answer(f"\u2705 \u9ed1\u540d\u5355\u5339\u914d\u6a21\u5f0f\u5df2\u5207\u6362\u4e3a\uff1a{mode_name}")
        cfg = await api_get("engine.botGetPushSettings", {"userId": uid}) or {}
        await q.edit_message_text(
            "\U0001f6ab **\u9ed1\u540d\u5355\u5173\u952e\u8bcd**\n\n\u70b9\u51fb\u4e0b\u65b9\u6309\u9215\u8fdb\u884c\u8bbe\u7f6e\uff1a",
            reply_markup=settings_blacklist_keyboard(cfg),
            parse_mode=ParseMode.MARKDOWN,
        )
    elif data == "settings_clear_blacklist":
        await api_post("engine.botSavePushSettings", {"userId": uid, "blacklistKeywords": None})
        await q.answer("\u2705 \u9ed1\u540d\u5355\u5df2\u6e05\u7a7a")
        cfg = await api_get("engine.botGetPushSettings", {"userId": uid}) or {}
        await q.edit_message_text(
            "\U0001f6ab **\u9ed1\u540d\u5355\u5173\u952e\u8bcd**\n\n\u70b9\u51fb\u4e0b\u65b9\u6309\u9215\u8fdb\u884c\u8bbe\u7f6e\uff1a",
            reply_markup=settings_blacklist_keyboard(cfg),
            parse_mode=ParseMode.MARKDOWN,
        )
    # ── 设置中心：开关类设置 ──
    elif data == "settings_toggle_filterAds":
        cfg = await api_get("engine.botGetPushSettings", {"userId": uid}) or {}
        new_val = not cfg.get("filterAds", False)
        await api_post("engine.botSavePushSettings", {"userId": uid, "filterAds": new_val})
        status = "\u5df2\u5f00\u542f" if new_val else "\u5df2\u5173\u95ed"
        await q.answer(f"\u2705 {status} \u8fc7\u6ee4\u5e7f\u544a\u6d88\u606f")
        cfg = await api_get("engine.botGetPushSettings", {"userId": uid}) or {}
        await q.edit_message_text(
            "\u2699\ufe0f **\u8bbe\u7f6e\u4e2d\u5fc3**\n\n\u914d\u7f6e\u5df2\u4fdd\u5b58\uff0c\u70b9\u51fb\u4e0b\u65b9\u6309\u9215\u7ee7\u7eed\u914d\u7f6e\uff1a",
            reply_markup=settings_menu_keyboard(cfg),
            parse_mode=ParseMode.MARKDOWN,
        )
    elif data == "settings_toggle_filterBots":
        cfg = await api_get("engine.botGetPushSettings", {"userId": uid}) or {}
        new_val = not cfg.get("filterBots", False)
        await api_post("engine.botSavePushSettings", {"userId": uid, "filterBots": new_val})
        status = "\u5df2\u5f00\u542f" if new_val else "\u5df2\u5173\u95ed"
        await q.answer(f"\u2705 {status} \u8fc7\u6ee4\u673a\u5668\u4eba\u6d88\u606f")
        cfg = await api_get("engine.botGetPushSettings", {"userId": uid}) or {}
        await q.edit_message_text(
            "\u2699\ufe0f **\u8bbe\u7f6e\u4e2d\u5fc3**\n\n\u914d\u7f6e\u5df2\u4fdd\u5b58\uff0c\u70b9\u51fb\u4e0b\u65b9\u6309\u9215\u7ee7\u7eed\u914d\u7f6e\uff1a",
            reply_markup=settings_menu_keyboard(cfg),
            parse_mode=ParseMode.MARKDOWN,
        )
    elif data == "settings_toggle_mediaOnly":
        cfg = await api_get("engine.botGetPushSettings", {"userId": uid}) or {}
        new_val = not cfg.get("mediaOnly", False)
        await api_post("engine.botSavePushSettings", {"userId": uid, "mediaOnly": new_val})
        status = "\u5df2\u5f00\u542f" if new_val else "\u5df2\u5173\u95ed"
        await q.answer(f"\u2705 {status} \u4ec5\u63a8\u9001\u542b\u5a92\u4f53\u6d88\u606f")
        cfg = await api_get("engine.botGetPushSettings", {"userId": uid}) or {}
        await q.edit_message_text(
            "\u2699\ufe0f **\u8bbe\u7f6e\u4e2d\u5fc3**\n\n\u914d\u7f6e\u5df2\u4fdd\u5b58\uff0c\u70b9\u51fb\u4e0b\u65b9\u6309\u9215\u7ee7\u7eed\u914d\u7f6e\uff1a",
            reply_markup=settings_menu_keyboard(cfg),
            parse_mode=ParseMode.MARKDOWN,
        )
    elif data == "settings_toggle_includeHistory":
        cfg = await api_get("engine.botGetPushSettings", {"userId": uid}) or {}
        new_val = not cfg.get("includeSearchHistory", False)
        await api_post("engine.botSavePushSettings", {"userId": uid, "includeSearchHistory": new_val})
        status = "\u5df2\u5f00\u542f" if new_val else "\u5df2\u5173\u95ed"
        await q.answer(f"\u2705 {status} \u5305\u542b7\u65e5\u641c\u7d22\u5386\u53f2")
        cfg = await api_get("engine.botGetPushSettings", {"userId": uid}) or {}
        await q.edit_message_text(
            "\u2699\ufe0f **\u8bbe\u7f6e\u4e2d\u5fc3**\n\n\u914d\u7f6e\u5df2\u4fdd\u5b58\uff0c\u70b9\u51fb\u4e0b\u65b9\u6309\u9215\u7ee7\u7eed\u914d\u7f6e\uff1a",
            reply_markup=settings_menu_keyboard(cfg),
            parse_mode=ParseMode.MARKDOWN,
        )
    # ── 方案A：常见问题（FAQ）──
    elif data == "menu_faq":
        await q.answer()
        cfg = await api_get("engine.botGetSysConfig", {}) or {}
        faq_text = cfg.get("faq_text") or (
            "\u2753 **\u5e38\u89c1\u95ee\u9898**\n\n"
            "**Q1\uff1a\u5982\u4f55\u5f00\u59cb\u4f7f\u7528\uff1f**\n"
            "A\uff1a\u6fc0\u6d3b\u5957\u9910 \u2192 \u6dfb\u52a0\u5173\u952e\u8bcd \u2192 \u7ed1\u5b9a\u63a8\u9001\u7fa4\u7ec4\uff0c\u5373\u53ef\u5f00\u59cb\u76d1\u63a7\u3002\n\n"
            "**Q2\uff1a\u5173\u952e\u8bcd\u5982\u4f55\u8bbe\u7f6e\uff1f**\n"
            "A\uff1a\u70b9\u51fb\u300c\u5173\u952e\u8bcd\u7ba1\u7406\u300d\u6dfb\u52a0\u8981\u76d1\u63a7\u7684\u8bcd\uff0c\u652f\u6301\u6a21\u7cca/\u7cbe\u786e/\u6700\u5de6/\u6700\u53f3\u5339\u914d\u3002\n\n"
            "**Q3\uff1a\u63a8\u9001\u5230\u54ea\u91cc\uff1f**\n"
            "A\uff1a\u9ed8\u8ba4\u63a8\u9001\u5230\u60a8\u7684Bot\u79c1\u804a\uff0c\u4e5f\u53ef\u7ed1\u5b9a\u63a8\u9001\u7fa4\u7ec4\uff08/listen \u547d\u4ee4\uff09\u3002\n\n"
            "**Q4\uff1a\u4ec0\u4e48\u662f\u9ed1\u540d\u5355\u5173\u952e\u8bcd\uff1f**\n"
            "A\uff1a\u6d88\u606f\u4e2d\u5305\u542b\u9ed1\u540d\u5355\u8bcd\u65f6\u8df3\u8fc7\u63a8\u9001\uff0c\u7528\u4e8e\u8fc7\u6ee4\u5e7f\u544a\u7b49\u65e0\u5173\u5185\u5bb9\u3002\n\n"
            "**Q5\uff1a\u53bb\u91cd\u7a97\u53e3\u662f\u4ec0\u4e48\uff1f**\n"
            "A\uff1a\u540c\u4e00\u53d1\u9001\u8005\u5728\u8bbe\u5b9a\u65f6\u95f4\u5185\u7684\u6d88\u606f\u53ea\u63a8\u9001\u4e00\u6b21\uff0c\u907f\u514d\u5237\u5c4f\u3002\n\n"
            "**Q6\uff1a\u5957\u9910\u5230\u671f\u540e\u600e\u4e48\u529e\uff1f**\n"
            "A\uff1a\u70b9\u51fb\u300c\u6fc0\u6d3b\u5957\u9910\u300d\u8f93\u5165\u65b0\u5361\u5bc6\u5373\u53ef\u7eed\u671f\uff0c\u6570\u636e\u4e0d\u4f1a\u4e22\u5931\u3002\n\n"
            "**Q7\uff1a\u5982\u4f55\u8054\u7cfb\u5ba2\u670d\uff1f**\n"
            "A\uff1a\u70b9\u51fb\u300c\u8054\u7cfb\u5ba2\u670d\u300d\u6309\u9215\uff0c\u6216\u5728\u8bbe\u7f6e\u4e2d\u67e5\u770b\u5ba2\u670d\u8054\u7cfb\u65b9\u5f0f\u3002"
        )
        await q.edit_message_text(
            faq_text,
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("\u25c0\ufe0f \u8fd4\u56de\u4e3b\u83dc\u5355", callback_data="menu_main")]]),
            parse_mode=ParseMode.MARKDOWN,
        )
    elif data == "menu_profile":
        await q.answer()
        uid = await ensure_user(update, context)
        if not uid:
            await q.edit_message_text("❌ 服务异常，请重试")
            return
        status = await api_get("engine.botGetEmailStatus", {"userId": uid}) or {}
        has_email = status.get("hasEmail", False)
        email = status.get("email", "")
        if has_email:
            text = (
                f"👤 **个人中心**\n\n"
                f"📧 已绑定邮箱：`{email}`\n\n"
                f"您可以使用此邮箱登录管理后台。\n"
                f"如需重置密码，点击下方按钮，系统将生成新的6位数密码。"
            )
            btns = [
                [InlineKeyboardButton("🌐 登录管理后台", url="https://tg.luxurvs.com")],
                [InlineKeyboardButton("🔑 重置登录密码", callback_data="profile_reset_password")],
                [InlineKeyboardButton("📧 更换邮箱", callback_data="profile_set_email")],
                [InlineKeyboardButton("◀️ 返回主菜单", callback_data="menu_main")],
            ]
        else:
            text = (
                "👤 **个人中心**\n\n"
                "您尚未绑定邮箱。\n\n"
                "绑定邮箱后，系统将为您生成一个6位数登录密码，\n"
                "您可以使用邮箱+密码登录管理后台进行更多操作。"
            )
            btns = [
                [InlineKeyboardButton("📧 绑定邮箱", callback_data="profile_set_email")],
                [InlineKeyboardButton("🌐 管理后台", url="https://tg.luxurvs.com")],
                [InlineKeyboardButton("◀️ 返回主菜单", callback_data="menu_main")],
            ]
        await q.edit_message_text(text, reply_markup=InlineKeyboardMarkup(btns), parse_mode=ParseMode.MARKDOWN)

    elif data == "profile_set_email":
        await q.answer()
        context.user_data[STATE_KEY] = STATE_EMAIL
        await q.edit_message_text(
            "📧 **绑定/更换邮箱**\n\n请输入您的邮箱地址：\n（格式如：example@gmail.com）",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("❌ 取消", callback_data="menu_profile")]]),
            parse_mode=ParseMode.MARKDOWN,
        )

    elif data == "profile_reset_password":
        await q.answer()
        uid = await ensure_user(update, context)
        if not uid:
            await q.edit_message_text("❌ 服务异常，请重试")
            return
        result = await api_post("engine.botResetPassword", {"userId": uid})
        if result and result.get("success"):
            new_pwd = result.get("password", "")
            email = result.get("email", "")
            await q.edit_message_text(
                f"✅ **密码已重置**\n\n"
                f"📧 邮箱：`{email}`\n"
                f"🔑 新密码：`{new_pwd}`\n\n"
                f"请妥善保管，登录管理后台时使用。\n"
                f"⚠️ 此密码仅显示一次，请立即记录。",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("◀️ 返回个人中心", callback_data="menu_profile")]]),
                parse_mode=ParseMode.MARKDOWN,
            )
        else:
            err = result.get("message", "操作失败") if result else "服务异常"
            await q.edit_message_text(
                f"❌ {err}",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("◀️ 返回", callback_data="menu_profile")]]),
                parse_mode=ParseMode.MARKDOWN,
            )

    elif data == "noop":
        await q.answer()
        pass

# ─── 文本消息（状态机）────────────────────────────────────────────────────────

async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    state = context.user_data.get(STATE_KEY)
    uid = await ensure_user(update, context)
    if not uid:
        await update.message.reply_text("❌ 服务异常，请重试")
        return
    text = update.message.text.strip()

    if state == STATE_KEYWORD:
        context.user_data[STATE_KEY] = None
        raw = [k.strip() for k in text.replace("\n", " ").split() if k.strip()]
        if not raw:
            await update.message.reply_text("❌ 请输入有效关键词")
            return
        s = await api_get("engine.botGetUserStatus", {"userId": uid}) or {}
        remaining = s.get("limits", {}).get("maxKeywords", 10) - s.get("keywordCount", 0)
        if remaining <= 0:
            await update.message.reply_text(f"⚠️ 关键词已达上限，请升级套餐")
            return
        added = []
        duplicates = []
        for kw in raw[:remaining]:
            r = await api_post("engine.botAddKeyword", {"userId": uid, "keyword": kw, "matchType": "contains"})
            if r and r.get("success"):
                added.append(kw)
            elif r and r.get("duplicate"):
                duplicates.append(kw)
        msg = (f"✅ 成功添加 {len(added)} 个关键词：\n" + "\n".join(f"  • `{k}`" for k in added)) if added else ""
        if duplicates:
            msg += ("\n\n" if msg else "") + f"⚠️ 以下关键词已存在（跳过）：\n" + "\n".join(f"  • `{k}`" for k in duplicates)
        if not msg:
            msg = "❌ 未添加任何关键词"
        if len(raw) > remaining:
            msg += f"\n\n⚠️ 仅处理了 {remaining} 个（套餐限制）"
        await update.message.reply_text(
            msg,
            reply_markup=InlineKeyboardMarkup([[
                InlineKeyboardButton("📋 查看关键词", callback_data="kw_list"),
                InlineKeyboardButton("◀️ 主菜单", callback_data="menu_main"),
            ]]),
            parse_mode=ParseMode.MARKDOWN,
        )

    elif state == STATE_TEMPLATE:
        context.user_data[STATE_KEY] = None
        r = await api_post("engine.botSetTemplate", {"userId": uid, "content": text, "name": "Bot模板"})
        if r and r.get("success"):
            await update.message.reply_text(
                f"✅ 模板已{'更新' if not r.get('isNew') else '创建'}！\n\n`{text}`",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("◀️ 主菜单", callback_data="menu_main")]]),
                parse_mode=ParseMode.MARKDOWN,
            )
        else:
            await update.message.reply_text("❌ 设置失败，请重试")

    elif state == STATE_GROUP:
        context.user_data[STATE_KEY] = None
        raw = text.strip()
        gid = raw.replace("https://t.me/", "@").replace("t.me/", "@") if "t.me/" in raw else raw
        r = await api_post("engine.botAddGroup", {"userId": uid, "groupId": gid, "groupTitle": gid})
        if r and r.get("success"):
            await update.message.reply_text(
                f"✅ 群组 `{gid}` {'已添加' if r.get('isNew') else '已重新激活'}！",
                reply_markup=InlineKeyboardMarkup([[
                    InlineKeyboardButton("👥 查看群组", callback_data="menu_groups"),
                    InlineKeyboardButton("◀️ 主菜单", callback_data="menu_main"),
                ]]),
                parse_mode=ParseMode.MARKDOWN,
            )
        else:
            await update.message.reply_text("❌ 添加失败，请检查格式")

    elif state == STATE_ACTIVATE:
        context.user_data[STATE_KEY] = None
        code = text.strip()
        uid_val = context.user_data.get("user_id")
        r = await api_post("engine.botActivateCode", {"userId": uid_val, "code": code})
        if r and r.get("success"):
            plan = PLAN_NAMES.get(r.get("planId", ""), "未知")
            exp = str(r.get("expiresAt", ""))[:10]
            await update.message.reply_text(
                f"🎉 **激活成功！**\n\n套餐：**{plan}**\n有效期至：{exp or '永久'}",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("◀️ 主菜单", callback_data="menu_main")]]),
                parse_mode=ParseMode.MARKDOWN,
            )
        else:
            msg = r.get("message", "卡密无效") if r else "激活失败"
            await update.message.reply_text(
                f"❌ {msg}\n\n请检查卡密格式是否正确（XXXX-XXXX-XXXX）",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🏟 重新输入", callback_data="menu_activate"), InlineKeyboardButton("◀️ 主菜单", callback_data="menu_main")]]),
                parse_mode=ParseMode.MARKDOWN,
            )

    # -- Bot Session import
    elif state == STATE_SENDER_SESSION:
        lines_input = text.strip().splitlines()
        session_str = lines_input[0].strip()
        phone_input = lines_input[1].strip() if len(lines_input) > 1 else None
        if len(session_str) < 10:
            await update.message.reply_text(
                "Session invalid, please resend",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("Cancel", callback_data="menu_sender")]]),
                parse_mode=ParseMode.MARKDOWN,
            )
            return
        payload = {"userId": uid, "sessionString": session_str}
        if phone_input:
            payload["phone"] = phone_input.replace(" ", "")
        r = await api_post("engine.botImportSession", payload)
        if r and r.get("success"):
            context.user_data.pop(STATE_KEY, None)
            await update.message.reply_text(
                "Session imported successfully!",
                reply_markup=InlineKeyboardMarkup([[
                    InlineKeyboardButton("View Accounts", callback_data="menu_sender"),
                    InlineKeyboardButton("Main Menu", callback_data="menu_main"),
                ]]),
                parse_mode=ParseMode.MARKDOWN,
            )
        else:
            err = r.get("message", "Import failed") if r else "Server error"
            await update.message.reply_text(
                f"Import failed: {err}",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("Back", callback_data="menu_sender")]]),
                parse_mode=ParseMode.MARKDOWN,
            )
    # ── Bot 内添加私信账号：第一步 - 输入手机号 ──────────────────────────────
    elif state == STATE_SENDER_PHONE:
        phone = text.strip().replace(" ", "").replace(" ", "")
        if not phone.startswith("+"):
            phone = "+" + phone
        await update.message.reply_text("⏳ 正在发送验证码，请稍候...")
        r = await api_post("engine.botSendCode", {"userId": uid, "phone": phone})
        if r and r.get("success"):
            context.user_data[STATE_KEY] = STATE_SENDER_CODE
            context.user_data["sender_phone"] = phone
            context.user_data["phone_code_hash"] = r.get("phoneCodeHash", "")
            await update.message.reply_text(
                f"✅ 验证码已发送至 `{phone}`\n\n请输入收到的验证码：",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("❌ 取消", callback_data="menu_sender")]]),
                parse_mode=ParseMode.MARKDOWN,
            )
        else:
            context.user_data[STATE_KEY] = None
            err = r.get("message", "发送失败") if r else "发送失败"
            await update.message.reply_text(
                f"❌ {err}\n\n请检查手机号格式是否正确（如 +8613800138000）",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("◀️ 返回", callback_data="menu_sender")]]),
                parse_mode=ParseMode.MARKDOWN,
            )

    # ── Bot 内添加私信账号：第二步 - 输入验证码 ──────────────────────────────
    elif state == STATE_SENDER_CODE:
        code = text.strip()
        phone = context.user_data.get("sender_phone", "")
        phone_code_hash = context.user_data.get("phone_code_hash", "")
        await update.message.reply_text("⏳ 正在验证，请稍候...")
        r = await api_post("engine.botVerifyCode", {
            "userId": uid,
            "phone": phone,
            "phoneCodeHash": phone_code_hash,
            "code": code,
        })
        if r and r.get("success"):
            if r.get("needs2FA"):
                context.user_data[STATE_KEY] = STATE_SENDER_2FA
                await update.message.reply_text(
                    "🔐 **需要二步验证**\n\n请输入二步验证密码：",
                    reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("❌ 取消", callback_data="menu_sender")]]),
                    parse_mode=ParseMode.MARKDOWN,
                )
            else:
                context.user_data[STATE_KEY] = None
                context.user_data.pop("sender_phone", None)
                context.user_data.pop("phone_code_hash", None)
                await update.message.reply_text(
                    f"✅ **账号添加成功！**\n\n手机号：`{phone}`\n账号已保存并设为发信账号。",
                    reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("📱 查看账号", callback_data="menu_sender"), InlineKeyboardButton("◀️ 主菜单", callback_data="menu_main")]]),
                    parse_mode=ParseMode.MARKDOWN,
                )
        else:
            context.user_data[STATE_KEY] = None
            err = r.get("message", "验证失败") if r else "验证失败"
            await update.message.reply_text(
                f"❌ {err}",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("◀️ 返回", callback_data="menu_sender")]]),
                parse_mode=ParseMode.MARKDOWN,
            )

    # ── Bot 内添加私信账号：第三步 - 二步验证密码 ──────────────────────────────
    elif state == STATE_SENDER_2FA:
        password = text.strip()
        phone = context.user_data.get("sender_phone", "")
        await update.message.reply_text("⏳ 正在验证二步密码，请稍候...")
        r = await api_post("engine.botVerify2FA", {
            "userId": uid,
            "phone": phone,
            "password": password,
        })
        if r and r.get("success"):
            context.user_data[STATE_KEY] = None
            context.user_data.pop("sender_phone", None)
            context.user_data.pop("phone_code_hash", None)
            await update.message.reply_text(
                f"✅ **账号添加成功！**\n\n手机号：`{phone}`\n账号已保存并设为发信账号。",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("📱 查看账号", callback_data="menu_sender"), InlineKeyboardButton("◀️ 主菜单", callback_data="menu_main")]]),
                parse_mode=ParseMode.MARKDOWN,
            )
        else:
            context.user_data[STATE_KEY] = None
            err = r.get("message", "二步验证失败") if r else "二步验证失败"
            await update.message.reply_text(
                f"❌ {err}\n\n请检查密码是否正确",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("◀️ 返回", callback_data="menu_sender")]]),
                parse_mode=ParseMode.MARKDOWN,
            )

    elif state == STATE_EMAIL:
        context.user_data[STATE_KEY] = None
        email_input = update.message.text.strip()
        # 简单邮箱格式验证
        import re
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email_input):
            await update.message.reply_text(
                "❌ 邮箱格式不正确，请重新输入（如：example@gmail.com）",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("◀️ 返回", callback_data="menu_profile")]]),
            )
            return
        result = await api_post("engine.botSetEmail", {"userId": uid, "email": email_input})
        if result and result.get("success"):
            new_pwd = result.get("password", "")
            await update.message.reply_text(
                f"✅ **邮箱绑定成功！**\n\n"
                f"📧 邮箱：`{email_input}`\n"
                f"🔑 登录密码：`{new_pwd}`\n\n"
                f"请使用以上邮箱和密码登录管理后台。\n"
                f"⚠️ 此密码仅显示一次，请立即记录！\n\n"
                f"如需重置密码，可在个人中心操作。",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("👤 个人中心", callback_data="menu_profile")]]),
                parse_mode=ParseMode.MARKDOWN,
            )
        else:
            err = result.get("message", "绑定失败") if result else "服务异常"
            await update.message.reply_text(
                f"❌ {err}\n\n请重试或联系技术支持。",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("◀️ 返回", callback_data="menu_profile")]]),
            )


    # ── 方案A：黑名单关键词输入处理 ──
    elif state == STATE_BLACKLIST_KWS:
        context.user_data[STATE_KEY] = None
        raw = update.message.text.strip()
        # 清理并去重
        kws = [k.strip() for k in raw.replace("，", ",").split(",") if k.strip()]
        kws = list(dict.fromkeys(kws))  # 保序去重
        if not kws:
            await update.message.reply_text(
                "❌ 未检测到有效关键词，请重新输入（多个词用逗号分隔）",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("◀️ 返回", callback_data="settings_blacklist")]]),
            )
            return
        kw_str = ",".join(kws)
        result = await api_post("engine.botSavePushSettings", {"userId": uid, "blacklistKeywords": kw_str})
        if result and result.get("success"):
            await update.message.reply_text(
                f"✅ **黑名单关键词已保存**\n\n"
                f"共 {len(kws)} 个关键词：\n"
                f"`{kw_str}`\n\n"
                f"消息中包含以上关键词时将跳过推送。",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("⚙️ 返回设置中心", callback_data="menu_settings")]]),
                parse_mode=ParseMode.MARKDOWN,
            )
        else:
            err = (result or {}).get("message", "保存失败")
            await update.message.reply_text(
                f"❌ {err}\n\n请重试。",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("◀️ 返回", callback_data="settings_blacklist")]]),
            )
    else:
        # 默认显示主菜单
        s = await api_get("engine.botGetUserStatus", {"userId": uid}) or {}
        await update.message.reply_text(
            main_menu_text(s),
            reply_markup=main_menu_keyboard(),
            parse_mode=ParseMode.MARKDOWN,
        )

# ─── 命中通知推送（由监控引擎调用）──────────────────────────────────────────

async def post_init(app):
    cmds = [
        BotCommand("start", "主菜单"),
        BotCommand("help", "使用帮助"),
        BotCommand("kw", "添加关键词 /kw 词1 词2"),
        BotCommand("template", "设置私信模板"),
        BotCommand("listen", "绑定推送群组（在群组中发送）"),
        BotCommand("group", "添加监控群组"),
        BotCommand("stats", "今日统计"),
        BotCommand("activate", "激活套餐卡密"),
    ]
    await app.bot.set_my_commands(cmds)
    logger.info("✅ Bot commands registered")

def main():
    if not BOT_TOKEN:
        logger.error("BOT_TOKEN not set!")
        return
    app = Application.builder().token(BOT_TOKEN).post_init(post_init).build()
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("help", cmd_help))
    app.add_handler(CommandHandler("kw", cmd_kw))
    app.add_handler(CommandHandler("template", cmd_template))
    app.add_handler(CommandHandler("listen", cmd_listen))
    app.add_handler(CommandHandler("group", cmd_group))
    app.add_handler(CommandHandler("stats", cmd_stats))
    app.add_handler(CommandHandler("activate", cmd_activate))
    app.add_handler(CallbackQueryHandler(handle_callback))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))
    logger.info("🤖 TG Monitor Pro Bot starting...")
    app.run_polling(drop_pending_updates=True)

if __name__ == "__main__":
    main()
