import { and, desc, eq, gte, inArray, like, lt, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  AntibanSettings,
  InsertAntibanSettings,
  InsertHitRecord,
  InsertKeyword,
  InsertMessageTemplate,
  InsertMonitorGroup,
  InsertTgAccount,
  InsertUser,
  Keyword,
  antibanSettings,
  blacklist,
  dmQueue,
  hitRecords,
  keywordGroups,
  keywords,
  messageTemplates,
  monitorGroups,
  plans,
  tgAccounts,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ============================================================
// 用户相关
// ============================================================
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};

  const textFields = ["name", "email", "loginMethod"] as const;
  textFields.forEach((field) => {
    const value = user[field];
    if (value === undefined) return;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  });

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getAllUsers(limit = 50, offset = 0) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).orderBy(desc(users.createdAt)).limit(limit).offset(offset);
}

export async function updateUserPlan(userId: number, planId: "free" | "basic" | "pro" | "enterprise", expiresAt?: Date) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ planId, planExpiresAt: expiresAt ?? null }).where(eq(users.id, userId));
}

// ============================================================
// 套餐相关
// ============================================================
export async function getAllPlans() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(plans).where(eq(plans.isActive, true));
}

export async function getPlanById(id: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(plans).where(eq(plans.id, id as any)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function upsertPlan(plan: typeof plans.$inferInsert) {
  const db = await getDb();
  if (!db) return;
  await db.insert(plans).values(plan).onDuplicateKeyUpdate({
    set: {
      name: plan.name,
      price: plan.price,
      maxMonitorGroups: plan.maxMonitorGroups,
      maxKeywords: plan.maxKeywords,
      maxDailyDm: plan.maxDailyDm,
      maxTgAccounts: plan.maxTgAccounts,
      maxTemplates: plan.maxTemplates,
      features: plan.features,
    },
  });
}

// ============================================================
// TG 账号相关
// ============================================================
export async function getTgAccountsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(tgAccounts).where(and(eq(tgAccounts.userId, userId), eq(tgAccounts.isActive, true))).orderBy(desc(tgAccounts.createdAt));
}

export async function getTgAccountById(id: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(tgAccounts).where(and(eq(tgAccounts.id, id), eq(tgAccounts.userId, userId))).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createTgAccount(data: InsertTgAccount) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(tgAccounts).values(data);
  return result[0].insertId;
}

export async function updateTgAccount(id: number, userId: number, data: Partial<InsertTgAccount>) {
  const db = await getDb();
  if (!db) return;
  await db.update(tgAccounts).set({ ...data, updatedAt: new Date() }).where(and(eq(tgAccounts.id, id), eq(tgAccounts.userId, userId)));
}

export async function deleteTgAccount(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(tgAccounts).set({ isActive: false }).where(and(eq(tgAccounts.id, id), eq(tgAccounts.userId, userId)));
}

// ============================================================
// 关键词分组相关
// ============================================================
export async function getKeywordGroupsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(keywordGroups).where(and(eq(keywordGroups.userId, userId), eq(keywordGroups.isActive, true))).orderBy(keywordGroups.name);
}

export async function createKeywordGroup(data: typeof keywordGroups.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(keywordGroups).values(data);
  return result[0].insertId;
}

export async function updateKeywordGroup(id: number, userId: number, data: Partial<typeof keywordGroups.$inferInsert>) {
  const db = await getDb();
  if (!db) return;
  await db.update(keywordGroups).set({ ...data, updatedAt: new Date() }).where(and(eq(keywordGroups.id, id), eq(keywordGroups.userId, userId)));
}

export async function deleteKeywordGroup(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(keywordGroups).set({ isActive: false }).where(and(eq(keywordGroups.id, id), eq(keywordGroups.userId, userId)));
}

// ============================================================
// 关键词相关
// ============================================================
export async function getKeywordsByUserId(userId: number, groupId?: number) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(keywords.userId, userId), eq(keywords.isActive, true)];
  if (groupId !== undefined) conditions.push(eq(keywords.groupId, groupId));
  return db.select().from(keywords).where(and(...conditions)).orderBy(desc(keywords.createdAt));
}

export async function getKeywordById(id: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(keywords).where(and(eq(keywords.id, id), eq(keywords.userId, userId))).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createKeyword(data: InsertKeyword) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(keywords).values(data);
  return result[0].insertId;
}

export async function updateKeyword(id: number, userId: number, data: Partial<InsertKeyword>) {
  const db = await getDb();
  if (!db) return;
  await db.update(keywords).set({ ...data, updatedAt: new Date() }).where(and(eq(keywords.id, id), eq(keywords.userId, userId)));
}

