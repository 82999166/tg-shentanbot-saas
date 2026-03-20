/**
 * 引擎 REST API 代理层
 * 将 /api/engine/* 的 REST 请求转发到对应的 tRPC 调用
 * 供 Python 监控引擎通过标准 HTTP 调用
 */
import { Router, Request, Response } from "express";
import { getDb } from "./db";
import {
  tgAccounts,
  monitorGroups,
  keywords,
  antibanSettings,
  hitRecords,
  dmQueue,
  messageTemplates,
  blacklist,
  senderHistory,
  keywordDailyStats,
  pushSettings,
  users,
  publicMonitorGroups,
} from "../drizzle/schema";
import { eq, and, inArray, sql } from "drizzle-orm";

const ENGINE_SECRET = process.env.ENGINE_SECRET || "tg-monitor-engine-secret";

function checkSecret(req: Request, res: Response): boolean {
  const secret = req.headers["x-engine-secret"];
  if (secret !== ENGINE_SECRET) {
    res.status(401).json({ error: "Invalid engine secret" });
    return false;
  }
  return true;
}

export function registerEngineRestRoutes(app: Router) {
  // GET /api/engine/config - 获取完整监控配置
  app.get("/api/engine/config", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const db = await getDb();
      if (!db) return res.json({ accounts: [], userConfigs: {} });

      const accounts = await db
        .select()
        .from(tgAccounts)
        .where(
          and(
            eq(tgAccounts.isActive, true),
            inArray(tgAccounts.accountRole, ["monitor", "both"])
          )
        );

      const userIdArr = accounts.map((a) => a.userId);
      const userIds: number[] = userIdArr.filter((v, i, arr) => arr.indexOf(v) === i);
      const userConfigs: Record<string, any> = {};

      for (const userId of userIds) {
        const groups = await db
          .select()
          .from(monitorGroups)
          .where(and(eq(monitorGroups.userId, userId), eq(monitorGroups.isActive, true)));

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

        const templates = await db
          .select()
          .from(messageTemplates)
          .where(and(eq(messageTemplates.userId, userId), eq(messageTemplates.isActive, true)));

        const antiban = await db
          .select()
          .from(antibanSettings)
          .where(eq(antibanSettings.userId, userId))
          .limit(1);

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

        // 获取屏蔽列表
        const blockedList = await db
          .select()
          .from(blacklist)
          .where(eq(blacklist.userId, userId));

        // 获取推送设置
        const pushSettingsRows = await db
          .select()
          .from(pushSettings)
          .where(eq(pushSettings.userId, userId))
          .limit(1);
        const pushConfig = pushSettingsRows[0] || {};

        // 获取用户的 tgUserId（用于 Bot 推送命中通知）
        const userRow = await db.select({ tgUserId: users.tgUserId }).from(users)
          .where(eq(users.id, userId)).limit(1);
        const botChatId = userRow[0]?.tgUserId || null;

        userConfigs[String(userId)] = {
          botChatId,
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
          blockedTgIds: blockedList.map((b) => b.targetTgId).filter(Boolean),
          pushSettings: {
            pushEnabled: pushConfig.pushEnabled ?? true,
            filterAds: pushConfig.filterAds ?? false,
            collabChatId: pushConfig.collaborationGroupId ?? null,
          },
        };
      }

      // 获取公共监控群组
      const publicGroups = await db
        .select()
        .from(publicMonitorGroups)
        .where(eq(publicMonitorGroups.isActive, true));

      return res.json({
        accounts: accounts.map((a) => ({
          id: a.id,
          userId: a.userId,
          sessionString: a.sessionString,
          isActive: a.isActive,
          role: a.accountRole,
          status: a.sessionStatus,
        })),
        userConfigs,
        publicGroups: publicGroups.map((g) => ({
          id: g.id,
          groupId: g.groupId,
          groupTitle: g.groupTitle,
          groupType: g.groupType,
        })),
      });
    } catch (e: any) {
      console.error("[Engine API] config error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/engine/hit - 上报命中记录
  app.post("/api/engine/hit", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const db = await getDb();
      if (!db) return res.status(500).json({ error: "DB unavailable" });

      const input = req.body;
      await db.insert(hitRecords).values({
        userId: input.userId,
        tgAccountId: input.monitorAccountId,
        monitorGroupId: 0,
        keywordId: 0,
        senderTgId: input.senderTgId,
        senderUsername: input.senderUsername || null,
        senderFirstName: input.senderName || null,
        messageContent: input.messageText,
        matchedKeyword: (input.matchedKeywords || []).join(", "),
        messageId: input.messageId || null,
        dmStatus: "pending",
        messageDate: new Date(),
      });

      res.json({ success: true });
    } catch (e: any) {
      console.error("[Engine API] hit error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/engine/dm-queue - 获取待发私信队列
  app.get("/api/engine/dm-queue", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const db = await getDb();
      if (!db) return res.json({ items: [] });

      const limit = parseInt(req.query.limit as string) || 5;
      const items = await db
        .select()
        .from(dmQueue)
        .where(eq(dmQueue.status, "pending"))
        .orderBy(dmQueue.createdAt)
        .limit(limit);

      res.json({ items });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/engine/dm-queue/success
  app.post("/api/engine/dm-queue/success", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const db = await getDb();
      if (!db) return res.status(500).json({ error: "DB unavailable" });

      const { id } = req.body;
      const queueItem = await db.select().from(dmQueue).where(eq(dmQueue.id, id)).limit(1);

      await db.update(dmQueue).set({ status: "sent", sentAt: new Date() }).where(eq(dmQueue.id, id));

      if (queueItem[0]?.hitRecordId) {
        await db.update(hitRecords).set({ dmStatus: "sent" }).where(eq(hitRecords.id, queueItem[0].hitRecordId));
      }
      if (queueItem[0]?.senderAccountId) {
        await db.update(tgAccounts).set({ dailyDmSent: sql`${tgAccounts.dailyDmSent} + 1` }).where(eq(tgAccounts.id, queueItem[0].senderAccountId));
      }

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/engine/dm-queue/fail
  app.post("/api/engine/dm-queue/fail", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const db = await getDb();
      if (!db) return res.status(500).json({ error: "DB unavailable" });

      const { id, error } = req.body;
      await db.update(dmQueue).set({ status: "failed", errorMessage: error }).where(eq(dmQueue.id, id));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/engine/dm-queue/retry
  app.post("/api/engine/dm-queue/retry", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const db = await getDb();
      if (!db) return res.status(500).json({ error: "DB unavailable" });

      const { id, retryAfter } = req.body;
      const retryAt = new Date(Date.now() + retryAfter * 1000);
      await db.update(dmQueue).set({ status: "pending", scheduledAt: retryAt }).where(eq(dmQueue.id, id));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/engine/dm-queue/add
  app.post("/api/engine/dm-queue/add", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const db = await getDb();
      if (!db) return res.status(500).json({ error: "DB unavailable" });

      const input = req.body;
      const existing = await db
        .select()
        .from(dmQueue)
        .where(and(eq(dmQueue.userId, input.userId), eq(dmQueue.targetTgId, input.targetTgId), eq(dmQueue.status, "sent")))
        .limit(1);

      if (existing.length > 0) {
        const lastSent = existing[0].sentAt;
        if (lastSent && Date.now() - lastSent.getTime() < 24 * 3600 * 1000) {
          return res.json({ success: false, reason: "already_sent" });
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

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/engine/account/health
  app.post("/api/engine/account/health", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const db = await getDb();
      if (!db) return res.status(500).json({ error: "DB unavailable" });

      const { accountId, delta, status } = req.body;
      const updates: Record<string, any> = {
        healthScore: sql`GREATEST(0, LEAST(100, ${tgAccounts.healthScore} + ${delta}))`,
        lastActiveAt: new Date(),
      };
      if (status) updates.healthStatus = status;

      await db.update(tgAccounts).set(updates).where(eq(tgAccounts.id, accountId));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/engine/account/status
  app.post("/api/engine/account/status", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const db = await getDb();
      if (!db) return res.status(500).json({ error: "DB unavailable" });

      const { accountId, status, tgUserId, tgUsername } = req.body;
      const updates: Record<string, any> = { sessionStatus: status, lastActiveAt: new Date() };
      if (tgUserId) updates.tgUserId = tgUserId;
      if (tgUsername !== undefined) updates.tgUsername = tgUsername;

      await db.update(tgAccounts).set(updates).where(eq(tgAccounts.id, accountId));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/engine/sender-history - 写入发送者历史记录
  app.post("/api/engine/sender-history", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const db = await getDb();
      if (!db) return res.status(500).json({ error: "DB unavailable" });

      const input = req.body;
      await db.insert(senderHistory).values({
        userId: input.userId,
        senderTgId: input.senderTgId,
        senderUsername: input.senderUsername || null,
        senderFirstName: input.senderName || null,
        groupId: input.tgGroupId,
        groupTitle: input.groupName || null,
        messageContent: input.messageContent || null,
        messageDate: new Date(),
      });

      res.json({ success: true });
    } catch (e: any) {
      console.error("[Engine API] sender-history error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/engine/keyword-stat - 写入关键词命中统计
  app.post("/api/engine/keyword-stat", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const db = await getDb();
      if (!db) return res.status(500).json({ error: "DB unavailable" });

      const input = req.body;
      const today = new Date();
      const dateStr = today.toISOString().slice(0, 10); // YYYY-MM-DD

      // upsert: 如果当天已有记录则 +1，否则新建
      const existing = await db
        .select()
        .from(keywordDailyStats)
        .where(
          and(
            eq(keywordDailyStats.userId, input.userId),
            eq(keywordDailyStats.keywordId, input.keywordId),
            eq(keywordDailyStats.date, dateStr)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(keywordDailyStats)
          .set({ hitCount: sql`${keywordDailyStats.hitCount} + 1` })
          .where(eq(keywordDailyStats.id, existing[0].id));
      } else {
        await db.insert(keywordDailyStats).values({
          userId: input.userId,
          keywordId: input.keywordId,
          date: dateStr,
          hitCount: 1,
          uniqueSenders: 1,
        });
      }

      res.json({ success: true });
    } catch (e: any) {
      console.error("[Engine API] keyword-stat error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/engine/heartbeat
  app.post("/api/engine/heartbeat", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    res.json({ success: true, serverTime: Date.now() });
  });
}
