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

BOT_TOKEN = os.getenv("BOT_TOKEN", "")
WEB_API_BASE = os.getenv("WEB_API_BASE", "http://localhost:3000/api")
ENGINE_SECRET = os.getenv("ENGINE_SECRET", "tg-monitor-engine-secret")
WEB_SITE_URL = os.getenv("WEB_SITE_URL", "")  # 网站地址，用于 Bot 中的跳转链接

# 套餐名称
PLAN_NAMES = {"free": "免费版", "basic": "基础版", "pro": "专业版", "enterprise": "企业版"}

# 对话状态 key
STATE_KEY = "input_state"
STATE_KEYWORD = "wait_keyword"
STATE_TEMPLATE = "wait_template"
STATE_GROUP = "wait_group"

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
            InlineKeyboardButton("👥 监控群组", callback_data="menu_groups"),
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
        f"👥 监控群组：**{grp}** 个\n"
        f"📬 自动私信：{dm}\n"
        f"📱 私信账号：{sender}\n\n"
        f"请选择操作："
    )

# ─── /start ───────────────────────────────────────────────────────────────────

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    tg = update.effective_user
    msg = await update.message.reply_text("⏳ 正在初始化...")
    result = await api_post("engine.botAutoRegister", {
        "tgUserId": str(tg.id),
        "tgUsername": tg.username,
        "tgFirstName": tg.first_name,
        "tgLastName": tg.last_name,
    })
    if not result:
        await msg.edit_text("❌ 服务暂时不可用，请稍后重试。")
        return
    uid = result["id"]
    context.user_data["user_id"] = uid
    is_new = result.get("isNew", False)
    status = await api_get("engine.botGetUserStatus", {"userId": uid}) or {}
    welcome = "🎉 欢迎加入 TG Monitor Pro！\n\n" if is_new else ""
    await msg.edit_text(
        welcome + main_menu_text(status),
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

    # ── 监控群组 ──
    elif data == "menu_groups":
        groups = await api_get("engine.botGetGroups", {"userId": uid}) or []
        if not groups:
            text = "👥 **监控群组**\n\n暂无群组\n\n快捷添加：`/group 群组链接`"
            btns = [[InlineKeyboardButton("➕ 添加群组", callback_data="group_add")],
                    [InlineKeyboardButton("◀️ 返回", callback_data="menu_main")]]
        else:
            text = f"👥 **监控群组**（{len(groups)} 个）\n\n"
            for g in groups:
                icon = "🟢" if g.get("monitorStatus") == "active" else "🔴"
                text += f"{icon} `{g.get('groupTitle') or g.get('groupId')}`\n"
            btns = [[InlineKeyboardButton("➕ 添加群组", callback_data="group_add")]]
            for g in groups[:5]:
                title = (g.get("groupTitle") or g.get("groupId") or "")[:20]
                btns.append([InlineKeyboardButton(f"🗑️ {title}", callback_data=f"group_del_{g['groupId']}")])
            btns.append([InlineKeyboardButton("◀️ 返回", callback_data="menu_main")])
        await q.edit_message_text(text, reply_markup=InlineKeyboardMarkup(btns), parse_mode=ParseMode.MARKDOWN)

    elif data == "group_add":
        context.user_data[STATE_KEY] = STATE_GROUP
        await q.edit_message_text(
            "👥 **添加监控群组**\n\n请发送群组链接或 ID：\n• `https://t.me/example`\n• `@example`\n• `-1001234567890`",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("❌ 取消", callback_data="menu_groups")]]),
            parse_mode=ParseMode.MARKDOWN,
        )

    elif data.startswith("group_del_"):
        gid = data[10:]
        await api_post("engine.botDeleteGroup", {"userId": uid, "groupId": gid})
        groups = await api_get("engine.botGetGroups", {"userId": uid}) or []
        text = f"✅ 已移除\n\n👥 **监控群组**（{len(groups)} 个）\n\n"
        for g in groups:
            icon = "🟢" if g.get("monitorStatus") == "active" else "🔴"
            text += f"{icon} `{g.get('groupTitle') or g.get('groupId')}`\n"
        if not groups:
            text = "✅ 已移除\n\n👥 暂无监控群组"
        btns = [[InlineKeyboardButton("➕ 添加群组", callback_data="group_add")],
                [InlineKeyboardButton("◀️ 返回", callback_data="menu_main")]]
        await q.edit_message_text(text, reply_markup=InlineKeyboardMarkup(btns), parse_mode=ParseMode.MARKDOWN)

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
        s = await api_get("engine.botGetUserStatus", {"userId": uid}) or {}
        has = s.get("hasSenderAccount", False)
        phone = s.get("senderPhone", "")
        if has:
            text = f"📱 **私信账号**\n\n✅ 已绑定：`{phone}`\n\n此账号将用于自动发送私信。"
            btns = [[InlineKeyboardButton("🔄 更换账号", callback_data="sender_guide")],
                    [InlineKeyboardButton("◀️ 返回", callback_data="menu_main")]]
        else:
            text = ("📱 **私信账号**\n\n⚠️ 尚未绑定私信账号\n\n"
                    "绑定后，系统将使用此账号自动向关键词命中的用户发送私信。\n\n"
                    "请在 Web 管理后台完成账号登录绑定：")
            btns = [[InlineKeyboardButton("🌐 前往绑定", url=f"{WEB_SITE_URL}/tg-accounts" if WEB_SITE_URL else "https://t.me")],
                    [InlineKeyboardButton("◀️ 返回", callback_data="menu_main")]]
        await q.edit_message_text(text, reply_markup=InlineKeyboardMarkup(btns), parse_mode=ParseMode.MARKDOWN)

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
            f"激活套餐：`/activate 卡密`",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("◀️ 返回", callback_data="menu_main")]]),
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

    # ── 命中记录操作 ──
    elif data.startswith("hit_processed_"):
        await q.edit_message_reply_markup(
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("✅ 已处理", callback_data="noop")]])
        )
        await q.answer("✅ 已标记为已处理")

    elif data.startswith("hit_block_"):
        sender_id = data[10:]
        await q.answer(f"🚫 已屏蔽用户 {sender_id}", show_alert=True)

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

    else:
        # 默认显示主菜单
        s = await api_get("engine.botGetUserStatus", {"userId": uid}) or {}
        await update.message.reply_text(
            main_menu_text(s),
            reply_markup=main_menu_keyboard(),
            parse_mode=ParseMode.MARKDOWN,
        )

