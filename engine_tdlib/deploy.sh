#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# 神探监控引擎 v5.0 (TDLib) - 部署脚本
# ═══════════════════════════════════════════════════════════════
# 用法: bash deploy.sh [install|start|stop|restart|status]

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ─── 安装依赖 ──────────────────────────────────────────────
cmd_install() {
    log_info "安装 Python 依赖..."
    pip3 install python-telegram python-dotenv requests jieba --quiet
    
    log_info "创建目录结构..."
    mkdir -p tdlib_data logs pids
    
    # 检查 .env 是否存在
    if [ ! -f .env ]; then
        log_warn ".env 文件不存在，从模板创建..."
        cp .env.example .env
        log_warn "请编辑 .env 文件填写实际配置值！"
    fi
    
    log_info "安装完成！"
    log_info "下一步："
    log_info "  1. 编辑 .env 文件配置 TG_API_ID、TG_API_HASH 等"
    log_info "  2. 运行 'bash deploy.sh start' 启动服务"
}

# ─── 启动服务 ──────────────────────────────────────────────
cmd_start() {
    log_info "启动 TDLib 引擎..."
    
    # 检查 .env
    if [ ! -f .env ]; then
        log_error ".env 文件不存在！请先运行 'bash deploy.sh install'"
        exit 1
    fi
    
    # 启动登录服务
    if pgrep -f "login_service.py" > /dev/null 2>&1; then
        log_warn "登录服务已在运行"
    else
        nohup python3 login_service.py > logs/login_service.log 2>&1 &
        log_info "登录服务已启动 (PID=$!)"
    fi
    
    # 启动 Master 进程
    if pgrep -f "main.py --master" > /dev/null 2>&1; then
        log_warn "Master 进程已在运行"
    else
        nohup python3 main.py --master > logs/master.log 2>&1 &
        log_info "Master 进程已启动 (PID=$!)"
    fi
    
    sleep 2
    cmd_status
}

# ─── 停止服务 ──────────────────────────────────────────────
cmd_stop() {
    log_info "停止所有引擎进程..."
    
    # 先停 Master（它会优雅停止所有 Worker）
    if pgrep -f "main.py --master" > /dev/null 2>&1; then
        pkill -TERM -f "main.py --master" || true
        sleep 3
    fi
    
    # 停止所有 Worker
    if pgrep -f "main.py --account_id" > /dev/null 2>&1; then
        pkill -TERM -f "main.py --account_id" || true
        sleep 2
    fi
    
    # 停止登录服务
    if pgrep -f "login_service.py" > /dev/null 2>&1; then
        pkill -TERM -f "login_service.py" || true
    fi
    
    # 强制清理残留
    sleep 1
    pkill -9 -f "main.py --" 2>/dev/null || true
    pkill -9 -f "login_service.py" 2>/dev/null || true
    
    # 清理 PID 文件
    rm -f pids/*.pid
    
    log_info "所有进程已停止"
}

# ─── 重启服务 ──────────────────────────────────────────────
cmd_restart() {
    cmd_stop
    sleep 2
    cmd_start
}

# ─── 查看状态 ──────────────────────────────────────────────
cmd_status() {
    echo "═══════════════════════════════════════════════════"
    echo " 神探监控引擎 v5.0 (TDLib) - 运行状态"
    echo "═══════════════════════════════════════════════════"
    
    # Master 进程
    if pgrep -f "main.py --master" > /dev/null 2>&1; then
        pid=$(pgrep -f "main.py --master")
        echo -e " Master:       ${GREEN}运行中${NC} (PID=$pid)"
    else
        echo -e " Master:       ${RED}未运行${NC}"
    fi
    
    # 登录服务
    if pgrep -f "login_service.py" > /dev/null 2>&1; then
        pid=$(pgrep -f "login_service.py")
        echo -e " 登录服务:     ${GREEN}运行中${NC} (PID=$pid)"
    else
        echo -e " 登录服务:     ${RED}未运行${NC}"
    fi
    
    # Worker 进程
    echo ""
    echo " Worker 进程:"
    workers=$(pgrep -af "main.py --account_id" 2>/dev/null || true)
    if [ -z "$workers" ]; then
        echo -e "   ${YELLOW}无运行中的 Worker${NC}"
    else
        echo "$workers" | while read line; do
            pid=$(echo "$line" | awk '{print $1}')
            acc_id=$(echo "$line" | grep -oP 'account_id \K\d+')
            port=$((7100 + acc_id))
            # 检查 HTTP 健康
            health=$(curl -s --connect-timeout 2 "http://127.0.0.1:$port/health" 2>/dev/null || echo "")
            if echo "$health" | grep -q '"status":"ok"'; then
                dialogs=$(echo "$health" | python3 -c "import sys,json;print(json.load(sys.stdin).get('dialogCount',0))" 2>/dev/null || echo "?")
                echo -e "   ACC${acc_id}: ${GREEN}正常${NC} (PID=$pid, port=$port, dialogs=$dialogs)"
            else
                echo -e "   ACC${acc_id}: ${YELLOW}启动中${NC} (PID=$pid, port=$port)"
            fi
        done
    fi
    
    echo ""
    echo " TDLib Sessions:"
    if [ -d tdlib_data ]; then
        for dir in tdlib_data/account_*/; do
            if [ -d "$dir" ]; then
                acc_id=$(basename "$dir" | sed 's/account_//')
                if [ -f "$dir/td.binlog" ]; then
                    size=$(du -sh "$dir" 2>/dev/null | cut -f1)
                    echo -e "   account_${acc_id}: ${GREEN}存在${NC} ($size)"
                fi
            fi
        done
    fi
    echo "═══════════════════════════════════════════════════"
}

# ─── 查看日志 ──────────────────────────────────────────────
cmd_logs() {
    account_id=${2:-"master"}
    if [ "$account_id" = "master" ]; then
        tail -f logs/master.log
    elif [ "$account_id" = "login" ]; then
        tail -f logs/login_service.log
    else
        tail -f "logs/engine-acc${account_id}.log"
    fi
}

# ─── 主入口 ──────────────────────────────────────────────
case "${1:-help}" in
    install)  cmd_install ;;
    start)    cmd_start ;;
    stop)     cmd_stop ;;
    restart)  cmd_restart ;;
    status)   cmd_status ;;
    logs)     cmd_logs "$@" ;;
    *)
        echo "用法: bash deploy.sh [命令]"
        echo ""
        echo "命令:"
        echo "  install   - 安装依赖并初始化"
        echo "  start     - 启动所有服务"
        echo "  stop      - 停止所有服务"
        echo "  restart   - 重启所有服务"
        echo "  status    - 查看运行状态"
        echo "  logs [N]  - 查看日志 (master/login/账号ID)"
        ;;
esac
