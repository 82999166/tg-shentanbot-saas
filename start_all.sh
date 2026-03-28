#!/bin/bash
# ============================================================
# TG Monitor Pro - 一键启动/重启所有服务脚本
# 项目目录: /home/hjroot/tg-monitor-tdlib
# 包含进程:
#   1. tg-monitor-tdlib  - Web 主服务 (Node.js)
#   2. tg-tdlib-engine   - 监控引擎 (Python/TDLib)
#   3. tg-tdlib-bot      - Telegram Bot (Python)
#   4. tg-tdlib-login    - 登录服务 (Python)
# ============================================================

set -e

PM2="/www/server/nvm/versions/node/v22.22.0/lib/node_modules/pm2/bin/pm2"
PROJECT_DIR="/home/hjroot/tg-monitor-tdlib"
ENGINE_DIR="$PROJECT_DIR/monitor-engine"
LOG_DIR="/home/hjroot/logs"

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  TG Monitor Pro - 启动所有服务${NC}"
echo -e "${BLUE}  $(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo -e "${BLUE}============================================${NC}"

# 确保日志目录存在
mkdir -p "$LOG_DIR"

# ── 函数：启动或重启单个服务 ──────────────────────────────
start_or_restart() {
    local name="$1"
    local config="$2"

    if $PM2 list 2>/dev/null | grep -q "$name"; then
        echo -e "${YELLOW}[重启]${NC} $name ..."
        $PM2 restart "$name" 2>/dev/null && echo -e "${GREEN}[OK]${NC} $name 已重启"
    else
        echo -e "${YELLOW}[启动]${NC} $name ..."
        $PM2 start "$config" 2>/dev/null && echo -e "${GREEN}[OK]${NC} $name 已启动"
    fi
}

# ── 1. Web 主服务 ─────────────────────────────────────────
echo ""
echo -e "${BLUE}[1/4] Web 主服务 (tg-monitor-tdlib)${NC}"
start_or_restart "tg-monitor-tdlib" "$PROJECT_DIR/ecosystem.config.cjs"

# ── 2. 登录服务（先于引擎启动）────────────────────────────
echo ""
echo -e "${BLUE}[2/4] 登录服务 (tg-tdlib-login)${NC}"
start_or_restart "tg-tdlib-login" "$ENGINE_DIR/ecosystem.engine.cjs --only tg-tdlib-login"

# ── 3. 监控引擎 ───────────────────────────────────────────
echo ""
echo -e "${BLUE}[3/4] 监控引擎 (tg-tdlib-engine)${NC}"
start_or_restart "tg-tdlib-engine" "$ENGINE_DIR/ecosystem.engine.cjs --only tg-tdlib-engine"

# ── 4. Telegram Bot ───────────────────────────────────────
echo ""
echo -e "${BLUE}[4/4] Telegram Bot (tg-tdlib-bot)${NC}"
start_or_restart "tg-tdlib-bot" "$ENGINE_DIR/ecosystem.bot.cjs"

# ── 等待服务稳定 ──────────────────────────────────────────
echo ""
echo -e "${YELLOW}等待服务稳定 (3秒)...${NC}"
sleep 3

# ── 显示最终状态 ──────────────────────────────────────────
echo ""
echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  服务状态总览${NC}"
echo -e "${BLUE}============================================${NC}"
$PM2 list 2>/dev/null | grep -E 'tg-monitor-tdlib|tg-tdlib-engine|tg-tdlib-bot|tg-tdlib-login|name|─'

# ── 检查是否有异常进程 ────────────────────────────────────
echo ""
ERRORED=$($PM2 list 2>/dev/null | grep -E 'tg-monitor-tdlib|tg-tdlib-engine|tg-tdlib-bot|tg-tdlib-login' | grep -v 'online' | wc -l)
if [ "$ERRORED" -gt 0 ]; then
    echo -e "${RED}[警告] 有 $ERRORED 个服务未正常运行，请检查日志：${NC}"
    echo -e "  引擎日志: tail -100 $ENGINE_DIR/engine.log"
    echo -e "  PM2 日志: $PM2 logs --lines 50"
else
    echo -e "${GREEN}[成功] 所有 4 个服务均已正常运行！${NC}"
fi

echo ""
echo -e "${BLUE}============================================${NC}"
echo -e "  Web 服务地址: https://tg.luxurvs.com"
echo -e "  管理后台:     https://tg.luxurvs.com/admin"
echo -e "${BLUE}============================================${NC}"
