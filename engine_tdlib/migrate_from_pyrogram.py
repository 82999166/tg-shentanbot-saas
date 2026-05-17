"""
神探监控引擎 - Pyrogram → TDLib 迁移工具

将现有的 Pyrogram session_string 账号迁移到 TDLib。
由于 Pyrogram 和 TDLib 的 session 格式完全不同，
无法直接转换，需要重新登录。

此工具的作用：
1. 读取数据库中所有已有账号的 phone
2. 为每个账号创建 TDLib session 目录
3. 提示管理员通过 Web 后台重新登录每个账号

如果账号之前通过 TDLib 登录服务登录过（session 已存在），
则跳过该账号。

用法: python3 migrate_from_pyrogram.py
"""
import os
import sys
import json
import requests

# 环境变量加载
try:
    from dotenv import load_dotenv
    _env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(_env_path):
        load_dotenv(_env_path, override=True)
except ImportError:
    pass

API_BASE = os.getenv("WEB_API_BASE", "http://127.0.0.1:7000/api")
ENGINE_SECRET = os.getenv("ENGINE_SECRET", "")
TDLIB_DATA_DIR = os.getenv("TDLIB_DATA_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "tdlib_data"))


def main():
    print("═══════════════════════════════════════════════════")
    print(" Pyrogram → TDLib 迁移工具")
    print("═══════════════════════════════════════════════════")
    print()

    # 获取所有账号
    headers = {"X-Engine-Secret": ENGINE_SECRET}
    try:
        r = requests.get(f"{API_BASE}/engine/config", headers=headers, timeout=10)
        config = r.json()
    except Exception as e:
        print(f"✗ 无法连接 Web API: {e}")
        sys.exit(1)

    accounts = config.get("accounts", [])
    if not accounts:
        print("✗ 未找到任何账号")
        sys.exit(1)

    print(f"找到 {len(accounts)} 个账号：")
    print()

    migrated = 0
    need_login = 0
    already_done = 0

    for acc in accounts:
        acc_id = acc.get("id")
        phone = acc.get("phone", "")
        session_string = acc.get("sessionString", "")
        is_active = acc.get("isActive", False)

        # 检查 TDLib session 是否已存在
        session_dir = os.path.join(TDLIB_DATA_DIR, f"account_{acc_id}")
        td_db = os.path.join(session_dir, "td.binlog")

        status = ""
        if os.path.exists(td_db):
            status = "✓ TDLib session 已存在"
            already_done += 1
        elif phone:
            status = "⚠ 需要通过 Web 后台重新登录"
            need_login += 1
            # 创建目录（为后续登录准备）
            os.makedirs(session_dir, exist_ok=True)
        elif session_string:
            status = "⚠ 有 Pyrogram session 但无手机号，需补充手机号后登录"
            need_login += 1
        else:
            status = "✗ 无 session 也无手机号"

        active_mark = "🟢" if is_active else "⚪"
        print(f"  {active_mark} ACC{acc_id}: phone={phone or '(无)'} | {status}")

    print()
    print("═══════════════════════════════════════════════════")
    print(f" 统计: 已完成={already_done}, 需登录={need_login}, 总计={len(accounts)}")
    print("═══════════════════════════════════════════════════")
    print()

    if need_login > 0:
        print("迁移步骤：")
        print("  1. 确保 TDLib 登录服务已启动 (python3 login_service.py)")
        print("  2. 在 Web 管理后台，对每个需要迁移的账号点击「重新登录」")
        print("  3. 输入验证码完成登录")
        print("  4. 登录成功后，TDLib session 自动保存")
        print("  5. 所有账号登录完成后，启动 Master 进程")
        print()
        print("注意：迁移期间旧的 Pyrogram 引擎可以继续运行，")
        print("      所有账号迁移完成后再切换到 TDLib 引擎。")


if __name__ == "__main__":
    main()
