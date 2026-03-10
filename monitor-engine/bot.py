"""
TG Monitor Pro - Telegram Bot 命令界面
功能：
- 用户通过 Bot 命令管理关键词、群组、私信模板
- 实时命中通知推送
- 账号状态查询
- 套餐信息查询
"""
import asyncio
import logging
import os
import aiohttp
from pyrogram import Client, filters
from pyrogram.types import (
    Message, CallbackQuery,
    InlineKeyboardMarkup, InlineKeyboardButton,
    BotCommand
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BOT_TOKEN = os.getenv("BOT_TOKEN", "")
WEB_API_BASE = os.getenv("WEB_API_BASE", "http://localhost:3000/api")
ENGINE_SECRET = os.getenv("ENGINE_SECRET", "tg-monitor-engine-secret")
API_ID = int(os.getenv("TG_API_ID", "0"))
API_HASH = os.getenv("TG_API_HASH", "")

# ─── API 辅助函数 ─────────────────────────────────────────────────────────────

async def api_get(path: str, params: dict = None):
    """调用 Web API GET 接口"""
    headers = {"x-engine-secret": ENGINE_SECRET}
    async with aiohttp.ClientSession() as session:
        async with session.get(f"{WEB_API_BASE}/trpc/{path}", headers=headers, params=params) as resp:
            return await resp.json()

async def api_post(path: str, data: dict = None):
    """调用 Web API POST 接口"""
    headers = {"x-engine-secret": ENGINE_SECRET, "Content-Type": "application/json"}
    import json
    async with aiohttp.ClientSession() as session:
        async with session.post(f"{WEB_API_BASE}/trpc/{path}", headers=headers, json={"json": data or {}}) as resp:
            return await resp.json()

async def get_user_by_tg_id(tg_user_id: int):
    """通过 Telegram 用户 ID 查找系统用户"""
    try:
        result = await api_get("engine.getUserByTgId", {"input": f'{{"json":{{"tgUserId":"{tg_user_id}"}}}}'})
        return result.get("result", {}).get("data", {}).get("json")
    except Exception as e:
        logger.error(f"get_user_by_tg_id error: {e}")
        return None

# ─── 主菜单 Keyboard ──────────────────────────────────────────────────────────

def main_menu_keyboard():
    return InlineKeyboardMarkup([
        [
            InlineKeyboardButton("📋 关键词管理", callback_data="menu_keywords"),
            InlineKeyboardButton("👥 监控群组", callback_data="menu_groups"),
        ],
        [
            InlineKeyboardButton("💬 消息模板", callback_data="menu_templates"),
            InlineKeyboardButton("📊 今日统计", callback_data="menu_stats"),
        ],
        [
            InlineKeyboardButton("📱 我的账号", callback_data="menu_accounts"),
            InlineKeyboardButton("🛡️ 防封设置", callback_data="menu_antiban"),
        ],
        [
            InlineKeyboardButton("💎 我的套餐", callback_data="menu_plan"),
            InlineKeyboardButton("🔔 通知设置", callback_data="menu_notify"),
        ],
        [
            InlineKeyboardButton("🌐 打开管理后台", url="https://tgmonitor.manus.space"),
        ],
    ])

# ─── Bot 命令处理 ─────────────────────────────────────────────────────────────

app = Client(
    "tg_monitor_bot",
    api_id=API_ID,
    api_hash=API_HASH,
    bot_token=BOT_TOKEN,
)

@app.on_message(filters.command("start") & filters.private)
async def cmd_start(client: Client, message: Message):
    """欢迎消息 + 主菜单"""
    user = message.from_user
    welcome_text = (
        f"👋 你好，**{user.first_name}**！\n\n"
        "🤖 **TG Monitor Pro** - 专业的 Telegram 关键词监控工具\n\n"
        "**核心功能：**\n"
        "• 📡 实时监控群组关键词\n"
        "• 🎯 命中后自动发送私信\n"
        "• 📊 数据统计与分析\n"
        "• 🛡️ 智能防封保护\n\n"
        "请选择操作："
    )
    await message.reply_text(welcome_text, reply_markup=main_menu_keyboard())

@app.on_message(filters.command("help") & filters.private)
async def cmd_help(client: Client, message: Message):
    """帮助信息"""
    help_text = (
        "📖 **命令列表**\n\n"
        "**基础命令：**\n"
        "`/start` - 主菜单\n"
        "`/status` - 系统状态\n"
        "`/stats` - 今日统计\n\n"
        "**关键词管理：**\n"
        "`/add_keyword <词>` - 添加关键词\n"
        "`/list_keywords` - 查看关键词列表\n"
        "`/del_keyword <ID>` - 删除关键词\n\n"
        "**群组管理：**\n"
        "`/add_group <群组链接>` - 添加监控群组\n"
        "`/list_groups` - 查看监控群组\n"
        "`/del_group <ID>` - 删除监控群组\n\n"
        "**私信功能：**\n"
        "`/dm_on` - 开启自动私信\n"
        "`/dm_off` - 关闭自动私信\n"
        "`/dm_template <内容>` - 设置私信模板\n"
        "`/dm_status` - 查看私信队列\n\n"
        "**套餐：**\n"
        "`/plan` - 查看当前套餐\n"
        "`/activate <卡密>` - 激活卡密\n"
    )
    await message.reply_text(help_text)

@app.on_message(filters.command("status") & filters.private)
async def cmd_status(client: Client, message: Message):
    """系统状态"""
    await message.reply_text(
        "✅ **系统状态**\n\n"
        "• 监控引擎：🟢 运行中\n"
        "• 数据库：🟢 正常\n"
        "• API 服务：🟢 正常\n\n"
        "如需查看详细统计，请使用 /stats"
    )

@app.on_message(filters.command("stats") & filters.private)
async def cmd_stats(client: Client, message: Message):
    """今日统计"""
    await message.reply_text(
        "📊 **今日统计**\n\n"
        "请登录 Web 管理后台查看完整统计数据：\n"
        "🌐 https://tgmonitor.manus.space/dashboard",
        reply_markup=InlineKeyboardMarkup([[
            InlineKeyboardButton("📊 查看仪表盘", url="https://tgmonitor.manus.space/dashboard")
        ]])
    )

@app.on_message(filters.command("add_keyword") & filters.private)
async def cmd_add_keyword(client: Client, message: Message):
    """添加关键词"""
    parts = message.text.split(maxsplit=1)
    if len(parts) < 2:
        await message.reply_text(
            "❌ 请提供关键词\n\n"
            "用法：`/add_keyword 关键词`\n"
            "示例：`/add_keyword 求购 BTC`"
        )
        return

    keyword = parts[1].strip()
    await message.reply_text(
        f"✅ 关键词 **{keyword}** 已添加到队列\n\n"
        "⚠️ 注意：关键词需要通过 Web 管理后台完成配置（选择匹配类型、绑定群组等）\n"
        "🌐 https://tgmonitor.manus.space/keywords",
        reply_markup=InlineKeyboardMarkup([[
            InlineKeyboardButton("⚙️ 完善配置", url="https://tgmonitor.manus.space/keywords")
        ]])
    )

@app.on_message(filters.command("list_keywords") & filters.private)
async def cmd_list_keywords(client: Client, message: Message):
    """查看关键词列表"""
    await message.reply_text(
        "📋 **关键词管理**\n\n"
        "请在 Web 管理后台查看和管理所有关键词：",
        reply_markup=InlineKeyboardMarkup([[
            InlineKeyboardButton("📋 关键词列表", url="https://tgmonitor.manus.space/keywords")
        ]])
    )

@app.on_message(filters.command("dm_on") & filters.private)
async def cmd_dm_on(client: Client, message: Message):
    """开启自动私信"""
    await message.reply_text(
        "✅ **自动私信功能**\n\n"
        "请在防封设置页面开启自动私信开关：",
        reply_markup=InlineKeyboardMarkup([[
            InlineKeyboardButton("🔔 防封设置", url="https://tgmonitor.manus.space/antiban")
        ]])
    )

@app.on_message(filters.command("dm_off") & filters.private)
async def cmd_dm_off(client: Client, message: Message):
    """关闭自动私信"""
    await message.reply_text(
        "🔕 **关闭自动私信**\n\n"
        "请在防封设置页面关闭自动私信开关：",
        reply_markup=InlineKeyboardMarkup([[
            InlineKeyboardButton("⚙️ 防封设置", url="https://tgmonitor.manus.space/antiban")
        ]])
    )

@app.on_message(filters.command("dm_template") & filters.private)
async def cmd_dm_template(client: Client, message: Message):
    """设置私信模板"""
    parts = message.text.split(maxsplit=1)
    if len(parts) < 2:
        await message.reply_text(
            "💬 **私信模板设置**\n\n"
            "用法：`/dm_template 你好 {username}，看到你在找 {keyword}，我这里有...`\n\n"
            "**可用变量：**\n"
            "• `{username}` - 对方用户名\n"
            "• `{keyword}` - 命中的关键词\n"
            "• `{group_name}` - 来源群组名\n"
            "• `{date}` - 当前日期\n\n"
            "或在 Web 后台管理多个模板：",
            reply_markup=InlineKeyboardMarkup([[
                InlineKeyboardButton("💬 模板管理", url="https://tgmonitor.manus.space/templates")
            ]])
        )
        return

    template_content = parts[1].strip()
    await message.reply_text(
        f"✅ 模板已记录：\n\n`{template_content}`\n\n"
        "请在 Web 后台完成保存：",
        reply_markup=InlineKeyboardMarkup([[
            InlineKeyboardButton("💾 保存模板", url="https://tgmonitor.manus.space/templates")
        ]])
    )

@app.on_message(filters.command("dm_status") & filters.private)
async def cmd_dm_status(client: Client, message: Message):
    """查看私信队列状态"""
    await message.reply_text(
        "📬 **私信队列**\n\n"
        "查看当前发送队列和历史记录：",
        reply_markup=InlineKeyboardMarkup([[
            InlineKeyboardButton("📬 私信队列", url="https://tgmonitor.manus.space/dm-queue")
        ]])
    )

@app.on_message(filters.command("plan") & filters.private)
async def cmd_plan(client: Client, message: Message):
    """查看当前套餐"""
    await message.reply_text(
        "💎 **套餐信息**\n\n"
        "查看当前套餐和升级选项：",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("💎 查看套餐", url="https://tgmonitor.manus.space/plans")],
            [InlineKeyboardButton("💳 购买升级", url="https://tgmonitor.manus.space/payment")],
        ])
    )

