#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# 神探监控引擎 - 从 Pyrogram 切换到 TDLib 的一键脚本
# 
# 使用方法: bash switch_to_tdlib.sh
# 
# 此脚本会：
# 1. 停止所有 Pyrogram 引擎进程
# 2. 更新 PM2 配置指向 TDLib 引擎
# 3. 启动 TDLib 引擎
# 4. 保存 PM2 配置（开机自启）
# ═══════════════════════════════════════════════════════════════

set -e

PM2="$HOME/.local/lib/node_modules/pm2/bin/pm2"
ENGINE_DIR="/home/hjroot/shentanbot/engine_tdlib"
PYTHON="/home/hjroot/shentanbot/engine/venv/bin/python3"
OLD_ENGINE_DIR="/home/hjroot/shentanbot/engine"

echo "═══ 神探监控引擎 - Pyrogram → TDLib 切换 ═══"
echo ""

# 检查前置条件
if [ ! -f "$ENGINE_DIR/main.py" ]; then
    echo "❌ TDLib 引擎代码不存在: $ENGINE_DIR/main.py"
    exit 1
fi

if [ ! -f "$ENGINE_DIR/.env" ]; then
    echo "❌ TDLib 引擎配置不存在: $ENGINE_DIR/.env"
    exit 1
fi

echo "✓ 前置条件检查通过"
echo ""

# Step 1: 停止所有旧引擎
echo "Step 1: 停止所有 Pyrogram 引擎..."
$PM2 stop 神探-登录 2>/dev/null || true
$PM2 stop 神探-引擎-主控 2>/dev/null || true
$PM2 stop 神探-引擎-Acc6 2>/dev/null || true
$PM2 stop 神探-引擎-Acc8 2>/dev/null || true
$PM2 stop 神探-引擎-Acc9 2>/dev/null || true
$PM2 stop 神探-引擎-Acc10 2>/dev/null || true
$PM2 stop 神探-引擎-Acc11 2>/dev/null || true
$PM2 stop 神探-引擎-Acc12 2>/dev/null || true
sleep 2
echo "✓ 所有旧引擎已停止"
echo ""

# Step 2: 删除旧的 PM2 进程配置
echo "Step 2: 清理旧 PM2 配置..."
$PM2 delete 神探-登录 2>/dev/null || true
$PM2 delete 神探-引擎-主控 2>/dev/null || true
$PM2 delete 神探-引擎-Acc6 2>/dev/null || true
$PM2 delete 神探-引擎-Acc8 2>/dev/null || true
$PM2 delete 神探-引擎-Acc9 2>/dev/null || true
$PM2 delete 神探-引擎-Acc10 2>/dev/null || true
$PM2 delete 神探-引擎-Acc11 2>/dev/null || true
$PM2 delete 神探-引擎-Acc12 2>/dev/null || true
echo "✓ 旧 PM2 配置已清理"
echo ""

# Step 3: 创建必要目录
echo "Step 3: 创建必要目录..."
mkdir -p "$ENGINE_DIR/tdlib_data"
mkdir -p "$ENGINE_DIR/logs"
mkdir -p "$ENGINE_DIR/pids"
echo "✓ 目录已创建"
echo ""

# Step 4: 确保 .env 中端口配置正确
echo "Step 4: 检查 .env 配置..."
# 恢复登录服务端口为 7002（与 Web 端约定一致）
sed -i 's/LOGIN_SERVICE_PORT=7020/LOGIN_SERVICE_PORT=7002/' "$ENGINE_DIR/.env" 2>/dev/null || true
grep -q "LOGIN_SERVICE_PORT=7002" "$ENGINE_DIR/.env" || echo "LOGIN_SERVICE_PORT=7002" >> "$ENGINE_DIR/.env"
echo "✓ .env 配置已确认"
echo ""

# Step 5: 启动 TDLib 引擎（通过 PM2）
echo "Step 5: 启动 TDLib 引擎..."

# 登录服务
$PM2 start "$PYTHON" --name "神探-登录" \
    --cwd "$ENGINE_DIR" \
    -- "$ENGINE_DIR/login_service.py"

# 主控（Master 模式，自动管理所有 Worker）
$PM2 start "$PYTHON" --name "神探-引擎-主控" \
    --cwd "$ENGINE_DIR" \
    -- "$ENGINE_DIR/main.py" --master

echo "✓ TDLib 引擎已启动"
echo ""

# Step 6: 保存 PM2 配置
echo "Step 6: 保存 PM2 配置..."
$PM2 save
echo "✓ PM2 配置已保存（开机自启）"
echo ""

# Step 7: 验证
echo "Step 7: 验证服务状态..."
sleep 5
$PM2 list

echo ""
echo "═══ 切换完成 ═══"
echo ""
echo "注意事项："
echo "  1. TDLib 引擎使用 Master 模式自动管理所有 Worker 子进程"
echo "  2. 不再需要为每个账号单独配置 PM2 进程"
echo "  3. 首次运行需要通过管理后台为每个账号完成 TDLib 登录"
echo "  4. 登录成功后，session 自动持久化到 $ENGINE_DIR/tdlib_data/"
echo ""
echo "如需回滚到 Pyrogram 引擎："
echo "  $PM2 stop 神探-登录 神探-引擎-主控"
echo "  $PM2 delete 神探-登录 神探-引擎-主控"
echo "  # 然后重新启动旧引擎..."
