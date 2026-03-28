import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  addToBlacklist,
  addToDmQueue,
  checkDuplicateDm,
  createHitRecord,
  getDashboardStats,
  getDmQueue,
  getDmQueueStats,
  getHitRecords,
  countHitRecords,
  getAntibanSettings,
  getBlacklist,
  getRandomTemplate,
  isBlacklisted,
  markHitRecordProcessed,
  removeFromBlacklist,
  updateDmQueueItem,
  updateHitRecordDmStatus,
  upsertAntibanSettings,
} from "../db";
import { protectedProcedure, router, adminProcedure } from "../_core/trpc";
import { getAllUsers, countAllUsers, getDb } from "../db";
import { users, tgAccounts, keywords, monitorGroups, hitRecords, publicMonitorGroups } from "../../drizzle/schema";
import { eq, and, desc, sql, or, like, gte, lt, inArray } from "drizzle-orm";

// ============================================================
// 命中记录路由
// ============================================================
export const hitRecordsRouter = router({
  list: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
      keywordId: z.number().optional(),
      monitorGroupId: z.number().optional(),
      dmStatus: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      search: z.string().optional(),
      filterUserId: z.number().optional(), // admin 按用户筛选
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { records: [], total: 0 };
      const isAdmin = ctx.user.role === "admin";
      const { limit, offset, keywordId, monitorGroupId, dmStatus, startDate, endDate, search, filterUserId } = input;

      // 构建查询条件
      const conditions: any[] = [];
      // admin 可查全平台，普通用户只能查自己
      if (isAdmin) {
        if (filterUserId) conditions.push(eq(hitRecords.userId, filterUserId));
      } else {
        conditions.push(eq(hitRecords.userId, ctx.user.id));
      }
      if (keywordId) conditions.push(eq(hitRecords.keywordId, keywordId));
      if (monitorGroupId) conditions.push(eq(hitRecords.monitorGroupId, monitorGroupId));
      if (dmStatus) conditions.push(eq(hitRecords.dmStatus, dmStatus as any));
      if (startDate) conditions.push(gte(hitRecords.createdAt, new Date(startDate)));
      if (endDate) conditions.push(lt(hitRecords.createdAt, new Date(endDate)));
      if (search) conditions.push(
        or(
          like(hitRecords.senderUsername, `%${search}%`),
          like(hitRecords.messageContent, `%${search}%`),
          like(hitRecords.matchedKeyword, `%${search}%`)
        )!
      );

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const records = await db
        .select()
        .from(hitRecords)
        .where(whereClause)
        .orderBy(desc(hitRecords.createdAt))
        .limit(limit)
        .offset(offset);

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(hitRecords)
        .where(whereClause);

      // 附加群组信息（所有用户都需要）
      let enrichedRecords: any[] = records;
      const groupIds = [...new Set(records.map(r => r.monitorGroupId).filter(id => id > 0))];
      let groupMap: Map<number, { groupTitle: string | null; groupId: string }> = new Map();
      if (groupIds.length > 0) {
        const groupRows = await db
          .select({ id: publicMonitorGroups.id, groupTitle: publicMonitorGroups.groupTitle, groupId: publicMonitorGroups.groupId })
          .from(publicMonitorGroups)
          .where(inArray(publicMonitorGroups.id, groupIds));
        groupMap = new Map(groupRows.map(g => [g.id, { groupTitle: g.groupTitle, groupId: g.groupId }]));
      }

      if (isAdmin) {
        // admin 时附加用户信息 + 群组信息
        const userIds = [...new Set(records.map(r => r.userId))];
        let userMap: Map<number, string> = new Map();
        if (userIds.length > 0) {
          const userRows = await db.select({ id: users.id, name: users.name, email: users.email })
            .from(users)
            .where(inArray(users.id, userIds));
          userMap = new Map(userRows.map(u => [u.id, u.name ?? u.email ?? `#${u.id}`]));
        }
        enrichedRecords = records.map(r => ({
          ...r,
          ownerName: userMap.get(r.userId) ?? `用户 #${r.userId}`,
          groupTitle: groupMap.get(r.monitorGroupId)?.groupTitle ?? null,
          groupUsername: groupMap.get(r.monitorGroupId)?.groupId ?? null,
        }));
      } else {
        // 普通用户附加群组信息
        enrichedRecords = records.map(r => ({
          ...r,
          groupTitle: groupMap.get(r.monitorGroupId)?.groupTitle ?? null,
          groupUsername: groupMap.get(r.monitorGroupId)?.groupId ?? null,
        }));
      }

      return { records: enrichedRecords, total: Number(count) };
    }),

  markProcessed: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await markHitRecordProcessed(input.id, ctx.user.id);
      return { success: true };
    }),

  // ─── 批量删除命中记录 ─────────────────────────────────────────
  batchDelete: protectedProcedure
    .input(z.object({ ids: z.array(z.number()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      await db
        .delete(hitRecords)
        .where(
          and(
            inArray(hitRecords.id, input.ids),
            eq(hitRecords.userId, ctx.user.id)
          )
        );
      return { success: true, deleted: input.ids.length };
    }),

  // 手动加入私信队列
  addToDmQueue: protectedProcedure
    .input(z.object({
      hitRecordId: z.number(),
      senderAccountId: z.number(),
      targetTgId: z.string(),
      targetUsername: z.string().optional(),
      templateId: z.number().optional(),
      content: z.string().min(1).max(4096),
    }))
    .mutation(async ({ ctx, input }) => {
      const settings = await getAntibanSettings(ctx.user.id);
      const delay = settings
        ? Math.floor(Math.random() * (settings.maxIntervalSeconds - settings.minIntervalSeconds) + settings.minIntervalSeconds)
        : 60;
      const scheduledAt = new Date(Date.now() + delay * 1000);

      await addToDmQueue({
        userId: ctx.user.id,
        hitRecordId: input.hitRecordId,
        senderAccountId: input.senderAccountId,
        targetTgId: input.targetTgId,
        targetUsername: input.targetUsername,
        templateId: input.templateId,
        content: input.content,
        scheduledAt,
      });
      await updateHitRecordDmStatus(input.hitRecordId, ctx.user.id, "queued");
      return { success: true };
    }),
});