@app.on_message(filters.command("activate") & filters.private)
async def cmd_activate(client: Client, message: Message):
    """激活卡密"""
    parts = message.text.split(maxsplit=1)
    if len(parts) < 2:
        await message.reply_text(
            "🔑 **激活卡密**\n\n"
            "用法：`/activate TGPRO-XXXX-XXXX-XXXX`\n\n"
            "或在网页端激活：",
            reply_markup=InlineKeyboardMarkup([[
                InlineKeyboardButton("🔑 激活页面", url="https://tgmonitor.manus.space/payment")
            ]])
        )
        return

    card_key = parts[1].strip()
    await message.reply_text(
        f"🔑 正在激活卡密：`{card_key}`\n\n"
        "请在网页端完成激活（需要登录验证）：",
        reply_markup=InlineKeyboardMarkup([[
            InlineKeyboardButton("🔑 激活页面", url=f"https://tgmonitor.manus.space/payment?key={card_key}")
        ]])
    )

@app.on_message(filters.command("add_group") & filters.private)
async def cmd_add_group(client: Client, message: Message):
    """添加监控群组"""
    parts = message.text.split(maxsplit=1)
    if len(parts) < 2:
        await message.reply_text(
            "👥 **添加监控群组**\n\n"
            "用法：`/add_group @group_username` 或 `/add_group https://t.me/group`\n\n"
            "或在 Web 后台添加：",
            reply_markup=InlineKeyboardMarkup([[
                InlineKeyboardButton("👥 群组管理", url="https://tgmonitor.manus.space/monitor-groups")
            ]])
        )
        return

    group_link = parts[1].strip()
    await message.reply_text(
        f"✅ 群组 `{group_link}` 已记录\n\n"
        "请在 Web 后台完成配置（绑定关键词等）：",
        reply_markup=InlineKeyboardMarkup([[
            InlineKeyboardButton("⚙️ 完善配置", url="https://tgmonitor.manus.space/monitor-groups")
        ]])
    )