export async function deleteKeyword(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(keywords).set({ isActive: false }).where(and(eq(keywords.id, id), eq(keywords.userId, userId)));
}

export async function countKeywordsByUserId(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ count: sql<number>`count(*)` }).from(keywords).where(and(eq(keywords.userId, userId), eq(keywords.isActive, true)));
  return result[0]?.count ?? 0;
}

// ============================================================
// 监控群组相关
// ============================================================
export async function getMonitorGroupsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(monitorGroups).where(and(eq(monitorGroups.userId, userId), eq(monitorGroups.isActive, true))).orderBy(desc(monitorGroups.createdAt));
}

export async function getMonitorGroupById(id: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(monitorGroups).where(and(eq(monitorGroups.id, id), eq(monitorGroups.userId, userId))).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createMonitorGroup(data: InsertMonitorGroup) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(monitorGroups).values(data);
  return result[0].insertId;
}

export async function updateMonitorGroup(id: number, userId: number, data: Partial<InsertMonitorGroup>) {
  const db = await getDb();
  if (!db) return;
  await db.update(monitorGroups).set({ ...data, updatedAt: new Date() }).where(and(eq(monitorGroups.id, id), eq(monitorGroups.userId, userId)));
}

export async function deleteMonitorGroup(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(monitorGroups).set({ isActive: false }).where(and(eq(monitorGroups.id, id), eq(monitorGroups.userId, userId)));
}

export async function countMonitorGroupsByUserId(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ count: sql<number>`count(*)` }).from(monitorGroups).where(and(eq(monitorGroups.userId, userId), eq(monitorGroups.isActive, true)));
  return result[0]?.count ?? 0;
}

// ============================================================
// 消息模板相关
// ============================================================
export async function getTemplatesByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(messageTemplates).where(and(eq(messageTemplates.userId, userId), eq(messageTemplates.isActive, true))).orderBy(desc(messageTemplates.createdAt));
}

export async function getTemplateById(id: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(messageTemplates).where(and(eq(messageTemplates.id, id), eq(messageTemplates.userId, userId))).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createTemplate(data: InsertMessageTemplate) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(messageTemplates).values(data);
  return result[0].insertId;
}

export async function updateTemplate(id: number, userId: number, data: Partial<InsertMessageTemplate>) {
  const db = await getDb();
  if (!db) return;
  await db.update(messageTemplates).set({ ...data, updatedAt: new Date() }).where(and(eq(messageTemplates.id, id), eq(messageTemplates.userId, userId)));
}

export async function deleteTemplate(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(messageTemplates).set({ isActive: false }).where(and(eq(messageTemplates.id, id), eq(messageTemplates.userId, userId)));
}

// 按权重随机选取模板
export async function getRandomTemplate(userId: number): Promise<typeof messageTemplates.$inferSelect | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const templates = await db.select().from(messageTemplates).where(and(eq(messageTemplates.userId, userId), eq(messageTemplates.isActive, true)));
  if (templates.length === 0) return undefined;
  const totalWeight = templates.reduce((sum, t) => sum + t.weight, 0);
  let random = Math.random() * totalWeight;
  for (const t of templates) {
    random -= t.weight;
    if (random <= 0) return t;
  }
  return templates[0];
}

// ============================================================
// 命中记录相关
// ============================================================
export async function createHitRecord(data: InsertHitRecord) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(hitRecords).values(data);
  return result[0].insertId;
}

export async function getHitRecords(userId: number, options: {
  limit?: number;
  offset?: number;
  keywordId?: number;
  monitorGroupId?: number;
  dmStatus?: string;
  startDate?: Date;
  endDate?: Date;
  search?: string;
} = {}) {
  const db = await getDb();
  if (!db) return [];
  const { limit = 20, offset = 0, keywordId, monitorGroupId, dmStatus, startDate, endDate, search } = options;
  const conditions = [eq(hitRecords.userId, userId)];
  if (keywordId) conditions.push(eq(hitRecords.keywordId, keywordId));
  if (monitorGroupId) conditions.push(eq(hitRecords.monitorGroupId, monitorGroupId));
  if (dmStatus) conditions.push(eq(hitRecords.dmStatus, dmStatus as any));
  if (startDate) conditions.push(gte(hitRecords.createdAt, startDate));
  if (endDate) conditions.push(lt(hitRecords.createdAt, endDate));
  if (search) conditions.push(or(like(hitRecords.senderUsername, `%${search}%`), like(hitRecords.messageContent, `%${search}%`))!);
  return db.select().from(hitRecords).where(and(...conditions)).orderBy(desc(hitRecords.createdAt)).limit(limit).offset(offset);
}

