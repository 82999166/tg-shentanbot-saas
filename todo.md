# TG Monitor Pro - TODO

## Phase 1: 数据库 Schema & 基础架构
- [x] 设计并推送完整数据库 Schema（套餐、TG账号、关键词、群组、模板、队列、记录）
- [x] 全局样式与主题配置（深色科技风）
- [x] DashboardLayout 侧边栏导航配置

## Phase 2: 后端 API - 核心功能
- [x] 套餐管理 API（免费/基础/专业/企业版，配额控制）
- [x] Telegram 账号管理 API（添加/删除/健康度评分/角色配置）
- [x] 关键词规则引擎 API（精确/正则/AND/OR/NOT，分组管理）
- [x] 群组监控配置 API（添加/移除/关联关键词规则/启停）

## Phase 3: 后端 API - 高级功能
- [x] 消息模板系统 API（多模板/变量插值/轮换策略）
- [x] 自动私信队列 API（加入队列/调度/去重/状态追踪）
- [x] 命中记录管理 API（历史查询/筛选/导出）
- [x] 防封策略配置 API（发信上限/间隔/时间窗口/账号降级）
- [x] 仪表盘统计 API（今日命中/发信成功率/热门关键词/最近记录）
- [x] 黑名单管理 API
- [x] 管理员 API（用户管理/套餐调整/平台统计）
- [x] 修复 SQL GROUP BY 兼容性问题

## Phase 4: 前端 - 核心页面
- [x] 全局布局与侧边栏导航（可折叠、角色权限控制）
- [x] Landing 落地页（产品介绍、套餐对比、CTA）
- [x] 仪表盘页面（统计卡片/趋势图/实时命中流）
- [x] Telegram 账号管理页面（添加账号/健康度/角色配置）

## Phase 5: 前端 - 功能页面
- [x] 关键词管理页面（规则引擎/分组/CRUD）
- [x] 群组监控页面（添加群组/关联规则/启停控制）
- [x] 消息模板页面（模板编辑/变量预览/轮换配置）
- [x] 私信队列页面（队列状态/发送记录/手动控制）

## Phase 6: 前端 - 管理页面
- [x] 命中记录页面（历史列表/筛选/导出）
- [x] 防封策略页面（参数配置/账号健康监控）
- [x] 套餐管理页面（当前套餐/配额使用/升级入口）
- [x] 管理后台页面（用户管理/套餐分配/系统统计）

## Phase 7: 测试与交付
- [x] Vitest 单元测试（13 个测试全部通过）
- [x] TypeScript 编译 0 错误
- [x] 保存检查点
- [x] 交付用户

## 新需求：TG 账号接入方式增强 & 管理后台修复
- [x] 后端：手机号登录 API - 发送验证码（sendCode）
- [x] 后端：手机号登录 API - 验证码确认（verifyCode）
- [x] 后端：手机号登录 API - 二步验证密码（verify2FA）
- [x] 后端： Session 批量导入 API（importSessions）
- [x] 前端：TG 账号页面 - 手机号+验证码+二步验证完整流程 UI（多步骤 Dialog）
- [x] 前端：TG 账号页面 - 批量导入 Session 文件 UI（拖拽上传/文本粘贴）
- [x] 前端：管理后台 - 新增监控账号管理 Tab（账号列表、套餐分配、健康度总览）

## 三大核心功能开发

### Stripe 支付接入
- [ ] 安装 Stripe SDK，配置 Webhook 密钥
- [ ] 数据库新增 orders、redeemCodes 表
- [ ] 后端：创建 Checkout Session API（套餐升级）
- [ ] 后端：Stripe Webhook 处理（payment_intent.succeeded → 自动升级套餐）
- [ ] 后端：卡密生成与激活 API
- [ ] 前端：套餐页面接入 Stripe Checkout 跳转
- [ ] 前端：卡密激活输入框与状态反馈
- [ ] 前端：支付成功回调页面

