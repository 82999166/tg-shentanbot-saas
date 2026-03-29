import {
  bigint,
  boolean,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  decimal,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

// ============================================================
// 用户表（基础）
// ============================================================
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).unique(),       // 兼容旧 OAuth，新用户可为空
  name: text("name"),
  email: varchar("email", { length: 320 }).unique(),
  loginMethod: varchar("loginMethod", { length: 64 }),
  // 邮箱注册
  passwordHash: varchar("passwordHash", { length: 256 }),   // bcrypt 哈希
  emailVerified: boolean("emailVerified").default(false).notNull(),
  emailVerifyToken: varchar("emailVerifyToken", { length: 128 }),
  emailVerifyExpiry: timestamp("emailVerifyExpiry"),
  // Telegram 绑定（Bot 自动注册）
  tgUserId: varchar("tgUserId", { length: 32 }).unique(),    // TG 用户 ID
  tgUsername: varchar("tgUsername", { length: 128 }),        // TG 用户名
  tgFirstName: varchar("tgFirstName", { length: 128 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  // 套餐
  planId: mysqlEnum("planId", ["free", "basic", "pro", "enterprise"]).default("free").notNull(),
  planExpiresAt: timestamp("planExpiresAt"),
  // 配额缓存（每日重置）
  dailyDmSent: int("dailyDmSent").default(0).notNull(),
  dailyDmResetAt: timestamp("dailyDmResetAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ============================================================
// 套餐配置表
// ============================================================
export const plans = mysqlTable("plans", {
  id: mysqlEnum("id", ["free", "basic", "pro", "enterprise"]).primaryKey(),
  name: varchar("name", { length: 64 }).notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  maxMonitorGroups: int("maxMonitorGroups").notNull(),   // 最大监控群组数
  maxKeywords: int("maxKeywords").notNull(),              // 最大关键词数
  maxDailyDm: int("maxDailyDm").notNull(),               // 每日最大私信数
  maxTgAccounts: int("maxTgAccounts").notNull(),          // 最大TG账号数
  maxTemplates: int("maxTemplates").notNull(),            // 最大消息模板数
  features: json("features"),                             // 额外功能列表
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Plan = typeof plans.$inferSelect;

// ============================================================
// Telegram 账号表
// ============================================================
export const tgAccounts = mysqlTable("tg_accounts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  // TG 账号信息
  phone: varchar("phone", { length: 32 }).unique(),       // 手机号唯一约束，防止重复添加
  tgUserId: varchar("tgUserId", { length: 32 }),         // TG 用户 ID
  tgUsername: varchar("tgUsername", { length: 128 }),    // TG 用户名
  tgFirstName: varchar("tgFirstName", { length: 128 }),
  tgLastName: varchar("tgLastName", { length: 128 }),
  // Session 管理
  sessionString: text("sessionString"),                   // 加密存储的 Session
  sessionStatus: mysqlEnum("sessionStatus", ["pending", "active", "expired", "banned"]).default("pending").notNull(),
  // 账号角色
  accountRole: mysqlEnum("accountRole", ["monitor", "sender", "both"]).default("both").notNull(),
  // 健康度评分 (0-100)
  healthScore: int("healthScore").default(100).notNull(),
  healthStatus: mysqlEnum("healthStatus", ["healthy", "warning", "degraded", "suspended"]).default("healthy").notNull(),
  // 统计
  totalMonitored: int("totalMonitored").default(0).notNull(),
  totalDmSent: int("totalDmSent").default(0).notNull(),
  dailyDmSent: int("dailyDmSent").default(0).notNull(),
  dailyDmResetAt: timestamp("dailyDmResetAt"),
  lastActiveAt: timestamp("lastActiveAt"),
  // 代理配置
  proxyHost: varchar("proxyHost", { length: 256 }),
  proxyPort: int("proxyPort"),
  proxyType: mysqlEnum("proxyType", ["socks5", "http", "mtproto"]),
  proxyUsername: varchar("proxyUsername", { length: 128 }),
  proxyPassword: varchar("proxyPassword", { length: 256 }),
  // 备注
  notes: text("notes"),
  isActive: boolean("isActive").default(true).notNull(),
  // 健康告警冷却（防止刷屏）
  lastAlertAt: timestamp("lastAlertAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_tg_accounts_userId").on(t.userId),
  uniqueIndex("uq_tg_accounts_phone").on(t.phone),
]);

export type TgAccount = typeof tgAccounts.$inferSelect;
export type InsertTgAccount = typeof tgAccounts.$inferInsert;

// ============================================================
// 关键词分组表
// ============================================================
export const keywordGroups = mysqlTable("keyword_groups", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  color: varchar("color", { length: 16 }).default("#3B82F6"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [index("idx_keyword_groups_userId").on(t.userId)]);

export type KeywordGroup = typeof keywordGroups.$inferSelect;

// ============================================================
// 关键词规则表
// ============================================================
export const keywords = mysqlTable("keywords", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  groupId: int("groupId"),
  // 规则配置
  keyword: varchar("keyword", { length: 512 }).notNull(),
  matchType: mysqlEnum("matchType", ["exact", "contains", "regex", "and", "or", "not"]).default("contains").notNull(),
  // AND/OR/NOT 逻辑时的子关键词列表
  subKeywords: json("subKeywords"),
  // 大小写敏感
  caseSensitive: boolean("caseSensitive").default(false).notNull(),
  // 统计
  hitCount: int("hitCount").default(0).notNull(),
  lastHitAt: timestamp("lastHitAt"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_keywords_userId").on(t.userId),
  index("idx_keywords_groupId").on(t.groupId),
]);

export type Keyword = typeof keywords.$inferSelect;
export type InsertKeyword = typeof keywords.$inferInsert;

// ============================================================
// 监控群组表
// ============================================================
export const monitorGroups = mysqlTable("monitor_groups", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  tgAccountId: int("tgAccountId").notNull(),             // 使用哪个TG账号监控
  // 群组信息
  groupId: varchar("groupId", { length: 64 }).notNull(), // TG 群组 ID
  groupTitle: varchar("groupTitle", { length: 256 }),
  groupUsername: varchar("groupUsername", { length: 128 }),
  groupType: mysqlEnum("groupType", ["group", "supergroup", "channel"]).default("supergroup"),
  memberCount: int("memberCount"),
  // 关联的关键词分组（JSON数组存储关键词ID列表）
  keywordIds: json("keywordIds"),
  // 监控状态
  monitorStatus: mysqlEnum("monitorStatus", ["active", "paused", "error"]).default("active").notNull(),
  lastMessageAt: timestamp("lastMessageAt"),
  totalHits: int("totalHits").default(0).notNull(),
  errorMessage: text("errorMessage"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_monitor_groups_userId").on(t.userId),
  index("idx_monitor_groups_tgAccountId").on(t.tgAccountId),
]);

export type MonitorGroup = typeof monitorGroups.$inferSelect;
export type InsertMonitorGroup = typeof monitorGroups.$inferInsert;

// ============================================================
// 消息模板表
// ============================================================
export const messageTemplates = mysqlTable("message_templates", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  // 模板内容（支持变量：{username}, {keyword}, {group_name}, {message}, {date}）
  content: text("content").notNull(),
  // 轮换权重（越高越常用）
  weight: int("weight").default(1).notNull(),
  // 统计
  usedCount: int("usedCount").default(0).notNull(),
  lastUsedAt: timestamp("lastUsedAt"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [index("idx_message_templates_userId").on(t.userId)]);

export type MessageTemplate = typeof messageTemplates.$inferSelect;
export type InsertMessageTemplate = typeof messageTemplates.$inferInsert;

// ============================================================
// 命中记录表
// ============================================================
export const hitRecords = mysqlTable("hit_records", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  // 来源信息
  monitorGroupId: int("monitorGroupId").notNull(),
  keywordId: int("keywordId").notNull(),
  tgAccountId: int("tgAccountId").notNull(),
  // 消息信息
  messageId: varchar("messageId", { length: 64 }),
  messageContent: text("messageContent"),
  messageDate: timestamp("messageDate"),
  // 发送者信息
  senderTgId: varchar("senderTgId", { length: 64 }),
  senderUsername: varchar("senderUsername", { length: 128 }),
  senderFirstName: varchar("senderFirstName", { length: 128 }),
  senderLastName: varchar("senderLastName", { length: 128 }),
  // 命中的关键词
  matchedKeyword: varchar("matchedKeyword", { length: 512 }),
  // 私信状态
  dmStatus: mysqlEnum("dmStatus", ["pending", "queued", "sent", "failed", "skipped", "duplicate"]).default("pending").notNull(),
  dmSentAt: timestamp("dmSentAt"),
  dmTemplateId: int("dmTemplateId"),
  dmContent: text("dmContent"),
  dmError: text("dmError"),
  // 是否已处理（人工标记）
  isProcessed: boolean("isProcessed").default(false).notNull(),
  processedAt: timestamp("processedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => [
  index("idx_hit_records_userId").on(t.userId),
  index("idx_hit_records_monitorGroupId").on(t.monitorGroupId),
  index("idx_hit_records_keywordId").on(t.keywordId),
  index("idx_hit_records_senderTgId").on(t.senderTgId),
  index("idx_hit_records_createdAt").on(t.createdAt),
]);

export type HitRecord = typeof hitRecords.$inferSelect;
export type InsertHitRecord = typeof hitRecords.$inferInsert;

// ============================================================
// 私信发送队列表
// ============================================================
export const dmQueue = mysqlTable("dm_queue", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  hitRecordId: bigint("hitRecordId", { mode: "number" }),
  // 发送配置
  senderAccountId: int("senderAccountId").notNull(),     // 使用哪个账号发送
  targetTgId: varchar("targetTgId", { length: 64 }).notNull(),
  targetUsername: varchar("targetUsername", { length: 128 }),
  templateId: int("templateId"),
  content: text("content").notNull(),
  // 调度
  scheduledAt: timestamp("scheduledAt").notNull(),
  status: mysqlEnum("status", ["pending", "processing", "sent", "failed", "cancelled"]).default("pending").notNull(),
  retryCount: int("retryCount").default(0).notNull(),
  maxRetries: int("maxRetries").default(3).notNull(),
  // 结果
  sentAt: timestamp("sentAt"),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_dm_queue_userId").on(t.userId),
  index("idx_dm_queue_status").on(t.status),
  index("idx_dm_queue_scheduledAt").on(t.scheduledAt),
]);

export type DmQueue = typeof dmQueue.$inferSelect;
export type InsertDmQueue = typeof dmQueue.$inferInsert;

// ============================================================
// 防封策略配置表
// ============================================================
export const antibanSettings = mysqlTable("antiban_settings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  // 发信频率控制
  dailyDmLimit: int("dailyDmLimit").default(30).notNull(),
  minIntervalSeconds: int("minIntervalSeconds").default(60).notNull(),
  maxIntervalSeconds: int("maxIntervalSeconds").default(180).notNull(),
  // 活跃时间窗口（24小时制）
  activeHourStart: int("activeHourStart").default(9).notNull(),
  activeHourEnd: int("activeHourEnd").default(22).notNull(),
  // 去重策略
  deduplicateEnabled: boolean("deduplicateEnabled").default(true).notNull(),
  deduplicateWindowHours: int("deduplicateWindowHours").default(24).notNull(),
  // 账号健康度阈值
  warningThreshold: int("warningThreshold").default(70).notNull(),
  degradedThreshold: int("degradedThreshold").default(40).notNull(),
  suspendThreshold: int("suspendThreshold").default(20).notNull(),
  // 自动降级
  autoDegrade: boolean("autoDegrade").default(true).notNull(),
  // 模板轮换
  templateRotation: boolean("templateRotation").default(true).notNull(),
  // DM 功能总开关
  dmEnabled: boolean("dmEnabled").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [index("idx_antiban_settings_userId").on(t.userId)]);

export type AntibanSettings = typeof antibanSettings.$inferSelect;
export type InsertAntibanSettings = typeof antibanSettings.$inferInsert;

// ============================================================
// 黑名单表（屏蔽特定用户）
// ============================================================
export const blacklist = mysqlTable("blacklist", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  targetTgId: varchar("targetTgId", { length: 64 }),
  targetUsername: varchar("targetUsername", { length: 128 }),
  reason: text("reason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => [
  index("idx_blacklist_userId").on(t.userId),
  index("idx_blacklist_targetTgId").on(t.targetTgId),
]);

export type Blacklist = typeof blacklist.$inferSelect;

// ============================================================
// 系统设置表（管理员可配置）
// ============================================================
export const systemSettings = mysqlTable("system_settings", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 128 }).notNull().unique(),
  value: text("value"),
  description: text("description"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SystemSetting = typeof systemSettings.$inferSelect;

// ============================================================
// 支付订单表（USDT 支付）
// ============================================================
export const paymentOrders = mysqlTable("payment_orders", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  // 套餐信息
  planId: mysqlEnum("planId", ["basic", "pro", "enterprise"]).notNull(),
  durationMonths: int("durationMonths").default(1).notNull(),
  // 支付信息
  usdtAmount: decimal("usdtAmount", { precision: 18, scale: 6 }).notNull(), // 精确金额（含唯一小数）
  usdtAddress: varchar("usdtAddress", { length: 128 }).notNull(),            // 收款地址
  network: mysqlEnum("network", ["trc20", "erc20", "bep20"]).default("trc20").notNull(),
  // 链上信息
  txHash: varchar("txHash", { length: 128 }),                                // 交易哈希
  confirmedAt: timestamp("confirmedAt"),
  // 订单状态
  status: mysqlEnum("status", ["pending", "confirming", "completed", "expired", "failed"]).default("pending").notNull(),
  expiredAt: timestamp("expiredAt").notNull(),                               // 订单过期时间（30分钟）
  // 卡密（支付成功后生成）
  redeemCode: varchar("redeemCode", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_payment_orders_userId").on(t.userId),
  index("idx_payment_orders_status").on(t.status),
  index("idx_payment_orders_usdtAmount").on(t.usdtAmount),
]);

export type PaymentOrder = typeof paymentOrders.$inferSelect;
export type InsertPaymentOrder = typeof paymentOrders.$inferInsert;

// ============================================================
// 卡密表
// ============================================================
export const redeemCodes = mysqlTable("redeem_codes", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 64 }).notNull().unique(),                 // 卡密，如 TGPRO-XXXX-XXXX-XXXX
  planId: mysqlEnum("planId", ["basic", "pro", "enterprise"]).notNull(),
  durationMonths: int("durationMonths").default(1).notNull(),
  // 状态
  status: mysqlEnum("status", ["unused", "used", "expired"]).default("unused").notNull(),
  // 使用信息
  usedByUserId: int("usedByUserId"),
  usedAt: timestamp("usedAt"),
  // 来源
  orderId: int("orderId"),                                                   // 关联订单
  batchId: varchar("batchId", { length: 64 }),                              // 批量生成批次号
  // 有效期
  expiresAt: timestamp("expiresAt"),                                         // 卡密本身的有效期
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => [
  index("idx_redeem_codes_code").on(t.code),
  index("idx_redeem_codes_status").on(t.status),
  index("idx_redeem_codes_orderId").on(t.orderId),
]);

export type RedeemCode = typeof redeemCodes.$inferSelect;
export type InsertRedeemCode = typeof redeemCodes.$inferInsert;

// ============================================================
// Telegram Bot 配置表
// ============================================================
export const botConfigs = mysqlTable("bot_configs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  botToken: varchar("botToken", { length: 256 }),                           // Bot Token
  botUsername: varchar("botUsername", { length: 128 }),
  // 通知配置
  notifyEnabled: boolean("notifyEnabled").default(true).notNull(),
  notifyTargetChatId: varchar("notifyTargetChatId", { length: 64 }),       // 接收通知的 Chat ID
  notifyFormat: mysqlEnum("notifyFormat", ["simple", "standard", "detailed"]).default("standard").notNull(),
  // Bot 状态
  isActive: boolean("isActive").default(false).notNull(),
  lastActiveAt: timestamp("lastActiveAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [index("idx_bot_configs_userId").on(t.userId)]);

export type BotConfig = typeof botConfigs.$inferSelect;
export type InsertBotConfig = typeof botConfigs.$inferInsert;

// ============================================================
// 邀请裂变系统
// ============================================================
export const inviteCodes = mysqlTable("invite_codes", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),                                  // 邀请人
  code: varchar("code", { length: 32 }).notNull().unique(),                 // 邀请码，如 TGM-ABC123
  totalInvited: int("totalInvited").default(0).notNull(),                   // 累计邀请注册人数
  totalPaidInvited: int("totalPaidInvited").default(0).notNull(),           // 累计邀请付费人数
  totalRewardDays: int("totalRewardDays").default(0).notNull(),             // 累计获得奖励天数
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_invite_codes_userId").on(t.userId),
  index("idx_invite_codes_code").on(t.code),
]);
export type InviteCode = typeof inviteCodes.$inferSelect;
export type InsertInviteCode = typeof inviteCodes.$inferInsert;

// 邀请记录表
export const inviteRecords = mysqlTable("invite_records", {
  id: int("id").autoincrement().primaryKey(),
  inviterId: int("inviterId").notNull(),                                    // 邀请人 userId
  inviteeId: int("inviteeId").notNull().unique(),                           // 被邀请人 userId（一人只能被邀请一次）
  inviteCode: varchar("inviteCode", { length: 32 }).notNull(),
  // 奖励状态
  registrationRewarded: boolean("registrationRewarded").default(false).notNull(),  // 注册奖励已发放
  paymentRewarded: boolean("paymentRewarded").default(false).notNull(),            // 付费奖励已发放
  rewardDaysGranted: int("rewardDaysGranted").default(0).notNull(),                // 已发放奖励天数
  // 时间
  registeredAt: timestamp("registeredAt").defaultNow().notNull(),
  paidAt: timestamp("paidAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => [
  index("idx_invite_records_inviterId").on(t.inviterId),
  index("idx_invite_records_inviteeId").on(t.inviteeId),
]);
export type InviteRecord = typeof inviteRecords.$inferSelect;
export type InsertInviteRecord = typeof inviteRecords.$inferInsert;

// ============================================================
// 密码重置 Token 表
// ============================================================
export const passwordResetTokens = mysqlTable("password_reset_tokens", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  token: varchar("token", { length: 128 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  usedAt: timestamp("usedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => [index("idx_prt_userId").on(t.userId), index("idx_prt_token").on(t.token)]);

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

// ============================================================
// 登录失败记录表（防暴力破解）
// ============================================================
export const loginAttempts = mysqlTable("login_attempts", {
  id: int("id").autoincrement().primaryKey(),
  email: varchar("email", { length: 320 }).notNull(),
  ip: varchar("ip", { length: 64 }),
  success: boolean("success").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => [index("idx_la_email").on(t.email), index("idx_la_ip").on(t.ip)]);

export type LoginAttempt = typeof loginAttempts.$inferSelect;

// ============================================================
// 发送者历史记录表（查看某用户近期发言）
// ============================================================
export const senderHistory = mysqlTable("sender_history", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  userId: int("userId").notNull(),                              // 所属监控用户
  senderTgId: varchar("senderTgId", { length: 64 }).notNull(), // 发送者 TG ID
  senderUsername: varchar("senderUsername", { length: 128 }),
  senderFirstName: varchar("senderFirstName", { length: 128 }),
  // 消息内容
  messageContent: text("messageContent"),
  groupId: varchar("groupId", { length: 64 }),
  groupTitle: varchar("groupTitle", { length: 256 }),
  messageDate: timestamp("messageDate").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => [
  index("idx_sender_history_userId").on(t.userId),
  index("idx_sender_history_senderTgId").on(t.senderTgId),
  index("idx_sender_history_messageDate").on(t.messageDate),
]);

export type SenderHistory = typeof senderHistory.$inferSelect;
export type InsertSenderHistory = typeof senderHistory.$inferInsert;

// ============================================================
// 群组提交审核表（用户提交新群组，管理员审核）
// ============================================================
export const groupSubmissions = mysqlTable("group_submissions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),                              // 提交人
  groupLink: varchar("groupLink", { length: 256 }).notNull(),  // 群组链接
  groupTitle: varchar("groupTitle", { length: 256 }),
  description: text("description"),                            // 提交说明
  status: mysqlEnum("status", ["pending", "approved", "rejected"]).default("pending").notNull(),
  reviewNote: text("reviewNote"),                              // 审核备注
  reviewedAt: timestamp("reviewedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_group_submissions_userId").on(t.userId),
  index("idx_group_submissions_status").on(t.status),
]);

export type GroupSubmission = typeof groupSubmissions.$inferSelect;
export type InsertGroupSubmission = typeof groupSubmissions.$inferInsert;

// ============================================================
// 用户推送设置表（推送开关、广告过滤、协作群组等）
// ============================================================
export const pushSettings = mysqlTable("push_settings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  // 推送开关
  pushEnabled: boolean("pushEnabled").default(true).notNull(),
  // 过滤广告用户
  filterAds: boolean("filterAds").default(false).notNull(),
  // 多人协作推送群（TG 群组 Chat ID）
  collaborationGroupId: varchar("collaborationGroupId", { length: 64 }),
  collaborationGroupTitle: varchar("collaborationGroupTitle", { length: 256 }),
  // 推送格式
  pushFormat: mysqlEnum("pushFormat", ["simple", "standard", "detailed"]).default("standard").notNull(),
  // ===== 方案A：设置中心新增字段 =====
  // 关键词匹配模式：fuzzy=模糊匹配(默认), exact=精确匹配, leftmost=最左匹配, rightmost=最右匹配
  keywordMatchMode: mysqlEnum("keywordMatchMode", ["fuzzy", "exact", "leftmost", "rightmost"]).default("fuzzy").notNull(),
  // 黑名单关键词匹配模式：fuzzy=模糊匹配(默认), exact=精确匹配
  blacklistMatchMode: mysqlEnum("blacklistMatchMode", ["fuzzy", "exact"]).default("fuzzy").notNull(),
  // 是否包含7日搜索历史（开启后推送时同步检索近7天消息）
  includeSearchHistory: boolean("includeSearchHistory").default(false).notNull(),
  // 去重时间窗口（分钟）：0=不去重, 3,5,10,30,60,720,1440,14400,43200
  dedupeMinutes: int("dedupeMinutes").default(0).notNull(),
  // 黑名单关键词（逗号分隔，命中则跳过推送）
  blacklistKeywords: text("blacklistKeywords"),
  // 是否过滤机器人消息
  filterBots: boolean("filterBots").default(false).notNull(),
  // 是否只推送有图片/媒体的消息
  mediaOnly: boolean("mediaOnly").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [index("idx_push_settings_userId").on(t.userId)]);

export type PushSettings = typeof pushSettings.$inferSelect;
export type InsertPushSettings = typeof pushSettings.$inferInsert;

// ============================================================
// 关键词每日统计表（近7日命中趋势）
// ============================================================
export const keywordDailyStats = mysqlTable("keyword_daily_stats", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  keywordId: int("keywordId").notNull(),
  date: varchar("date", { length: 10 }).notNull(),             // YYYY-MM-DD
  hitCount: int("hitCount").default(0).notNull(),
  uniqueSenders: int("uniqueSenders").default(0).notNull(),    // 唯一发送者数
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_kds_userId").on(t.userId),
  index("idx_kds_keywordId").on(t.keywordId),
  index("idx_kds_date").on(t.date),
]);

export type KeywordDailyStat = typeof keywordDailyStats.$inferSelect;
export type InsertKeywordDailyStat = typeof keywordDailyStats.$inferInsert;

// ============================================================
// 系统配置表（单行 key-value 配置）
// ============================================================
export const systemConfig = mysqlTable("system_config", {
  id: int("id").autoincrement().primaryKey(),
  configKey: varchar("configKey", { length: 64 }).unique().notNull(),
  configValue: text("configValue"),
  description: varchar("description", { length: 256 }),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type SystemConfig = typeof systemConfig.$inferSelect;
export type InsertSystemConfig = typeof systemConfig.$inferInsert;

// ============================================================
// 公共监控群组表（管理员添加，所有会员共享使用）
// ============================================================
export const publicMonitorGroups = mysqlTable("public_monitor_groups", {
  id: int("id").autoincrement().primaryKey(),
  groupId: varchar("groupId", { length: 128 }).notNull().unique(),   // TG 群组 ID 或 @username
  groupTitle: varchar("groupTitle", { length: 256 }),                // 群组名称
  groupType: varchar("groupType", { length: 32 }).default("group"),  // group / channel
  memberCount: int("memberCount").default(0),
  isActive: boolean("isActive").default(true).notNull(),
  realId: varchar("realId", { length: 64 }),                         // TG 真实数字 ID（引擎解析后回写）
  addedBy: int("addedBy"),                                           // 添加者 userId（管理员）
  note: varchar("note", { length: 512 }),                           // 备注
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_pmg_groupId").on(t.groupId),
  index("idx_pmg_isActive").on(t.isActive),
]);
export type PublicMonitorGroup = typeof publicMonitorGroups.$inferSelect;
export type InsertPublicMonitorGroup = typeof publicMonitorGroups.$inferInsert;

// ============================================================
// 公共群组关键词表（管理员为每个公共群组配置全局关键词）
// ============================================================
export const publicGroupKeywords = mysqlTable("public_group_keywords", {
  id: int("id").autoincrement().primaryKey(),
  publicGroupId: int("publicGroupId").notNull(),                     // 关联 public_monitor_groups.id
  pattern: varchar("pattern", { length: 256 }).notNull(),           // 关键词内容
  matchType: varchar("matchType", { length: 32 }).default("contains"), // contains / exact / regex
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => [
  index("idx_pgk_groupId").on(t.publicGroupId),
  index("idx_pgk_isActive").on(t.isActive),
]);
export type PublicGroupKeyword = typeof publicGroupKeywords.$inferSelect;
export type InsertPublicGroupKeyword = typeof publicGroupKeywords.$inferInsert;

// ============================================================
// 监控账号加群状态表（记录每个监控账号是否已加入公共群组）
// ============================================================
export const publicGroupJoinStatus = mysqlTable("public_group_join_status", {
  id: int("id").autoincrement().primaryKey(),
  publicGroupId: int("publicGroupId").notNull(),                     // 关联 public_monitor_groups.id
  monitorAccountId: int("monitorAccountId").notNull(),               // 关联 tg_accounts.id
  status: varchar("status", { length: 32 }).default("pending").notNull(), // pending / joined / failed
  errorMsg: varchar("errorMsg", { length: 512 }),                   // 失败原因
  joinedAt: timestamp("joinedAt"),                                   // 成功加入时间
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_pgjs_groupId").on(t.publicGroupId),
  index("idx_pgjs_accountId").on(t.monitorAccountId),
  uniqueIndex("idx_pgjs_unique").on(t.publicGroupId, t.monitorAccountId),
]);
export type PublicGroupJoinStatus = typeof publicGroupJoinStatus.$inferSelect;
export type InsertPublicGroupJoinStatus = typeof publicGroupJoinStatus.$inferInsert;

// ============================================================
// 群组采集任务表（管理员配置关键词采集任务）
// ============================================================
export const groupScrapeTasks = mysqlTable("group_scrape_tasks", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),                    // 任务名称
  keywords: text("keywords").notNull(),                                // 搜索关键词，JSON 数组存储
  minMemberCount: int("minMemberCount").default(1000).notNull(),       // 最小成员数过滤
  maxResults: int("maxResults").default(50).notNull(),                 // 每个关键词最多采集数量
  status: varchar("status", { length: 32 }).default("idle").notNull(), // idle / running / done / failed
  lastRunAt: timestamp("lastRunAt"),                                   // 最近一次执行时间
  totalFound: int("totalFound").default(0),                           // 本次采集到的总数
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type GroupScrapeTask = typeof groupScrapeTasks.$inferSelect;
export type InsertGroupScrapeTask = typeof groupScrapeTasks.$inferInsert;

// ============================================================
// 群组采集结果表（TDLib searchPublicChats 返回的群组）
// ============================================================
export const groupScrapeResults = mysqlTable("group_scrape_results", {
  id: int("id").autoincrement().primaryKey(),
  taskId: int("taskId").notNull(),                                     // 关联采集任务
  keyword: varchar("keyword", { length: 128 }).notNull(),             // 触发该结果的关键词
  groupId: varchar("groupId", { length: 128 }).notNull(),             // TG @username 或数字 ID
  groupTitle: varchar("groupTitle", { length: 256 }),                 // 群组名称
  groupType: varchar("groupType", { length: 32 }).default("group"),   // group / channel / supergroup
  memberCount: int("memberCount").default(0),                         // 成员数
  description: text("description"),                                   // 群组简介
  username: varchar("username", { length: 128 }),                     // @username（无@）
  realId: varchar("realId", { length: 64 }),                          // TG 真实数字 ID
  importStatus: varchar("importStatus", { length: 32 }).default("pending").notNull(), // pending / imported / ignored
  importedAt: timestamp("importedAt"),                                // 导入时间
  scrapedAt: timestamp("scrapedAt").defaultNow().notNull(),           // 采集时间
}, (t) => [
  index("idx_gsr_taskId").on(t.taskId),
  index("idx_gsr_groupId").on(t.groupId),
  index("idx_gsr_importStatus").on(t.importStatus),
  uniqueIndex("idx_gsr_task_group").on(t.taskId, t.groupId),
]);
export type GroupScrapeResult = typeof groupScrapeResults.$inferSelect;
export type InsertGroupScrapeResult = typeof groupScrapeResults.$inferInsert;
