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
  users,
  redeemCodes,
  plans,
  pushSettings,
  systemConfig,
  publicMonitorGroups,
} from "../../drizzle/schema";
import { eq, and, inArray, sql, desc, gte } from "drizzle-orm";
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

      await db.insert(hitRecords).values({
        userId: input.userId,
        tgAccountId: input.monitorAccountId,
        monitorGroupId: 0,
        keywordId: 0,
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
      const db = await getDb();
      if (db) {
        // 简单记录到内存，不做持久化
      }
      return { success: true, serverTime: Date.now() };
    }),

  // ── Bot API：通过 TG 用户 ID 查找用户 ──────────────────────
  botGetUserByTgId: engineProcedure
    .input(z.object({ tgUserId: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const directUser = await db.select().from(users)
        .where(eq(users.tgUserId, input.tgUserId))
        .limit(1);
      if (directUser[0]) {
        const u = directUser[0];
        return { id: u.id, name: u.name, email: u.email, planId: u.planId, planExpiresAt: u.planExpiresAt, tgUsername: u.tgUsername, tgFirstName: u.tgFirstName };
      }
      const account = await db
        .select({ userId: tgAccounts.userId })
        .from(tgAccounts)
        .where(eq(tgAccounts.tgUserId, input.tgUserId))
        .limit(1);
      if (!account[0]) return null;
      const userId = account[0].userId;
      const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      return user[0] ? { id: user[0].id, name: user[0].name, email: user[0].email, planId: user[0].planId, planExpiresAt: user[0].planExpiresAt, tgUsername: user[0].tgUsername, tgFirstName: user[0].tgFirstName } : null;
    }),

  // ── Bot API：自动注册（/start 时调用） ───────────────────────
  botAutoRegister: engineProcedure
    .input(z.object({
      tgUserId: z.string(),
      tgUsername: z.string().optional().nullable(),
      tgFirstName: z.string().optional().nullable(),
      tgLastName: z.string().optional().nullable(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const existing = await db.select().from(users)
        .where(eq(users.tgUserId, input.tgUserId))
        .limit(1);
      if (existing[0]) {
        await db.update(users).set({
          tgUsername: input.tgUsername || existing[0].tgUsername,
          tgFirstName: input.tgFirstName || existing[0].tgFirstName,
        }).where(eq(users.id, existing[0].id));
        const u = existing[0];
        return { isNew: false, id: u.id, name: u.name || input.tgFirstName || 'User', planId: u.planId, planExpiresAt: u.planExpiresAt };
      }
      const displayName = [input.tgFirstName, input.tgLastName].filter(Boolean).join(' ') || `tg_${input.tgUserId}`;
      const result = await db.insert(users).values({
        tgUserId: input.tgUserId,
        tgUsername: input.tgUsername || null,
        tgFirstName: input.tgFirstName || null,
        name: displayName,
        loginMethod: 'telegram',
        emailVerified: false,
        planId: 'free',
        dailyDmSent: 0,
      });
      const newId = (result as any).insertId || (result as any)[0]?.insertId;
      return { isNew: true, id: newId, name: displayName, planId: 'free', planExpiresAt: null };
    }),

  // ── Bot API：设置消息模板 ──────────────────────────────────
  botSetTemplate: engineProcedure
    .input(z.object({ userId: z.number(), content: z.string(), name: z.string().default('默认模板') }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const existing = await db.select().from(messageTemplates)
        .where(and(eq(messageTemplates.userId, input.userId), eq(messageTemplates.isActive, true)))
        .limit(1);
      if (existing[0]) {
        await db.update(messageTemplates).set({ content: input.content, name: input.name })
          .where(eq(messageTemplates.id, existing[0].id));
        return { success: true, id: existing[0].id, isNew: false };
      }
      const result = await db.insert(messageTemplates).values({
        userId: input.userId,
        name: input.name,
        content: input.content,
        weight: 1,
        usedCount: 0,
        isActive: true,
      });
      const newId = (result as any).insertId || (result as any)[0]?.insertId;
      return { success: true, id: newId, isNew: true };
    }),

  // ── Bot API：获取消息模板 ──────────────────────────────────
  botGetTemplates: engineProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(messageTemplates)
        .where(and(eq(messageTemplates.userId, input.userId), eq(messageTemplates.isActive, true)))
        .orderBy(desc(messageTemplates.createdAt))
        .limit(10);
    }),

  // ── Bot API：开关自动私信 ──────────────────────────────────
  botSetDmEnabled: engineProcedure
    .input(z.object({ userId: z.number(), enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const existing = await db.select().from(antibanSettings)
        .where(eq(antibanSettings.userId, input.userId)).limit(1);
      if (existing[0]) {
        await db.update(antibanSettings).set({ dmEnabled: input.enabled })
          .where(eq(antibanSettings.id, existing[0].id));
      } else {
        await db.insert(antibanSettings).values({
          userId: input.userId,
          dmEnabled: input.enabled,
          minIntervalSeconds: 60,
          maxIntervalSeconds: 180,
          dailyDmLimit: 30,
          deduplicateWindowHours: 24,
        });
      }
      return { success: true };
    }),

  // ── Bot API：获取用户完整状态（套餐+关键词数+私信开关） ────
  botGetUserStatus: engineProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const user = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
      if (!user[0]) return null;
      const u = user[0];
      const kwCount = await db.select({ count: sql<number>`count(*)` }).from(keywords)
        .where(and(eq(keywords.userId, input.userId), eq(keywords.isActive, true)));
      const antiban = await db.select().from(antibanSettings)
        .where(eq(antibanSettings.userId, input.userId)).limit(1);
      // 获取公共群组数量
      const publicGroupCount = await db.select({ count: sql<number>`count(*)` })
        .from(publicMonitorGroups).where(eq(publicMonitorGroups.isActive, true));
      const PLAN_LIMITS: Record<string, { maxKeywords: number; maxDailyDm: number; maxTgAccounts: number }> = {
        free: { maxKeywords: 10, maxDailyDm: 5, maxTgAccounts: 1 },
        basic: { maxKeywords: 50, maxDailyDm: 30, maxTgAccounts: 3 },
        pro: { maxKeywords: 200, maxDailyDm: 100, maxTgAccounts: 10 },
        enterprise: { maxKeywords: 1000, maxDailyDm: 500, maxTgAccounts: 50 },
      };
      const limits = PLAN_LIMITS[u.planId] || PLAN_LIMITS.free;
      return {
        id: u.id,
        name: u.name,
        planId: u.planId,
        planExpiresAt: u.planExpiresAt,
        keywordCount: Number(kwCount[0]?.count || 0),
        // 新模式：显示公共群组数量而非私有群组数量
        groupCount: Number(publicGroupCount[0]?.count || 0),
        dmEnabled: antiban[0]?.dmEnabled ?? false,
        hasSenderAccount: true, // 平台统一提供发信账号
        limits,
        dailyDmSent: u.dailyDmSent,
      };
    }),

  // ── Bot API：添加监控群组（旧模式兼容，新模式不使用） ──────
  botAddGroup: engineProcedure
    .input(z.object({ userId: z.number(), groupId: z.string(), groupTitle: z.string().optional() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const existing = await db.select().from(monitorGroups)
        .where(and(eq(monitorGroups.userId, input.userId), eq(monitorGroups.groupId, input.groupId)))
        .limit(1);
      if (existing[0]) {
        await db.update(monitorGroups).set({ isActive: true, monitorStatus: 'active' })
          .where(eq(monitorGroups.id, existing[0].id));
        return { success: true, isNew: false };
      }
      await db.insert(monitorGroups).values({
        userId: input.userId,
        tgAccountId: 0,
        groupId: input.groupId,
        groupTitle: input.groupTitle || input.groupId,
        monitorStatus: 'active',
        totalHits: 0,
        isActive: true,
      });
      return { success: true, isNew: true };
    }),

  // ── Bot API：删除监控群组 ──────────────────────────────────
  botDeleteGroup: engineProcedure
    .input(z.object({ userId: z.number(), groupId: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(monitorGroups).set({ isActive: false })
        .where(and(eq(monitorGroups.userId, input.userId), eq(monitorGroups.groupId, input.groupId)));
      return { success: true };
    }),

  // ── Bot API：获取今日统计 ──────────────────────────────────
  botGetStats: engineProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { todayHits: 0, todayDm: 0, totalHits: 0 };
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayHitsResult = await db.select({ count: sql<number>`count(*)` }).from(hitRecords)
        .where(and(eq(hitRecords.userId, input.userId), gte(hitRecords.createdAt, today)));
      const totalHitsResult = await db.select({ count: sql<number>`count(*)` }).from(hitRecords)
        .where(eq(hitRecords.userId, input.userId));
      const user = await db.select({ dailyDmSent: users.dailyDmSent }).from(users)
        .where(eq(users.id, input.userId)).limit(1);
      return {
        todayHits: Number(todayHitsResult[0]?.count || 0),
        todayDm: user[0]?.dailyDmSent || 0,
        totalHits: Number(totalHitsResult[0]?.count || 0),
      };
    }),

  // ── Bot API：获取关键词列表 ────────────────────────────────
  botGetKeywords: engineProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(keywords)
        .where(and(eq(keywords.userId, input.userId), eq(keywords.isActive, true)))
        .orderBy(desc(keywords.createdAt))
        .limit(20);
    }),

  // ── Bot API：添加关键词 ────────────────────────────────────
  botAddKeyword: engineProcedure
    .input(z.object({ userId: z.number(), keyword: z.string(), matchType: z.string().default("contains") }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.insert(keywords).values({
        userId: input.userId,
        keyword: input.keyword,
        matchType: input.matchType as any,
        isActive: true,
      });
      return { success: true };
    }),

  // ── Bot API：删除关键词 ────────────────────────────────────
  botDeleteKeyword: engineProcedure
    .input(z.object({ userId: z.number(), keywordId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(keywords)
        .set({ isActive: false })
        .where(and(eq(keywords.id, input.keywordId), eq(keywords.userId, input.userId)));
      return { success: true };
    }),

  // ── Bot API：获取监控群组列表（新模式返回公共群组） ─────────
  botGetGroups: engineProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      // 新模式：返回公共群组池（所有会员共享）
      return db.select().from(publicMonitorGroups)
        .where(eq(publicMonitorGroups.isActive, true))
        .orderBy(desc(publicMonitorGroups.createdAt))
        .limit(50);
    }),

  // ── Bot API：获取推送群组 ─────────────────────────────────
  botGetPushGroup: engineProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return {};
      const rows = await db.select({
        collabChatId: pushSettings.collaborationGroupId,
        collabChatTitle: pushSettings.collaborationGroupTitle,
      }).from(pushSettings).where(eq(pushSettings.userId, input.userId)).limit(1);
      return rows[0] || {};
    }),

  // ── Bot API：设置推送群组 ─────────────────────────────────
  botSetPushGroup: engineProcedure
    .input(z.object({
      userId: z.number(),
      collabChatId: z.string().nullable(),
      collabChatTitle: z.string().nullable(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const existing = await db.select({ id: pushSettings.id }).from(pushSettings)
        .where(eq(pushSettings.userId, input.userId)).limit(1);
      if (existing.length > 0) {
        await db.update(pushSettings).set({
          collaborationGroupId: input.collabChatId,
          collaborationGroupTitle: input.collabChatTitle,
        }).where(eq(pushSettings.userId, input.userId));
      } else {
        await db.insert(pushSettings).values({
          userId: input.userId,
          collaborationGroupId: input.collabChatId,
          collaborationGroupTitle: input.collabChatTitle,
        });
      }
      return { success: true };
    }),

  // ── Bot API：获取最近命中记录 ─────────────────────────────
  botGetHitRecords: engineProcedure
    .input(z.object({ userId: z.number(), limit: z.number().default(10) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(hitRecords)
        .where(eq(hitRecords.userId, input.userId))
        .orderBy(desc(hitRecords.createdAt))
        .limit(input.limit);
    }),

  // ── Bot API：激活卡密 ─────────────────────────────────────
  botActivateCode: engineProcedure
    .input(z.object({ userId: z.number(), code: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const code = await db.select().from(redeemCodes)
        .where(and(eq(redeemCodes.code, input.code), eq(redeemCodes.status, "unused")))
        .limit(1);
      if (!code[0]) return { success: false, message: "卡密无效或已使用" };
      const rc = code[0];
      if (rc.expiresAt && rc.expiresAt < new Date()) {
        return { success: false, message: "卡密已过期" };
      }
      const user = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
      if (!user[0]) return { success: false, message: "用户不存在" };
      const now = new Date();
      const base = user[0].planExpiresAt && user[0].planExpiresAt > now ? user[0].planExpiresAt : now;
      const newExpiry = new Date(base);
      newExpiry.setMonth(newExpiry.getMonth() + rc.durationMonths);
      await db.update(users).set({
        planId: rc.planId,
        planExpiresAt: newExpiry,
      }).where(eq(users.id, input.userId));
      await db.update(redeemCodes).set({
        status: "used",
        usedByUserId: input.userId,
        usedAt: now,
      }).where(eq(redeemCodes.id, rc.id));
      return { success: true, planId: rc.planId, durationMonths: rc.durationMonths, expiresAt: newExpiry };
    }),

  // ── Bot API：绑定用户 TG ID ───────────────────────────────
  botBindTgId: engineProcedure
    .input(z.object({ userId: z.number(), tgUserId: z.string(), tgUsername: z.string().optional() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(users).set({
        tgUserId: input.tgUserId,
        tgUsername: input.tgUsername || null,
      }).where(eq(users.id, input.userId));
      return { success: true };
    }),

  // ── Bot API：获取私信队列 ─────────────────────────────────
  botGetDmQueue: engineProcedure
    .input(z.object({ userId: z.number(), limit: z.number().default(10) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(dmQueue)
        .where(eq(dmQueue.userId, input.userId))
        .orderBy(desc(dmQueue.createdAt))
        .limit(input.limit);
    }),

  // ── Bot API：获取系统配置（客服/频道/教程等） ─────────────
  botGetSysConfig: engineProcedure
    .input(z.object({}).optional())
    .query(async () => {
      const db = await getDb();
      if (!db) return {};
      const rows = await db.select().from(systemConfig);
      const result: Record<string, string> = {};
      for (const row of rows) {
        result[row.configKey] = row.configValue || "";
      }
      return result;
    }),

  // ── Bot API：获取公共监控群组列表（管理员配置，所有会员共享）──
  botGetPublicGroups: engineProcedure
    .input(z.object({}).optional())
    .query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(publicMonitorGroups)
        .where(eq(publicMonitorGroups.isActive, true))
        .orderBy(publicMonitorGroups.createdAt);
    }),
});

// ── 配置查询（独立函数，避免循环引用） ──────────────────────────────────────────────────────────────
function engineRouter_config() {
  return engineProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { accounts: [], userConfigs: {}, publicGroups: [] };

    // 获取所有激活的平台监控账号（系统账号，不属于特定会员）
    const accounts = await db
      .select()
      .from(tgAccounts)
      .where(
        and(
          eq(tgAccounts.isActive, true),
          inArray(tgAccounts.accountRole, ["monitor", "both"])
        )
      );

    // 获取公共监控群组池
    const publicGroupRows = await db
      .select()
      .from(publicMonitorGroups)
      .where(eq(publicMonitorGroups.isActive, true));

    // 新模式：所有有活跃关键词的用户都加入 userConfigs（不依赖 tgAccounts）
    const allKeywordUsers = await db
      .selectDistinct({ userId: keywords.userId })
      .from(keywords)
      .where(eq(keywords.isActive, true));

    // 合并：有 tgAccounts 的用户 + 有关键词的用户
    const accountUserIds = accounts.map((a) => a.userId);
    const keywordUserIds = allKeywordUsers.map((r) => r.userId);
    const allUserIds = Array.from(new Set([...accountUserIds, ...keywordUserIds]));

    const userConfigs: Record<string, any> = {};

    for (const userId of allUserIds) {
      // 获取该用户的全局关键词（新模式：对所有公共群组生效）
      const globalKws = await db
        .select()
        .from(keywords)
        .where(and(eq(keywords.userId, userId), eq(keywords.isActive, true)));

      const kwMapper = (k: typeof globalKws[0]) => ({
        id: k.id,
        pattern: k.keyword,
        matchType: k.matchType,
        subKeywords: Array.isArray(k.subKeywords) ? k.subKeywords : [],
        caseSensitive: k.caseSensitive,
        isActive: k.isActive,
      });

      // 旧模式兼容：私有群组（如果有的话）
      const privateGroups = await db
        .select()
        .from(monitorGroups)
        .where(and(eq(monitorGroups.userId, userId), eq(monitorGroups.isActive, true)));

      const groupsWithKeywords = privateGroups.map((group) => ({
        ...group,
        keywords: globalKws.map(kwMapper),
      }));

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

      // 获取平台发信账号（新模式：所有会员共用平台发信账号）
      const senderAccounts = await db
        .select()
        .from(tgAccounts)
        .where(
          and(
            eq(tgAccounts.isActive, true),
            inArray(tgAccounts.accountRole, ["sender", "both"])
          )
        )
        .limit(1);

      const antibanConfig = antiban[0] || {};
      const senderAccount = senderAccounts[0];

      // 获取用户的 tgUserId（用于 Bot 推送命中通知）
      const userRow = await db.select({ tgUserId: users.tgUserId }).from(users)
        .where(eq(users.id, userId)).limit(1);
      const botChatId = userRow[0]?.tgUserId || null;

      // 获取推送设置（协作群、过滤广告等）
      const pushSettingsRow = await db.select().from(pushSettings)
        .where(eq(pushSettings.userId, userId)).limit(1);
      const pushConfig = pushSettingsRow[0] || {};

      userConfigs[String(userId)] = {
        botChatId,
        // 新模式：全局关键词（对所有公共群组生效）
        globalKeywords: globalKws.map(kwMapper),
        // 旧模式兼容：私有群组关键词
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
        pushSettings: {
          pushEnabled: pushConfig.pushEnabled ?? true,
          filterAds: pushConfig.filterAds ?? false,
          collabChatId: pushConfig.collaborationGroupId || null,
          collabChatTitle: pushConfig.collaborationGroupTitle || null,
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
      // 公共监控群组池（所有会员共享）
      publicGroups: publicGroupRows.map((pg) => ({
        id: pg.id,
        groupId: pg.groupId,
        groupTitle: pg.groupTitle,
        isActive: pg.isActive,
      })),
    };
  });
}