export async function countHitRecords(userId: number, options: { startDate?: Date; endDate?: Date } = {}): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const conditions = [eq(hitRecords.userId, userId)];
  if (options.startDate) conditions.push(gte(hitRecords.createdAt, options.startDate));
  if (options.endDate) conditions.push(lt(hitRecords.createdAt, options.endDate));
  const result = await db.select({ count: sql<number>`count(*)` }).from(hitRecords).where(and(...conditions));
  return result[0]?.count ?? 0;
}

export async function updateHitRecordDmStatus(id: number, userId: number, dmStatus: string, extra?: { dmSentAt?: Date; dmContent?: string; dmError?: string }) {
  const db = await getDb();
  if (!db) return;
  await db.update(hitRecords).set({ dmStatus: dmStatus as any, ...extra }).where(and(eq(hitRecords.id, id), eq(hitRecords.userId, userId)));
}

export async function markHitRecordProcessed(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(hitRecords).set({ isProcessed: true, processedAt: new Date() }).where(and(eq(hitRecords.id, id), eq(hitRecords.userId, userId)));
}

// 检查某用户是否已在时间窗口内被发过私信（去重）
export async function checkDuplicateDm(userId: number, targetTgId: string, windowHours: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const since = new Date(Date.now() - windowHours * 3600 * 1000);
  const result = await db.select({ count: sql<number>`count(*)` }).from(hitRecords)
    .where(and(
      eq(hitRecords.userId, userId),
      eq(hitRecords.senderTgId, targetTgId),
      inArray(hitRecords.dmStatus, ["sent", "queued"]),
      gte(hitRecords.createdAt, since)
    ));
  return (result[0]?.count ?? 0) > 0;
}

// ============================================================
// 私信队列相关
// ============================================================
export async function addToDmQueue(data: typeof dmQueue.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(dmQueue).values(data);
  return result[0].insertId;
}

export async function getDmQueue(userId: number, options: { limit?: number; offset?: number; status?: string } = {}) {
  const db = await getDb();
  if (!db) return [];
  const { limit = 20, offset = 0, status } = options;
  const conditions = [eq(dmQueue.userId, userId)];
  if (status) conditions.push(eq(dmQueue.status, status as any));
  return db.select().from(dmQueue).where(and(...conditions)).orderBy(desc(dmQueue.createdAt)).limit(limit).offset(offset);
}

export async function getDmQueueStats(userId: number) {
  const db = await getDb();
  if (!db) return { pending: 0, sent: 0, failed: 0, total: 0 };
  const result = await db.select({
    status: dmQueue.status,
    count: sql<number>`count(*)`,
  }).from(dmQueue).where(eq(dmQueue.userId, userId)).groupBy(dmQueue.status);
  const stats = { pending: 0, sent: 0, failed: 0, total: 0 };
  result.forEach((r) => {
    stats.total += r.count;
    if (r.status === "pending" || r.status === "processing") stats.pending += r.count;
    else if (r.status === "sent") stats.sent += r.count;
    else if (r.status === "failed") stats.failed += r.count;
  });
  return stats;
}

export async function updateDmQueueItem(id: number, userId: number, data: Partial<typeof dmQueue.$inferInsert>) {
  const db = await getDb();
  if (!db) return;
  await db.update(dmQueue).set({ ...data, updatedAt: new Date() }).where(and(eq(dmQueue.id, id), eq(dmQueue.userId, userId)));
}

