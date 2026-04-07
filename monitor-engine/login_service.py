"""
神探监控机器人 - Pyrofork 登录服务 v2.0
基于 Pyrofork (MTProto)，与监控引擎使用相同的 session 格式。

支持：
  1. 手机号 + 验证码 + 二步验证登录（生成 Pyrofork session_string）
  2. Session 字符串导入与测试
  3. 获取账号群组列表
  4. 账号信息查询
"""
import asyncio
import logging
import os
import time
from typing import Optional

try:
    from dotenv import load_dotenv
    _env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    load_dotenv(_env_path, override=True)
except ImportError:
    pass

from aiohttp import web
from pyrogram import Client
from pyrogram.errors import (
    PhoneCodeInvalid, PhoneCodeExpired, SessionPasswordNeeded,
    PasswordHashInvalid, FloodWait, PhoneNumberInvalid,
    AuthKeyUnregistered, SessionExpired, SessionRevoked
)

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("login-service")

TG_API_ID   = int(os.getenv("TG_API_ID", "0"))
TG_API_HASH = os.getenv("TG_API_HASH", "")

# 登录会话状态（内存存储，重启后需重新登录）
# phone -> {"client": Client, "state": str, "expires_at": float}
login_sessions: dict = {}
SESSION_TIMEOUT = 600  # 10 分钟超时


def _cleanup_expired_sessions():
    """清理过期的登录会话"""
    now = time.time()
    expired = [p for p, s in list(login_sessions.items()) if s.get("expires_at", 0) < now]
    for p in expired:
        session = login_sessions.pop(p, None)
        if session and session.get("client"):
            try:
                asyncio.create_task(session["client"].stop())
            except Exception:
                pass
        logger.info(f"[Cleanup] 已清理过期会话: {p}")


async def handle_send_code(request: web.Request) -> web.Response:
    """第一步：发送验证码到手机"""
    _cleanup_expired_sessions()
    try:
        body = await request.json()
        phone = body.get("phone", "").strip().replace(" ", "").replace("\u00a0", "")
        if not phone:
            return web.json_response({"success": False, "error": "手机号不能为空"}, status=400)
        if not TG_API_ID or not TG_API_HASH:
            return web.json_response({"success": False, "error": "TG API 凭证未配置，请在引擎 .env 中设置 TG_API_ID 和 TG_API_HASH"}, status=500)

        # 清理旧会话
        old = login_sessions.pop(phone, None)
        if old and old.get("client"):
            try:
                await old["client"].stop()
            except Exception:
                pass

        # 创建 Pyrofork 客户端（内存 session，不写文件）
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
            "state": "wait_code",
            "expires_at": time.time() + SESSION_TIMEOUT,
        }
        logger.info(f"[SendCode] {phone} 验证码已发送")
        return web.json_response({
            "success": True,
            "message": "验证码已发送",
            "next_step": "verify_code",
            "phone_code_hash": sent.phone_code_hash,
        })

    except PhoneNumberInvalid:
        return web.json_response({"success": False, "error": "手机号格式无效，请包含国际区号（如 +86...）"}, status=400)
    except FloodWait as e:
        return web.json_response({"success": False, "error": f"请求过于频繁，请等待 {e.value} 秒后重试"}, status=429)
    except Exception as e:
        logger.error(f"[SendCode] 错误: {e}", exc_info=True)
        return web.json_response({"success": False, "error": str(e)}, status=500)


