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
  publicGroupKeywords,
  publicGroupJoinStatus,
  systemConfig,
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

      // 获取所有系统监控账号（管理员 userId 下的账号，供引擎使用）
      const accounts = await db
        .select()
        .from(tgAccounts)
        .where(
          and(
            eq(tgAccounts.isActive, true),
            inArray(tgAccounts.accountRole, ["monitor", "sender", "both"])  // sender 账号也需要加载到引擎以发送私信
          )
        );

      // 新模式：获取所有有关键词或推送设置的用户（不依赖 tgAccounts）
      const allUsersWithKeywords = await db
        .selectDistinct({ userId: keywords.userId })
        .from(keywords)
        .where(eq(keywords.isActive, true));
      const allUsersWithPush = await db
        .selectDistinct({ userId: pushSettings.userId })
        .from(pushSettings);
      const allUserIdSet = new Set<number>();
      allUsersWithKeywords.forEach(r => allUserIdSet.add(r.userId));
      allUsersWithPush.forEach(r => allUserIdSet.add(r.userId));
      const userIds: number[] = Array.from(allUserIdSet);
      const userConfigs: Record<string, any> = {};

      for (const userId of userIds) {
        // 新模式：获取该用户的全局关键词（不绑定特定群组）
        const kws = await db
          .select()
          .from(keywords)
          .where(and(eq(keywords.userId, userId), eq(keywords.isActive, true)));
        const globalKeywords = kws.map((k) => ({
          id: k.id,
          pattern: k.keyword,
          matchType: k.matchType,
          subKeywords: Array.isArray(k.subKeywords) ? k.subKeywords : [],
          caseSensitive: k.caseSensitive,
          isActive: k.isActive,
        }));

        // 兼容旧模式：也获取私有监控群组（如果有的话）
        const groups = await db
          .select()
          .from(monitorGroups)
          .where(and(eq(monitorGroups.userId, userId), eq(monitorGroups.isActive, true)));
        const groupsWithKeywords = groups.map((group) => ({
          ...group,
          keywords: globalKeywords,
        }));

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
        // 优先使用绑定的推送群组 ID，没有群组时才用个人 TG ID
        const collaborationGroupId = pushConfig.collaborationGroupId || null;
        const botChatId = collaborationGroupId || userRow[0]?.tgUserId || null;

        userConfigs[String(userId)] = {
          botChatId,
          // 新模式：全局关键词（对所有公共群组生效）
          globalKeywords,
          // 兼容旧模式：私有监控群组
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

      // 获取公共监控群组（新模式：不含独立关键词，由每个会员的全局关键词匹配）
      const publicGroups = await db
        .select()
        .from(publicMonitorGroups)
        .where(eq(publicMonitorGroups.isActive, true))
        .orderBy(publicMonitorGroups.id);

      const publicGroupsList = publicGroups.map((g) => ({
        id: g.id,
        groupId: g.groupId,
        username: g.groupId,         // 引擎用 username 字段做 real_ids 映射，groupId 即为 @username
        groupTitle: g.groupTitle,
        groupType: g.groupType,
        memberCount: g.memberCount,
        isActive: g.isActive,
        realId: g.realId || null,   // TG 真实数字 ID（引擎首次解析后回写）
      }));

      // 获取全局反垃圾配置（从 system_config 表读取）
      const sysConfigRows = await db.select().from(systemConfig);
      const sysConfigMap: Record<string, string> = {};
      for (const row of sysConfigRows) {
        sysConfigMap[row.configKey] = row.configValue || "";
      }
      const globalAntiSpam = {
        enabled: sysConfigMap["anti_spam_enabled"] !== "false",
        dailyLimit: parseInt(sysConfigMap["anti_spam_daily_limit"] || "100", 10),
        rateWindow: parseInt(sysConfigMap["anti_spam_rate_window"] || "0", 10),
        rateLimit: parseInt(sysConfigMap["anti_spam_rate_limit"] || "1000", 10),
        minMsgLen: parseInt(sysConfigMap["anti_spam_min_msg_len"] || "0", 10),
        maxMsgLen: parseInt(sysConfigMap["anti_spam_max_msg_len"] || "0", 10),
        // 全局消息过滤字段（与前端 Antiban 页面 global_* 配置对应）
        globalMaxMsgLen: parseInt(sysConfigMap["global_max_msg_length"] || "0", 10),
        filterBot: sysConfigMap["global_filter_bot"] !== "false",
        filterAds: sysConfigMap["global_filter_ads"] === "true",
        globalRateWindow: parseInt(sysConfigMap["global_rate_window"] || "0", 10),
        globalRateLimit: parseInt(sysConfigMap["global_rate_limit"] || "0", 10),
      };

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
        // 新模式：公共群组列表（引擎用每个会员的 globalKeywords 匹配这些群组的消息）
        publicGroups: publicGroupsList,
        // 全局反垃圾配置
        globalAntiSpam,
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
      // 兼容引擎发送的两种字段格式：matchedKeyword（单个）和 matchedKeywords（数组）
      const matchedKeywordStr = Array.isArray(input.matchedKeywords)
        ? input.matchedKeywords.join(", ")
        : (input.matchedKeyword || "");

      // 根据 tgGroupId 关联 public_monitor_groups 表查出正确的 monitorGroupId
      // 引擎上报的 tgGroupId 可能是 @username、数字 ID 或 -100xxxxx 格式
      let resolvedMonitorGroupId = 0;
      const tgGroupId = input.tgGroupId || input.groupId || "";
      if (tgGroupId) {
        // 标准化 groupId：去掉 @ 前缀，或保留数字 ID
        const normalizedGroupId = String(tgGroupId).replace(/^@/, "");
        // 先尝试精确匹配 groupId 字段（@username 或数字 ID）
        const groupRows = await db
          .select({ id: publicMonitorGroups.id })
          .from(publicMonitorGroups)
          .where(eq(publicMonitorGroups.groupId, normalizedGroupId))
          .limit(1);
        if (groupRows.length > 0) {
          resolvedMonitorGroupId = groupRows[0].id;
        } else {
          // 尝试通过 realId 字段匹配（引擎回写的 TG 真实数字 ID）
          const groupByRealId = await db
            .select({ id: publicMonitorGroups.id })
            .from(publicMonitorGroups)
            .where(eq(publicMonitorGroups.realId, normalizedGroupId))
            .limit(1);
          if (groupByRealId.length > 0) {
            resolvedMonitorGroupId = groupByRealId[0].id;
          }
        }
      }

      const result = await db.insert(hitRecords).values({
        userId: input.userId,
        tgAccountId: input.monitorAccountId || input.accountId || 0,
        monitorGroupId: resolvedMonitorGroupId,
        keywordId: input.keywordId || 0,
        senderTgId: input.senderTgId,
        senderUsername: input.senderUsername || null,
        senderFirstName: input.senderName || null,
        messageContent: input.messageContent || input.messageText || null,
        matchedKeyword: matchedKeywordStr,
        messageId: input.messageId ? String(input.messageId) : null,
        dmStatus: "pending",
        messageDate: new Date(),
      });

      res.json({ success: true, id: Number(result[0].insertId) });
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

  // POST /api/engine/public-group/join-status - 上报监控账号加入公共群组的状态
  app.post("/api/engine/public-group/join-status", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const db = await getDb();
      if (!db) return res.status(500).json({ error: "DB unavailable" });

      const { publicGroupId, monitorAccountId, status, errorMsg, realId } = req.body;
      if (!publicGroupId || !monitorAccountId) {
        return res.status(400).json({ error: "publicGroupId and monitorAccountId are required" });
      }

      // upsert: 先尝试 INSERT，冲突时改为 UPDATE（避免并发竞态条件）
      const now = new Date();
      try {
        await db.insert(publicGroupJoinStatus).values({
          publicGroupId,
          monitorAccountId,
          status: status || "joined",
          errorMsg: errorMsg || null,
          joinedAt: status === "joined" ? now : null,
        });
      } catch (insertErr: any) {
        // 主键/唯一键冲突时改为 UPDATE
        if (insertErr?.code === 'ER_DUP_ENTRY' || insertErr?.errno === 1062) {
          await db
            .update(publicGroupJoinStatus)
            .set({
              status: status || "joined",
              errorMsg: errorMsg || null,
              ...(status === "joined" ? { joinedAt: now } : {}),
              updatedAt: now,
            })
            .where(
              and(
                eq(publicGroupJoinStatus.publicGroupId, publicGroupId),
                eq(publicGroupJoinStatus.monitorAccountId, monitorAccountId)
              )
            );
        } else {
          throw insertErr;
        }
      }

      // 如果引擎上报了 realId，回写到 publicMonitorGroups 表（仅当 status=joined 且 realId 不为空时）
      if (status === "joined" && realId) {
        try {
          await db
            .update(publicMonitorGroups)
            .set({ realId: String(realId) })
            .where(eq(publicMonitorGroups.id, publicGroupId));
        } catch (updateErr) {
          // 回写失败不影响主流程
          console.warn("[Engine API] 回写 realId 失败:", updateErr);
        }
      }

      res.json({ success: true });
    } catch (e: any) {
      console.error("[Engine API] public-group/join-status error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // ── 群组采集相关接口 ──────────────────────────────────────────────────────────

  // GET /api/engine/scrape-tasks - 获取待执行的采集任务（status=pending）
  app.get("/api/engine/scrape-tasks", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const db = await getDb();
      if (!db) return res.status(500).json({ error: "DB unavailable" });
      const { groupScrapeTasks } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const tasks = await db.select().from(groupScrapeTasks)
        .where(eq(groupScrapeTasks.status, "pending"));
      // 将 keywords JSON 字符串解析为数组
      const result = tasks.map((t: any) => ({
        ...t,
        keywords: JSON.parse(t.keywords || "[]"),
      }));
      res.json(result);
    } catch (e: any) {
      console.error("[Engine API] scrape-tasks error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/engine/scrape-task/:id/start - 标记任务开始执行
  app.post("/api/engine/scrape-task/:id/start", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const db = await getDb();
      if (!db) return res.status(500).json({ error: "DB unavailable" });
      const { groupScrapeTasks } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const taskId = parseInt(req.params.id);
      await db.update(groupScrapeTasks)
        .set({ status: "running", lastRunAt: new Date() })
        .where(eq(groupScrapeTasks.id, taskId));
      res.json({ success: true });
    } catch (e: any) {
      console.error("[Engine API] scrape-task/start error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/engine/scrape-task/:id/finish - 标记任务完成并写入结果
  app.post("/api/engine/scrape-task/:id/finish", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const db = await getDb();
      if (!db) return res.status(500).json({ error: "DB unavailable" });
      const { groupScrapeTasks, groupScrapeResults } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const taskId = parseInt(req.params.id);
      const { status, results } = req.body as {
        status: "done" | "failed";
        results: Array<{
          keyword: string;
          groupId: string;
          groupTitle?: string;
          groupType?: string;
          memberCount?: number;
          description?: string;
          username?: string;
          realId?: string;
        }>;
      };

      // 批量写入采集结果（忽略重复）
      let insertedCount = 0;
      if (results && results.length > 0) {
        for (const r of results) {
          try {
            await db.insert(groupScrapeResults).ignore().values({
              taskId,
              keyword: r.keyword,
              groupId: r.groupId,
              groupTitle: r.groupTitle || null,
              groupType: r.groupType || "group",
              memberCount: r.memberCount || 0,
              description: r.description || null,
              username: r.username || null,
              realId: r.realId || null,
              importStatus: "pending",
            });
            insertedCount++;
          } catch (insertErr) {
            // 重复记录忽略
          }
        }
      }

      // 更新任务状态
      await db.update(groupScrapeTasks)
        .set({
          status: status || "done",
          totalFound: insertedCount,
        })
        .where(eq(groupScrapeTasks.id, taskId));

      res.json({ success: true, insertedCount });
    } catch (e: any) {
      console.error("[Engine API] scrape-task/finish error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/engine/update-user-tgid - 直接更新用户的 tgUserId（管理员操作）
  app.post("/api/engine/update-user-tgid", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const db = await getDb();
      if (!db) return res.status(500).json({ error: "DB unavailable" });
      const { userId, tgUserId, tgUsername } = req.body;
      if (!userId || !tgUserId) {
        return res.status(400).json({ error: "userId and tgUserId are required" });
      }
      // 先清除其他用户的相同 tgUserId
      await db.update(users).set({ tgUserId: null, tgUsername: null })
        .where(and(eq(users.tgUserId, String(tgUserId)), sql`id != ${userId}`));
      // 更新目标用户
      await db.update(users).set({
        tgUserId: String(tgUserId),
        tgUsername: tgUsername || null,
      }).where(eq(users.id, Number(userId)));
      res.json({ success: true, userId, tgUserId });
    } catch (e: any) {
      console.error("[Engine API] update-user-tgid error:", e);
      res.status(500).json({ error: e.message });
    }
  });
}
