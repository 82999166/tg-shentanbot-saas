import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  hitRecords,
  blacklist,
  senderHistory,
  pushSettings,
  keywordDailyStats,
  groupSubmissions,
  keywords,
} from "../../drizzle/schema";
import { eq, and, desc, gte, sql, inArray } from "drizzle-orm";

export const hitMessagesRouter = router({
  // ─── 命中消息列表 ───────────────────────────────────────────
  list: protectedProcedure
    .input(
      z.object({
        page: z.number().default(1),
        pageSize: z.number().default(20),
        isProcessed: z.boolean().optional(),
        keywordId: z.number().optional(),
        monitorGroupId: z.number().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const offset = (input.page - 1) * input.pageSize;

      const conditions = [eq(hitRecords.userId, ctx.user.id)];
      if (input.isProcessed !== undefined) {
        conditions.push(eq(hitRecords.isProcessed, input.isProcessed));
      }
      if (input.keywordId) {
        conditions.push(eq(hitRecords.keywordId, input.keywordId));
      }
      if (input.monitorGroupId) {
        conditions.push(eq(hitRecords.monitorGroupId, input.monitorGroupId));
      }

      const rows = await db
        .select()
        .from(hitRecords)
        .where(and(...conditions))
        .orderBy(desc(hitRecords.createdAt))
        .limit(input.pageSize)
        .offset(offset);

      const [{ total }] = await db
        .select({ total: sql<number>`count(*)` })
        .from(hitRecords)
        .where(and(...conditions));

      return { rows, total };
    }),

  // ─── 标记/取消标记已处理 ─────────────────────────────────────
  markHandled: protectedProcedure
    .input(z.object({ id: z.number(), isProcessed: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      await db
        .update(hitRecords)
        .set({
          isProcessed: input.isProcessed,
          processedAt: input.isProcessed ? new Date() : null,
        })
        .where(and(eq(hitRecords.id, input.id), eq(hitRecords.userId, ctx.user.id)));
      return { success: true };
    }),

  // ─── 批量标记已处理 ──────────────────────────────────────────
  batchMarkHandled: protectedProcedure
    .input(z.object({ ids: z.array(z.number()), isProcessed: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      await db
        .update(hitRecords)
        .set({
          isProcessed: input.isProcessed,
          processedAt: input.isProcessed ? new Date() : null,
        })
        .where(
          and(
            inArray(hitRecords.id, input.ids),
            eq(hitRecords.userId, ctx.user.id)
          )
        );
      return { success: true };
    }),

  // ─── 屏蔽发送者 ─────────────────────────────────────────────
  blockSender: protectedProcedure
    .input(
      z.object({
        senderTgId: z.string(),
        senderUsername: z.string().optional(),
        reason: z.string().optional(),
        deleteHistory: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");

      // 检查是否已屏蔽
      const existing = await db
        .select()
        .from(blacklist)
        .where(
          and(
            eq(blacklist.userId, ctx.user.id),
            eq(blacklist.targetTgId, input.senderTgId)
          )
        )
        .limit(1);

      if (existing.length === 0) {
        await db.insert(blacklist).values({
          userId: ctx.user.id,
          targetTgId: input.senderTgId,
          targetUsername: input.senderUsername,
          reason: input.reason,
        });
      }

      // 如果需要删除历史推送记录
      if (input.deleteHistory) {
        await db
          .delete(hitRecords)
          .where(
            and(
              eq(hitRecords.userId, ctx.user.id),
              eq(hitRecords.senderTgId, input.senderTgId)
            )
          );
        await db
          .delete(senderHistory)
          .where(
            and(
              eq(senderHistory.userId, ctx.user.id),
              eq(senderHistory.senderTgId, input.senderTgId)
            )
          );
      }

      return { success: true };
    }),

  // ─── 取消屏蔽 ───────────────────────────────────────────────
  unblockSender: protectedProcedure
    .input(z.object({ targetTgId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      await db
        .delete(blacklist)
        .where(
          and(
            eq(blacklist.userId, ctx.user.id),
            eq(blacklist.targetTgId, input.targetTgId)
          )
        );
      return { success: true };
    }),

  // ─── 屏蔽列表 ───────────────────────────────────────────────
  blockedList: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("DB not available");
    return db
      .select()
      .from(blacklist)
      .where(eq(blacklist.userId, ctx.user.id))
      .orderBy(desc(blacklist.createdAt));
  }),

  // ─── 发送者历史记录（近7天） ─────────────────────────────────
  senderHistory: protectedProcedure
    .input(z.object({ senderTgId: z.string() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      return db
        .select()
        .from(senderHistory)
        .where(
          and(
            eq(senderHistory.userId, ctx.user.id),
            eq(senderHistory.senderTgId, input.senderTgId),
            gte(senderHistory.messageDate, sevenDaysAgo)
          )
        )
        .orderBy(desc(senderHistory.messageDate))
        .limit(50);
    }),

  // ─── 关键词统计（近7日每天命中数） ──────────────────────────
  keywordStats: protectedProcedure
    .input(z.object({ keywordId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");

      // 近7天日期列表
      const dates: string[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
        dates.push(d.toISOString().split("T")[0]);
      }

      const conditions = [eq(keywordDailyStats.userId, ctx.user.id)];
      if (input.keywordId) {
        conditions.push(eq(keywordDailyStats.keywordId, input.keywordId));
      }

      const stats = await db
        .select()
        .from(keywordDailyStats)
        .where(and(...conditions, inArray(keywordDailyStats.date, dates)));

      // 获取关键词列表
      const kws = await db
        .select({ id: keywords.id, keyword: keywords.keyword, hitCount: keywords.hitCount })
        .from(keywords)
        .where(eq(keywords.userId, ctx.user.id));

      return { stats, dates, keywords: kws };
    }),

  // ─── 命中某关键词的用户列表 ──────────────────────────────────
  keywordSenders: protectedProcedure
    .input(z.object({ keywordId: z.number(), page: z.number().default(1) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const offset = (input.page - 1) * 20;

      const rows = await db
        .select({
          senderTgId: hitRecords.senderTgId,
          senderUsername: hitRecords.senderUsername,
          senderFirstName: hitRecords.senderFirstName,
          lastHit: sql<Date>`MAX(${hitRecords.createdAt})`,
          hitCount: sql<number>`COUNT(*)`,
        })
        .from(hitRecords)
        .where(
          and(
            eq(hitRecords.userId, ctx.user.id),
            eq(hitRecords.keywordId, input.keywordId)
          )
        )
        .groupBy(
          hitRecords.senderTgId,
          hitRecords.senderUsername,
          hitRecords.senderFirstName
        )
        .orderBy(desc(sql`MAX(${hitRecords.createdAt})`))
        .limit(20)
        .offset(offset);

      const [{ total }] = await db
        .select({ total: sql<number>`COUNT(DISTINCT ${hitRecords.senderTgId})` })
        .from(hitRecords)
        .where(
          and(
            eq(hitRecords.userId, ctx.user.id),
            eq(hitRecords.keywordId, input.keywordId)
          )
        );

      return { rows, total };
    }),

  // ─── 推送设置（获取） ────────────────────────────────────────
  getPushSettings: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("DB not available");
    const rows = await db
      .select()
      .from(pushSettings)
      .where(eq(pushSettings.userId, ctx.user.id))
      .limit(1);
    return rows[0] ?? null;
  }),

  // ─── 推送设置（保存） ────────────────────────────────────────
  savePushSettings: protectedProcedure
    .input(
      z.object({
        pushEnabled: z.boolean(),
        filterAds: z.boolean(),
        collaborationGroupId: z.string().optional(),
        collaborationGroupTitle: z.string().optional(),
        pushFormat: z.enum(["simple", "standard", "detailed"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");

      const existing = await db
        .select({ id: pushSettings.id })
        .from(pushSettings)
        .where(eq(pushSettings.userId, ctx.user.id))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(pushSettings)
          .set({ ...input })
          .where(eq(pushSettings.userId, ctx.user.id));
      } else {
        await db.insert(pushSettings).values({ userId: ctx.user.id, ...input });
      }
      return { success: true };
    }),

  // ─── 群组提交（用户提交） ────────────────────────────────────
  submitGroup: protectedProcedure
    .input(
      z.object({
        groupLink: z.string().url(),
        groupTitle: z.string().optional(),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      await db.insert(groupSubmissions).values({
        userId: ctx.user.id,
        ...input,
      });
      return { success: true };
    }),

  // ─── 群组提交列表（用户查看自己的） ─────────────────────────
  mySubmissions: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("DB not available");
    return db
      .select()
      .from(groupSubmissions)
      .where(eq(groupSubmissions.userId, ctx.user.id))
      .orderBy(desc(groupSubmissions.createdAt));
  }),

  // ─── 群组提交审核（管理员） ──────────────────────────────────
  listSubmissions: adminProcedure
    .input(z.object({ status: z.enum(["pending", "approved", "rejected"]).optional() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const conditions = input.status ? [eq(groupSubmissions.status, input.status)] : [];
      return db
        .select()
        .from(groupSubmissions)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(groupSubmissions.createdAt));
    }),

  reviewSubmission: adminProcedure
    .input(
      z.object({
        id: z.number(),
        status: z.enum(["approved", "rejected"]),
        reviewNote: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      await db
        .update(groupSubmissions)
        .set({
          status: input.status,
          reviewNote: input.reviewNote,
          reviewedAt: new Date(),
        })
        .where(eq(groupSubmissions.id, input.id));
      return { success: true };
    }),

  // ─── 仪表盘统计 ───────────────────────────────────────────────────
  dashboardStats: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("DB not available");

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [[todayHits], [weekHits], [unprocessed], [blockedCount]] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(hitRecords)
        .where(and(eq(hitRecords.userId, ctx.user.id), gte(hitRecords.createdAt, today))),
      db.select({ count: sql<number>`count(*)` }).from(hitRecords)
        .where(and(eq(hitRecords.userId, ctx.user.id), gte(hitRecords.createdAt, weekAgo))),
      db.select({ count: sql<number>`count(*)` }).from(hitRecords)
        .where(and(eq(hitRecords.userId, ctx.user.id), eq(hitRecords.isProcessed, false))),
      db.select({ count: sql<number>`count(*)` }).from(blacklist)
        .where(eq(blacklist.userId, ctx.user.id)),
    ]);

    return {
      todayHits: todayHits.count,
      weekHits: weekHits.count,
      unprocessed: unprocessed.count,
      blockedCount: blockedCount.count,
    };
  }),
});