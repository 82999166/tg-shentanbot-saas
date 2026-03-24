FROM python:3.11-slim

WORKDIR /app

# 安装系统依赖（TDLib 需要 libssl）
RUN apt-get update && apt-get install -y \
    curl \
    libssl-dev \
    libz-dev \
    && rm -rf /var/lib/apt/lists/*

# 安装 Python 依赖（含 pytdbot + tdjson）
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制源码
COPY . .

# 创建必要目录
# - sessions/: 旧版 Pyrogram session 文件（兼容保留）
# - tdlib_data/: TDLib 持久化数据目录（每账号一个子目录）
# - logs/: 日志文件
RUN mkdir -p sessions tdlib_data logs

# 健康检查端口（监控引擎 REST API）
EXPOSE 8080

# 登录服务端口
EXPOSE 5050

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -sf http://localhost:8080/health || exit 1

CMD ["python3", "main.py"]