# ─── 命中通知推送（由监控引擎调用）──────────────────────────────────────────

async def send_hit_notification(app, bot_chat_id: int, sender_username: str,
                                sender_tg_id: str, matched_keyword: str,
                                group_name: str, message_text: str, dm_status: str = "pending"):
    dm_icon = {
        "sent": "✅ 私信已发送", "queued": "⏳ 私信排队中",
        "failed": "❌ 私信发送失败", "skipped": "⏭️ 已跳过",
        "pending": "⏳ 等待处理",
    }.get(dm_status, "❓")
    sender_link = f"@{sender_username}" if sender_username else f"ID: {sender_tg_id}"
    text = (
        "🎯 **关键词命中**\n\n"
        f"📍 群组：**{group_name}**\n"
        f"🔑 关键词：`{matched_keyword}`\n"
        f"👤 发送者：{sender_link}\n"
        f"💬 消息：\n`{message_text[:200]}{'...' if len(message_text) > 200 else ''}`\n\n"
        f"📬 私信：{dm_icon}"
    )
    url = f"https://t.me/{sender_username}" if sender_username else f"tg://user?id={sender_tg_id}"
    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("💬 私聊TA", url=url),
         InlineKeyboardButton("✅ 已处理", callback_data=f"hit_processed_{sender_tg_id}")],
        [InlineKeyboardButton("🚫 屏蔽", callback_data=f"hit_block_{sender_tg_id}")],
    ])
    try:
        await app.bot.send_message(chat_id=bot_chat_id, text=text, reply_markup=kb, parse_mode=ParseMode.MARKDOWN)
    except Exception as e:
        logger.error(f"send_hit_notification error: {e}")

# ─── 主入口 ───────────────────────────────────────────────────────────────────

async def post_init(app):
    cmds = [
        BotCommand("start", "主菜单"),
        BotCommand("help", "使用帮助"),
        BotCommand("kw", "添加关键词 /kw 词1 词2"),
        BotCommand("template", "设置私信模板"),
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
    app.add_handler(CommandHandler("group", cmd_group))
    app.add_handler(CommandHandler("stats", cmd_stats))
    app.add_handler(CommandHandler("activate", cmd_activate))
    app.add_handler(CallbackQueryHandler(handle_callback))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))
    logger.info("🤖 TG Monitor Pro Bot starting...")
    app.run_polling(drop_pending_updates=True)

if __name__ == "__main__":
    main()
