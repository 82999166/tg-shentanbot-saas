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

# ─── 主菜单 ───────────────────────────────────────────────────────────────────

def main_menu_keyboard():
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
            InlineKeyboardButton("💬 技术支持", callback_data="menu_support"),
        ],
        [
            InlineKeyboardButton("📢 官方频道", callback_data="menu_channel"),
        ],
        [
            InlineKeyboardButton("👤 个人中心", callback_data="menu_profile"),
        ],
    ])

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
    for kw in context.args[:remaining]:
        r = await api_post("engine.botAddKeyword", {"userId": uid, "keyword": kw, "matchType": "contains"})
        if r and r.get("success"):
            added.append(kw)
    msg = f"✅ 成功添加 {len(added)} 个关键词：\n" + "\n".join(f"  • `{k}`" for k in added)
    if len(context.args) > remaining:
        msg += f"\n\n⚠️ 仅添加了 {remaining} 个（套餐限制）"
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
    await q.answer()
    data = q.data
    uid = await ensure_user(update, context)
    if not uid:
        await q.edit_message_text("❌ 服务异常，请重试")
        return

    # 主菜单
    if data == "menu_main":
        s = await api_get("engine.botGetUserStatus", {"userId": uid}) or {}
        await q.edit_message_text(main_menu_text(s), reply_markup=main_menu_keyboard(), parse_mode=ParseMode.MARKDOWN)

    # ── 关键词 ──
    elif data == "menu_keywords":
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
        context.user_data[STATE_KEY] = STATE_KEYWORD
        await q.edit_message_text(
            "📋 **添加关键词**\n\n请发送关键词（多个用空格或换行分隔）：",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("❌ 取消", callback_data="menu_keywords")]]),
            parse_mode=ParseMode.MARKDOWN,
        )

    elif data == "kw_list":
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
        await api_post("engine.botSetPushGroup", {"userId": uid, "collabChatId": None, "collabChatTitle": None})
        await q.edit_message_text(
            "✅ 已解除推送群组绑定\n\n命中消息将不再推送到群组。",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("◀️ 返回", callback_data="menu_push_group")]]),
            parse_mode=ParseMode.MARKDOWN,
        )
    # ── 私信模板 ──
    elif data == "menu_template":
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
        # Bot 内添加账号：引导输入手机号
        context.user_data[STATE_KEY] = STATE_SENDER_PHONE
        await q.edit_message_text(
            "📱 **Bot 内添加私信账号**\n\n"
            "请输入手机号（含国家代码，如 +8613800138000）：",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("❌ 取消", callback_data="menu_sender")]]),
            parse_mode=ParseMode.MARKDOWN,
        )
    elif data == "sender_guide":
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
        s = await api_get("engine.botGetUserStatus", {"userId": uid}) or {}
        plan = PLAN_NAMES.get(s.get("planId", "free"), "免费版")
        limits = s.get("limits", {})
        exp = str(s.get("planExpiresAt", ""))[:10] or "永久有效"
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
        context.user_data[STATE_KEY] = STATE_ACTIVATE
        await q.edit_message_text(
            "🎟 **激活套餐**\n\n请直接发送卡密（格式：XXXX-XXXX-XXXX）：",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("❌ 取消", callback_data="menu_main")]]),
            parse_mode=ParseMode.MARKDOWN,
        )

    # ── 自动私信开关 ──
    elif data == "menu_dm_toggle":
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
        # 先应答避免超时，再发送带 tg://openmessage 按钮的临时消息（5秒后自动删除）
        # 注意：answer_callback_query 的 url 不支持 tg://，但 InlineKeyboardButton.url 支持
        await q.answer()
        dm_markup = InlineKeyboardMarkup([[
            InlineKeyboardButton("💬 点击打开私信", url="tg://openmessage?user_id=" + sender_tg_id_str)
        ]])
        try:
            sent = await context.bot.send_message(
                chat_id=q.message.chat_id,
                text="👆 点击上方按钮打开私信",
                reply_markup=dm_markup,
            )
            # 5秒后自动删除该提示消息
            async def _auto_delete(bot, chat_id, msg_id):
                await asyncio.sleep(5)
                try:
                    await bot.delete_message(chat_id=chat_id, message_id=msg_id)
                except Exception:
                    pass
            asyncio.create_task(_auto_delete(context.bot, q.message.chat_id, sent.message_id))
        except Exception as e:
            await q.answer(f"TG ID: {sender_tg_id_str}", show_alert=True)
    elif data.startswith("history:"):
        parts = data.split(":")
        sender_tg_id_str = parts[2] if len(parts) > 2 else "0"
        records = await api_get("engine.botGetSenderHistory", {"userId": uid, "senderTgId": sender_tg_id_str, "limit": 10}) or []
        if not records:
            text = "📋 *发送者历史记录*\n\n该用户暂无命中记录"
        else:
            lines = []
            for r in records:
                kw = r.get("keyword", "")
                grp = r.get("groupName", "")
                t = str(r.get("createdAt", ""))[:16]
                lines.append(f"• {t} [{kw}] {grp}")
            cnt = len(records)
            text = f"📋 *发送者历史命中（最近{cnt}条）*\n\n" + "\n".join(lines)
        await q.answer()
        try:
            await q.message.reply_text(text, parse_mode=ParseMode.MARKDOWN)
        except Exception:
            await context.bot.send_message(chat_id=q.message.chat_id, text=text, parse_mode=ParseMode.MARKDOWN)
    elif data.startswith("block:"):
        parts = data.split(":")
        sender_tg_id_str = parts[2] if len(parts) > 2 else "0"
        try:
            result = await api_post("engine.botBlockUser", {"userId": uid, "targetTgId": sender_tg_id_str})
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
    elif data == "menu_expiry":
        s = await api_get("engine.botGetUserStatus", {"userId": uid}) or {}
        plan = PLAN_NAMES.get(s.get("planId", "free"), "免费版")
        exp = str(s.get("planExpiresAt", ""))[:10] or "永久有效"
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
    elif data == "menu_profile":
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
        context.user_data[STATE_KEY] = STATE_EMAIL
        await q.edit_message_text(
            "📧 **绑定/更换邮箱**\n\n请输入您的邮箱地址：\n（格式如：example@gmail.com）",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("❌ 取消", callback_data="menu_profile")]]),
            parse_mode=ParseMode.MARKDOWN,
        )

    elif data == "profile_reset_password":
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
        for kw in raw[:remaining]:
            r = await api_post("engine.botAddKeyword", {"userId": uid, "keyword": kw, "matchType": "contains"})
            if r and r.get("success"):
                added.append(kw)
        msg = f"✅ 成功添加 {len(added)} 个关键词：\n" + "\n".join(f"  • `{k}`" for k in added)
        if len(raw) > remaining:
            msg += f"\n\n⚠️ 仅添加了 {remaining} 个（套餐限制）"
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
