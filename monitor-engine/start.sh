#!/bin/bash
# ============================================================
# TG Monitor Pro - 一键启动脚本
# 支持：Ubuntu 20.04/22.04, Debian 11/12, CentOS 7/8
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step()  { echo -e "${BLUE}[STEP]${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── 检查 .env 文件 ────────────────────────────────────────────
log_step "检查环境变量配置..."
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example .env
    log_warn ".env 文件不存在，已从 .env.example 复制"
    log_warn "请编辑 .env 文件填入必要配置后重新运行此脚本"
    echo ""
    echo "必填项："
    echo "  WEB_API_URL   - Web 管理台 API 地址"
    echo "  ENGINE_SECRET - 引擎通信密钥（与 Web 管理台保持一致）"
    echo ""
    exit 1
  else
    log_error ".env 文件不存在，请先创建"
    exit 1
  fi
fi

# 加载 .env
set -a
source .env
set +a

# 检查必填项
if [ -z "$WEB_API_URL" ] || [ -z "$ENGINE_SECRET" ]; then
  log_error "WEB_API_URL 和 ENGINE_SECRET 为必填项，请检查 .env 文件"
  exit 1
fi

log_info "Web API: $WEB_API_URL"

# ── 检查 Python ───────────────────────────────────────────────
log_step "检查 Python 环境..."
if command -v python3 &>/dev/null; then
  PYTHON_VERSION=$(python3 --version 2>&1 | awk '{print $2}')
  log_info "Python 版本: $PYTHON_VERSION"
  PYTHON_CMD="python3"
elif command -v python &>/dev/null; then
  PYTHON_VERSION=$(python --version 2>&1 | awk '{print $2}')
  log_info "Python 版本: $PYTHON_VERSION"
  PYTHON_CMD="python"
else
  log_error "未找到 Python，正在尝试安装..."
  if command -v apt-get &>/dev/null; then
    sudo apt-get update -qq && sudo apt-get install -y python3 python3-pip python3-venv
    PYTHON_CMD="python3"
  elif command -v yum &>/dev/null; then
    sudo yum install -y python3 python3-pip
    PYTHON_CMD="python3"
  else
    log_error "无法自动安装 Python，请手动安装 Python 3.9+"
    exit 1
  fi
fi

# ── 创建虚拟环境 ──────────────────────────────────────────────
log_step "设置 Python 虚拟环境..."
if [ ! -d "venv" ]; then
  $PYTHON_CMD -m venv venv
  log_info "虚拟环境已创建"
fi

source venv/bin/activate

# ── 安装依赖 ──────────────────────────────────────────────────
log_step "安装 Python 依赖..."
pip install --upgrade pip -q
pip install -r requirements.txt -q
log_info "依赖安装完成"

# ── 检查 Web API 连通性 ───────────────────────────────────────
log_step "测试 Web API 连接..."
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "${WEB_API_URL}/api/trpc/engine.health" \
  -H "x-engine-secret: ${ENGINE_SECRET}" \
  --connect-timeout 10 2>/dev/null || echo "000")

if [ "$HTTP_STATUS" = "200" ]; then
  log_info "Web API 连接成功 ✓"
else
  log_warn "Web API 连接失败（HTTP $HTTP_STATUS），请检查 WEB_API_URL 和 ENGINE_SECRET"
  log_warn "将继续启动，但引擎可能无法正常工作"
fi

# ── 创建日志目录 ──────────────────────────────────────────────
mkdir -p logs

# ── 启动模式选择 ──────────────────────────────────────────────
MODE=${1:-"foreground"}

if [ "$MODE" = "background" ] || [ "$MODE" = "-d" ]; then
  log_step "后台启动监控引擎..."

  # 停止旧进程
  if [ -f "logs/main.pid" ]; then
    OLD_PID=$(cat logs/main.pid)
    if kill -0 "$OLD_PID" 2>/dev/null; then
      log_info "停止旧监控进程 (PID: $OLD_PID)..."
      kill "$OLD_PID"
      sleep 2
    fi
    rm -f logs/main.pid
  fi

  if [ -f "logs/bot.pid" ]; then
    OLD_PID=$(cat logs/bot.pid)
    if kill -0 "$OLD_PID" 2>/dev/null; then
      log_info "停止旧 Bot 进程 (PID: $OLD_PID)..."
      kill "$OLD_PID"
      sleep 2
    fi
    rm -f logs/bot.pid
  fi

  # 启动监控引擎
  nohup python3 main.py > logs/main.log 2>&1 &
  MAIN_PID=$!
  echo $MAIN_PID > logs/main.pid
  log_info "监控引擎已启动 (PID: $MAIN_PID)"

  # 如果配置了 Bot Token，启动 Bot
  if [ -n "$BOT_TOKEN" ]; then
    nohup python3 bot.py > logs/bot.log 2>&1 &
    BOT_PID=$!
    echo $BOT_PID > logs/bot.pid
    log_info "Telegram Bot 已启动 (PID: $BOT_PID)"
  else
    log_warn "未配置 BOT_TOKEN，跳过 Bot 启动"
  fi

  echo ""
  log_info "═══════════════════════════════════════"
  log_info "  TG Monitor Pro 引擎已在后台运行"
  log_info "  监控引擎日志: tail -f logs/main.log"
  log_info "  Bot 日志:     tail -f logs/bot.log"
  log_info "  停止服务:     ./start.sh stop"
  log_info "═══════════════════════════════════════"

elif [ "$MODE" = "stop" ]; then
  log_step "停止所有服务..."
  for PID_FILE in logs/main.pid logs/bot.pid; do
    if [ -f "$PID_FILE" ]; then
      PID=$(cat "$PID_FILE")
      if kill -0 "$PID" 2>/dev/null; then
        kill "$PID"
        log_info "已停止进程 $PID"
      fi
      rm -f "$PID_FILE"
    fi
  done
  log_info "所有服务已停止"

elif [ "$MODE" = "status" ]; then
  echo ""
  echo "═══ 服务状态 ═══════════════════════════"
  for SERVICE in main bot; do
    PID_FILE="logs/${SERVICE}.pid"
    if [ -f "$PID_FILE" ]; then
      PID=$(cat "$PID_FILE")
      if kill -0 "$PID" 2>/dev/null; then
        echo -e "  ${SERVICE}: ${GREEN}运行中${NC} (PID: $PID)"
      else
        echo -e "  ${SERVICE}: ${RED}已停止${NC} (PID 文件残留)"
      fi
    else
      echo -e "  ${SERVICE}: ${YELLOW}未启动${NC}"
    fi
  done
  echo "════════════════════════════════════════"

else
  # 前台运行（开发调试模式）
  log_info "前台运行模式（Ctrl+C 退出）"
  echo ""
  log_info "═══════════════════════════════════════"
  log_info "  启动监控引擎..."
  log_info "═══════════════════════════════════════"
  python3 main.py
fi