// ============================================================
// 私信队列路由
// ============================================================
export const dmQueueRouter = router({
  list: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
      status: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      return getDmQueue(ctx.user.id, input);
    }),

  stats: protectedProcedure.query(async ({ ctx }) => {
    return getDmQueueStats(ctx.user.id);
  }),

  cancel: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await updateDmQueueItem(input.id, ctx.user.id, { status: "cancelled" });
      return { success: true };
    }),

  retry: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await updateDmQueueItem(input.id, ctx.user.id, {
        status: "pending",
        retryCount: 0,
        scheduledAt: new Date(Date.now() + 30 * 1000),
      });
      return { success: true };
    }),

  // ─── 批量删除私信队列 ─────────────────────────────────────────
  batchDelete: protectedProcedure
    .input(z.object({ ids: z.array(z.number()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const { dmQueue } = await import("../../drizzle/schema");
      await db
        .delete(dmQueue)
        .where(
          and(
            inArray(dmQueue.id, input.ids),
            eq(dmQueue.userId, ctx.user.id)
          )
        );
      return { success: true, deleted: input.ids.length };
    }),

  // ─── 清空所有（按状态）─────────────────────────────────────────
  clearAll: protectedProcedure
    .input(z.object({ status: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const { dmQueue } = await import("../../drizzle/schema");
      const conditions = [eq(dmQueue.userId, ctx.user.id)];
      if (input.status) {
        const { eq: eqDrizzle } = await import("drizzle-orm");
        conditions.push(eqDrizzle(dmQueue.status, input.status as any));
      }
      await db.delete(dmQueue).where(and(...conditions));
      return { success: true };
    }),
});

// ============================================================
// 防封策略路由
// ============================================================
export const antibanRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const settings = await getAntibanSettings(ctx.user.id);
    // 返回默认值
    return settings ?? {
      userId: ctx.user.id,
      dailyDmLimit: 30,
      minIntervalSeconds: 60,
      maxIntervalSeconds: 180,
      activeHourStart: 9,
      activeHourEnd: 22,
      deduplicateEnabled: true,
      deduplicateWindowHours: 24,
      warningThreshold: 70,
      degradedThreshold: 40,
      suspendThreshold: 20,
      autoDegrade: true,
      templateRotation: true,
      dmEnabled: false,
    };
  }),

  update: protectedProcedure
    .input(z.object({
      dailyDmLimit: z.number().min(1).max(500).optional(),
      minIntervalSeconds: z.number().min(10).max(3600).optional(),
      maxIntervalSeconds: z.number().min(10).max(3600).optional(),
      activeHourStart: z.number().min(0).max(23).optional(),
      activeHourEnd: z.number().min(0).max(23).optional(),
      deduplicateEnabled: z.boolean().optional(),
      deduplicateWindowHours: z.number().min(1).max(168).optional(),
      warningThreshold: z.number().min(0).max(100).optional(),
      degradedThreshold: z.number().min(0).max(100).optional(),
      suspendThreshold: z.number().min(0).max(100).optional(),
      autoDegrade: z.boolean().optional(),
      templateRotation: z.boolean().optional(),
      dmEnabled: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await upsertAntibanSettings(ctx.user.id, input);
      return { success: true };
    }),
});

