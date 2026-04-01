#!/usr/bin/env python3
"""
TG Monitor Pro - TDLib 登录服务
基于 pytdbot + tdjson，提供 HTTP API 供 Web 后端调用。
支持：
  1. 手机号 + 验证码 + 二步验证登录（生成持久化 TDLib 数据目录）
  2. Session 文件（.session / session_string）导入
  3. Session 有效性测试
  4. 获取账号群组列表
  5. 账号信息查询
"""
import asyncio
import json
import logging
import os
import time
import tempfile
import shutil
from typing import Optional

try:
    from dotenv import load_dotenv
    _env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    load_dotenv(_env_path, override=True)
except ImportError:
    pass

from aiohttp import web

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("login-service")

TG_API_ID = int(os.getenv("TG_API_ID", "0"))
TG_API_HASH = os.getenv("TG_API_HASH", "")
TDLIB_DATA_DIR = os.getenv("TDLIB_DATA_DIR", os.path.join(_BASE_DIR, "tdlib_data"))

# 登录会话状态（临时内存存储，重启后需重新登录）
# phone -> {"client": TDClient, "state": str, "phone_code_hash": str, "expires_at": float}
login_sessions: dict = {}
SESSION_TIMEOUT = 600  # 10 分钟超时


def _cleanup_expired_sessions():
    """清理过期的登录会话"""
    now = time.time()
    expired = [p for p, s in login_sessions.items() if s.get("expires_at", 0) < now]
    for p in expired:
        session = login_sessions.pop(p, None)
        if session and session.get("client"):
            try:
                asyncio.create_task(session["client"].close())
            except Exception:
                pass


async def _create_tdlib_client(account_id: str, phone: str = None) -> object:
    """创建 TDLib 客户端实例（用于登录流程）"""
    from pytdbot import Client as TDClient
    files_dir = os.path.join(TDLIB_DATA_DIR, f"login_{account_id}")
    os.makedirs(files_dir, exist_ok=True)
    client = TDClient(
        api_id=TG_API_ID,
        api_hash=TG_API_HASH,
        files_directory=files_dir,
        use_message_database=False,  # 登录阶段不需要消息数据库
        use_chat_info_database=False,
        use_file_database=False,
        td_verbosity=1,
        user_bot=True,
    )
    return client, files_dir


