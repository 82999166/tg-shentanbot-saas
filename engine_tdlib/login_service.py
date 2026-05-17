"""
神探监控机器人 - TDLib 登录服务 v5.0

替代原有的 Pyrogram login_service.py。
通过 HTTP API 提供登录流程（发送验证码 → 验证验证码 → 二步验证）。
Web 管理后台通过此服务完成 Telegram 账号登录。

接口完全兼容原有的 Pyrogram 登录服务（前端无需修改）。
登录成功后，TDLib session 自动持久化到本地文件，后续引擎启动直接复用。

所有配置从环境变量读取。
"""
import asyncio
import json
import logging
import os
import sys
import time
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Optional, Dict

# 环境变量加载
try:
    from dotenv import load_dotenv
    _env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(_env_path):
        load_dotenv(_env_path, override=True)
except ImportError:
    pass

from telegram.client import Telegram, AuthorizationState

# ─── 配置（从环境变量读取）──────────────────────────────────────
LOGIN_SERVICE_PORT = int(os.getenv("LOGIN_SERVICE_PORT", "7002"))
TG_API_ID = int(os.getenv("TG_API_ID", "0"))
TG_API_HASH = os.getenv("TG_API_HASH", "")
TDLIB_DATA_DIR = os.getenv("TDLIB_DATA_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "tdlib_data"))
TDLIB_VERBOSITY = int(os.getenv("TDLIB_VERBOSITY", "1"))
DB_ENCRYPTION_KEY = os.getenv("TDLIB_DB_KEY", "")

os.makedirs(TDLIB_DATA_DIR, exist_ok=True)

# ─── 日志 ──────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("tdlib-login-service")

# ─── 登录会话管理 ──────────────────────────────────────────
# 每个手机号一个 TDLib 实例，用于完成登录流程
_login_sessions: Dict[str, dict] = {}
_session_lock = threading.Lock()
SESSION_TIMEOUT = 300  # 5分钟超时


def _get_or_create_session(phone: str, api_id: int = 0, api_hash: str = "") -> dict:
    """获取或创建登录会话"""
    with _session_lock:
        if phone in _login_sessions:
            session = _login_sessions[phone]
            if time.time() - session['created_at'] < SESSION_TIMEOUT:
                return session
            else:
                # 超时，清理旧会话
                _cleanup_session(phone)

        # 使用传入的 api_id/api_hash 或环境变量默认值
        actual_api_id = api_id if api_id else TG_API_ID
        actual_api_hash = api_hash if api_hash else TG_API_HASH

        if not actual_api_id or not actual_api_hash:
            raise ValueError("TG_API_ID 和 TG_API_HASH 未配置")

        # 为登录创建临时 TDLib 实例
        # 使用 phone 作为目录名（临时的，登录成功后会移动到正式目录）
        safe_phone = phone.replace('+', '').replace(' ', '')
        session_dir = os.path.join(TDLIB_DATA_DIR, f"login_{safe_phone}")
        os.makedirs(session_dir, exist_ok=True)

        tg = Telegram(
            api_id=actual_api_id,
            api_hash=actual_api_hash,
            phone=phone,
            database_encryption_key=DB_ENCRYPTION_KEY,
            files_directory=session_dir,
            tdlib_verbosity=TDLIB_VERBOSITY,
            use_message_database=False,
        )

        session = {
            'phone': phone,
            'tg': tg,
            'session_dir': session_dir,
            'state': 'created',
            'created_at': time.time(),
            'api_id': actual_api_id,
            'api_hash': actual_api_hash,
        }
        _login_sessions[phone] = session
        return session


def _cleanup_session(phone: str):
    """清理登录会话"""
    with _session_lock:
        session = _login_sessions.pop(phone, None)
    if session:
        try:
            session['tg'].stop()
        except Exception:
            pass


def _move_session_to_account(phone: str, account_id: int):
    """将登录成功的 session 移动到正式的账号目录"""
    safe_phone = phone.replace('+', '').replace(' ', '')
    login_dir = os.path.join(TDLIB_DATA_DIR, f"login_{safe_phone}")
    account_dir = os.path.join(TDLIB_DATA_DIR, f"account_{account_id}")

    if os.path.exists(login_dir):
        # 如果目标目录已存在，先备份
        if os.path.exists(account_dir):
            import shutil
            backup_dir = f"{account_dir}_backup_{int(time.time())}"
            shutil.move(account_dir, backup_dir)
            logger.info(f"旧 session 已备份到 {backup_dir}")

        import shutil
        shutil.move(login_dir, account_dir)
        logger.info(f"Session 已移动: {login_dir} -> {account_dir}")


# ═══════════════════════════════════════════════════════════════
# HTTP API 处理
# ═══════════════════════════════════════════════════════════════

def handle_send_code(body: dict) -> dict:
    """发送验证码

    接口兼容原 Pyrogram 版本：
    - 输入: {phone, api_id?, api_hash?}
    - 输出: {success, message, phone_code_hash}
    """
    phone = body.get("phone", "").strip()
    api_id = body.get("api_id", 0)
    api_hash = body.get("api_hash", "")

    if not phone:
        return {"success": False, "error": "缺少 phone 参数"}

    # 确保手机号格式正确
    if not phone.startswith('+'):
        phone = f'+{phone}'

    try:
        session = _get_or_create_session(phone, api_id, api_hash)
        tg = session['tg']

        # TDLib 的登录流程是自动的，调用 login() 后它会自动发送验证码
        # 我们需要使用非阻塞方式来处理
        state = tg.login(blocking=False)

        # login(blocking=False) 直接返回当前 authorization state
        if state == AuthorizationState.WAIT_CODE:
            session['state'] = 'wait_code'
            logger.info(f"[{phone}] 验证码已发送")
            return {
                "success": True,
                "message": f"验证码已发送至 {phone}，请在 Telegram 中查收",
                "phone_code_hash": f"tdlib_{phone}",
            }
        elif state == AuthorizationState.WAIT_PASSWORD:
            session['state'] = 'wait_2fa'
            logger.info(f"[{phone}] 需要二步验证密码")
            return {
                "success": True,
                "message": "该账号需要二步验证密码",
                "needs_2fa": True,
                "next_step": "verify_2fa",
            }
        elif state == AuthorizationState.READY:
            session['state'] = 'ready'
            logger.info(f"[{phone}] 已登录（session 已存在）")
            return {
                "success": True,
                "message": "该账号已登录，无需验证码",
                "session_string": f"tdlib_session_{phone}",
            }
        else:
            return {"success": False, "error": f"登录状态异常: {state}"}

    except Exception as e:
        logger.error(f"[{phone}] 发送验证码失败: {e}", exc_info=True)
        _cleanup_session(phone)
        return {"success": False, "error": str(e)}


def handle_verify_code(body: dict) -> dict:
    """验证验证码

    接口兼容原 Pyrogram 版本：
    - 输入: {phone, code, phone_code_hash?}
    - 输出: {success, session_string} 或 {success, needs_2fa}
    """
    phone = body.get("phone", "").strip()
    code = body.get("code", "").strip()

    if not phone or not code:
        return {"success": False, "error": "缺少 phone 或 code 参数"}

    if not phone.startswith('+'):
        phone = f'+{phone}'

    with _session_lock:
        session = _login_sessions.get(phone)
    if not session:
        return {"success": False, "error": "登录会话不存在或已过期，请重新发送验证码"}

    try:
        tg = session['tg']

        # 发送验证码到 TDLib
        result = tg.send_code(code)
        result.wait(timeout=30)

        if result.error:
            error_msg = str(result.error_info)
            if 'PHONE_CODE_INVALID' in error_msg:
                return {"success": False, "error": "验证码错误，请重新输入"}
            elif 'PHONE_CODE_EXPIRED' in error_msg:
                _cleanup_session(phone)
                return {"success": False, "error": "验证码已过期，请重新发送"}
            return {"success": False, "error": f"验证失败: {error_msg}"}

        # 检查验证后的状态
        max_wait = 10
        waited = 0
        while waited < max_wait:
            auth_state = tg.authorization_state
            if auth_state == AuthorizationState.WAIT_PASSWORD:
                session['state'] = 'wait_2fa'
                return {
                    "success": True,
                    "needs_2fa": True,
                    "next_step": "verify_2fa",
                    "message": "该账号已开启二步验证，请输入密码",
                }
            elif auth_state == AuthorizationState.READY:
                session['state'] = 'ready'
                logger.info(f"[{phone}] 登录成功！")
                return {
                    "success": True,
                    "session_string": f"tdlib_session_{phone}",
                    "message": "登录成功",
                }
            time.sleep(0.5)
            waited += 0.5

        return {"success": False, "error": f"验证码验证后状态异常: {tg.authorization_state}"}

    except Exception as e:
        logger.error(f"[{phone}] 验证码验证失败: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


def handle_verify_2fa(body: dict) -> dict:
    """二步验证

    接口兼容原 Pyrogram 版本：
    - 输入: {phone, password}
    - 输出: {success, session_string}
    """
    phone = body.get("phone", "").strip()
    password = body.get("password", "")

    if not phone or not password:
        return {"success": False, "error": "缺少 phone 或 password 参数"}

    if not phone.startswith('+'):
        phone = f'+{phone}'

    with _session_lock:
        session = _login_sessions.get(phone)
    if not session:
        return {"success": False, "error": "登录会话不存在或已过期，请重新发送验证码"}

    try:
        tg = session['tg']

        # 发送二步验证密码
        result = tg.send_password(password)
        result.wait(timeout=30)

        if result.error:
            error_msg = str(result.error_info)
            if 'PASSWORD_HASH_INVALID' in error_msg:
                return {"success": False, "error": "二步验证密码错误"}
            return {"success": False, "error": f"二步验证失败: {error_msg}"}

        # 等待登录完成
        max_wait = 10
        waited = 0
        while waited < max_wait:
            if tg.authorization_state == AuthorizationState.READY:
                session['state'] = 'ready'
                logger.info(f"[{phone}] 二步验证成功，登录完成！")
                return {
                    "success": True,
                    "session_string": f"tdlib_session_{phone}",
                    "message": "登录成功",
                }
            time.sleep(0.5)
            waited += 0.5

        return {"success": False, "error": f"二步验证后状态异常: {tg.authorization_state}"}

    except Exception as e:
        logger.error(f"[{phone}] 二步验证失败: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


def handle_finalize_login(body: dict) -> dict:
    """完成登录并将 session 移动到正式目录

    这是新增的接口，Web 端在 saveAccount 成功后调用。
    - 输入: {phone, account_id}
    - 输出: {success}
    """
    phone = body.get("phone", "").strip()
    account_id = body.get("account_id")

    if not phone or not account_id:
        return {"success": False, "error": "缺少 phone 或 account_id 参数"}

    if not phone.startswith('+'):
        phone = f'+{phone}'

    try:
        # 先停止 TDLib 实例（释放文件锁）
        with _session_lock:
            session = _login_sessions.get(phone)
        if session:
            try:
                session['tg'].stop()
            except Exception:
                pass
            time.sleep(1)

        # 移动 session 文件到正式目录
        _move_session_to_account(phone, account_id)

        # 清理登录会话
        with _session_lock:
            _login_sessions.pop(phone, None)

        logger.info(f"[{phone}] Session 已迁移到 account_{account_id}")
        return {"success": True, "message": f"Session 已保存到 account_{account_id}"}

    except Exception as e:
        logger.error(f"[{phone}] 完成登录失败: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


def handle_check_session(body: dict) -> dict:
    """检查账号的 TDLib session 是否存在

    - 输入: {account_id}
    - 输出: {success, exists, session_dir}
    """
    account_id = body.get("account_id")
    if not account_id:
        return {"success": False, "error": "缺少 account_id 参数"}

    session_dir = os.path.join(TDLIB_DATA_DIR, f"account_{account_id}")
    td_db = os.path.join(session_dir, "td.binlog")
    exists = os.path.exists(td_db)

    return {
        "success": True,
        "exists": exists,
        "session_dir": session_dir,
    }


def handle_test_session(body: dict) -> dict:
    """测试 session 连接（兼容 Pyrogram 和 TDLib 两种模式）

    - 输入: {session_string} 或 {account_id}
    - 输出: {success, user_id, username, first_name}
    """
    account_id = body.get("account_id")
    session_string = body.get("session_string", "")

    # TDLib 模式：通过 account_id 测试
    if account_id or (session_string and session_string.startswith("tdlib_session_")):
        if not account_id:
            # 从 session_string 推断（兼容旧逻辑）
            return {"success": False, "error": "TDLib 模式需要 account_id 参数"}

        session_dir = os.path.join(TDLIB_DATA_DIR, f"account_{account_id}")
        td_db = os.path.join(session_dir, "td.binlog")

        if not os.path.exists(td_db):
            return {"success": False, "error": "Session 文件不存在，请重新登录"}

        try:
            # 创建临时 TDLib 实例来验证 session
            tg = Telegram(
                api_id=TG_API_ID,
                api_hash=TG_API_HASH,
                phone="+0000000000",  # 占位，不会用到
                database_encryption_key=DB_ENCRYPTION_KEY,
                files_directory=session_dir,
                tdlib_verbosity=0,
                use_message_database=False,
            )

            state = tg.login(blocking=False)

            if state == AuthorizationState.READY:
                # 获取用户信息
                result = tg.get_me()
                result.wait(timeout=10)

                if result.error:
                    tg.stop()
                    return {"success": False, "error": f"获取用户信息失败: {result.error_info}"}

                me = result.update
                tg.stop()

                return {
                    "success": True,
                    "user_id": me.get("id"),
                    "username": me.get("usernames", {}).get("editable_username", "") if me.get("usernames") else (me.get("username", "")),
                    "first_name": me.get("first_name", ""),
                    "last_name": me.get("last_name", ""),
                }
            else:
                tg.stop()
                return {"success": False, "error": f"Session 已失效（状态: {state}），请重新登录"}

        except Exception as e:
            logger.error(f"[account_{account_id}] test_session 失败: {e}", exc_info=True)
            return {"success": False, "error": str(e)}

    # Pyrogram 模式（兼容旧账号）
    elif session_string:
        return {"success": False, "error": "Pyrogram session 测试需要旧版登录服务"}

    else:
        return {"success": False, "error": "缺少 account_id 或 session_string 参数"}


def handle_get_dialogs(body: dict) -> dict:
    """获取账号的对话列表（群组/频道）

    - 输入: {session_string} 或 {account_id}
    - 输出: {success, dialogs: [{id, title, username, type, members_count}]}
    """
    account_id = body.get("account_id")
    session_string = body.get("session_string", "")

    # 确定 session 目录
    if account_id:
        session_dir = os.path.join(TDLIB_DATA_DIR, f"account_{account_id}")
    elif session_string and session_string.startswith("tdlib_session_"):
        return {"success": False, "error": "请使用 account_id 参数"}
    else:
        return {"success": False, "error": "缺少 account_id 参数"}

    td_db = os.path.join(session_dir, "td.binlog")
    if not os.path.exists(td_db):
        return {"success": False, "error": "Session 文件不存在"}

    try:
        tg = Telegram(
            api_id=TG_API_ID,
            api_hash=TG_API_HASH,
            phone="+0000000000",
            database_encryption_key=DB_ENCRYPTION_KEY,
            files_directory=session_dir,
            tdlib_verbosity=0,
            use_message_database=False,
        )

        state = tg.login(blocking=False)
        if state != AuthorizationState.READY:
            tg.stop()
            return {"success": False, "error": f"Session 未就绪: {state}"}

        # 获取对话列表
        dialogs = []
        offset_order = 2**63 - 1
        offset_chat_id = 0
        limit = 100

        for _ in range(50):  # 最多获取 5000 个对话
            result = tg.call_method('getChats', {
                'chat_list': {'@type': 'chatListMain'},
                'limit': limit,
            })
            result.wait(timeout=30)

            if result.error:
                break

            chat_ids = result.update.get('chat_ids', [])
            if not chat_ids:
                break

            for chat_id in chat_ids:
                chat_result = tg.call_method('getChat', {'chat_id': chat_id})
                chat_result.wait(timeout=10)

                if chat_result.error:
                    continue

                chat = chat_result.update
                chat_type = chat.get('type', {}).get('@type', '')

                # 只返回群组和频道
                if chat_type in ('chatTypeSupergroup', 'chatTypeBasicGroup'):
                    # 获取 supergroup 信息
                    username = ""
                    members_count = None
                    if chat_type == 'chatTypeSupergroup':
                        sg_id = chat['type'].get('supergroup_id')
                        if sg_id:
                            sg_result = tg.call_method('getSupergroup', {'supergroup_id': sg_id})
                            sg_result.wait(timeout=10)
                            if not sg_result.error:
                                sg = sg_result.update
                                username = sg.get('usernames', {}).get('editable_username', '') if sg.get('usernames') else (sg.get('username', ''))
                                members_count = sg.get('member_count')

                    dialogs.append({
                        'id': str(chat_id),
                        'title': chat.get('title', ''),
                        'username': username,
                        'type': 'supergroup' if chat_type == 'chatTypeSupergroup' else 'group',
                        'members_count': members_count,
                    })

            if len(chat_ids) < limit:
                break

        tg.stop()

        return {
            "success": True,
            "dialogs": dialogs,
            "count": len(dialogs),
        }

    except Exception as e:
        logger.error(f"[account_{account_id}] get_dialogs 失败: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


# ═══════════════════════════════════════════════════════════════
# HTTP 服务器
# ═══════════════════════════════════════════════════════════════

class LoginServiceHandler(BaseHTTPRequestHandler):
    """HTTP 请求处理器"""

    ROUTES = {
        '/send_code': handle_send_code,
        '/verify_code': handle_verify_code,
        '/verify_2fa': handle_verify_2fa,
        '/finalize_login': handle_finalize_login,
        '/check_session': handle_check_session,
        '/test_session': handle_test_session,
        '/get_dialogs': handle_get_dialogs,
    }

    def log_message(self, format, *args):
        logger.debug(f"HTTP: {format % args}")

    def do_GET(self):
        if self.path == '/health':
            self._respond({"status": "ok", "version": "v5.0-tdlib", "sessions": len(_login_sessions)})
        else:
            self._respond({"error": "Not found"}, 404)

    def do_POST(self):
        handler = self.ROUTES.get(self.path)
        if not handler:
            self._respond({"error": f"Unknown endpoint: {self.path}"}, 404)
            return

        try:
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length)) if length > 0 else {}
        except Exception:
            self._respond({"success": False, "error": "Invalid JSON body"}, 400)
            return

        try:
            result = handler(body)
            status = 200 if result.get("success", True) else 400
            self._respond(result, status)
        except Exception as e:
            logger.error(f"处理 {self.path} 异常: {e}", exc_info=True)
            self._respond({"success": False, "error": str(e)}, 500)

    def _respond(self, data: dict, status: int = 200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode())


def _cleanup_expired_sessions():
    """定时清理过期的登录会话"""
    while True:
        time.sleep(60)
        now = time.time()
        expired = []
        with _session_lock:
            for phone, session in _login_sessions.items():
                if now - session['created_at'] > SESSION_TIMEOUT:
                    expired.append(phone)
        for phone in expired:
            logger.info(f"清理过期登录会话: {phone}")
            _cleanup_session(phone)


def main():
    logger.info(f"═══ TDLib 登录服务 v5.0 启动 ═══")
    logger.info(f"端口: {LOGIN_SERVICE_PORT}")
    logger.info(f"TDLib 数据目录: {TDLIB_DATA_DIR}")
    logger.info(f"API ID: {TG_API_ID}")

    if not TG_API_ID or not TG_API_HASH:
        logger.warning("TG_API_ID 或 TG_API_HASH 未在环境变量中配置，将依赖 Web 端传入")

    # 启动过期会话清理线程
    threading.Thread(target=_cleanup_expired_sessions, daemon=True).start()

    # 启动 HTTP 服务器
    server = HTTPServer(('0.0.0.0', LOGIN_SERVICE_PORT), LoginServiceHandler)
    logger.info(f"登录服务已启动: http://0.0.0.0:{LOGIN_SERVICE_PORT}")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("登录服务停止")
        server.shutdown()


if __name__ == "__main__":
    main()