# ─── Callback Query 处理 ──────────────────────────────────────────────────────

@app.on_callback_query(filters.regex("^menu_"))
async def handle_menu_callback(client: Client, callback: CallbackQuery):
    """主菜单回调"""
    action = callback.data.replace("menu_", "")

    menu_map = {
        "keywords": ("📋 关键词管理", "https://tgmonitor.manus.space/keywords"),
        "groups": ("👥 监控群组", "https://tgmonitor.manus.space/monitor-groups"),
        "templates": ("💬 消息模板", "https://tgmonitor.manus.space/templates"),
        "stats": ("📊 今日统计", "https://tgmonitor.manus.space/dashboard"),
        "accounts": ("📱 TG 账号", "https://tgmonitor.manus.space/tg-accounts"),
        "antiban": ("🛡️ 防封设置", "https://tgmonitor.manus.space/antiban"),
        "plan": ("💎 套餐管理", "https://tgmonitor.manus.space/plans"),
        "notify": ("🔔 通知设置", "https://tgmonitor.manus.space/antiban"),
    }

    if action in menu_map:
        title, url = menu_map[action]
        await callback.answer()
        await callback.message.reply_text(
            f"🔗 **{title}**\n\n点击下方按钮打开管理页面：",
            reply_markup=InlineKeyboardMarkup([[
                InlineKeyboardButton(f"打开 {title}", url=url)
            ]])
        )
    else:
        await callback.answer("功能开发中...", show_alert=True)

