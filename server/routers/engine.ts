/**
 * 引擎 API 桥接路由
 * 供 Pyrogram 监控引擎通过 HTTP 调用
 * 使用 ENGINE_SECRET 鉴权（非 JWT，引擎专用）
 */
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  tgAccounts,
  monitorGroups,
  keywords,
  antibanSettings,
  hitRecords,
  dmQueue,
  messageTemplates,
} from "../../drizzle/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

const ENGINE_SECRET = process.env.ENGINE_SECRET || "tg-monitor-engine-secret";

// 引擎鉴权中间件
const engineProcedure = publicProcedure.use(({ ctx, next }) => {
  const secret = (ctx.req.headers as any)["x-engine-secret"];
  if (secret !== ENGINE_SECRET) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid engine secret" });
  }
  return next({ ctx });
});

export const engineRouter = router({
  // ── 获取完整监控配置 ─────────────────────────────────────
  config: engineRouter_config(),

  // ── 上报命中记录 ─────────────────────────────────────────
  hit: engineProcedure
    .input(
      z.object({
        userId: z.number(),
        monitorAccountId: z.number(),
        tgGroupId: z.string(),
        groupName: z.string().optional(),
        senderTgId: z.string(),
        senderUsername: z.string().optional().nullable(),
        senderName: z.string().optional().nullable(),
        messageText: z.string(),
        matchedKeywords: z.array(z.string()),
        messageId: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // hitRecords schema: tgAccountId, monitorGroupId, keywordId are required
      // Engine provides simplified data; use 0 as placeholder for required FK fields
      await db.insert(hitRecords).values({
        userId: input.userId,
        tgAccountId: input.monitorAccountId,
        monitorGroupId: 0,   // placeholder - engine doesn't have DB group ID
        keywordId: 0,        // placeholder - engine doesn't have DB keyword ID
        senderTgId: input.senderTgId,
        senderUsername: input.senderUsername || null,
        senderFirstName: input.senderName || null,
        messageContent: input.messageText,
        matchedKeyword: input.matchedKeywords.join(", "),
        messageId: input.messageId || null,
        dmStatus: "pending",
        messageDate: new Date(),
      });

      return { success: true };
    }),

  // ── 获取待发私信队列 ─────────────────────────────────────
  dmQueue: engineProcedure
    .input(z.object({ limit: z.number().default(5) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { items: [] };

      const items = await db
        .select()
        .from(dmQueue)
        .where(eq(dmQueue.status, "pending"))
        .orderBy(dmQueue.createdAt)
        .limit(input.limit);

      return { items };
    }),

  // ── 私信发送成功 ─────────────────────────────────────────
  dmSuccess: engineProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db
        .update(dmQueue)
        .set({ status: "sent", sentAt: new Date() })
        .where(eq(dmQueue.id, input.id));

      // 同步更新命中记录的 DM 状态
      const queueItem = await db
        .select()
        .from(dmQueue)
        .where(eq(dmQueue.id, input.id))
        .limit(1);

      if (queueItem[0]?.hitRecordId) {
        await db
          .update(hitRecords)
          .set({ dmStatus: "sent" })
          .where(eq(hitRecords.id, queueItem[0].hitRecordId));
      }

      // 更新账号今日发信计数
      if (queueItem[0]?.senderAccountId) {
        await db
          .update(tgAccounts)
          .set({ dailyDmSent: sql`${tgAccounts.dailyDmSent} + 1` })
          .where(eq(tgAccounts.id, queueItem[0].senderAccountId));
      }

      return { success: true };
    }),

  // ── 私信发送失败 ─────────────────────────────────────────
  dmFail: engineProcedure
    .input(z.object({ id: z.number(), error: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db
        .update(dmQueue)
        .set({ status: "failed", errorMessage: input.error })
        .where(eq(dmQueue.id, input.id));

      return { success: true };
    }),

  // ── 私信跳过（冷却中） ───────────────────────────────────
  dmSkip: engineProcedure
    .input(z.object({ id: z.number(), reason: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db
        .update(dmQueue)
        .set({ status: "cancelled", errorMessage: input.reason })
        .where(eq(dmQueue.id, input.id));

      return { success: true };
    }),

  // ── 私信重试（FloodWait 后） ─────────────────────────────
  dmRetry: engineProcedure
    .input(z.object({ id: z.number(), retryAfter: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const retryAt = new Date(Date.now() + input.retryAfter * 1000);
      await db
        .update(dmQueue)
        .set({ status: "pending", scheduledAt: retryAt })
        .where(eq(dmQueue.id, input.id));

      return { success: true };
    }),

  // ── 加入私信队列 ─────────────────────────────────────────
  dmAdd: engineProcedure
    .input(
      z.object({
        userId: z.number(),
        senderAccountId: z.number(),
        targetTgId: z.string(),
        targetUsername: z.string().optional().nullable(),
        content: z.string(),
        templateId: z.number().optional().nullable(),
        hitGroupId: z.string().optional().nullable(),
        matchedKeyword: z.string().optional().nullable(),
        hitRecordId: z.number().optional().nullable(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 去重：同一用户对同一目标，24小时内只发一次
      const existing = await db
        .select()
        .from(dmQueue)
        .where(
          and(
            eq(dmQueue.userId, input.userId),
            eq(dmQueue.targetTgId, input.targetTgId),
            eq(dmQueue.status, "sent")
          )
        )
        .limit(1);

      if (existing.length > 0) {
        const lastSent = existing[0].sentAt;
        if (lastSent && Date.now() - lastSent.getTime() < 24 * 3600 * 1000) {
          return { success: false, reason: "already_sent" };
        }
      }

      await db.insert(dmQueue).values({
        userId: input.userId,
        senderAccountId: input.senderAccountId,
        targetTgId: input.targetTgId,
        targetUsername: input.targetUsername || null,
        content: input.content,
        templateId: input.templateId || null,
        hitRecordId: input.hitRecordId || null,
        status: "pending",
        scheduledAt: new Date(),
      });

      return { success: true };
    }),

  // ── 更新账号健康度 ───────────────────────────────────────
  accountHealth: engineProcedure
    .input(
      z.object({
        accountId: z.number(),
        delta: z.number(),
        status: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const updates: Record<string, any> = {
        healthScore: sql`GREATEST(0, LEAST(100, ${tgAccounts.healthScore} + ${input.delta}))`,
        lastActiveAt: new Date(),
      };
      if (input.status) {
        updates.status = input.status;
      }

      await db.update(tgAccounts).set(updates).where(eq(tgAccounts.id, input.accountId));
      return { success: true };
    }),

  // ── 更新账号状态 ─────────────────────────────────────────
  accountStatus: engineProcedure
    .input(
      z.object({
        accountId: z.number(),
        status: z.string(),
        tgUserId: z.string().optional(),
        tgUsername: z.string().optional().nullable(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const updates: Record<string, any> = {
        status: input.status,
        lastActiveAt: new Date(),
      };
      if (input.tgUserId) updates.tgUserId = input.tgUserId;
      if (input.tgUsername !== undefined) updates.tgUsername = input.tgUsername;

      await db.update(tgAccounts).set(updates).where(eq(tgAccounts.id, input.accountId));
      return { success: true };
    }),

  // ── 心跳上报 ─────────────────────────────────────────────
  heartbeat: engineProcedure
    .input(
      z.object({
        activeAccounts: z.number(),
        timestamp: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      // 可以存储到 systemSettings 表记录引擎状态
      const db = await getDb();
      if (db) {
        // 简单记录到内存，不做持久化
      }
      return { success: true, serverTime: Date.now() };
    }),
});

// ── 配置查询（独立函数，避免循环引用） ──────────────────────
function engineRouter_config() {
  return engineProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { accounts: [], userConfigs: {} };

    // 获取所有激活的监控账号
      const accounts = await db
        .select()
        .from(tgAccounts)
        .where(
          and(
            eq(tgAccounts.isActive, true),
            inArray(tgAccounts.accountRole, ["monitor", "both"])
          )
        );

    // 为每个账号的用户构建监控配置
    const userIdArr = accounts.map((a) => a.userId);
    const userIds: number[] = userIdArr.filter((v, i, arr) => arr.indexOf(v) === i);
    const userConfigs: Record<string, any> = {};

    for (const userId of userIds) {
      // 获取该用户的监控群组
      const groups = await db
        .select()
        .from(monitorGroups)
        .where(and(eq(monitorGroups.userId, userId), eq(monitorGroups.isActive, true)));

      // 为每个群组获取关键词
      const groupsWithKeywords = await Promise.all(
        groups.map(async (group) => {
          const kws = await db
            .select()
            .from(keywords)
            .where(and(eq(keywords.userId, userId), eq(keywords.isActive, true)));

          return {
            ...group,
            keywords: kws.map((k) => ({
              id: k.id,
              pattern: k.keyword,
              matchType: k.matchType,
              subKeywords: Array.isArray(k.subKeywords) ? k.subKeywords : [],
              caseSensitive: k.caseSensitive,
              isActive: k.isActive,
            })),
          };
        })
      );

      // 获取消息模板
      const templates = await db
        .select()
        .from(messageTemplates)
        .where(and(eq(messageTemplates.userId, userId), eq(messageTemplates.isActive, true)));

      // 获取防封设置
      const antiban = await db
        .select()
        .from(antibanSettings)
        .where(eq(antibanSettings.userId, userId))
        .limit(1);

      // 获取发信账号
      const senderAccounts = await db
        .select()
        .from(tgAccounts)
        .where(
          and(
            eq(tgAccounts.userId, userId),
            eq(tgAccounts.isActive, true),
            inArray(tgAccounts.accountRole, ["sender", "both"])
          )
        );

      const antibanConfig = antiban[0] || {};
      const senderAccount = senderAccounts[0];

      userConfigs[String(userId)] = {
        groups: groupsWithKeywords,
        dmTemplates: templates.map((t) => ({
          id: t.id,
          content: t.content,
          weight: t.weight,
        })),
        dmEnabled: antibanConfig.dmEnabled ?? false,
        dmSenderAccountId: senderAccount?.id || null,
        antiban: {
          minDelay: antibanConfig.minIntervalSeconds || 60,
          maxDelay: antibanConfig.maxIntervalSeconds || 180,
          dailyLimit: antibanConfig.dailyDmLimit || 30,
          cooldownHours: antibanConfig.deduplicateWindowHours || 24,
        },
      };
    }

      return {
        accounts: accounts.map((a) => ({
          id: a.id,
          userId: a.userId,
          sessionString: a.sessionString,
          isActive: a.isActive,
          role: a.accountRole,
          status: a.sessionStatus,
        })),
      userConfigs,
    };
  });
}