async def handle_verify_code(request: web.Request) -> web.Response:
    """第二步：验证验证码"""
    try:
        body = await request.json()
        phone = body.get("phone", "").strip().replace(" ", "").replace("\u00a0", "")
        code  = body.get("code", "").strip()
        if not phone or not code:
            return web.json_response({"success": False, "error": "参数不完整"}, status=400)

        session_data = login_sessions.get(phone)
        if not session_data or session_data.get("state") != "wait_code":
            return web.json_response({"success": False, "error": "登录会话已过期，请重新发送验证码"}, status=400)
        if time.time() > session_data.get("expires_at", 0):
            login_sessions.pop(phone, None)
            return web.json_response({"success": False, "error": "登录会话已超时，请重新开始"}, status=400)

        client: Client = session_data["client"]
        phone_code_hash = session_data["phone_code_hash"]

        try:
            user = await client.sign_in(phone, phone_code_hash, code)
            # 登录成功，导出 session_string
            session_string = await client.export_session_string()
            await client.stop()
            login_sessions.pop(phone, None)
            logger.info(f"[VerifyCode] {phone} 登录成功，session_string 长度: {len(session_string)}")
            return web.json_response({
                "success": True,
                "message": "登录成功",
                "session_string": session_string,
                "next_step": "done",
            })
        except SessionPasswordNeeded:
            # 需要二步验证
            session_data["state"] = "wait_password"
            session_data["expires_at"] = time.time() + SESSION_TIMEOUT
            return web.json_response({
                "success": True,
                "message": "需要二步验证密码",
                "next_step": "verify_2fa",
            })
        except PhoneCodeInvalid:
            return web.json_response({"success": False, "error": "验证码错误，请重新输入"}, status=400)
        except PhoneCodeExpired:
            login_sessions.pop(phone, None)
            return web.json_response({"success": False, "error": "验证码已过期，请重新发送"}, status=400)

    except Exception as e:
        logger.error(f"[VerifyCode] 错误: {e}", exc_info=True)
        return web.json_response({"success": False, "error": str(e)}, status=500)


async def handle_verify_2fa(request: web.Request) -> web.Response:
    """第三步：二步验证密码"""
    try:
        body = await request.json()
        phone    = body.get("phone", "").strip().replace(" ", "").replace("\u00a0", "")
        password = body.get("password", "").strip()
        if not phone or not password:
            return web.json_response({"success": False, "error": "参数不完整"}, status=400)

        session_data = login_sessions.get(phone)
        if not session_data or session_data.get("state") != "wait_password":
            return web.json_response({"success": False, "error": "登录会话已过期，请重新开始"}, status=400)

        client: Client = session_data["client"]

        try:
            await client.check_password(password)
            # check_password 后 client 可能已自动 terminate，先导出 session 再安全停止
            session_string = await client.export_session_string()
            try:
                await client.stop()
            except ConnectionError:
                pass  # Client is already terminated，忽略
            login_sessions.pop(phone, None)
            logger.info(f"[Verify2FA] {phone} 二步验证成功，session_string 长度: {len(session_string)}")
            return web.json_response({
                "success": True,
                "message": "登录成功",
                "session_string": session_string,
                "next_step": "done",
            })
        except PasswordHashInvalid:
            return web.json_response({"success": False, "error": "二步验证密码错误"}, status=400)

    except Exception as e:
        logger.error(f"[Verify2FA] 错误: {e}", exc_info=True)
        return web.json_response({"success": False, "error": str(e)}, status=500)


async def handle_import_session(request: web.Request) -> web.Response:
    """导入 Pyrofork session_string，验证有效性并返回账号信息"""
    try:
        body = await request.json()
        session_string = body.get("session_string", "").strip()
        if not session_string:
            return web.json_response({"success": False, "error": "session_string 不能为空"}, status=400)

        client = Client(
            name="import_test",
            api_id=TG_API_ID,
            api_hash=TG_API_HASH,
            session_string=session_string,
            in_memory=True,
        )
        try:
            await client.start()
            me = await client.get_me()
            await client.stop()
            return web.json_response({
                "success": True,
                "message": "Session 有效",
                "session_string": session_string,
                "phone": me.phone_number or "",
                "username": me.username or "",
                "first_name": me.first_name or "",
            })
        except (AuthKeyUnregistered, SessionExpired, SessionRevoked):
            return web.json_response({"success": False, "error": "Session 已失效或被撤销"}, status=400)
        except Exception as e:
            return web.json_response({"success": False, "error": f"Session 验证失败: {e}"}, status=400)
        finally:
            try:
                await client.stop()
            except Exception:
                pass

    except Exception as e:
        logger.error(f"[ImportSession] 错误: {e}", exc_info=True)
        return web.json_response({"success": False, "error": str(e)}, status=500)


