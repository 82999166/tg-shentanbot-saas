# TG Monitor Pro - 监控引擎

## 快速启动

```bash
cd monitor-engine
pip install -r requirements.txt

# 设置环境变量
export TG_API_ID=你的API_ID
export TG_API_HASH=你的API_HASH
export WEB_API_BASE=http://localhost:3000/api
export ENGINE_SECRET=tg-monitor-engine-secret

python main.py
```

## 获取 Telegram API 凭证

1. 访问 https://my.telegram.org/apps
2. 登录你的 Telegram 账号
3. 创建应用，获取 `api_id` 和 `api_hash`

## 架构说明

引擎通过 HTTP API 与 Web 管理台通信：
- `GET /api/engine/config` - 拉取监控配置
- `POST /api/engine/hit` - 上报命中记录
- `GET /api/engine/dm-queue` - 获取待发私信
- `POST /api/engine/dm-queue/success` - 标记发送成功
- `POST /api/engine/account/health` - 更新账号健康度
- `POST /api/engine/heartbeat` - 心跳上报