### Pyrogram 监控引擎
- [ ] 编写 Python 监控服务（monitor_engine/）
- [ ] Session 管理模块（加载/保存/健康检查）
- [ ] 关键词匹配引擎（精确/正则/AND/OR/NOT）
- [ ] 消息监听与命中记录写入
- [ ] 自动私信发送队列执行器
- [ ] 防封策略执行（随机延迟/频率限制/账号轮换）
- [ ] 引擎状态 REST API（供 Web 管理台调用）
- [ ] 后端：Web 管理台与 Python 引擎的 API 桥接
- [ ] 前端：引擎状态实时显示（运行中/停止/错误）

### Telegram Bot 命令界面
- [ ] 数据库新增 botConfigs 表
- [ ] 后端：Bot 配置 API（token 管理、命令绑定）
- [ ] Python Bot 服务（bot_service/）
- [ ] 命令菜单（/start、/add_keyword、/dm_on、/dm_template 等 26 条）
- [ ] Inline Keyboard 主菜单
- [ ] 命中通知推送（含快捷操作按钮）
- [ ] 前端：Bot 配置管理页面

## USDT 自动发卡支付系统
- [ ] 数据库：新增 paymentOrders、redeemCodes、systemSettings 表
- [ ] 后端：系统设置 API（USDT 地址、套餐价格、TronGrid API Key 等）
- [ ] 后端：创建支付订单 API（生成唯一金额、监控地址）
- [ ] 后端：TronGrid 链上监控定时任务（每 30 秒检查到账）
- [ ] 后端：到账自动生成卡密并发送给用户
- [ ] 后端：卡密激活 API（验证卡密 → 升级套餐）
- [ ] 后端：管理后台价格配置 API
- [ ] 前端：套餐购买页面（选择套餐 → 生成订单 → 显示收款地址+金额）
- [ ] 前端：支付等待页（倒计时、链上确认状态轮询）
- [ ] 前端：卡密激活输入框
- [ ] 前端：管理后台系统设置页（USDT 地址、套餐价格配置）
- [ ] 前端：订单历史记录页

## v1.2 三大核心功能完成状态
- [x] USDT TRC20 支付系统 - 数据库设计（支付订单/卡密/系统设置表）
- [x] TronGrid 链上监控 API - 自动检测 USDT 到账
- [x] 自动发卡逻辑 - 到账后自动生成卡密并通知用户
- [x] 支付前端页面 - 套餐选择/支付等待/卡密激活完整流程
- [x] 系统设置管理页 - USDT 地址/套餐价格/卡密管理/订单管理（管理员专用）
- [x] Pyrogram 监控引擎 - main.py 核心监控服务
- [x] 引擎 API 桥接路由 - Web 服务端与 Python 引擎通信接口
- [x] Telegram Bot 服务 - bot.py 命令交互服务（14条命令 + Inline Keyboard）
- [x] Bot 配置管理页 - Web 端 Bot Token 配置/部署说明/命令列表
- [x] 侧边栏导航更新 - 新增购买升级/Bot配置/系统设置入口

## v1.3 三项功能开发

### TronGrid API Key 配置与支付闭环
- [ ] 系统设置页面新增 TronGrid API Key 输入框
- [ ] 支付路由 checkPayment 使用数据库中的 API Key
- [ ] 链上监控轮询任务完善（定时检查待支付订单）
- [ ] 支付成功后 Telegram Bot 自动推送卡密通知

### Python 引擎部署优化
- [ ] 一键启动脚本 start.sh（自动安装依赖+启动服务）
- [ ] 健康检查接口 /health
- [ ] 环境变量模板 .env.example 完善
- [ ] Docker Compose 部署配置
- [ ] README.md 更新（完整部署步骤）

### 邀请裂变系统
- [ ] 数据库：邀请记录表（invitations）
- [ ] 后端 API：生成邀请链接、查询邀请记录、奖励发放
- [ ] 前端：邀请页面（专属链接、邀请记录、奖励明细）
- [ ] 侧边栏：新增邀请好友入口
- [ ] 注册流程：识别邀请码并记录关系
- [ ] 奖励逻辑：被邀请用户付费后自动给邀请人加天数

