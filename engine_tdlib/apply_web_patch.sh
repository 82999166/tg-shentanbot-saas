#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# 自动应用 Web 端 TDLib 适配补丁
# 
# 使用方法: bash apply_web_patch.sh
# 
# 修改文件: /home/hjroot/shentanbot/web/server/api/routers/tgAccounts.ts
# ═══════════════════════════════════════════════════════════════

set -e

TARGET="/home/hjroot/shentanbot/web/server/api/routers/tgAccounts.ts"
BACKUP="${TARGET}.bak.$(date +%Y%m%d%H%M%S)"

echo "═══ 应用 TDLib Web 端适配补丁 ═══"
echo ""

# 备份原文件
cp "$TARGET" "$BACKUP"
echo "✓ 已备份原文件: $BACKUP"

# 改动 1: 修改 verifyCode 中的 session 保存逻辑
# 将 "登录成功，保存 Pyrofork session_string" 段替换
python3 << 'PYTHON_PATCH'
import re

with open("/home/hjroot/shentanbot/web/server/api/routers/tgAccounts.ts", "r") as f:
    content = f.read()

# 改动 1: verifyCode 中的 session 保存和 finalize_login
old_verify_code = '''      // 登录成功，保存 Pyrofork session_string
      const sessionVal = data.session_string ?? "";
      if (!sessionVal) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "登录服务未返回 session_string" });
      return await saveAccount(ctx.user, phone, sessionVal);'''

new_verify_code = '''      // 登录成功
      const sessionVal = data.session_string ?? "";
      if (!sessionVal) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "登录服务未返回 session 标识" });

      // 保存账号（TDLib 模式下 sessionString 是文件路径标记）
      const result = await saveAccount(ctx.user, phone, sessionVal);

      // 通知登录服务将临时 session 移动到正式目录
      if (result.accountId) {
        try {
          await callLoginService("/finalize_login", { phone, account_id: result.accountId });
        } catch (e) {
          console.warn(`[verifyCode] finalize_login 调用失败（不影响登录结果）:`, e);
        }
      }

      return result;'''

if old_verify_code in content:
    content = content.replace(old_verify_code, new_verify_code)
    print("✓ 改动 1: verifyCode finalize_login 已应用")
else:
    print("⚠ 改动 1: verifyCode 原始代码未匹配（可能已修改过）")

# 改动 2: verify2FA 中的 session 保存和 finalize_login
old_verify_2fa = '''      // 二步验证成功，保存 Pyrofork session_string
      const sessionVal = data.session_string ?? "";
      if (!sessionVal) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "登录服务未返回 session_string" });
      return await saveAccount(ctx.user, phone, sessionVal);'''

new_verify_2fa = '''      // 二步验证成功
      const sessionVal = data.session_string ?? "";
      if (!sessionVal) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "登录服务未返回 session 标识" });

      // 保存账号
      const result = await saveAccount(ctx.user, phone, sessionVal);

      // 通知登录服务将临时 session 移动到正式目录
      if (result.accountId) {
        try {
          await callLoginService("/finalize_login", { phone, account_id: result.accountId });
        } catch (e) {
          console.warn(`[verify2FA] finalize_login 调用失败（不影响登录结果）:`, e);
        }
      }

      return result;'''

if old_verify_2fa in content:
    content = content.replace(old_verify_2fa, new_verify_2fa)
    print("✓ 改动 2: verify2FA finalize_login 已应用")
else:
    print("⚠ 改动 2: verify2FA 原始代码未匹配（可能已修改过）")

# 改动 3: 更新注释
old_comment = "// ─── Pyrogram 登录服务地址（本地 Python HTTP 服务）─────────────────────────"
new_comment = "// ─── TDLib 登录服务地址（本地 Python HTTP 服务）─────────────────────────────"

if old_comment in content:
    content = content.replace(old_comment, new_comment)
    print("✓ 改动 3: 注释已更新")
else:
    print("⚠ 改动 3: 注释未匹配")

# 改动 4: 更新辅助函数注释
old_helper = "// ─── 调用 Pyrogram 登录服务的辅助函数（使用内置 http 模块）──────────────────"
new_helper = "// ─── 调用 TDLib 登录服务的辅助函数（使用内置 http 模块）────────────────────"

if old_helper in content:
    content = content.replace(old_helper, new_helper)
    print("✓ 改动 4: 辅助函数注释已更新")
else:
    print("⚠ 改动 4: 辅助函数注释未匹配")

with open("/home/hjroot/shentanbot/web/server/api/routers/tgAccounts.ts", "w") as f:
    f.write(content)

print("")
print("═══ 补丁应用完成 ═══")
PYTHON_PATCH

echo ""
echo "注意：修改后需要重新构建 Web 端："
echo "  cd /home/hjroot/shentanbot/web && npx tsc && pm2 restart 神探-Web"
echo ""
echo "如需回滚："
echo "  cp $BACKUP $TARGET"
echo "  cd /home/hjroot/shentanbot/web && npx tsc && pm2 restart 神探-Web"
