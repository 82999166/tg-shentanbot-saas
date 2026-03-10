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
import { getAllUsers, getDb } from "../db";
import { users, tgAccounts } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

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
    }))
    .query(async ({ ctx, input }) => {
      const { limit, offset, keywordId, monitorGroupId, dmStatus, startDate, endDate, search } = input;
      const records = await getHitRecords(ctx.user.id, {
        limit,
        offset,
        keywordId,
        monitorGroupId,
        dmStatus,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        search,
      });
      const total = await countHitRecords(ctx.user.id, {
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
      });
      return { records, total };
    }),

  markProcessed: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await markHitRecordProcessed(input.id, ctx.user.id);
      return { success: true };
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
      limit: z.number().default(50),
      offset: z.number().default(0),
    }))
    .query(async ({ input }) => {
      return getAllUsers(input.limit, input.offset);
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
});
