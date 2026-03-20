#!/usr/bin/env python3
"""
Pyrogram 登录服务
提供 HTTP API 供 Web 后台调用，生成 Pyrogram 格式的 Session 字符串
运行在 5050 端口（仅本地访问）
"""
import asyncio
import json
import os
import logging
from aiohttp import web
from pyrogram import Client
from pyrogram.errors import (
    PhoneNumberInvalid, PhoneCodeInvalid, PhoneCodeExpired,
    SessionPasswordNeeded, PasswordHashInvalid, FloodWait,
    PhoneNumberBanned, PhoneNumberUnoccupied
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("login-service")

# TG API 凭证（与 main.py 保持一致）
TG_API_ID = int(os.environ.get("TG_API_ID", "20621684"))
TG_API_HASH = os.environ.get("TG_API_HASH", "a9e5c7b0d3f8e1a2b4c6d8e0f2a4b6c8")

# 登录会话缓存 key: phone
login_sessions: dict = {}


async def handle_send_code(request):
    """第一步：发送验证码"""
    try:
        body = await request.json()
        phone = body.get("phone", "").strip()
        if not phone:
            return web.json_response({"success": False, "error": "手机号不能为空"}, status=400)

        # 清理旧会话
        if phone in login_sessions:
            old = login_sessions.pop(phone)
            try:
                client = old.get("client")
                if client and client.is_connected:
                    await client.disconnect()
            except Exception:
                pass

        client = Client(
            name=f"login_{phone.replace('+', '')}",
            api_id=TG_API_ID,
            api_hash=TG_API_HASH,
            in_memory=True,
        )
        await client.connect()

        sent = await client.send_code(phone)
        login_sessions[phone] = {
            "client": client,
            "phone_code_hash": sent.phone_code_hash,
        }
        logger.info(f"[SendCode] {phone} 验证码已发送")
        return web.json_response({
            "success": True,
            "phone_code_hash": sent.phone_code_hash,
            "message": f"验证码已发送至 {phone}",
        })

    except PhoneNumberInvalid:
        return web.json_response({"success": False, "error": "手机号格式无效"}, status=400)
    except PhoneNumberBanned:
        return web.json_response({"success": False, "error": "该手机号已被 Telegram 封禁"}, status=400)
    except PhoneNumberUnoccupied:
        return web.json_response({"success": False, "error": "该手机号尚未注册 Telegram"}, status=400)
    except FloodWait as e:
        return web.json_response({"success": False, "error": f"请求过于频繁，请等待 {e.value} 秒后重试"}, status=429)
    except Exception as e:
        logger.error(f"[SendCode] 错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


async def handle_verify_code(request):
    """第二步：验证验证码"""
    try:
        body = await request.json()
        phone = body.get("phone", "").strip()
        code = body.get("code", "").strip()
        phone_code_hash = body.get("phone_code_hash", "").strip()

        if not phone or not code:
            return web.json_response({"success": False, "error": "参数不完整"}, status=400)

        session_data = login_sessions.get(phone)
        if not session_data:
            return web.json_response({"success": False, "error": "登录会话已过期，请重新发送验证码"}, status=400)

        client: Client = session_data["client"]
        hash_to_use = phone_code_hash or session_data["phone_code_hash"]

        try:
            await client.sign_in(phone, hash_to_use, code)
        except SessionPasswordNeeded:
            # 需要二步验证
            login_sessions[phone]["needs_2fa"] = True
            return web.json_response({
                "success": True,
                "needs_2fa": True,
                "message": "该账号已开启二步验证，请输入密码",
            })

        # 登录成功，导出 session
        session_string = await client.export_session_string()
        await client.disconnect()
        login_sessions.pop(phone, None)

        logger.info(f"[VerifyCode] {phone} 登录成功")
        return web.json_response({
            "success": True,
            "needs_2fa": False,
            "session_string": session_string,
            "message": "登录成功",
        })

    except PhoneCodeInvalid:
        return web.json_response({"success": False, "error": "验证码错误，请重新输入"}, status=400)
    except PhoneCodeExpired:
        login_sessions.pop(phone, None)
        return web.json_response({"success": False, "error": "验证码已过期，请重新发送"}, status=400)
    except FloodWait as e:
        return web.json_response({"success": False, "error": f"请求过于频繁，请等待 {e.value} 秒后重试"}, status=429)
    except Exception as e:
        logger.error(f"[VerifyCode] 错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


async def handle_verify_2fa(request):
    """第三步：二步验证密码"""
    try:
        body = await request.json()
        phone = body.get("phone", "").strip()
        password = body.get("password", "").strip()

        if not phone or not password:
            return web.json_response({"success": False, "error": "参数不完整"}, status=400)

        session_data = login_sessions.get(phone)
        if not session_data or not session_data.get("needs_2fa"):
            return web.json_response({"success": False, "error": "登录会话已过期，请重新开始"}, status=400)

        client: Client = session_data["client"]

        try:
            await client.check_password(password)
        except PasswordHashInvalid:
            return web.json_response({"success": False, "error": "二步验证密码错误"}, status=400)

        session_string = await client.export_session_string()
        await client.disconnect()
        login_sessions.pop(phone, None)

        logger.info(f"[Verify2FA] {phone} 二步验证成功")
        return web.json_response({
            "success": True,
            "session_string": session_string,
            "message": "登录成功",
        })

    except FloodWait as e:
        return web.json_response({"success": False, "error": f"请求过于频繁，请等待 {e.value} 秒后重试"}, status=429)
    except Exception as e:
        logger.error(f"[Verify2FA] 错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


async def handle_test_session(request):
    """测试 Session 是否有效"""
    try:
        body = await request.json()
        session_string = body.get("session_string", "").strip()
        if not session_string:
            return web.json_response({"success": False, "error": "session_string 不能为空"}, status=400)

        client = Client(
            name="test_session",
            api_id=TG_API_ID,
            api_hash=TG_API_HASH,
            session_string=session_string,
            in_memory=True,
        )
        await client.start()
        me = await client.get_me()
        await client.stop()
        return web.json_response({
            "success": True,
            "user_id": me.id,
            "username": me.username,
            "first_name": me.first_name,
            "last_name": me.last_name,
        })
    except Exception as e:
        logger.error(f"[TestSession] 错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


async def handle_get_dialogs(request):
    """获取账号的群组/频道列表"""
    try:
        body = await request.json()
        session_string = body.get("session_string", "").strip()
        if not session_string:
            return web.json_response({"success": False, "error": "session_string 不能为空"}, status=400)

        client = Client(
            name="get_dialogs",
            api_id=TG_API_ID,
            api_hash=TG_API_HASH,
            session_string=session_string,
            in_memory=True,
        )
        await client.start()
        dialogs = []
        async for dialog in client.get_dialogs():
            chat = dialog.chat
            if chat.type.name not in ("GROUP", "SUPERGROUP", "CHANNEL"):
                continue
            dialogs.append({
                "id": str(chat.id),
                "title": chat.title or "",
                "username": chat.username or "",
                "type": chat.type.name.lower(),
                "members_count": getattr(chat, "members_count", None),
            })
        await client.stop()
        logger.info(f"[GetDialogs] 获取到 {len(dialogs)} 个群组/频道")
        return web.json_response({
            "success": True,
            "dialogs": dialogs,
        })
    except Exception as e:
        logger.error(f"[GetDialogs] 错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


async def handle_health(request):
    return web.json_response({"status": "ok"})


def main():
    app = web.Application()
    app.router.add_post("/send_code", handle_send_code)
    app.router.add_post("/verify_code", handle_verify_code)
    app.router.add_post("/verify_2fa", handle_verify_2fa)
    app.router.add_post("/test_session", handle_test_session)
    app.router.add_post("/get_dialogs", handle_get_dialogs)
    app.router.add_get("/health", handle_health)

    port = int(os.environ.get("LOGIN_SERVICE_PORT", "5050"))
    logger.info(f"Pyrogram 登录服务启动在 127.0.0.1:{port}")
    web.run_app(app, host="127.0.0.1", port=port)


if __name__ == "__main__":
    main()