// ============================================================
// 黑名单路由
// ============================================================
export const blacklistRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return getBlacklist(ctx.user.id);
  }),

  add: protectedProcedure
    .input(z.object({
      targetTgId: z.string().min(1),
      targetUsername: z.string().optional(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await addToBlacklist(ctx.user.id, input.targetTgId, input.targetUsername, input.reason);
      return { success: true };
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await removeFromBlacklist(input.id, ctx.user.id);
      return { success: true };
    }),
});

// ============================================================
// 仪表盘路由
// ============================================================
export const dashboardRouter = router({
  stats: protectedProcedure.query(async ({ ctx }) => {
    return getDashboardStats(ctx.user.id);
  }),
});

// ============================================================
// 管理后台路由
// ============================================================
export const adminRouter = router({
  users: adminProcedure
    .input(z.object({
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(20),
      search: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { users: [], total: 0 };
      const { page, pageSize, search } = input;
      const offset = (page - 1) * pageSize;
      const userList = await getAllUsers(pageSize, offset, search);
      const total = await countAllUsers(search);
      if (!userList.length) return { users: [], total };

      // 批量聚合每个用户的关键词数和命中数
      const userIds = userList.map((u) => u.id);

      const kwCounts = await db
        .select({ userId: keywords.userId, cnt: sql<number>`count(*)` })
        .from(keywords)
        .where(sql`${keywords.userId} IN (${sql.join(userIds.map((id) => sql`${id}`), sql`, `)})`)
        .groupBy(keywords.userId);

      const hitCounts = await db
        .select({ userId: hitRecords.userId, cnt: sql<number>`count(*)` })
        .from(hitRecords)
        .where(sql`${hitRecords.userId} IN (${sql.join(userIds.map((id) => sql`${id}`), sql`, `)})`)
        .groupBy(hitRecords.userId);

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayHitCounts = await db
        .select({ userId: hitRecords.userId, cnt: sql<number>`count(*)` })
        .from(hitRecords)
        .where(sql`${hitRecords.userId} IN (${sql.join(userIds.map((id) => sql`${id}`), sql`, `)}) AND ${hitRecords.createdAt} >= ${todayStart}`)
        .groupBy(hitRecords.userId);

      const kwMap = new Map(kwCounts.map((r) => [r.userId, Number(r.cnt)]));
      const hitMap = new Map(hitCounts.map((r) => [r.userId, Number(r.cnt)]));
      const todayHitMap = new Map(todayHitCounts.map((r) => [r.userId, Number(r.cnt)]));

      return {
        users: userList.map((u) => ({
          ...u,
          keywordCount: kwMap.get(u.id) ?? 0,
          totalHits: hitMap.get(u.id) ?? 0,
          todayHits: todayHitMap.get(u.id) ?? 0,
        })),
        total,
      };
    }),

  updateUserPlan: adminProcedure
    .input(z.object({
      userId: z.number(),
      planId: z.enum(["free", "basic", "pro", "enterprise"]),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      await db.update(users).set({ planId: input.planId }).where(eq(users.id, input.userId));
      return { success: true };
    }),

  stats: adminProcedure.query(async () => {
    const allUsers = await getAllUsers(1000, 0);
    const planCounts = allUsers.reduce((acc, u) => {
      acc[u.planId] = (acc[u.planId] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    return {
      totalUsers: allUsers.length,
      planCounts,
      recentUsers: allUsers.slice(0, 10),
    };
  }),

  allTgAccounts: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const allUsers = await getAllUsers(1000, 0);
    const userMap = new Map(allUsers.map((u) => [u.id, u.name ?? u.email ?? `#${u.id}`]));
    const accounts = await db.select().from(tgAccounts);
    return accounts.map((a) => ({
      ...a,
      userName: userMap.get(a.userId) ?? `用户 #${a.userId}`,
    }));
  }),

  // ── 用户详情 ─────────────────────────────────────────────
  userDetail: adminProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const user = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
      if (!user[0]) throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });
      const userKws = await db.select().from(keywords)
        .where(eq(keywords.userId, input.userId))
        .orderBy(desc(keywords.createdAt));
      const userGroups = await db.select().from(monitorGroups)
        .where(eq(monitorGroups.userId, input.userId))
        .orderBy(desc(monitorGroups.createdAt));
      const userAccounts = await db.select().from(tgAccounts)
        .where(eq(tgAccounts.userId, input.userId));
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const [totalHitsRow] = await db.select({ count: sql<number>`count(*)` })
        .from(hitRecords).where(eq(hitRecords.userId, input.userId));
      const [todayHitsRow] = await db.select({ count: sql<number>`count(*)` })
        .from(hitRecords).where(and(
          eq(hitRecords.userId, input.userId),
          sql`${hitRecords.createdAt} >= ${todayStart}`
        ));
      return {
        user: user[0],
        keywords: userKws,
        monitorGroups: userGroups,
        tgAccounts: userAccounts,
        stats: {
          totalHits: Number(totalHitsRow?.count ?? 0),
          todayHits: Number(todayHitsRow?.count ?? 0),
          keywordCount: userKws.length,
          activeKeywordCount: userKws.filter(k => k.isActive).length,
          groupCount: userGroups.length,
          activeGroupCount: userGroups.filter(g => g.isActive).length,
        },
      };
    }),

  // ── 修改套餐 + 到期日 ──────────────────────────────────────
  updateUserPlanExpiry: adminProcedure
    .input(z.object({
      userId: z.number(),
      planId: z.enum(["free", "basic", "pro", "enterprise"]),
      planExpiresAt: z.string().nullable(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(users).set({
        planId: input.planId,
        planExpiresAt: input.planExpiresAt ? new Date(input.planExpiresAt) : null,
      }).where(eq(users.id, input.userId));
      return { success: true };
    }),

  // ── 管理员添加关键词 ──────────────────────────────────────
  addKeyword: adminProcedure
    .input(z.object({
      userId: z.number(),
      keyword: z.string().min(1),
      matchType: z.enum(["exact", "contains", "regex", "and", "or", "not"]).default("contains"),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const existing = await db.select().from(keywords)
        .where(and(eq(keywords.userId, input.userId), eq(keywords.keyword, input.keyword)))
        .limit(1);
      if (existing[0]) throw new TRPCError({ code: "CONFLICT", message: "关键词已存在" });
      await db.insert(keywords).values({
        userId: input.userId,
        keyword: input.keyword,
        matchType: input.matchType,
        isActive: true,
      });
      return { success: true };
    }),

  // ── 管理员删除关键词 ──────────────────────────────────────
  deleteKeyword: adminProcedure
    .input(z.object({ keywordId: z.number(), userId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(keywords)
        .where(and(eq(keywords.id, input.keywordId), eq(keywords.userId, input.userId)));
      return { success: true };
    }),

  // ── 管理员切换关键词状态 ──────────────────────────────────
  toggleKeyword: adminProcedure
    .input(z.object({ keywordId: z.number(), userId: z.number(), isActive: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(keywords).set({ isActive: input.isActive })
        .where(and(eq(keywords.id, input.keywordId), eq(keywords.userId, input.userId)));
      return { success: true };
    }),

  // ── 全平台汇总统计（管理员仪表盘用）──────────────────────
  platformStats: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return {
      todayHits: 0, totalHits: 0, todayDmSent: 0,
      activeGroups: 0, activeAccounts: 0, pendingQueue: 0,
      totalUsers: 0, dmSuccessRate: 0, weeklyHits: [], topKeywords: [], recentHits: [],
    };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const [todayHitsRow] = await db.select({ count: sql`count(*)` }).from(hitRecords)
      .where(sql`${hitRecords.createdAt} >= ${today}`);
    const [totalHitsRow] = await db.select({ count: sql`count(*)` }).from(hitRecords);
    const [todayDmRow] = await db.select({ count: sql`count(*)` }).from(hitRecords)
      .where(and(eq(hitRecords.dmStatus, "sent"), sql`${hitRecords.createdAt} >= ${today}`));
    const [activeGroupsRow] = await db.select({ count: sql`count(*)` }).from(monitorGroups)
      .where(and(eq(monitorGroups.isActive, true), eq(monitorGroups.monitorStatus, "active")));
    const [activeAccountsRow] = await db.select({ count: sql`count(*)` }).from(tgAccounts)
      .where(and(eq(tgAccounts.isActive, true), eq(tgAccounts.sessionStatus, "active")));
    const [pendingQueueRow] = await db.select({ count: sql`count(*)` }).from(hitRecords)
      .where(eq(hitRecords.dmStatus, "pending"));
    const [totalUsersRow] = await db.select({ count: sql`count(*)` }).from(users);
    const [dmTotalRow] = await db.select({ count: sql`count(*)` }).from(hitRecords)
      .where(sql`${hitRecords.dmStatus} IN ("sent","failed")`);
    const [dmSentRow] = await db.select({ count: sql`count(*)` }).from(hitRecords)
      .where(eq(hitRecords.dmStatus, "sent"));
    const dmSuccessRate = Number(dmTotalRow?.count ?? 0) > 0
      ? Math.round((Number(dmSentRow?.count ?? 0) / Number(dmTotalRow.count)) * 100) : 0;
    const weeklyHits = await db.select({
      date: sql`DATE(MIN(${hitRecords.createdAt}))`,
      count: sql`count(*)`,
    }).from(hitRecords)
      .where(sql`${hitRecords.createdAt} >= ${weekAgo}`)
      .groupBy(sql`DATE(${hitRecords.createdAt})`)
      .orderBy(sql`DATE(${hitRecords.createdAt})`);
    const topKeywords = await db.select({
      keywordId: hitRecords.keywordId,
      matchedKeyword: hitRecords.matchedKeyword,
      count: sql`count(*)`,
    }).from(hitRecords)
      .where(sql`${hitRecords.createdAt} >= ${weekAgo}`)
      .groupBy(hitRecords.keywordId, hitRecords.matchedKeyword)
      .orderBy(desc(sql`count(*)`))
      .limit(5);
    const recentHits = await db.select().from(hitRecords)
      .orderBy(desc(hitRecords.createdAt))
      .limit(10);
    return {
      todayHits: Number(todayHitsRow?.count ?? 0),
      totalHits: Number(totalHitsRow?.count ?? 0),
      todayDmSent: Number(todayDmRow?.count ?? 0),
      activeGroups: Number(activeGroupsRow?.count ?? 0),
      activeAccounts: Number(activeAccountsRow?.count ?? 0),
      pendingQueue: Number(pendingQueueRow?.count ?? 0),
      totalUsers: Number(totalUsersRow?.count ?? 0),
      dmSuccessRate,
      weeklyHits,
      topKeywords,
      recentHits,
    };
  }),
});