async def handle_test_session(request: web.Request) -> web.Response:
    """测试 session_string 有效性"""
    try:
        body = await request.json()
        session_string = body.get("session_string", "").strip()
        account_id     = body.get("account_id")
        if not session_string:
            return web.json_response({"success": False, "error": "session_string 不能为空"}, status=400)

        client = Client(
            name=f"test_{account_id or 'tmp'}",
            api_id=TG_API_ID,
            api_hash=TG_API_HASH,
            session_string=session_string,
            in_memory=True,
        )
        try:
            await client.start()
            me = await client.get_me()
            await client.stop()
            return web.json_response({
                "success": True,
                "valid": True,
                "phone": me.phone_number or "",
                "username": me.username or "",
                "first_name": me.first_name or "",
                "tg_user_id": str(me.id),
            })
        except (AuthKeyUnregistered, SessionExpired, SessionRevoked):
            return web.json_response({"success": True, "valid": False, "error": "Session 已失效"})
        except Exception as e:
            return web.json_response({"success": True, "valid": False, "error": str(e)})
        finally:
            try:
                await client.stop()
            except Exception:
                pass

    except Exception as e:
        logger.error(f"[TestSession] 错误: {e}", exc_info=True)
        return web.json_response({"success": False, "error": str(e)}, status=500)


async def handle_get_dialogs(request: web.Request) -> web.Response:
    """获取账号已加入的群组列表"""
    try:
        body = await request.json()
        session_string = body.get("session_string", "").strip()
        if not session_string:
            return web.json_response({"success": False, "error": "session_string 不能为空"}, status=400)

        client = Client(
            name="dialogs_tmp",
            api_id=TG_API_ID,
            api_hash=TG_API_HASH,
            session_string=session_string,
            in_memory=True,
        )
        try:
            await client.start()
            dialogs = []
            async for dialog in client.get_dialogs():
                chat = dialog.chat
                if chat and chat.type.name in ("GROUP", "SUPERGROUP"):
                    dialogs.append({
                        "id": str(chat.id),
                        "title": chat.title or "",
                        "username": chat.username or "",
                        "members_count": getattr(chat, "members_count", 0) or 0,
                    })
            await client.stop()
            return web.json_response({"success": True, "dialogs": dialogs, "total": len(dialogs)})
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)
        finally:
            try:
                await client.stop()
            except Exception:
                pass

    except Exception as e:
        logger.error(f"[GetDialogs] 错误: {e}", exc_info=True)
        return web.json_response({"success": False, "error": str(e)}, status=500)


async def handle_health(request: web.Request) -> web.Response:
    return web.json_response({
        "status": "ok",
        "engine": "pyrofork",
        "api_configured": bool(TG_API_ID and TG_API_HASH),
        "active_sessions": len(login_sessions),
    })


def main():
    app = web.Application()
    app.router.add_post("/send_code",       handle_send_code)
    app.router.add_post("/verify_code",     handle_verify_code)
    app.router.add_post("/verify_2fa",      handle_verify_2fa)
    app.router.add_post("/import_session",  handle_import_session)
    app.router.add_post("/test_session",    handle_test_session)
    app.router.add_post("/get_dialogs",     handle_get_dialogs)
    app.router.add_get("/health",           handle_health)
    port = int(os.environ.get("LOGIN_SERVICE_PORT", "7002"))
    logger.info(f"Pyrofork 登录服务启动在 127.0.0.1:{port}")
    web.run_app(app, host="127.0.0.1", port=port)


if __name__ == "__main__":
    main()
