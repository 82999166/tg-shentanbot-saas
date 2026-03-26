# TG Monitor SaaS - TDLib 升级与重构指南

本文档详细说明了本次基于 TDLib 重构 TG 群组消息监控系统，并优化管理后台的完整变更内容与部署指南。

## 一、核心变更概述

### 1. 监控引擎全面升级 (Pyrogram -> TDLib)
为了解决 Pyrogram 在网络不稳定时容易出现 updates gap（消息丢失）且无法自动恢复的问题，监控引擎已全面重写为基于 Telegram 官方 C++ 客户端库 **TDLib** 的实现（使用 `pytdbot` 作为 Python 绑定）。

**TDLib 带来的核心优势：**
- **Updates Gap 自动修复**：内置完整的 `getDifference` 逻辑，断线重连后会自动拉取丢失的消息，确保监控不漏报。
- **状态持久化**：使用 `td.binlog` 本地数据库持久化 session 状态，引擎重启无需重新请求验证码。
- **并发性能提升**：每个监控账号运行在独立的 TDLib 实例中，互不干扰，稳定性大幅提升。
- **官方维护**：协议兼容性最佳，不易被封控。

### 2. 登录服务重写
`login_service.py` 已完全重写以适配 TDLib 的登录流程。
- 支持完整的手机号 -> 验证码 -> 2FA 密码登录流程。
- 兼容旧版 Pyrogram Session 字符串导入（系统会自动尝试转换为 TDLib 可用的状态）。

### 3. 管理后台前端优化
在管理后台 (`SystemSettings.tsx` / `AdminPanel.tsx`) 中新增了以下高级功能：
- **TDLib 引擎状态监控 Tab**：实时查看引擎心跳、引擎类型、TDLib 版本、Gap 恢复次数，以及全量账号的健康度进度条。
- **用户参数全量配置 Tab**：管理员可以通过搜索选择任意用户，在一个面板中查看并修改其所有参数，包括：
  - **套餐配置**：修改套餐类型、到期时间。
  - **关键词管理**：增删改查关键词、启停关键词、修改匹配类型（包含、精确、正则等）。
  - **监控群组**：查看该用户所有群组的监控状态。
  - **TG 账号**：查看该用户绑定的所有 TG 账号的健康度、发信统计和引擎类型。
- **账号列表优化**：在原有监控账号列表中，新增了引擎类型标识（🚀 TDLib / 🐍 Pyrogram）。

---

## 二、目录结构变更

```text
tg-monitor-saas/
├── monitor-engine/
│   ├── main.py                     # [重写] TDLib 监控引擎核心
│   ├── login_service.py            # [重写] TDLib 登录服务
│   ├── requirements.txt            # [更新] 新增 pytdbot, tdjson
│   ├── Dockerfile                  # [更新] 新增 libssl-dev, tdlib_data 目录
│   ├── docker-compose.yml          # [更新] 新增 tdlib_data 卷挂载
│   ├── .env.example                # [更新] 新增 TDLIB_DATA_DIR 等配置
│   ├── main_pyrogram_backup.py     # [新增] 原 Pyrogram 引擎备份
│   └── login_service_pyrogram_backup.py # [新增] 原 Pyrogram 登录服务备份
│
├── client/src/pages/
│   ├── TdlibEngineTab.tsx          # [新增] TDLib 引擎状态监控组件
│   ├── UserConfigPanel.tsx         # [新增] 用户参数全量配置组件
│   ├── SystemSettings.tsx          # [修改] 挂载新增的两个 Tab
│   └── AdminPanel.tsx              # [修改] 账号卡片增加引擎类型标识
│
└── server/routers/
    └── engine.ts                   # [修改] heartbeat 路由支持 tdlib 字段
```

---

## 三、部署与升级指南

### 1. 更新代码
```bash
git pull origin main
```

### 2. 更新环境变量
进入 `monitor-engine` 目录，参考 `.env.example` 更新你的 `.env` 文件，确保包含以下 TDLib 专属配置：
```env
# TDLib 持久化数据目录
TDLIB_DATA_DIR=./tdlib_data
# TDLib 日志级别（0=错误, 1=警告, 2=信息, 3=调试, 4=详细调试）
TDLIB_VERBOSITY=1
# 登录服务端口
LOGIN_SERVICE_PORT=5050
```

### 3. 重建 Docker 镜像并启动
由于引入了 TDLib 的 C++ 依赖（需要 `libssl-dev`），必须重新构建引擎的 Docker 镜像。

```bash
cd monitor-engine
# 停止旧服务
docker compose down
# 重新构建镜像并启动
docker compose up -d --build
```

### 4. 验证升级
1. 访问 Web 管理后台 -> **系统设置** -> **TDLib 引擎** Tab。
2. 确认引擎状态显示为“在线”，并且引擎类型显示为 **🚀 TDLib**。
3. 如果账号之前是使用 Pyrogram 登录的，新引擎启动时会自动接管 `sessions/` 目录下的旧版配置并尝试迁移到 `tdlib_data/`。如果遇到个别账号迁移失败（显示需要验证），请在后台重新登录该账号即可。

---

## 四、回滚方案

如果在生产环境中遇到严重的 TDLib 兼容性问题，可以通过以下步骤快速回滚到 Pyrogram 版本：

1. 停止服务：`docker compose down`
2. 恢复备份文件：
   ```bash
   cp main_pyrogram_backup.py main.py
   cp login_service_pyrogram_backup.py login_service.py
   ```
3. 重新启动服务：`docker compose up -d`