// ============================================================
// 防封策略相关
// ============================================================
export async function getAntibanSettings(userId: number): Promise<AntibanSettings | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(antibanSettings).where(eq(antibanSettings.userId, userId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function upsertAntibanSettings(userId: number, data: Partial<InsertAntibanSettings>) {
  const db = await getDb();
  if (!db) return;
  const existing = await getAntibanSettings(userId);
  if (existing) {
    await db.update(antibanSettings).set({ ...data, updatedAt: new Date() }).where(eq(antibanSettings.userId, userId));
  } else {
    await db.insert(antibanSettings).values({ userId, ...data });
  }
}

// ============================================================
// 黑名单相关
// ============================================================
export async function getBlacklist(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(blacklist).where(eq(blacklist.userId, userId)).orderBy(desc(blacklist.createdAt));
}

export async function addToBlacklist(userId: number, targetTgId: string, targetUsername?: string, reason?: string) {
  const db = await getDb();
  if (!db) return;
  await db.insert(blacklist).values({ userId, targetTgId, targetUsername: targetUsername ?? null, reason: reason ?? null });
}

export async function removeFromBlacklist(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(blacklist).where(and(eq(blacklist.id, id), eq(blacklist.userId, userId)));
}

export async function isBlacklisted(userId: number, targetTgId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const result = await db.select({ count: sql<number>`count(*)` }).from(blacklist).where(and(eq(blacklist.userId, userId), eq(blacklist.targetTgId, targetTgId)));
  return (result[0]?.count ?? 0) > 0;
}

// ============================================================
// 仪表盘统计
// ============================================================
export async function getDashboardStats(userId: number) {
  const db = await getDb();
  if (!db) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  // 今日命中数
  const todayHits = await db.select({ count: sql<number>`count(*)` }).from(hitRecords)
    .where(and(eq(hitRecords.userId, userId), gte(hitRecords.createdAt, today)));

  // 今日发信数
  const todayDmSent = await db.select({ count: sql<number>`count(*)` }).from(hitRecords)
    .where(and(eq(hitRecords.userId, userId), eq(hitRecords.dmStatus, "sent"), gte(hitRecords.createdAt, today)));

  // 总命中数
  const totalHits = await db.select({ count: sql<number>`count(*)` }).from(hitRecords)
    .where(eq(hitRecords.userId, userId));

  // 活跃监控群组数
  const activeGroups = await db.select({ count: sql<number>`count(*)` }).from(monitorGroups)
    .where(and(eq(monitorGroups.userId, userId), eq(monitorGroups.isActive, true), eq(monitorGroups.monitorStatus, "active")));

  // 活跃账号数
  const activeAccounts = await db.select({ count: sql<number>`count(*)` }).from(tgAccounts)
    .where(and(eq(tgAccounts.userId, userId), eq(tgAccounts.isActive, true), eq(tgAccounts.sessionStatus, "active")));

  // 待发队列数
  const pendingQueue = await db.select({ count: sql<number>`count(*)` }).from(dmQueue)
    .where(and(eq(dmQueue.userId, userId), eq(dmQueue.status, "pending")));

  // 最近7天每日命中趋势
  const weeklyHits = await db.select({
    date: sql<string>`DATE(MIN(${hitRecords.createdAt}))`,
    count: sql<number>`count(*)`,
  }).from(hitRecords)
    .where(and(eq(hitRecords.userId, userId), gte(hitRecords.createdAt, weekAgo)))
    .groupBy(sql`DATE(${hitRecords.createdAt})`)
    .orderBy(sql`DATE(${hitRecords.createdAt})`);

  // 热门关键词 Top 5
  const topKeywords = await db.select({
    keywordId: hitRecords.keywordId,
    matchedKeyword: hitRecords.matchedKeyword,
    count: sql<number>`count(*)`,
  }).from(hitRecords)
    .where(and(eq(hitRecords.userId, userId), gte(hitRecords.createdAt, weekAgo)))
    .groupBy(hitRecords.keywordId, hitRecords.matchedKeyword)
    .orderBy(desc(sql`count(*)`))
    .limit(5);

  // 最近命中记录
  const recentHits = await db.select().from(hitRecords)
    .where(eq(hitRecords.userId, userId))
    .orderBy(desc(hitRecords.createdAt))
    .limit(10);

  // 发信成功率
  const dmTotal = await db.select({ count: sql<number>`count(*)` }).from(hitRecords)
    .where(and(eq(hitRecords.userId, userId), inArray(hitRecords.dmStatus, ["sent", "failed"])));
  const dmSuccess = await db.select({ count: sql<number>`count(*)` }).from(hitRecords)
    .where(and(eq(hitRecords.userId, userId), eq(hitRecords.dmStatus, "sent")));

  const dmSuccessRate = dmTotal[0]?.count > 0
    ? Math.round((dmSuccess[0]?.count / dmTotal[0]?.count) * 100)
    : 0;

  return {
    todayHits: todayHits[0]?.count ?? 0,
    todayDmSent: todayDmSent[0]?.count ?? 0,
    totalHits: totalHits[0]?.count ?? 0,
    activeGroups: activeGroups[0]?.count ?? 0,
    activeAccounts: activeAccounts[0]?.count ?? 0,
    pendingQueue: pendingQueue[0]?.count ?? 0,
    dmSuccessRate,
    weeklyHits,
    topKeywords,
    recentHits,
  };
}