## v1.3 完成状态 (2026-03-10)
- [x] TronGrid API Key 配置集成到系统设置
- [x] 卡密激活后自动触发邀请付费奖励
- [x] Python 引擎 Docker Compose 部署配置
- [x] Python 引擎 Dockerfile 和一键启动脚本 start.sh
- [x] 完善引擎环境变量模板
- [x] 更新 README.md 完整部署说明（含 Docker/手动两种方式）
- [x] 邀请裂变数据库表（inviteCodes、inviteRecords）
- [x] 邀请裂变后端 API（生成邀请码/链接、记录注册、奖励发放）
- [x] 邀请裂变前端页面（邀请链接、统计、排行榜、奖励记录）
- [x] 侧边栏增加「邀请裂变」入口
- [x] App.tsx 注册 /invite 路由
- [x] 注册邀请链接落地处理（URL 参数自动绑定邀请关系）

## v1.4 服务器部署与编辑功能修复 (2026-03-12)

- [x] 连接服务器（72.167.134.119），检查环境（Ubuntu 24.04 + 宝塔面板 + MySQL + Node.js v22）
- [x] 修复关键词规则页面 - 支持编辑关键词内容/匹配模式/状态
- [x] 修复群组监控页面 - 支持编辑群组名称/状态
- [x] 修复消息模板页面 - 支持编辑模板内容
- [x] 修复 TG 账号管理页面 - 支持编辑账号备注
- [x] 将代码部署到服务器，配置 .env 环境变量
- [x] 配置 MySQL 数据库（tg_monitor_pro），运行 db:push
- [x] 构建前端并启动 Web 服务（PM2 管理，端口 3001）
- [x] 部署 Python 监控引擎（Pyrogram，PM2 管理）
- [x] 添加引擎 REST API 代理层（/api/engine/* 路由）
- [x] 配置 Nginx 反向代理（80 端口 → 3001）
- [x] 设置 PM2 开机自启
- [ ] 填入 TG_API_ID 和 TG_API_HASH 后测试完整监控链路

## v1.5 管理后台配置 TG API 凭证 (2026-03-12)

- [x] 后端：系统设置新增 tgApiId / tgApiHash 字段保存接口
- [x] 后端：保存后自动写入服务器 monitor-engine/.env 并重启引擎
- [x] 前端：系统设置页面新增《TG API 凭证》配置区块（API ID + API Hash 输入框）
- [x] 前端：显示引擎当前状态（运行中/等待凭证/错误）
- [x] 部署更新到服务器并测试

## v1.6 邮箱注册/登录系统（完全替换 Manus OAuth）(2026-03-12)

- [x] 数据库：users 表新增 passwordHash、emailVerified、emailVerifyToken、emailVerifyExpiry 字段
- [x] 数据库：新增 passwordResetTokens 表（找回密码 token）
- [x] 数据库：新增 loginAttempts 表（登录失败次数限制）
- [x] 后端：注册 API（邮箱+密码，发送验证邮件）
- [x] 后端：邮箱验证 API（验证 token → 激活账号）
- [x] 后端：登录 API（邮箱+密码，失败次数限制，JWT session）
- [x] 后端：找回密码 API（发送重置邮件）
- [x] 后端：重置密码 API（验证 token → 更新密码）
- [x] 后端：修改密码 API（需登录，验证旧密码）
- [x] 后端：集成 SMTP 邮件发送（nodemailer）
- [x] 前端：注册页面（邮箱+密码+确认密码）
- [x] 前端：登录页面（邮箱+密码，记住我）
- [x] 前端：邮箱验证提示页（注册后提示查收邮件）
- [x] 前端：找回密码页（输入邮箱发送重置链接）
- [x] 前端：重置密码页（输入新密码）
- [x] 前端：个人设置页（修改密码）
- [x] 移除 Manus OAuth 登录入口
- [x] 部署到服务器并测试完整流程

## v1.7 参考 bljtBot 新增全部功能 (2026-03-12)

### 数据库
- [x] 新增 senderHistory 表（发送者历史消息记录）
- [x] 新增 groupSubmissions 表（用户提交的群组审核）
- [x] 新增 pushSettings 表（推送开关/广告过滤/协作群组）
- [x] 新增 keywordDailyStats 表（关键词每日统计）

### 后端 API
- [x] 消息处理标记 API（markHandled/unmarkHandled）
- [x] 屏蔽/取消屏蔽发送者 API
- [x] 查看发送者历史记录 API（近7天）
- [x] 删除发送者所有历史推送 API
- [x] 过滤广告用户开关 API
- [x] 推送开关 API（savePushSettings）
- [x] 关键词命中统计 API（近7日每天命中数）
- [x] 关键词用户列表 API（命中某关键词的所有用户）
- [x] 用户列表导出 API（CSV 下载）
- [x] 群组提交审核 API（用户提交 + 管理员审核）
- [x] 多人协作推送群配置 API（collaborationGroupId）
- [x] engineRestApi 新增 sender-history、keyword-stat 接口

### 前端页面
- [x] 新增「命中消息」页面（消息列表、处理标记、屏蔽按钮、历史查看）
- [x] 新增「关键词统计」页面（7日趋势图、命中用户列表、CSV 导出）
- [x] 新增「群组审核」页面（管理员审核用户提交的群组）
- [x] 新增「推送设置」页面（推送开关、协作群、广告过滤、屏蔽列表）
- [x] 侧边栏导航更新（DashboardLayout.tsx）

### Python 引擎
- [x] 推送前检查发送者是否在屏蔽列表
- [x] 推送前检查用户推送开关是否开启
- [x] 推送前检查广告过滤开关，过滤疑似广告账号
- [x] 记录发送者历史消息到 senderHistory 表
- [x] 关键词命中统计写入 keywordDailyStats 表
- [x] 支持协作群组推送（collabChatId）
- [x] 部署到服务器（72.167.134.119）

## v1.8 修复关键词命中问题 (2026-03-13)

- [ ] 修复 ecosystem.engine.cjs 语法错误（ENGINE_SECRET 变量未定义）
- [ ] 修复 saveTgApiCredentials 写入 .env 路径问题（生产环境路径不对）
- [ ] 修复 Python 引擎无法启动问题（TG_API_ID/HASH 未配置）
- [ ] 修复 ENGINE_SECRET 不一致问题（引擎和 Web 服务的 secret 不同步）
- [ ] 在系统设置 TG API 凭证页面增加「引擎密钥」配置项
- [ ] 构建并部署到服务器，验证关键词命中功能

## v1.9 修复系统设置问题 (2026-03-13)
- [x] 修复 saveTgApiCredentials 保存后卡住问题（PM2 重启改为异步不阻塞）
- [x] 恢复系统设置 Bot 配置 Tab（Bot Token、推送频道 ID）
- [x] 后端新增 saveBotConfig / getBotConfig API
- [x] 构建部署到服务器验证

## v2.0 修复关键词命中和群成员数获取 (2026-03-13)
- [ ] 查看引擎日志确认 TG API 凭证/账号登录/群组状态
- [ ] 修复关键词无法命中问题
- [ ] 修复群成员数无法获取问题
- [ ] 构建部署验证

## v2.1 Bot 命令菜单 (2026-03-13)
- [ ] 检查 bot.py 中命令处理逻辑
- [ ] 确保 /start /status /help 等命令正常响应
- [ ] 通过 setMyCommands API 自动注册命令菜单
- [ ] 部署验证

## v2.2 修复保存按钮卡住 (2026-03-13)
- [ ] 后端所有 saveTgApiCredentials / saveBotConfig 的 PM2 重启改为完全异步（fire-and-forget）
- [ ] 保存后立即返回成功，前端立即显示 toast 提示
- [ ] 构建部署并重启 Bot 进程

## v2.3 Bot 自动私信功能 (2026-03-13)
- [x] bot.py 全面重写：/start 自动注册、关键词管理、私信账号绑定、消息模板设置、监控群组管理
- [x] bot.py 主菜单 Inline Keyboard（关键词/群组/私信模板/私信账号/统计/套餐/自动私信开关）
- [x] bot.py 快捷命令：/kw /template /group /stats /activate /help
- [x] engine.ts：新增 botAutoRegister（/start 自动创建账号，绑定 tgUserId）
- [x] engine.ts：botGetUserStatus 返回 hasSenderAccount/senderPhone
- [x] engine.ts：/engine/config 返回 botChatId（用户 tgUserId），供引擎推送命中通知
- [x] main.py：关键词命中后通过 Bot API 向用户推送命中通知（含发送者/群组/关键词/私信状态）
- [x] bot.py：WEB_SITE_URL 环境变量替换硬编码 URL
- [ ] 部署到服务器并测试完整流程
