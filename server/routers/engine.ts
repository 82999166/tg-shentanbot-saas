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
  systemSettings,
  publicMonitorGroups,
  blacklist,
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

      // 写入队列后立即通知引擎触发发送（不等待轮询间隔）
      try {
        const engineUrl = process.env.ENGINE_URL || "http://127.0.0.1:8765";
        const engineSecret = process.env.ENGINE_SECRET || "tg-monitor-engine-secret";
        await fetch(`${engineUrl}/trigger-dm`, {
          method: "POST",
          headers: { "X-Engine-Secret": engineSecret },
          signal: AbortSignal.timeout(2000),
        }).catch(() => {}); // 忘记错误，引擎轮询作为兆底保障
      } catch (_) {}

      return { success: true };
    }),

  // ── 更新账号健康度（并在健康度低于阈值时自动发送 Bot 告警）───────────────────────────────────────────
  accountHealth: engineProcedure
    .input(
      z.object({
        accountId: z.number(),
        delta: z.number(),
        status: z.string().optional(),
        reason: z.string().optional(), // 健康度下降原因（用于告警消息）
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 先读取当前账号信息
      const accountRow = await db.select({
        id: tgAccounts.id,
        healthScore: tgAccounts.healthScore,
        phone: tgAccounts.phone,
        tgUsername: tgAccounts.tgUsername,
        userId: tgAccounts.userId,
        lastAlertAt: tgAccounts.lastAlertAt,
      }).from(tgAccounts).where(eq(tgAccounts.id, input.accountId)).limit(1);
      const account = accountRow[0];

      const updates: Record<string, any> = {
        healthScore: sql`GREATEST(0, LEAST(100, ${tgAccounts.healthScore} + ${input.delta}))`,
        lastActiveAt: new Date(),
      };
      if (input.status) updates.sessionStatus = input.status;
      await db.update(tgAccounts).set(updates).where(eq(tgAccounts.id, input.accountId));

      // 健康告警逻辑：当 delta < 0 且新健康度低于阈值时发送告警
      if (account && input.delta < 0) {
        const newScore = Math.max(0, Math.min(100, (account.healthScore ?? 80) + input.delta));
        // 读取告警阈值配置
        const cfgRows = await db.select().from(systemConfig)
          .where(sql`${systemConfig.configKey} IN ('health_alert_threshold', 'health_alert_cooldown_hours', 'bot_token')`);
        const cfgMap: Record<string, string> = {};
        for (const r of cfgRows) cfgMap[r.configKey] = r.configValue ?? "";
        const alertThreshold = parseInt(cfgMap["health_alert_threshold"] ?? "40");
        const cooldownHours = parseInt(cfgMap["health_alert_cooldown_hours"] ?? "1");
        if (newScore <= alertThreshold) {
          // 检查冷却时间（防止刷屏）
          const lastAlert = account.lastAlertAt ? new Date(account.lastAlertAt).getTime() : 0;
          const cooldownMs = cooldownHours * 3600 * 1000;
          if (Date.now() - lastAlert >= cooldownMs) {
            // 更新最近告警时间
            await db.update(tgAccounts).set({ lastAlertAt: new Date() }).where(eq(tgAccounts.id, input.accountId));
            // 获取用户 tgUserId 用于 Bot 推送
            if (account.userId) {
              const userRow = await db.select({ tgUserId: users.tgUserId })
                .from(users).where(eq(users.id, account.userId)).limit(1);
              const botChatId = userRow[0]?.tgUserId;
              const botToken = cfgMap["bot_token"];
              if (botChatId && botToken) {
                const phoneDisplay = account.phone || (account.tgUsername ? `@${account.tgUsername}` : `ID:${input.accountId}`);
                const reasonMap: Record<string, string> = {
                  needs_2fa: "需要二步验证",
                  error: "账号连接异常",
                  limited: "发信受限",
                  flood: "触发限流保护",
                  banned: "账号已被封禁",
                };
                const reasonText = input.reason ? (reasonMap[input.reason] || input.reason) : "健康度下降";
                const statusMap: Record<string, string> = { active: "运行中", limited: "受限", banned: "已封禁", needs_2fa: "需二步验证", error: "异常" };
                const statusText = input.status ? (statusMap[input.status] || input.status) : "未知";
                const alertText = [
                  `⚠️ <b>账号健康告警</b>`,
                  ``,
                  `📱 账号：${phoneDisplay}`,
                  `📊 健康度：<b>${newScore}</b> / 100（告警阈值 ${alertThreshold}）`,
                  `🔴 状态：${statusText}`,
                  `⚡ 原因：${reasonText}`,
                  ``,
                  `💡 建议：请到账号管理页面检查并处理该账号`,
                ].join("\n");
                // 异步发送 Bot 消息（fire-and-forget，不阻塞主流程）
                fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    chat_id: botChatId,
                    text: alertText,
                    parse_mode: "HTML",
                    disable_web_page_preview: true,
                    reply_markup: {
                      inline_keyboard: [[
                        { text: "📱 账号管理", url: `${process.env.VITE_OAUTH_PORTAL_URL || "https://t.me"}/tg-accounts` },
                      ]]
                    },
                  }),
                }).catch((e: any) => console.error("[HealthAlert] Bot push failed:", e));
              }
            }
          }
        }
      }
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

  // ── 心跳上报（TDLib 引擎增强版）─────────────────────────────
  heartbeat: engineProcedure
    .input(
      z.object({
        activeAccounts: z.number(),
        timestamp: z.number(),
        engineType: z.string().optional(),       // "tdlib" | "pyrogram"
        tdlibVersion: z.string().optional(),     // TDLib 版本号
        totalGroups: z.number().optional(),      // 正在监控的群组总数
        gapRecoveries: z.number().optional(),    // updates gap 恢复次数
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (db) {
        // 持久化心跳状态到 systemConfig
        try {
          const heartbeatData = JSON.stringify({
            activeAccounts: input.activeAccounts,
            timestamp: input.timestamp,
            engineType: input.engineType ?? "pyrogram",
            tdlibVersion: input.tdlibVersion ?? null,
            totalGroups: input.totalGroups ?? 0,
            gapRecoveries: input.gapRecoveries ?? 0,
          });
          await db.insert(systemConfig)
            .values({ configKey: "engine_last_heartbeat", configValue: heartbeatData })
            .onDuplicateKeyUpdate({ set: { configValue: heartbeatData } });
        } catch (_e) {
          // 忽略持久化错误，不影响引擎运行
        }
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

  // ── Bot API：获取推送设置（设置中心） ─────────────────────
  botGetPushSettings: engineProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });
      const rows = await db.select().from(pushSettings)
        .where(eq(pushSettings.userId, input.userId)).limit(1);
      if (rows.length === 0) {
        // 返回默认值
        return {
          pushEnabled: true,
          filterAds: false,
          collaborationGroupId: null,
          collaborationGroupTitle: null,
          pushFormat: 'standard' as const,
          keywordMatchMode: 'fuzzy' as const,
          blacklistMatchMode: 'fuzzy' as const,
          includeSearchHistory: false,
          dedupeMinutes: 0,
          blacklistKeywords: null,
          filterBots: false,
          mediaOnly: false,
        };
      }
      return rows[0];
    }),
  // ── Bot API：保存推送设置（设置中心） ─────────────────────
  botSavePushSettings: engineProcedure
    .input(z.object({
      userId: z.number(),
      pushEnabled: z.boolean().optional(),
      filterAds: z.boolean().optional(),
      collaborationGroupId: z.string().optional().nullable(),
      collaborationGroupTitle: z.string().optional().nullable(),
      pushFormat: z.enum(["simple", "standard", "detailed"]).optional(),
      keywordMatchMode: z.enum(["fuzzy", "exact", "leftmost", "rightmost"]).optional(),
      blacklistMatchMode: z.enum(["fuzzy", "exact"]).optional(),
      includeSearchHistory: z.boolean().optional(),
      dedupeMinutes: z.number().int().min(0).optional(),
      blacklistKeywords: z.string().optional().nullable(),
      filterBots: z.boolean().optional(),
      mediaOnly: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });
      const { userId, ...updateData } = input;
      // 过滤掉 undefined 值
      const cleanData = Object.fromEntries(
        Object.entries(updateData).filter(([, v]) => v !== undefined)
      );
      const existing = await db.select({ id: pushSettings.id })
        .from(pushSettings).where(eq(pushSettings.userId, userId)).limit(1);
      if (existing.length > 0) {
        await db.update(pushSettings).set(cleanData).where(eq(pushSettings.userId, userId));
      } else {
        await db.insert(pushSettings).values({ userId, ...cleanData });
      }
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
      // 全量返回，不限制条数（Bot 长页显示，无需分页）
      return db.select().from(keywords)
        .where(and(eq(keywords.userId, input.userId), eq(keywords.isActive, true)))
        .orderBy(desc(keywords.createdAt));
    }),

  // ── Bot API：添加关键词 ────────────────────────────────────
  botAddKeyword: engineProcedure
    .input(z.object({ userId: z.number(), keyword: z.string(), matchType: z.string().default("contains") }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // ── 去重检查：同一用户不允许添加重复关键词（不区分大小写）──
      const existing = await db.select({ id: keywords.id }).from(keywords)
        .where(and(
          eq(keywords.userId, input.userId),
          sql`LOWER(${keywords.keyword}) = LOWER(${input.keyword})`,
          eq(keywords.isActive, true),
        )).limit(1);
      if (existing.length > 0) {
        return { success: false, duplicate: true, message: "关键词已存在" };
      }
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

  // ── Bot API：通过 hitRecordId 获取命中记录详情（含 senderUsername）────
  botGetHitById: engineProcedure
    .input(z.object({ hitRecordId: z.number(), userId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const rows = await db.select().from(hitRecords)
        .where(and(eq(hitRecords.id, input.hitRecordId), eq(hitRecords.userId, input.userId)))
        .limit(1);
      return rows[0] || null;
    }),
  // ── Bot API：标记命中记录为已处理 ─────────────────────────
  botMarkProcessed: engineProcedure
    .input(z.object({ hitRecordId: z.number(), userId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { success: false };
      await db.update(hitRecords)
        .set({ isProcessed: true })
        .where(and(eq(hitRecords.id, input.hitRecordId), eq(hitRecords.userId, input.userId)));
      return { success: true };
    }),
  // ── Bot API：屏蔽发送者（加入黑名单）────────────────────────
  botBlockUser: engineProcedure
    .input(z.object({ userId: z.number(), targetTgId: z.string(), targetUsername: z.string().optional() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { success: false };
      const existing = await db.select().from(blacklist)
        .where(and(eq(blacklist.userId, input.userId), eq(blacklist.targetTgId, input.targetTgId)))
        .limit(1);
      if (existing.length === 0) {
        await db.insert(blacklist).values({
          userId: input.userId,
          targetTgId: input.targetTgId,
          targetUsername: input.targetUsername || null,
          reason: "Bot 屏蔽",
        });
      }
      return { success: true };
    }),
  // ── Bot API：删除命中记录 ─────────────────────────────────
  botDeleteHit: engineProcedure
    .input(z.object({ hitRecordId: z.number(), userId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { success: false };
      await db.delete(hitRecords)
        .where(and(eq(hitRecords.id, input.hitRecordId), eq(hitRecords.userId, input.userId)));
      return { success: true };
    }),
  // ── Bot API：获取发送者历史命中记录 ───────────────────────
  botGetSenderHistory: engineProcedure
    .input(z.object({ userId: z.number(), senderTgId: z.string(), limit: z.number().default(10) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(hitRecords)
        .where(and(eq(hitRecords.userId, input.userId), eq(hitRecords.senderTgId, input.senderTgId)))
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

  // ── Bot 内添加私信账号：第一步 - 发送验证码 ──────────────────────────────
  botSendCode: engineProcedure
    .input(z.object({
      userId: z.number(),
      phone: z.string(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库未初始化" });
      const phone = (input.phone.replace(/\s/g, "").startsWith("+") ? input.phone.replace(/\s/g, "") : `+${input.phone.replace(/\s/g, "")}`);
      // 读取系统 API 配置（从 system_settings 表）
      const settingsRows = await db.select().from(systemSettings)
        .where(sql`${systemSettings.key} IN ('tg_api_id', 'tg_api_hash')`);
      const settingsMap: Record<string, string> = {};
      for (const r of settingsRows) settingsMap[r.key] = r.value ?? "";
      const apiId = parseInt(settingsMap["tg_api_id"] || "0");
      const apiHash = settingsMap["tg_api_hash"] || "";
      if (!apiId || !apiHash) throw new TRPCError({ code: "BAD_REQUEST", message: "请先在系统设置中配置 TG API ID 和 API Hash" });
      const LOGIN_SERVICE_URL = process.env.LOGIN_SERVICE_URL ?? "http://127.0.0.1:5051";
      const resp = await fetch(`${LOGIN_SERVICE_URL}/send_code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, api_id: apiId, api_hash: apiHash }),
      });
      const data = await resp.json() as any;
      if (!data.phone_code_hash) throw new TRPCError({ code: "BAD_REQUEST", message: data.error || "发送验证码失败" });
      return { success: true, phoneCodeHash: data.phone_code_hash as string };
    }),

  // ── Bot 内添加私信账号：第二步 - 验证码登录 ──────────────────────────────
  botVerifyCode: engineProcedure
    .input(z.object({
      userId: z.number(),
      phone: z.string(),
      phoneCodeHash: z.string(),
      code: z.string(),
    }))
    .mutation(async ({ input }) => {
      const phone = (input.phone.replace(/\s/g, "").startsWith("+") ? input.phone.replace(/\s/g, "") : `+${input.phone.replace(/\s/g, "")}`);
      const LOGIN_SERVICE_URL = process.env.LOGIN_SERVICE_URL ?? "http://127.0.0.1:5051";
      const resp = await fetch(`${LOGIN_SERVICE_URL}/verify_code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code: input.code, phone_code_hash: input.phoneCodeHash }),
      });
      const data = await resp.json() as any;
      // login_service 返回 next_step=verify_2fa 表示需要二步验证
      if (data.next_step === "verify_2fa" || data.needs_2fa) return { success: true, needs2FA: true, sessionString: null };
      if (!data.success) throw new TRPCError({ code: "BAD_REQUEST", message: data.error || "验证失败" });
      // 保存账号到数据库
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库未初始化" });
      // 检查手机号是否已存在（存在则更新session，不存在则新增）
      const existingAcc = await db.select({ id: tgAccounts.id }).from(tgAccounts)
        .where(eq(tgAccounts.phone, phone)).limit(1);
      if (existingAcc.length > 0) {
        await db.update(tgAccounts).set({
          sessionString: data.files_directory,
          sessionStatus: "active",
          healthScore: 80,
          healthStatus: "healthy",
        }).where(eq(tgAccounts.phone, phone));
      } else {
        await db.insert(tgAccounts).values({
          userId: input.userId,
          phone,
          sessionString: data.files_directory,
          sessionStatus: "active",
          accountRole: "sender",
          healthScore: 80,
          healthStatus: "healthy",
          notes: "Bot内添加",
        });
      }
      return { success: true, needs2FA: false, sessionString: data.files_directory as string };
    }),

  // ── Bot 内添加私信账号：第三步 - 二步验证 ──────────────────────────────────
  botVerify2FA: engineProcedure
    .input(z.object({
      userId: z.number(),
      phone: z.string(),
      password: z.string(),
    }))
    .mutation(async ({ input }) => {
      const phone = (input.phone.replace(/\s/g, "").startsWith("+") ? input.phone.replace(/\s/g, "") : `+${input.phone.replace(/\s/g, "")}`);
      const LOGIN_SERVICE_URL = process.env.LOGIN_SERVICE_URL ?? "http://127.0.0.1:5051";
      const resp = await fetch(`${LOGIN_SERVICE_URL}/verify_2fa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password: input.password }),
      });
      const data = await resp.json() as any;
      if (!data.success) throw new TRPCError({ code: "BAD_REQUEST", message: data.error || "验证失败" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库未初始化" });
      // 检查手机号是否已存在（存在则更新session，不存在则新增）
      const existing2fa = await db.select({ id: tgAccounts.id }).from(tgAccounts)
        .where(eq(tgAccounts.phone, phone)).limit(1);
      if (existing2fa.length > 0) {
        // 已存在：更新sessionString和状态
        await db.update(tgAccounts).set({
          sessionString: data.files_directory,
          sessionStatus: "active",
          healthScore: 80,
          healthStatus: "healthy",
        }).where(eq(tgAccounts.phone, phone));
      } else {
        await db.insert(tgAccounts).values({
          userId: input.userId,
          phone,
          sessionString: data.files_directory,
          sessionStatus: "active",
          accountRole: "sender",
          healthScore: 80,
          healthStatus: "healthy",
          notes: "Bot内添加",
        });
      }
      return { success: true };
    }),

  // ── Bot API：获取用户的私信账号列表 ──────────────────────────────────────────
  botGetSenderAccounts: engineProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { accounts: [] };
      const accounts = await db
        .select({
          id: tgAccounts.id,
          phone: tgAccounts.phone,
          tgUsername: tgAccounts.tgUsername,
          tgFirstName: tgAccounts.tgFirstName,
          sessionStatus: tgAccounts.sessionStatus,
          healthScore: tgAccounts.healthScore,
          healthStatus: tgAccounts.healthStatus,
          totalDmSent: tgAccounts.totalDmSent,
          dailyDmSent: tgAccounts.dailyDmSent,
          lastActiveAt: tgAccounts.lastActiveAt,
          notes: tgAccounts.notes,
        })
        .from(tgAccounts)
        .where(and(eq(tgAccounts.userId, input.userId), eq(tgAccounts.accountRole, "sender")))
        .orderBy(tgAccounts.id);
      return { accounts };
    }),

  // ── Bot API：删除指定私信账号 ──────────────────────────────────────────────
  botDeleteSenderAccount: engineProcedure
    .input(z.object({ userId: z.number(), accountId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // 确认账号属于该用户
      const acc = await db.select({ id: tgAccounts.id }).from(tgAccounts)
        .where(and(eq(tgAccounts.id, input.accountId), eq(tgAccounts.userId, input.userId))).limit(1);
      if (!acc[0]) throw new TRPCError({ code: "NOT_FOUND", message: "账号不存在或无权限删除" });
      await db.delete(tgAccounts).where(eq(tgAccounts.id, input.accountId));
      return { success: true };
    }),

  // ── Bot API：通过 Session 字符串导入私信账号 ──────────────────────────────
  botImportSession: engineProcedure
    .input(z.object({
      userId: z.number(),
      sessionString: z.string().min(10, "Session字符串无效"),
      phone: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // 检查 session 是否已存在
      const existingSession = await db.select({ id: tgAccounts.id }).from(tgAccounts)
        .where(eq(tgAccounts.sessionString, input.sessionString)).limit(1);
      if (existingSession.length > 0) throw new TRPCError({ code: "CONFLICT", message: "该 Session 已存在，请勿重复导入" });
      // 如果提供了手机号，检查手机号是否已存在
      if (input.phone) {
        const cleanPhone = input.phone.replace(/\s/g, "");
        const phone = cleanPhone.startsWith("+") ? cleanPhone : `+${cleanPhone}`;
        const existingPhone = await db.select({ id: tgAccounts.id }).from(tgAccounts)
          .where(eq(tgAccounts.phone, phone)).limit(1);
        if (existingPhone.length > 0) throw new TRPCError({ code: "CONFLICT", message: `手机号 ${phone} 已存在，请勿重复添加` });
        await db.insert(tgAccounts).values({
          userId: input.userId,
          phone,
          sessionString: input.sessionString,
          sessionStatus: "active",
          accountRole: "sender",
          healthScore: 80,
          healthStatus: "healthy",
          notes: "Bot内Session导入",
        });
      } else {
        await db.insert(tgAccounts).values({
          userId: input.userId,
          phone: null,
          sessionString: input.sessionString,
          sessionStatus: "active",
          accountRole: "sender",
          healthScore: 80,
          healthStatus: "healthy",
          notes: "Bot内Session导入（无手机号）",
        });
      }
      return { success: true };
    }),

  // -- Bot API: 绑定邮箱并生成6位随机密码
  botSetEmail: engineProcedure
    .input(z.object({
      userId: z.number(),
      email: z.string().email('请输入有效的邮箱地址'),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '数据库未初始化' });
      const existingEmail = await db.select({ id: users.id }).from(users)
        .where(eq(users.email, input.email)).limit(1);
      if (existingEmail.length > 0 && existingEmail[0].id !== input.userId) {
        throw new TRPCError({ code: 'CONFLICT', message: '该邮箱已被其他账号使用' });
      }
      const rawPassword = Math.floor(100000 + Math.random() * 900000).toString();
      const bcrypt = await import('bcryptjs');
      const passwordHash = await bcrypt.hash(rawPassword, 12);
      await db.update(users).set({
        email: input.email,
        passwordHash,
        loginMethod: 'email',
        emailVerified: true,
      }).where(eq(users.id, input.userId));
      return { success: true, password: rawPassword, email: input.email };
    }),

  // -- Bot API: 重置管理后台登录密码（生成新6位随机密码）
  botResetPassword: engineProcedure
    .input(z.object({
      userId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '数据库未初始化' });
      const userRow = await db.select({ id: users.id, email: users.email })
        .from(users).where(eq(users.id, input.userId)).limit(1);
      if (!userRow[0] || !userRow[0].email) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '请先绑定邮箱再重置密码' });
      }
      const rawPassword = Math.floor(100000 + Math.random() * 900000).toString();
      const bcrypt = await import('bcryptjs');
      const passwordHash = await bcrypt.hash(rawPassword, 12);
      await db.update(users).set({ passwordHash }).where(eq(users.id, input.userId));
      return { success: true, password: rawPassword, email: userRow[0].email };
    }),

  // -- Bot API: 获取用户邮箱绑定状态
  botGetEmailStatus: engineProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { hasEmail: false, email: null };
      const userRow = await db.select({ email: users.email }).from(users)
        .where(eq(users.id, input.userId)).limit(1);
      const email = userRow[0] ? userRow[0].email : null;
      return { hasEmail: email ? true : false, email };
    }),

  // ── 立即同步群组配置（管理后台维护页面使用）────────────────────────────────
  forceSync: publicProcedure.mutation(async () => {
    try {
      const engineUrl = process.env.ENGINE_URL || "http://127.0.0.1:8765";
      const engineSecret = process.env.ENGINE_SECRET || "tg-monitor-engine-secret";
      const resp = await fetch(`${engineUrl}/force-sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Engine-Secret": engineSecret,
        },
        body: JSON.stringify({}),
      });
      if (!resp.ok) {
        return { success: false, message: `引擎响应异常: ${resp.status}` };
      }
      const data = await resp.json() as any;
      return { success: true, message: data.message || "已触发立即同步" };
    } catch (e: any) {
      return { success: false, message: `无法连接引擎: ${e.message}` };
    }
  }),

  // ── 数据库记录统计（管理后台维护页面使用）────────────────────────────────
  getRecordStats: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { hitRecords: 0, dmQueue: 0, senderHistory: 0, loginAttempts: 0 };
    const { loginAttempts, senderHistory } = await import("../../drizzle/schema");
    const [hitCount] = await db.select({ count: sql<number>`count(*)` }).from(hitRecords);
    const [dmCount] = await db.select({ count: sql<number>`count(*)` }).from(dmQueue);
    const [senderCount] = await db.select({ count: sql<number>`count(*)` }).from(senderHistory);
    const [loginCount] = await db.select({ count: sql<number>`count(*)` }).from(loginAttempts);
    return {
      hitRecords: Number(hitCount?.count ?? 0),
      dmQueue: Number(dmCount?.count ?? 0),
      senderHistory: Number(senderCount?.count ?? 0),
      loginAttempts: Number(loginCount?.count ?? 0),
    };
  }),

  // ── 清理历史数据（管理后台维护页面使用）────────────────────────────────
  cleanupRecords: publicProcedure
    .input(
      z.object({
        hitRecordsDays: z.number().optional(),
        dmQueueDays: z.number().optional(),
        senderHistoryDays: z.number().optional(),
        loginAttemptsDays: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { loginAttempts, senderHistory } = await import("../../drizzle/schema");
      const details: Record<string, number> = {};
      const now = new Date();
      if (input.hitRecordsDays && input.hitRecordsDays > 0) {
        const cutoff = new Date(now.getTime() - input.hitRecordsDays * 86400000);
        const [before] = await db.select({ count: sql<number>`count(*)` }).from(hitRecords).where(sql`${hitRecords.createdAt} < ${cutoff}`);
        await db.delete(hitRecords).where(sql`${hitRecords.createdAt} < ${cutoff}`);
        details.hitRecords = Number(before?.count ?? 0);
      }
      if (input.dmQueueDays && input.dmQueueDays > 0) {
        const cutoff = new Date(now.getTime() - input.dmQueueDays * 86400000);
        const [before] = await db.select({ count: sql<number>`count(*)` }).from(dmQueue).where(sql`${dmQueue.createdAt} < ${cutoff}`);
        await db.delete(dmQueue).where(sql`${dmQueue.createdAt} < ${cutoff}`);
        details.dmQueue = Number(before?.count ?? 0);
      }
      if (input.senderHistoryDays && input.senderHistoryDays > 0) {
        const cutoff = new Date(now.getTime() - input.senderHistoryDays * 86400000);
        const [before] = await db.select({ count: sql<number>`count(*)` }).from(senderHistory).where(sql`${senderHistory.createdAt} < ${cutoff}`);
        await db.delete(senderHistory).where(sql`${senderHistory.createdAt} < ${cutoff}`);
        details.senderHistory = Number(before?.count ?? 0);
      }
      if (input.loginAttemptsDays && input.loginAttemptsDays > 0) {
        const cutoff = new Date(now.getTime() - input.loginAttemptsDays * 86400000);
        const [before] = await db.select({ count: sql<number>`count(*)` }).from(loginAttempts).where(sql`${loginAttempts.createdAt} < ${cutoff}`);
        await db.delete(loginAttempts).where(sql`${loginAttempts.createdAt} < ${cutoff}`);
        details.loginAttempts = Number(before?.count ?? 0);
      }
      const total = Object.values(details).reduce((a, b) => a + b, 0);
      return {
        success: true,
        message: `已清理 ${total} 条历史记录`,
        details,
      };
    }),

  // ── 一键加群 ──────────────────────────────────────────────────────────────────
  batchJoinGroups: publicProcedure
    .input(
      z.object({
        accountIds: z.array(z.number()).min(1, "至少选择一个账号"),
        groupIds: z.array(z.string()).optional(),
        intervalMin: z.number().min(5).max(300).optional(),
        intervalMax: z.number().min(5).max(600).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const engineUrl = process.env.ENGINE_URL || "http://127.0.0.1:8765";
      const engineSecret = process.env.ENGINE_SECRET || "tg-monitor-engine-secret";
      // 从数据库读取 join_interval 配置，优先使用前端传入的值
      let intervalMin = input.intervalMin;
      let intervalMax = input.intervalMax;
      if (intervalMin === undefined || intervalMax === undefined) {
        try {
          const db = await getDb();
          if (db) {
            const cfgRows = await db.select().from(systemConfig)
              .where(sql`${systemConfig.configKey} IN ('join_interval_min', 'join_interval_max')`);
            const cfgMap: Record<string, string> = {};
            for (const row of cfgRows) cfgMap[row.configKey] = row.configValue ?? "";
            if (intervalMin === undefined) intervalMin = parseInt(cfgMap["join_interval_min"] || "10", 10);
            if (intervalMax === undefined) intervalMax = parseInt(cfgMap["join_interval_max"] || "30", 10);
          }
        } catch (_) {}
        if (intervalMin === undefined) intervalMin = 10;
        if (intervalMax === undefined) intervalMax = 30;
      }
      const resp = await fetch(`${engineUrl}/batch-join-groups`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Engine-Secret": engineSecret,
        },
        body: JSON.stringify({
          account_ids: input.accountIds,
          group_ids: input.groupIds || [],
          interval_min: intervalMin,
          interval_max: intervalMax,
        }),
        signal: AbortSignal.timeout(600_000),
      });
      const data = await resp.json() as {
        success?: boolean;
        joined?: number;
        failed?: number;
        skipped?: number;
        results?: Array<{ account_id: number; group_id: string; status: string; real_id?: number; reason?: string }>;
        error?: string;
      };
      if (!data.success) {
        throw new TRPCError({ code: "BAD_REQUEST", message: data.error || "批量加群失败" });
      }
      return {
        success: true,
        joined: data.joined ?? 0,
        failed: data.failed ?? 0,
        skipped: data.skipped ?? 0,
        results: data.results ?? [],
      };
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
          inArray(tgAccounts.accountRole, ["monitor", "sender", "both"])
        )
      );

    // 获取公共监控群组池
    const publicGroupRows = await db
      .select()
      .from(publicMonitorGroups)
      .where(eq(publicMonitorGroups.isActive, true));
    // 读取全局刷词过滤配置
    const sysConfigRows = await db.select().from(systemConfig);
    const sysConfigMap: Record<string, string> = {};
    for (const row of sysConfigRows) {
      sysConfigMap[row.configKey] = row.configValue || "";
    }
    const globalAntiSpam = {
      dailyLimit: parseInt(sysConfigMap["anti_spam_daily_limit"] || "10", 10),
      rateWindow: parseInt(sysConfigMap["anti_spam_rate_window"] || "60", 10),
      rateLimit: parseInt(sysConfigMap["anti_spam_rate_limit"] || "3", 10),
      minMsgLen: parseInt(sysConfigMap["anti_spam_min_msg_len"] || "0", 10),
      enabled: sysConfigMap["anti_spam_enabled"] !== "false",
      // 全局消息过滤字段（与前端 Antiban 页面 global_* 配置对应）
      globalMaxMsgLen: parseInt(sysConfigMap["global_max_msg_length"] || "500", 10),
      filterBot: sysConfigMap["global_filter_bot"] !== "false",
      filterAds: sysConfigMap["global_filter_ads"] === "true",
      globalRateWindow: parseInt(sysConfigMap["global_rate_window"] || "60", 10),
      globalRateLimit: parseInt(sysConfigMap["global_rate_limit"] || "5", 10),
    };

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
          // 方案A新增字段
          keywordMatchMode: pushConfig.keywordMatchMode ?? "fuzzy",
          blacklistMatchMode: pushConfig.blacklistMatchMode ?? "fuzzy",
          includeSearchHistory: pushConfig.includeSearchHistory ?? false,
          dedupeMinutes: pushConfig.dedupeMinutes ?? 0,
          blacklistKeywords: pushConfig.blacklistKeywords ?? null,
          filterBots: pushConfig.filterBots ?? false,
          mediaOnly: pushConfig.mediaOnly ?? false,
        },
      };
    }

    return {
      accounts: accounts.map((a) => ({
        id: a.id,
        userId: a.userId,
        phone: a.phone,
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
        realId: pg.realId || null,
      })),
      // 全局刷词过滤配置
      globalAntiSpam,
      // 加群配置
      joinConfig: {
        joinEnabled: sysConfigMap["join_enabled"] !== "false",
        joinIntervalMin: parseInt(sysConfigMap["join_interval_min"] || "30", 10),
        joinIntervalMax: parseInt(sysConfigMap["join_interval_max"] || "60", 10),
        maxGroupsPerAccount: parseInt(sysConfigMap["max_groups_per_account"] || "100", 10),
      },
    };
  });
}