async def handle_send_code(request: web.Request) -> web.Response:
    """第一步：发送验证码到手机"""
    _cleanup_expired_sessions()
    try:
        body = await request.json()
        phone = body.get("phone", "").strip().replace(" ", "").replace("\u00a0", "")
        if not phone:
            return web.json_response({"success": False, "error": "手机号不能为空"}, status=400)
        if not TG_API_ID or not TG_API_HASH:
            return web.json_response({"success": False, "error": "TG API 凭证未配置"}, status=500)

        # 如果已有会话，先清理
        old_session = login_sessions.pop(phone, None)
        if old_session and old_session.get("client"):
            try:
                await old_session["client"].close()
            except Exception:
                pass

        # 使用临时账号 ID 创建登录客户端
        # 清理旧的临时登录session目录，避免TDLib残留导致WaitPassword
        import shutil, os
        _temp_id_clean = f"temp_{phone.replace("+", "").replace(" ", "")}"
        _old_dir = os.path.join(TDLIB_DATA_DIR, f"login_{_temp_id_clean}")
        if os.path.exists(_old_dir):
            shutil.rmtree(_old_dir, ignore_errors=True)
            logger.info(f"[SendCode] 已清理旧session目录: {_old_dir}")
        temp_id = f"temp_{phone.replace('+', '').replace(' ', '')}"
        client, files_dir = await _create_tdlib_client(temp_id, phone)

        # 启动客户端并等待认证状态
        auth_state_event = asyncio.Event()
        auth_state_result = {"state": None, "error": None}

        @client.on_updateAuthorizationState()
        async def on_auth(c, update):
            from pytdbot import types as tg_types
            state = update.authorization_state if hasattr(update, 'authorization_state') else update
            # 获取状态类型名（兼容对象和字典两种格式）
            if hasattr(state, 'ID') and state.ID:
                state_type = state.ID
            elif isinstance(state, dict):
                state_type = state.get("@type", "")
            else:
                state_type = type(state).__name__
            logger.info(f"[SendCode] 认证状态: {state_type}")
            if isinstance(state, tg_types.AuthorizationStateWaitPhoneNumber) or state_type in ("authorizationStateWaitPhoneNumber", "AuthorizationStateWaitPhoneNumber"):
                # 发送手机号
                result = await c.invoke({
                    "@type": "setAuthenticationPhoneNumber",
                    "phone_number": phone,
                    "settings": {"@type": "phoneNumberAuthenticationSettings", "allow_flash_call": False, "is_current_phone_number": False}
                })
                logger.info(f"[SendCode] 已发送手机号 {phone}: {result}")
            elif isinstance(state, tg_types.AuthorizationStateWaitCode) or state_type in ("authorizationStateWaitCode", "AuthorizationStateWaitCode"):
                auth_state_result["state"] = "wait_code"
                auth_state_event.set()
            elif isinstance(state, tg_types.AuthorizationStateWaitPassword) or state_type in ("authorizationStateWaitPassword", "AuthorizationStateWaitPassword"):
                auth_state_result["state"] = "wait_password"
                auth_state_event.set()
            elif isinstance(state, tg_types.AuthorizationStateReady) or state_type in ("authorizationStateReady", "AuthorizationStateReady"):
                auth_state_result["state"] = "ready"
                auth_state_event.set()
            elif state_type in ("authorizationStateClosing", "authorizationStateClosed", "AuthorizationStateClosing", "AuthorizationStateClosed"):
                auth_state_result["state"] = "closed"
                auth_state_event.set()

        # 在后台启动客户端
        task = asyncio.create_task(client.start())
        try:
            await asyncio.wait_for(auth_state_event.wait(), timeout=30)
        except asyncio.TimeoutError:
            task.cancel()
            return web.json_response({"success": False, "error": "发送验证码超时，请检查手机号是否正确"}, status=408)

        if auth_state_result["state"] == "wait_code":
            login_sessions[phone] = {
                "client": client,
                "task": task,
                "files_dir": files_dir,
                "state": "wait_code",
                "expires_at": time.time() + SESSION_TIMEOUT,
            }
            logger.info(f"[SendCode] {phone} 验证码已发送")
            return web.json_response({"success": True, "message": "验证码已发送", "next_step": "verify_code", "phone_code_hash": "tdlib_session"})
        elif auth_state_result["state"] == "ready":
            # 已登录（已有有效 Session）
            login_sessions[phone] = {
                "client": client,
                "task": task,
                "files_dir": files_dir,
                "state": "ready",
                "expires_at": time.time() + SESSION_TIMEOUT,
            }
            return web.json_response({"success": True, "message": "账号已登录", "next_step": "already_logged_in", "phone_code_hash": "tdlib_session"})
        elif auth_state_result["state"] == "wait_password":
            task.cancel()
            # TDLib残留旧session，清理后告知用户重试
            import shutil
            shutil.rmtree(files_dir, ignore_errors=True)
            task.cancel()
            return web.json_response({"success": False, "error": "账号session已过期，已自动清理，请重新点击添加账号"}, status=400)
    except Exception as e:
        logger.error(f"[SendCode] 错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


async def handle_verify_code(request: web.Request) -> web.Response:
    """第二步：验证验证码"""
    try:
        body = await request.json()
        phone = body.get("phone", "").strip().replace(" ", "").replace("\u00a0", "")
        code = body.get("code", "").strip()
        if not phone or not code:
            return web.json_response({"success": False, "error": "参数不完整"}, status=400)

        session_data = login_sessions.get(phone)
        if not session_data or session_data.get("state") != "wait_code":
            return web.json_response({"success": False, "error": "登录会话已过期，请重新发送验证码"}, status=400)
        if time.time() > session_data.get("expires_at", 0):
            login_sessions.pop(phone, None)
            return web.json_response({"success": False, "error": "登录会话已超时，请重新开始"}, status=400)

        client = session_data["client"]
        auth_event = asyncio.Event()
        auth_result = {"state": None, "error": None}

        @client.on_updateAuthorizationState()
        async def on_auth(c, update):
            from pytdbot import types as tg_types
            state = update.authorization_state if hasattr(update, 'authorization_state') else update
            if hasattr(state, 'ID') and state.ID:
                state_type = state.ID
            elif isinstance(state, dict):
                state_type = state.get("@type", "")
            else:
                state_type = type(state).__name__
            if isinstance(state, tg_types.AuthorizationStateReady) or state_type in ("authorizationStateReady", "AuthorizationStateReady"):
                auth_result["state"] = "ready"
                auth_event.set()
            elif isinstance(state, tg_types.AuthorizationStateWaitPassword) or state_type in ("authorizationStateWaitPassword", "AuthorizationStateWaitPassword"):
                auth_result["state"] = "wait_password"
                auth_event.set()

        # 提交验证码
        result = await client.invoke({
            "@type": "checkAuthenticationCode",
            "code": code,
        })
        logger.info(f"[VerifyCode] 提交验证码结果: {result}")

        try:
            await asyncio.wait_for(auth_event.wait(), timeout=15)
        except asyncio.TimeoutError:
            pass

        if auth_result["state"] == "ready":
            files_dir = session_data["files_dir"]
            login_sessions.pop(phone, None)
            logger.info(f"[VerifyCode] {phone} 登录成功，数据目录: {files_dir}")
            return web.json_response({
                "success": True,
                "message": "登录成功",
                "files_directory": files_dir,
                "next_step": "done",
            })
        elif auth_result["state"] == "wait_password":
            session_data["state"] = "wait_password"
            session_data["expires_at"] = time.time() + SESSION_TIMEOUT
            return web.json_response({
                "success": True,
                "message": "需要二步验证密码",
                "next_step": "verify_2fa",
            })
        else:
            return web.json_response({"success": False, "error": "验证码错误或已过期"}, status=400)
    except Exception as e:
        logger.error(f"[VerifyCode] 错误: {e}")
        err_str = str(e).lower()
        if "code" in err_str and ("invalid" in err_str or "wrong" in err_str):
            return web.json_response({"success": False, "error": "验证码错误，请重新输入"}, status=400)
        if "expired" in err_str:
            login_sessions.pop(phone, None)
            return web.json_response({"success": False, "error": "验证码已过期，请重新发送"}, status=400)
        return web.json_response({"success": False, "error": str(e)}, status=500)


async def handle_verify_2fa(request: web.Request) -> web.Response:
    """第三步：二步验证密码"""
    try:
        body = await request.json()
        phone = body.get("phone", "").strip().replace(" ", "").replace("\u00a0", "")
        password = body.get("password", "").strip()
        if not phone or not password:
            return web.json_response({"success": False, "error": "参数不完整"}, status=400)

        session_data = login_sessions.get(phone)
        if not session_data or session_data.get("state") != "wait_password":
            return web.json_response({"success": False, "error": "登录会话已过期，请重新开始"}, status=400)

        client = session_data["client"]
        auth_event = asyncio.Event()
        auth_result = {"state": None}

        @client.on_updateAuthorizationState()
        async def on_auth(c, update):
            from pytdbot import types as tg_types
            state = update.authorization_state if hasattr(update, 'authorization_state') else update
            if hasattr(state, 'ID') and state.ID:
                state_type = state.ID
            elif isinstance(state, dict):
                state_type = state.get("@type", "")
            else:
                state_type = type(state).__name__
            if isinstance(state, tg_types.AuthorizationStateReady) or state_type in ("authorizationStateReady", "AuthorizationStateReady"):
                auth_result["state"] = "ready"
                auth_event.set()

        result = await client.invoke({
            "@type": "checkAuthenticationPassword",
            "password": password,
        })
        logger.info(f"[Verify2FA] 提交密码结果: {result}")

        try:
            await asyncio.wait_for(auth_event.wait(), timeout=15)
        except asyncio.TimeoutError:
            pass

        if auth_result["state"] == "ready":
            files_dir = session_data["files_dir"]
            login_sessions.pop(phone, None)
            logger.info(f"[Verify2FA] {phone} 二步验证成功，数据目录: {files_dir}")
            return web.json_response({
                "success": True,
                "message": "登录成功",
                "files_directory": files_dir,
                "next_step": "done",
            })
        else:
            return web.json_response({"success": False, "error": "二步验证密码错误"}, status=400)
    except Exception as e:
        logger.error(f"[Verify2FA] 错误: {e}")
        err_str = str(e).lower()
        if "password" in err_str and ("invalid" in err_str or "wrong" in err_str):
            return web.json_response({"success": False, "error": "二步验证密码错误"}, status=400)
        return web.json_response({"success": False, "error": str(e)}, status=500)


async def handle_import_session(request: web.Request) -> web.Response:
    """
    导入 Pyrogram session_string 或上传 .session 文件。
    TDLib 使用持久化目录，此接口将 session_string 转换为 TDLib 可用的登录态。
    注意：由于 Pyrogram 和 TDLib 的 session 格式不兼容，
    此接口通过 session_string 启动 Pyrogram 客户端获取手机号，
    然后指导用户使用手机号重新登录 TDLib。
    """
    try:
        body = await request.json()
        session_string = body.get("session_string", "").strip()
        account_id = body.get("account_id", "").strip()
        if not session_string:
            return web.json_response({"success": False, "error": "session_string 不能为空"}, status=400)

        # 尝试用 Pyrogram 验证 session_string 并获取账号信息
        try:
            from pyrogram import Client as PyroClient
            client = PyroClient(
                name="import_test",
                api_id=TG_API_ID,
                api_hash=TG_API_HASH,
                session_string=session_string,
                in_memory=True,
            )
            await client.start()
            me = await client.get_me()
            phone = me.phone_number
            user_id = me.id
            username = me.username
            first_name = me.first_name
            await client.stop()
            logger.info(f"[ImportSession] Pyrogram session 有效: @{username or user_id} ({phone})")
            return web.json_response({
                "success": True,
                "session_string": session_string,
                "user_id": user_id,
                "username": username,
                "first_name": first_name,
                "phone": phone,
                "message": "Session 有效，已导入",
                "note": "已保存 session_string，监控引擎将使用 TDLib 重新建立连接",
            })
        except ImportError:
            # Pyrogram 未安装，直接返回 session_string（由调用方存储）
            return web.json_response({
                "success": True,
                "session_string": session_string,
                "message": "Session 已接收（无法验证，请确认账号有效）",
            })
        except Exception as e:
            logger.warning(f"[ImportSession] Pyrogram 验证失败: {e}")
            return web.json_response({
                "success": True,
                "session_string": session_string,
                "message": "Session 已接收（验证跳过）",
                "warning": str(e)[:100],
            })
    except Exception as e:
        logger.error(f"[ImportSession] 错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


async def handle_test_session(request: web.Request) -> web.Response:
    """测试 TDLib 账号数据目录是否有效（账号是否已登录）"""
    try:
        body = await request.json()
        account_id = body.get("account_id", "").strip()
        session_string = body.get("session_string", "").strip()

        if session_string:
            # 用 Pyrogram 测试 session_string
            try:
                from pyrogram import Client as PyroClient
                client = PyroClient(
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
                    "phone": me.phone_number,
                })
            except Exception as e:
                return web.json_response({"success": False, "error": str(e)}, status=400)

        if account_id:
            files_dir = os.path.join(TDLIB_DATA_DIR, f"account_{account_id}")
            # 兼容两种目录结构：account_{id}/database/td.binlog 或 account_{id}/td.binlog
            binlog_paths = [
                os.path.join(files_dir, "database", "td.binlog"),
                os.path.join(files_dir, "td.binlog"),
            ]
            binlog_exists = any(os.path.exists(p) for p in binlog_paths)
            if os.path.exists(files_dir) and binlog_exists:
                return web.json_response({"success": True, "message": "TDLib 数据目录存在", "files_directory": files_dir})
            else:
                return web.json_response({"success": False, "error": "TDLib 数据目录不存在或未登录"}, status=404)

        return web.json_response({"success": False, "error": "需要 account_id 或 session_string"}, status=400)
    except Exception as e:
        logger.error(f"[TestSession] 错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


async def handle_get_dialogs(request: web.Request) -> web.Response:
    """获取账号的群组/频道列表"""
    try:
        body = await request.json()
        session_string = body.get("session_string", "").strip()
        if not session_string:
            return web.json_response({"success": False, "error": "session_string 不能为空"}, status=400)

        try:
            from pyrogram import Client as PyroClient
            client = PyroClient(
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
            return web.json_response({"success": True, "dialogs": dialogs})
        except ImportError:
            return web.json_response({"success": False, "error": "Pyrogram 未安装，无法获取群组列表"}, status=500)
        except Exception as e:
            logger.error(f"[GetDialogs] 错误: {e}")
            return web.json_response({"success": False, "error": str(e)}, status=500)
    except Exception as e:
        logger.error(f"[GetDialogs] 外层错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


async def handle_health(request: web.Request) -> web.Response:
    return web.json_response({
        "status": "ok",
        "engine": "tdlib",
        "api_configured": bool(TG_API_ID and TG_API_HASH),
        "active_sessions": len(login_sessions),
    })


def main():
    app = web.Application()
    app.router.add_post("/send_code", handle_send_code)
    app.router.add_post("/verify_code", handle_verify_code)
    app.router.add_post("/verify_2fa", handle_verify_2fa)
    app.router.add_post("/import_session", handle_import_session)
    app.router.add_post("/test_session", handle_test_session)
    app.router.add_post("/get_dialogs", handle_get_dialogs)
    app.router.add_get("/health", handle_health)
    port = int(os.environ.get("LOGIN_SERVICE_PORT", "5050"))
    logger.info(f"TDLib 登录服务启动在 127.0.0.1:{port}")
    web.run_app(app, host="127.0.0.1", port=port)


if __name__ == "__main__":
    main()
