# TG Monitor Pro - 监控引擎部署说明

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│  Web 管理台（已部署在 Manus）                                │
│  - 用户管理、关键词配置、群组监控配置                        │
│  - 命中记录、私信队列、防封策略                              │
│  - USDT 支付、套餐管理                                       │
└──────────────────────┬──────────────────────────────────────┘
                       │ REST API（ENGINE_SECRET 鉴权）
┌──────────────────────▼──────────────────────────────────────┐
│  监控引擎（本目录，部署在 VPS）                              │
│  ├── main.py  - 核心监控服务（Pyrogram Userbot）             │
│  └── bot.py   - Telegram Bot 命令服务（可选）                │
└─────────────────────────────────────────────────────────────┘
```

---

## 快速部署

### 方式一：一键脚本（推荐）

```bash
# 1. 上传 monitor-engine 目录到 VPS
scp -r monitor-engine/ root@your-vps:/opt/tgmonitor/

# 2. 进入目录并添加执行权限
cd /opt/tgmonitor/monitor-engine
chmod +x start.sh

# 3. 首次运行（自动创建 .env 模板）
./start.sh

# 4. 编辑 .env 填写配置
nano .env

# 5. 后台启动
./start.sh -d
```

### 方式二：Docker Compose（推荐生产环境）

```bash
cd monitor-engine
cp .env.example .env
nano .env   # 填写必要配置
docker compose up -d
docker compose logs -f monitor-engine
```

---

## 必填配置项

编辑 `.env` 文件，至少填写以下两项：

| 配置项 | 说明 | 示例 |
|--------|------|------|
| `WEB_API_URL` | Web 管理台地址 | `https://your-domain.manus.space` |
| `ENGINE_SECRET` | 引擎通信密钥 | 在 Web 管理台「系统设置 → 引擎配置」中查看 |

---

## 可选配置项

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `BOT_TOKEN` | Telegram Bot Token（@BotFather 获取） | 空（不启动 Bot） |
| `TG_API_ID` | Telegram API ID（my.telegram.org） | 从 Web 管理台获取 |
| `TG_API_HASH` | Telegram API Hash | 从 Web 管理台获取 |
| `PROXY_URL` | 代理地址（如 `socks5://127.0.0.1:1080`） | 空 |
| `SYNC_INTERVAL` | 配置同步间隔（秒） | 30 |
| `DM_MIN_INTERVAL` | 私信最小间隔（秒） | 60 |
| `LOG_LEVEL` | 日志级别 | INFO |

---

## Telegram API 申请

1. 访问 https://my.telegram.org/apps
2. 登录你的 Telegram 账号
3. 创建应用，获取 `api_id` 和 `api_hash`
4. 在 Web 管理台「系统设置 → 引擎配置」中填入

---

## 服务管理命令

```bash
./start.sh -d        # 后台启动
./start.sh status    # 查看状态
./start.sh stop      # 停止服务
tail -f logs/main.log   # 查看监控引擎日志
tail -f logs/bot.log    # 查看 Bot 日志
```

---

## Telegram Bot 命令列表

| 命令 | 说明 |
|------|------|
| `/start` | 主菜单 |
| `/status` | 查看监控状态 |
| `/add_keyword <词>` | 添加关键词 |
| `/list_keywords` | 查看关键词列表 |
| `/del_keyword <ID>` | 删除关键词 |
| `/add_group <链接>` | 添加监控群组 |
| `/list_groups` | 查看监控群组 |
| `/dm_on` | 开启自动私信 |
| `/dm_off` | 关闭自动私信 |
| `/dm_template <内容>` | 设置私信模板 |
| `/dm_status` | 查看私信统计 |
| `/dm_queue` | 查看待发送队列 |
| `/stats` | 今日统计报告 |
| `/help` | 帮助信息 |

---

## 系统要求

- **操作系统**：Ubuntu 20.04+ / Debian 11+ / CentOS 7+
- **Python**：3.9+（脚本会自动安装）
- **内存**：≥ 512MB（建议 1GB+）
- **网络**：能访问 Telegram 服务器（中国大陆需要代理）
- **磁盘**：≥ 1GB 可用空间

---

## API 接口说明（引擎与 Web 管理台通信）

| 接口 | 说明 |
|------|------|
| `GET /api/trpc/engine.health` | 健康检查 |
| `GET /api/trpc/engine.config` | 拉取监控配置 |
| `POST /api/trpc/engine.hit` | 上报命中记录 |
| `GET /api/trpc/engine.dmQueue` | 获取待发私信队列 |
| `POST /api/trpc/engine.dmSuccess` | 标记私信发送成功 |
| `POST /api/trpc/engine.dmFail` | 标记私信发送失败 |
| `POST /api/trpc/engine.updateHealth` | 更新账号健康度 |
| `POST /api/trpc/engine.heartbeat` | 心跳上报 |

所有接口需在请求头中携带：`x-engine-secret: <ENGINE_SECRET>`
