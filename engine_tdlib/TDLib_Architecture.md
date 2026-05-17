# 神探 Telegram 监控引擎 v5.0 (TDLib 架构)

## 1. 架构演进背景

原系统基于 Pyrogram (纯 Python MTProto 实现)，在大规模监控场景下面临严重瓶颈：
- **内存溢出**：加入上万群组后，`get_dialogs()` 导致解析层崩溃。
- **消息丢失**：`in_memory=True` 导致重启后 `access_hash` 和 `pts` 丢失，Telegram 服务器不再推送群组实时消息（实测丢包率高达 95%）。
- **断线重连脆弱**：并发进程管理混乱，容易产生僵尸进程。

v5.0 架构全面迁移至 **TDLib (Telegram Database Library)**，这是 Telegram 官方提供的 C++ 核心库。

## 2. TDLib 架构优势

| 维度 | Pyrogram (旧) | TDLib (新) |
|------|--------------|------------|
| 底层技术 | Python 纯协议实现 | C++ 官方原生内核 |
| 稳定性 | 一般，群多易断连 | 顶级，7×24不掉线 |
| 上万群组支持 | 压力大，内存暴涨 | 完美支持，内置 SQLite 管理 |
| 消息丢失率 | 高达 95% (in_memory) | 0% (自动处理 updates gap) |
| 本地存储 | 无/需自己写 | 内置高性能 SQLite 持久化 |

## 3. 核心模块设计

### 3.1 独立登录服务 (login_service.py)
- 运行在 7002 端口，专门处理 Web 端发起的登录请求。
- 使用 `login(blocking=False)` 非阻塞模式，避免后台进程因等待终端输入而挂起。
- 登录成功后，将 session 暂存在 `login_{phone}` 目录。

### 3.2 引擎主控 (Master Mode)
- 运行 `main.py --master`，作为守护进程。
- 每 10 秒从数据库读取启用的账号列表。
- 自动拉起、监控、重启子进程 (Worker)。

### 3.3 账号工作进程 (Worker Mode)
- 每个账号对应一个独立的 `main.py --account_id=X` 进程。
- 拥有独立的 SQLite session 文件，互不干扰。
- 自动监听新消息，执行关键词匹配，并上报给 Web 端。
- 内置 HTTP API (7100+ID)，供 Web 端实时查询状态。

## 4. 部署与切换指南

1. **环境准备**：
   ```bash
   pip3 install python-telegram==0.19.0
   ```

2. **配置更新**：
   在 `/home/hjroot/shentanbot/engine_tdlib/.env` 中配置正确的环境变量。

3. **PM2 接管**：
   ```bash
   pm2 stop 神探-登录 神探-引擎-主控
   pm2 start ecosystem.config.js
   ```

4. **Web 端对接**：
   在 Web 端的 `saveAccount` 成功后，调用 `http://127.0.0.1:7002/finalize_login` 接口，完成 session 目录的正式转移。