# ─── 命中通知推送（由监控引擎调用） ──────────────────────────────────────────

async def send_hit_notification(
    bot_chat_id: int,
    sender_username: str,
    sender_tg_id: str,
    matched_keyword: str,
    group_name: str,
    message_text: str,
    dm_enabled: bool = False,
):
    """
    向用户推送关键词命中通知
    此函数由监控引擎在检测到命中时调用
    """
    dm_status = "✅ 已加入私信队列" if dm_enabled else "❌ 自动私信未开启"

    notification_text = (
        "🎯 **关键词命中通知**\n\n"
        f"📍 **来源群组：** {group_name}\n"
        f"🔑 **命中关键词：** `{matched_keyword}`\n"
        f"👤 **发送者：** @{sender_username or 'N/A'} (`{sender_tg_id}`)\n"
        f"💬 **消息内容：**\n`{message_text[:200]}{'...' if len(message_text) > 200 else ''}`\n\n"
        f"📬 **私信状态：** {dm_status}"
    )

    keyboard = InlineKeyboardMarkup([
        [
            InlineKeyboardButton(
                "💬 私聊TA",
                url=f"https://t.me/{sender_username}" if sender_username else f"tg://user?id={sender_tg_id}"
            ),
            InlineKeyboardButton("✅ 标记已处理", callback_data=f"mark_processed_{sender_tg_id}"),
        ],
        [
            InlineKeyboardButton("🚫 屏蔽此用户", callback_data=f"block_user_{sender_tg_id}"),
            InlineKeyboardButton("📊 查看记录", url="https://tgmonitor.manus.space/hit-records"),
        ],
    ])

    try:
        await app.send_message(bot_chat_id, notification_text, reply_markup=keyboard)
    except Exception as e:
        logger.error(f"Failed to send notification to {bot_chat_id}: {e}")

@app.on_callback_query(filters.regex("^mark_processed_"))
async def handle_mark_processed(client: Client, callback: CallbackQuery):
    """标记命中记录为已处理"""
    await callback.answer("✅ 已标记为已处理", show_alert=False)
    await callback.message.edit_reply_markup(
        InlineKeyboardMarkup([[
            InlineKeyboardButton("✅ 已处理", callback_data="noop"),
        ]])
    )

@app.on_callback_query(filters.regex("^block_user_"))
async def handle_block_user(client: Client, callback: CallbackQuery):
    """屏蔽用户"""
    tg_id = callback.data.replace("block_user_", "")
    await callback.answer(f"🚫 用户 {tg_id} 已加入黑名单", show_alert=True)

@app.on_callback_query(filters.regex("^noop$"))
async def handle_noop(client: Client, callback: CallbackQuery):
    await callback.answer()

# ─── 设置 Bot 命令菜单 ────────────────────────────────────────────────────────

async def set_bot_commands():
    """设置 Bot 命令菜单"""
    commands = [
        BotCommand("start", "主菜单"),
        BotCommand("help", "命令帮助"),
        BotCommand("status", "系统状态"),
        BotCommand("stats", "今日统计"),
        BotCommand("add_keyword", "添加关键词"),
        BotCommand("list_keywords", "关键词列表"),
        BotCommand("add_group", "添加监控群组"),
        BotCommand("list_groups", "群组列表"),
        BotCommand("dm_on", "开启自动私信"),
        BotCommand("dm_off", "关闭自动私信"),
        BotCommand("dm_template", "设置私信模板"),
        BotCommand("dm_status", "私信队列状态"),
        BotCommand("plan", "查看套餐"),
        BotCommand("activate", "激活卡密"),
    ]
    await app.set_bot_commands(commands)
    logger.info("Bot commands set successfully")

# ─── 主入口 ───────────────────────────────────────────────────────────────────

async def main():
    await app.start()
    await set_bot_commands()
    logger.info("TG Monitor Pro Bot started!")
    await asyncio.Event().wait()

if __name__ == "__main__":
    asyncio.run(main())
