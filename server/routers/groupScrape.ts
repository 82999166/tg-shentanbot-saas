/**
 * 群组采集路由 v3
 * - Tab1: 关键词采集（任务管理 + 结果审核 + AI评分）
 * - Tab2: 指定群组采集（批次管理，去任务依赖，全局去重，AI标签）
 * - Tab3: 消息提取链接（工具，AI过滤）
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { publicProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  groupScrapeTasks,
  groupScrapeResults,
  publicMonitorGroups,
  tgAccounts,
  scrapeCollectedGroups,
  scrapeCollectedUsers,
  scrapeBatches,
} from "../../drizzle/schema";
import { eq, desc, and, inArray, sql, like, or, isNull, isNotNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

// ── 管理员鉴权
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user?.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "仅管理员可操作" });
  }
  return next({ ctx });
});

// ══════════════════════════════════════════════════════════════════
// AI 标签引擎
// ══════════════════════════════════════════════════════════════════

// 广告词库（用于识别广告用户）
const AD_KEYWORDS = ["卖", "出", "代", "收", "USDT", "U", "搬砖", "兼职", "赚钱", "招募", "加群", "拉人", "广告", "推广", "引流"];

function calcGroupAiScore(g: {
  memberCount?: number;
  username?: string;
  title?: string;
  description?: string;
  type?: string;
}): { score: number; detail: Record<string, number> } {
  const detail: Record<string, number> = {};

  // 1. 成员数量（25分）
  const mc = g.memberCount ?? 0;
  let memberScore = 0;
  if (mc >= 50000) memberScore = 25;
  else if (mc >= 10000) memberScore = 22;
  else if (mc >= 5000) memberScore = 18;
  else if (mc >= 1000) memberScore = 14;
  else if (mc >= 500) memberScore = 10;
  else if (mc >= 100) memberScore = 6;
  else memberScore = 2;
  detail.memberCount = memberScore;

  // 2. 有 username（20分）
  detail.hasUsername = (g.username && g.username.trim().length > 0) ? 20 : 0;

  // 3. 标题质量（20分）
  const title = g.title || "";
  let titleScore = 0;
  if (title.length >= 2) titleScore += 8;
  if (title.length >= 5) titleScore += 6;
  if (!/^\d+$/.test(title)) titleScore += 6;
  detail.titleQuality = Math.min(titleScore, 20);

  // 4. 有描述（20分）
  const desc = g.description || "";
  let descScore = 0;
  if (desc.length >= 10) descScore += 10;
  if (desc.length >= 50) descScore += 10;
  detail.hasDescription = descScore;

  // 5. 类型加成（15分）
  detail.typeBonus = g.type === "channel" ? 10 : 5;

  const total = Object.values(detail).reduce((a, b) => a + b, 0);
  return { score: Math.min(Math.round(total), 100), detail };
}

function calcGroupTags(g: {
  memberCount?: number;
  username?: string;
  description?: string;
  type?: string;
  aiScore?: number;
  botRatio?: number;
  activeScore?: number;
}): string[] {
  const tags: string[] = [];
  const mc = g.memberCount ?? 0;
  const score = g.aiScore ?? 0;

  // 类型
  if (g.type === "channel") tags.push("频道");
  else tags.push("群组");

  // 公开/私有
  if (g.username) tags.push("公开");
  else tags.push("私有");

  // 规模
  if (mc >= 10000) tags.push("大群");
  else if (mc >= 1000) tags.push("中群");
  else if (mc < 100) tags.push("小群");

  // 活跃度
  if ((g.activeScore ?? 0) >= 70) tags.push("活跃");
  else if ((g.activeScore ?? 0) < 20 && mc < 100) tags.push("僵尸群");

  // 机器人占比
  if ((g.botRatio ?? 0) > 0.3) tags.push("机器人多");

  // 内容类型（基于描述关键词）
  const desc = (g.description || "").toLowerCase();
  if (/资源|下载|网盘|分享/.test(desc)) tags.push("资源群");
  if (/广告|推广|引流/.test(desc)) tags.push("广告群");

  // AI评分
  if (score >= 80) tags.push("优质");
  else if (score < 40) tags.push("低质");

  return tags;
}

function calcUserAiScore(u: {
  username?: string;
  displayName?: string;
  isBot?: boolean;
  isPremium?: boolean;
  messageCount?: number;
}): number {
  let score = 50;
  if (u.username && u.username.trim().length > 0) score += 25;
  if (u.isPremium) score += 15;
  if (u.isBot) score -= 30;
  const name = u.displayName || "";
  if (name.length >= 2 && !/^\d+$/.test(name)) score += 10;
  if ((u.messageCount ?? 0) > 0) score += 5; // 有发言记录加分
  return Math.max(0, Math.min(score, 100));
}

function calcUserTags(u: {
  username?: string;
  displayName?: string;
  isBot?: boolean;
  isPremium?: boolean;
  messageCount?: number;
  aiScore?: number;
}): string[] {
  const tags: string[] = [];
  const name = u.displayName || "";
  const score = u.aiScore ?? 0;

  if (u.isBot) {
    tags.push("机器人");
    return tags; // 机器人直接返回
  }

  if (u.isPremium) tags.push("Premium");

  // 活跃度
  if ((u.messageCount ?? 0) > 0) tags.push("活跃用户");
  else tags.push("沉默用户");

  // 用户名
  if (u.username) tags.push("有用户名");

  // 语言判断（简单启发式）
  const hasChinese = /[\u4e00-\u9fff]/.test(name);
  const hasLatin = /[a-zA-Z]/.test(name);
  if (hasChinese) tags.push("中文用户");
  else if (hasLatin) tags.push("海外用户");

  // 广告号识别
  const isAd = AD_KEYWORDS.some(kw => name.includes(kw) || (u.username || "").includes(kw));
  if (isAd) tags.push("疑似广告");

  // AI评分
  if (score >= 80) tags.push("高质量");
  else if (score < 40) tags.push("低质量");

  return tags;
}

// ══════════════════════════════════════════════════════════════════
// 引擎调用
// ══════════════════════════════════════════════════════════════════

async function fetchMembersFromEngine(
  accountId: number,
  group: string,
  limit: number
): Promise<Array<{ tgId: string; username?: string; displayName?: string; isBot?: boolean; isPremium?: boolean; messageCount?: number }>> {
  const engineSecret = process.env.ENGINE_SECRET || "shentanbot-engine-secret-2026";
  const engineHttpPortBase = parseInt(process.env.ENGINE_HTTP_PORT_BASE || "7100", 10);
  const port = engineHttpPortBase + accountId;
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/scrape-members`, {
      method: "POST",
      headers: { "X-Engine-Secret": engineSecret, "Content-Type": "application/json" },
      body: JSON.stringify({ group, limit }),
      // @ts-ignore
      signal: AbortSignal.timeout(120000),
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as any;
    return data.members ?? [];
  } catch {
    return [];
  }
}

async function fetchLinksFromEngine(
  accountId: number,
  group: string,
  limit: number
): Promise<Array<{ tgId?: string; username?: string; title?: string; memberCount?: number; description?: string; type?: string }>> {
  const engineSecret = process.env.ENGINE_SECRET || "shentanbot-engine-secret-2026";
  const engineHttpPortBase = parseInt(process.env.ENGINE_HTTP_PORT_BASE || "7100", 10);
  const port = engineHttpPortBase + accountId;
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/scrape-links`, {
      method: "POST",
      headers: { "X-Engine-Secret": engineSecret, "Content-Type": "application/json" },
      body: JSON.stringify({ group, limit }),
      // @ts-ignore
      signal: AbortSignal.timeout(120000),
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as any;
    return data.results ?? [];
  } catch {
    return [];
  }
}

async function getAvailableAccountId(): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const accounts = await db
    .select({ id: tgAccounts.id })
    .from(tgAccounts)
    .where(eq(tgAccounts.isActive, true))
    .limit(1);
  return accounts[0]?.id ?? null;
}

// ══════════════════════════════════════════════════════════════════
// 路由定义
// ══════════════════════════════════════════════════════════════════

export const groupScrapeRouter = router({

  // ════════════════════════════════════════════════════════════════
  // Tab1: 关键词采集任务管理
  // ════════════════════════════════════════════════════════════════

  createTask: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(128),
      keywords: z.array(z.string().min(1)).min(1),
      minMemberCount: z.number().int().min(0).default(1000),
      maxResults: z.number().int().min(1).max(500).default(50),
      fissionEnabled: z.boolean().default(false),
      fissionDepth: z.number().int().min(1).max(3).default(1),
      fissionMaxPerSeed: z.number().int().min(1).max(50).default(10),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [task] = await db.insert(groupScrapeTasks).values({
        name: input.name,
        keywords: JSON.stringify(input.keywords),
        minMemberCount: input.minMemberCount,
        maxResults: input.maxResults,
        fissionEnabled: input.fissionEnabled ?? false,
        fissionDepth: input.fissionDepth ?? 1,
        fissionMaxPerSeed: input.fissionMaxPerSeed ?? 10,
        status: "idle",
        scrapeMode: "keyword",
      }).$returningId();
      return { id: task.id };
    }),

  updateTask: adminProcedure
    .input(z.object({
      id: z.number().int(),
      name: z.string().min(1).max(128).optional(),
      keywords: z.array(z.string().min(1)).min(1).optional(),
      minMemberCount: z.number().int().min(0).optional(),
      maxResults: z.number().int().min(1).max(500).optional(),
      fissionEnabled: z.boolean().optional(),
      fissionDepth: z.number().int().min(1).max(3).optional(),
      fissionMaxPerSeed: z.number().int().min(1).max(50).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const updates: Record<string, any> = {};
      if (input.name !== undefined) updates.name = input.name;
      if (input.keywords !== undefined) updates.keywords = JSON.stringify(input.keywords);
      if (input.minMemberCount !== undefined) updates.minMemberCount = input.minMemberCount;
      if (input.maxResults !== undefined) updates.maxResults = input.maxResults;
      if (input.fissionEnabled !== undefined) updates.fissionEnabled = input.fissionEnabled;
      if (input.fissionDepth !== undefined) updates.fissionDepth = input.fissionDepth;
      if (input.fissionMaxPerSeed !== undefined) updates.fissionMaxPerSeed = input.fissionMaxPerSeed;
      await db.update(groupScrapeTasks).set(updates).where(eq(groupScrapeTasks.id, input.id));
      return { success: true };
    }),

  deleteTask: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db.delete(groupScrapeResults).where(eq(groupScrapeResults.taskId, input.id));
      await db.delete(groupScrapeTasks).where(eq(groupScrapeTasks.id, input.id));
      return { success: true };
    }),

  triggerTask: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [task] = await db.select().from(groupScrapeTasks).where(eq(groupScrapeTasks.id, input.id));
      if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
      if (task.status === "running") throw new TRPCError({ code: "BAD_REQUEST", message: "任务正在运行中" });
      await db.update(groupScrapeTasks).set({ status: "pending" }).where(eq(groupScrapeTasks.id, input.id));
      return { success: true };
    }),

  listTasks: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    const tasks = await db.select().from(groupScrapeTasks).orderBy(desc(groupScrapeTasks.createdAt));
    return tasks.map((t) => ({
      ...t,
      keywords: JSON.parse(t.keywords || "[]") as string[],
    }));
  }),

  listResults: adminProcedure
    .input(z.object({
      taskId: z.number().int().optional(),
      importStatus: z.enum(["pending", "imported", "ignored", "all"]).default("all"),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions = [];
      if (input.taskId) conditions.push(eq(groupScrapeResults.taskId, input.taskId));
      if (input.importStatus !== "all") conditions.push(eq(groupScrapeResults.importStatus, input.importStatus));

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
      const offset = (input.page - 1) * input.pageSize;

      const [results, countResult] = await Promise.all([
        db.select().from(groupScrapeResults)
          .where(whereClause)
          .orderBy(desc(groupScrapeResults.memberCount))
          .limit(input.pageSize)
          .offset(offset),
        db.select({ count: sql<number>`count(*)` }).from(groupScrapeResults).where(whereClause),
      ]);

      return {
        items: results.map(r => ({
          ...r,
          tags: r.tags ? JSON.parse(r.tags as any) : [],
        })),
        total: Number(countResult[0]?.count || 0),
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  importToPublicPool: adminProcedure
    .input(z.object({ resultIds: z.array(z.number().int()).min(1) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const results = await db.select().from(groupScrapeResults)
        .where(inArray(groupScrapeResults.id, input.resultIds));

      let importedCount = 0;
      let skippedCount = 0;

      for (const r of results) {
        try {
          const existing = await db.select({ id: publicMonitorGroups.id })
            .from(publicMonitorGroups)
            .where(eq(publicMonitorGroups.groupId, r.groupId));

          if (existing.length === 0) {
            await db.insert(publicMonitorGroups).values({
              groupId: r.groupId,
              groupTitle: r.groupTitle || r.groupId,
              groupType: r.groupType || "group",
              memberCount: r.memberCount || 0,
              isActive: true,
              realId: r.realId || null,
              note: `关键词采集导入 - ${r.keyword}${r.aiScore ? ` AI:${r.aiScore}` : ""}`,
            });
            importedCount++;
          } else {
            skippedCount++;
          }

          await db.update(groupScrapeResults)
            .set({ importStatus: "imported", importedAt: new Date() })
            .where(eq(groupScrapeResults.id, r.id));
        } catch (e) {
          console.error(`[groupScrape] 导入 ${r.groupId} 失败:`, e);
        }
      }

      return { importedCount, skippedCount };
    }),

  ignoreResults: adminProcedure
    .input(z.object({ resultIds: z.array(z.number().int()).min(1) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db.update(groupScrapeResults)
        .set({ importStatus: "ignored" })
        .where(inArray(groupScrapeResults.id, input.resultIds));
      return { success: true };
    }),

  clearResults: adminProcedure
    .input(z.object({ taskId: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db.delete(groupScrapeResults).where(eq(groupScrapeResults.taskId, input.taskId));
      await db.update(groupScrapeTasks)
        .set({ totalFound: 0, status: "idle" })
        .where(eq(groupScrapeTasks.id, input.taskId));
      return { success: true };
    }),

  // ════════════════════════════════════════════════════════════════
  // Tab2: 指定群组采集（批次管理，无任务依赖）
  // ════════════════════════════════════════════════════════════════

  // 执行指定群组采集（创建批次，采集，AI标签，全局去重）
  runTargetScrape: adminProcedure
    .input(z.object({
      targetGroups: z.array(z.string().min(1)).min(1).max(50),
      collectTypes: z.string().default("group,channel,user"),
      userLimit: z.number().int().min(1).max(2000).default(500),
      // AI 评分参数
      aiScoreEnabled: z.boolean().default(true),
      aiMinScore: z.number().min(0).max(100).default(60),
      aiMinMembers: z.number().int().min(0).default(0),
      aiRequireUsername: z.boolean().default(false),
      aiRequireDescription: z.boolean().default(false),
      aiFilterBots: z.boolean().default(true),
      aiFilterAds: z.boolean().default(true),
      aiMinActivity: z.number().min(0).max(100).default(0),
      accountId: z.number().int().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // 确定账号
      let accountId = input.accountId;
      if (!accountId) accountId = await getAvailableAccountId();
      if (!accountId) throw new TRPCError({ code: "BAD_REQUEST", message: "没有可用的 TG 账号" });

      const collectTypes = input.collectTypes.split(",").map(s => s.trim());
      const collectGroups = collectTypes.includes("group");
      const collectChannels = collectTypes.includes("channel");
      const collectUsers = collectTypes.includes("user");

      // 生成批次 key
      const batchKey = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      // 创建批次记录
      const [batchRow] = await db.insert(scrapeBatches).values({
        batchKey,
        scrapeMode: "target",
        sourceGroups: JSON.stringify(input.targetGroups),
        collectTypes: input.collectTypes,
        accountId,
        totalGroups: 0,
        totalChannels: 0,
        totalUsers: 0,
      }).$returningId();
      const batchId = batchRow.id;

      let totalGroupsSaved = 0;
      let totalChannelsSaved = 0;
      let totalUsersSaved = 0;
      let totalSkipped = 0;

      for (const groupTarget of input.targetGroups) {
        const normalizedGroup = groupTarget.startsWith("@") ? groupTarget : `@${groupTarget}`;

        // 采集群组/频道链接
        if (collectGroups || collectChannels) {
          const links = await fetchLinksFromEngine(accountId, normalizedGroup, 200);
          for (const link of links) {
            const linkType = link.type || "group";
            if (linkType === "group" && !collectGroups) continue;
            if (linkType === "channel" && !collectChannels) continue;

            const { score, detail } = calcGroupAiScore({
              memberCount: link.memberCount,
              username: link.username,
              title: link.title,
              description: link.description,
              type: linkType,
            });

            if (input.aiScoreEnabled && score < input.aiMinScore) continue;
            if (input.aiMinMembers > 0 && (link.memberCount ?? 0) < input.aiMinMembers) continue;
            if (input.aiRequireUsername && !link.username) continue;
            if (input.aiRequireDescription && !link.description) continue;

            const tags = calcGroupTags({
              memberCount: link.memberCount,
              username: link.username,
              description: link.description,
              type: linkType,
              aiScore: score,
            });

            const tgIdStr = link.tgId ? String(link.tgId) : null;
            if (!tgIdStr) continue;

            try {
              // 全局去重：tgId 唯一，存在则更新最新数据
              const existing = await db.select({ id: scrapeCollectedGroups.id })
                .from(scrapeCollectedGroups)
                .where(eq(scrapeCollectedGroups.tgId, tgIdStr))
                .limit(1);

              if (existing.length === 0) {
                await db.insert(scrapeCollectedGroups).values({
                  batchId,
                  sourceGroupId: normalizedGroup,
                  type: linkType,
                  tgId: tgIdStr,
                  username: link.username || null,
                  title: link.title || null,
                  memberCount: link.memberCount || 0,
                  description: link.description || null,
                  aiScore: score,
                  tags: JSON.stringify(tags),
                  aiScoreDetail: JSON.stringify(detail),
                  importStatus: "pending",
                });
                if (linkType === "channel") totalChannelsSaved++;
                else totalGroupsSaved++;
              } else {
                // 更新最新数据（成员数、标签等）
                await db.update(scrapeCollectedGroups).set({
                  batchId,
                  memberCount: link.memberCount || 0,
                  aiScore: score,
                  tags: JSON.stringify(tags),
                  aiScoreDetail: JSON.stringify(detail),
                }).where(eq(scrapeCollectedGroups.tgId, tgIdStr));
                totalSkipped++;
              }
            } catch (e: any) {
              if (!e?.message?.includes("Duplicate")) {
                console.error("[groupScrape] 插入群组失败:", e?.message);
              }
              totalSkipped++;
            }
          }
        }

        // 采集用户
        if (collectUsers) {
          const members = await fetchMembersFromEngine(accountId, normalizedGroup, input.userLimit);
          for (const member of members) {
            if (input.aiFilterBots && member.isBot) continue;
            if (input.aiFilterAds && !member.username && (!member.displayName || member.displayName.trim().length === 0)) continue;
            if (input.aiRequireUsername && !member.username) continue;

            const userScore = calcUserAiScore({
              username: member.username,
              displayName: member.displayName,
              isBot: member.isBot,
              isPremium: member.isPremium,
              messageCount: member.messageCount,
            });

            if (input.aiScoreEnabled && userScore < input.aiMinScore) continue;

            const userTags = calcUserTags({
              username: member.username,
              displayName: member.displayName,
              isBot: member.isBot,
              isPremium: member.isPremium,
              messageCount: member.messageCount,
              aiScore: userScore,
            });

            try {
              const tgIdStr = String(member.tgId);
              const existing = await db.select({ id: scrapeCollectedUsers.id })
                .from(scrapeCollectedUsers)
                .where(eq(scrapeCollectedUsers.tgId, tgIdStr))
                .limit(1);

              if (existing.length === 0) {
                await db.insert(scrapeCollectedUsers).values({
                  batchId,
                  sourceGroupId: normalizedGroup,
                  tgId: tgIdStr,
                  username: member.username || null,
                  displayName: member.displayName || null,
                  isBot: member.isBot ?? false,
                  isPremium: member.isPremium ?? false,
                  messageCount: member.messageCount ?? 0,
                  aiScore: userScore,
                  tags: JSON.stringify(userTags),
                  lastSeenGroupId: normalizedGroup,
                });
                totalUsersSaved++;
              } else {
                // 更新最新数据
                await db.update(scrapeCollectedUsers).set({
                  batchId,
                  aiScore: userScore,
                  tags: JSON.stringify(userTags),
                  lastSeenGroupId: normalizedGroup,
                  messageCount: member.messageCount ?? 0,
                }).where(eq(scrapeCollectedUsers.tgId, tgIdStr));
                totalSkipped++;
              }
            } catch (e: any) {
              if (!e?.message?.includes("Duplicate")) {
                console.error("[groupScrape] 插入用户失败:", e?.message);
              }
              totalSkipped++;
            }
          }
        }
      }

      // 更新批次统计
      await db.update(scrapeBatches).set({
        totalGroups: totalGroupsSaved,
        totalChannels: totalChannelsSaved,
        totalUsers: totalUsersSaved,
      }).where(eq(scrapeBatches.id, batchId));

      // 清理超过50个批次的旧批次（只删批次记录，保留数据）
      const allBatches = await db.select({ id: scrapeBatches.id })
        .from(scrapeBatches)
        .where(eq(scrapeBatches.scrapeMode, "target"))
        .orderBy(desc(scrapeBatches.createdAt));
      if (allBatches.length > 50) {
        const toDelete = allBatches.slice(50).map(b => b.id);
        await db.delete(scrapeBatches).where(inArray(scrapeBatches.id, toDelete));
      }

      return {
        success: true,
        batchId,
        batchKey,
        groupsSaved: totalGroupsSaved,
        channelsSaved: totalChannelsSaved,
        usersSaved: totalUsersSaved,
        skipped: totalSkipped,
      };
    }),

  // 获取批次列表
  listBatches: adminProcedure
    .input(z.object({
      scrapeMode: z.enum(["target", "extract", "all"]).default("target"),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(50).default(20),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions = [];
      if (input.scrapeMode !== "all") conditions.push(eq(scrapeBatches.scrapeMode, input.scrapeMode));
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
      const offset = (input.page - 1) * input.pageSize;

      const [items, countResult] = await Promise.all([
        db.select().from(scrapeBatches)
          .where(whereClause)
          .orderBy(desc(scrapeBatches.createdAt))
          .limit(input.pageSize)
          .offset(offset),
        db.select({ count: sql<number>`count(*)` }).from(scrapeBatches).where(whereClause),
      ]);

      return {
        items: items.map(b => ({
          ...b,
          sourceGroups: b.sourceGroups ? JSON.parse(b.sourceGroups as any) : [],
        })),
        total: Number(countResult[0]?.count || 0),
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  // 删除批次（及其数据）
  deleteBatch: adminProcedure
    .input(z.object({ batchId: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db.delete(scrapeCollectedGroups).where(eq(scrapeCollectedGroups.batchId, input.batchId));
      await db.delete(scrapeCollectedUsers).where(eq(scrapeCollectedUsers.batchId, input.batchId));
      await db.delete(scrapeBatches).where(eq(scrapeBatches.id, input.batchId));
      return { success: true };
    }),

  // 获取采集到的群组/频道列表（支持按批次、标签过滤）
  listCollectedGroups: adminProcedure
    .input(z.object({
      batchId: z.number().int().optional(),
      type: z.enum(["group", "channel", "all"]).default("all"),
      importStatus: z.enum(["pending", "imported", "ignored", "all"]).default("all"),
      minScore: z.number().min(0).max(100).optional(),
      tag: z.string().optional(),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions: any[] = [];
      if (input.batchId) conditions.push(eq(scrapeCollectedGroups.batchId, input.batchId));
      if (input.type !== "all") conditions.push(eq(scrapeCollectedGroups.type, input.type));
      if (input.importStatus !== "all") conditions.push(eq(scrapeCollectedGroups.importStatus, input.importStatus));
      if (input.minScore !== undefined) conditions.push(sql`${scrapeCollectedGroups.aiScore} >= ${input.minScore}`);
      if (input.tag) conditions.push(sql`JSON_CONTAINS(${scrapeCollectedGroups.tags}, ${JSON.stringify(input.tag)})`);

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
      const offset = (input.page - 1) * input.pageSize;

      const [items, countResult] = await Promise.all([
        db.select().from(scrapeCollectedGroups)
          .where(whereClause)
          .orderBy(desc(scrapeCollectedGroups.aiScore))
          .limit(input.pageSize)
          .offset(offset),
        db.select({ count: sql<number>`count(*)` }).from(scrapeCollectedGroups).where(whereClause),
      ]);

      return {
        items: items.map(item => ({
          ...item,
          tags: item.tags ? JSON.parse(item.tags as any) : [],
          aiScoreDetail: item.aiScoreDetail ? JSON.parse(item.aiScoreDetail) : null,
        })),
        total: Number(countResult[0]?.count || 0),
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  // 获取采集到的用户列表（支持按批次、标签过滤）
  listCollectedUsers: adminProcedure
    .input(z.object({
      batchId: z.number().int().optional(),
      onlyWithUsername: z.boolean().default(false),
      minScore: z.number().min(0).max(100).optional(),
      tag: z.string().optional(),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions: any[] = [];
      if (input.batchId) conditions.push(eq(scrapeCollectedUsers.batchId, input.batchId));
      if (input.onlyWithUsername) conditions.push(sql`${scrapeCollectedUsers.username} IS NOT NULL AND ${scrapeCollectedUsers.username} != ''`);
      if (input.minScore !== undefined) conditions.push(sql`${scrapeCollectedUsers.aiScore} >= ${input.minScore}`);
      if (input.tag) conditions.push(sql`JSON_CONTAINS(${scrapeCollectedUsers.tags}, ${JSON.stringify(input.tag)})`);

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
      const offset = (input.page - 1) * input.pageSize;

      const [items, countResult] = await Promise.all([
        db.select().from(scrapeCollectedUsers)
          .where(whereClause)
          .orderBy(desc(scrapeCollectedUsers.aiScore))
          .limit(input.pageSize)
          .offset(offset),
        db.select({ count: sql<number>`count(*)` }).from(scrapeCollectedUsers).where(whereClause),
      ]);

      return {
        items: items.map(u => ({
          ...u,
          tags: u.tags ? JSON.parse(u.tags as any) : [],
        })),
        total: Number(countResult[0]?.count || 0),
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  // 获取全局统计（所有批次汇总）
  getGlobalStats: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    const [groupCount, channelCount, userCount, batchCount] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(scrapeCollectedGroups).where(eq(scrapeCollectedGroups.type, "group")),
      db.select({ count: sql<number>`count(*)` }).from(scrapeCollectedGroups).where(eq(scrapeCollectedGroups.type, "channel")),
      db.select({ count: sql<number>`count(*)` }).from(scrapeCollectedUsers),
      db.select({ count: sql<number>`count(*)` }).from(scrapeBatches).where(eq(scrapeBatches.scrapeMode, "target")),
    ]);

    return {
      groups: Number(groupCount[0]?.count || 0),
      channels: Number(channelCount[0]?.count || 0),
      users: Number(userCount[0]?.count || 0),
      batches: Number(batchCount[0]?.count || 0),
    };
  }),

  // 将采集到的群组导入公共监控池
  importCollectedGroupsToPool: adminProcedure
    .input(z.object({ ids: z.array(z.number().int()).min(1) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const groups = await db.select().from(scrapeCollectedGroups)
        .where(inArray(scrapeCollectedGroups.id, input.ids));

      let importedCount = 0;
      let skippedCount = 0;

      for (const g of groups) {
        try {
          const groupIdentifier = g.username ? `@${g.username}` : (g.tgId || "");
          if (!groupIdentifier) { skippedCount++; continue; }

          const existing = await db.select({ id: publicMonitorGroups.id })
            .from(publicMonitorGroups)
            .where(eq(publicMonitorGroups.groupId, groupIdentifier))
            .limit(1);

          if (existing.length === 0) {
            const tagsArr = g.tags ? JSON.parse(g.tags as any) : [];
            await db.insert(publicMonitorGroups).values({
              groupId: groupIdentifier,
              groupTitle: g.title || groupIdentifier,
              groupType: g.type || "group",
              memberCount: g.memberCount || 0,
              isActive: true,
              realId: g.tgId || null,
              note: `指定采集导入 AI:${g.aiScore} 标签:${tagsArr.join(",")}`,
            });
            importedCount++;
          } else {
            skippedCount++;
          }

          await db.update(scrapeCollectedGroups)
            .set({ importStatus: "imported" })
            .where(eq(scrapeCollectedGroups.id, g.id));
        } catch (e) {
          console.error(`[groupScrape] 导入群组 ${g.id} 失败:`, e);
          skippedCount++;
        }
      }

      return { importedCount, skippedCount };
    }),

  // 导出用户列表（支持多种格式）
  exportCollectedUsers: adminProcedure
    .input(z.object({
      batchId: z.number().int().optional(),
      onlyWithUsername: z.boolean().default(true),
      minScore: z.number().min(0).max(100).optional(),
      tag: z.string().optional(),
      format: z.enum(["username", "tgid", "csv"]).default("username"),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions: any[] = [];
      if (input.batchId) conditions.push(eq(scrapeCollectedUsers.batchId, input.batchId));
      if (input.onlyWithUsername) conditions.push(sql`${scrapeCollectedUsers.username} IS NOT NULL AND ${scrapeCollectedUsers.username} != ''`);
      if (input.minScore !== undefined) conditions.push(sql`${scrapeCollectedUsers.aiScore} >= ${input.minScore}`);
      if (input.tag) conditions.push(sql`JSON_CONTAINS(${scrapeCollectedUsers.tags}, ${JSON.stringify(input.tag)})`);

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const users = await db.select().from(scrapeCollectedUsers)
        .where(whereClause)
        .orderBy(desc(scrapeCollectedUsers.aiScore))
        .limit(10000);

      let content = "";
      if (input.format === "username") {
        content = users.map(u => u.username ? `@${u.username}` : `tg://user?id=${u.tgId}`).join("\n");
      } else if (input.format === "tgid") {
        content = users.map(u => u.tgId).join("\n");
      } else if (input.format === "csv") {
        const header = "tgId,username,displayName,isBot,isPremium,aiScore,tags,messageCount,sourceGroup";
        const rows = users.map(u => {
          const tags = u.tags ? JSON.parse(u.tags as any).join("|") : "";
          return `${u.tgId},${u.username || ""},${(u.displayName || "").replace(/,/g, " ")},${u.isBot ? 1 : 0},${u.isPremium ? 1 : 0},${u.aiScore || 0},"${tags}",${u.messageCount || 0},${u.sourceGroupId || ""}`;
        });
        content = [header, ...rows].join("\n");
      }

      return {
        total: users.length,
        content,
        users: users.map(u => ({
          ...u,
          tags: u.tags ? JSON.parse(u.tags as any) : [],
        })),
      };
    }),

  // 清空全部采集数据（或按批次）
  clearCollectedData: adminProcedure
    .input(z.object({
      batchId: z.number().int().optional(),
      clearGroups: z.boolean().default(true),
      clearUsers: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      if (input.batchId) {
        if (input.clearGroups) await db.delete(scrapeCollectedGroups).where(eq(scrapeCollectedGroups.batchId, input.batchId));
        if (input.clearUsers) await db.delete(scrapeCollectedUsers).where(eq(scrapeCollectedUsers.batchId, input.batchId));
        await db.delete(scrapeBatches).where(eq(scrapeBatches.id, input.batchId));
      } else {
        if (input.clearGroups) await db.delete(scrapeCollectedGroups);
        if (input.clearUsers) await db.delete(scrapeCollectedUsers);
        await db.delete(scrapeBatches).where(eq(scrapeBatches.scrapeMode, "target"));
      }

      return { success: true };
    }),

  // ════════════════════════════════════════════════════════════════
  // Tab3: 消息提取链接
  // ════════════════════════════════════════════════════════════════

  extractFromGroup: adminProcedure
    .input(z.object({
      accountId: z.number().int(),
      groupUrl: z.string().min(1),
      limit: z.number().int().min(50).max(5000).default(500),
      aiFilter: z.boolean().default(false),
      aiMinMembers: z.number().int().min(0).default(0),
    }))
    .mutation(async ({ input }) => {
      // 使用正确的引擎端口: 7100 + accountId
      let accountId = input.accountId;
      if (!accountId) {
        const fallback = await getAvailableAccountId();
        if (!fallback) throw new TRPCError({ code: "BAD_REQUEST", message: "没有可用的 TG 账号" });
        accountId = fallback;
      }
      try {
        // 规范化群组 URL
        let normalizedGroup = input.groupUrl.trim();
        if (normalizedGroup.startsWith("https://t.me/")) {
          normalizedGroup = "@" + normalizedGroup.replace("https://t.me/", "").split("/")[0];
        } else if (!normalizedGroup.startsWith("@")) {
          normalizedGroup = "@" + normalizedGroup;
        }

        // 调用引擎 scrape-links 接口（使用 fetchLinksFromEngine，端口 = 7100 + accountId）
        const rawLinks = await fetchLinksFromEngine(accountId, normalizedGroup, input.limit);
        let links = rawLinks as Array<{ tgId?: string; username?: string; title?: string; memberCount?: number; description?: string; type?: string }>;

        // AI 过滤：按最低成员数
        if (input.aiFilter && input.aiMinMembers > 0) {
          links = links.filter(l => (l.memberCount ?? 0) >= input.aiMinMembers);
        }

        // 为每个链接计算 AI 评分和标签
        const enrichedLinks = links.map(l => {
          const username = l.username || "";
          const url = username ? `https://t.me/${username.replace(/^@/, "")}` : "";
          const { score } = calcGroupAiScore({
            memberCount: l.memberCount,
            username,
            title: l.title,
            type: l.type,
            description: l.description,
          });
          const tags = calcGroupTags({
            memberCount: l.memberCount,
            username,
            type: l.type,
            aiScore: score,
          });
          return { url, slug: username.replace(/^@/, ""), memberCount: l.memberCount, title: l.title, type: l.type, description: l.description, aiScore: score, tags };
        });

        return {
          success: true,
          total: enrichedLinks.length,
          scanned: input.limit,
          links: enrichedLinks,
        };
      } catch (err: any) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `无法连接引擎: ${err.message}` });
      }
    }),

  // 批量导入提取的链接到公共群池
  importExtractedLinks: adminProcedure
    .input(z.object({
      urls: z.array(z.string().min(1)).min(1),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      let added = 0;
      let skipped = 0;

      for (const url of input.urls) {
        try {
          const slug = url.replace(/^https?:\/\/t\.me\//, "").replace(/^@/, "").split("/")[0];
          if (!slug) { skipped++; continue; }
          const groupId = `@${slug}`;

          const existing = await db.select({ id: publicMonitorGroups.id })
            .from(publicMonitorGroups)
            .where(eq(publicMonitorGroups.groupId, groupId))
            .limit(1);

          if (existing.length === 0) {
            await db.insert(publicMonitorGroups).values({
              groupId,
              groupTitle: slug,
              groupType: "group",
              memberCount: 0,
              isActive: true,
              note: "消息提取导入",
            });
            added++;
          } else {
            skipped++;
          }
        } catch (e) {
          skipped++;
        }
      }

      return { added, skipped };
    }),

  // 同步群组 realId（保留原有功能）
  syncGroupRealIds: adminProcedure
    .mutation(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const engineSecret = process.env.ENGINE_SECRET || "shentanbot-engine-secret-2026";
      const engineHttpPortBase = parseInt(process.env.ENGINE_HTTP_PORT_BASE || "7100", 10);

      const accounts = await db
        .select({ id: tgAccounts.id, accountRole: tgAccounts.accountRole })
        .from(tgAccounts)
        .where(eq(tgAccounts.isActive, true));

      const monitorAccounts = accounts.filter(a => a.accountRole === "monitor" || a.accountRole === "both");
      if (monitorAccounts.length === 0) {
        return { success: false, message: "没有活跃的监控账号", updated: 0, total: 0, scanned: 0 };
      }

      const dialogMap = new Map<string, string>();
      for (const acc of monitorAccounts) {
        const port = engineHttpPortBase + acc.id;
        try {
          const resp = await fetch(`http://127.0.0.1:${port}/dialogs`, {
            headers: { "X-Engine-Secret": engineSecret },
            // @ts-ignore
            signal: AbortSignal.timeout(30000),
          });
          if (!resp.ok) continue;
          const data = (await resp.json()) as any;
          const dialogs: Array<{ chatId: string; username?: string }> =
            Array.isArray(data) ? data : (data.dialogs ?? data.groups ?? []);
          for (const d of dialogs) {
            if (d.username && d.chatId) {
              dialogMap.set(d.username.replace(/^@/, "").toLowerCase(), d.chatId);
            }
          }
        } catch { continue; }
      }

      if (dialogMap.size === 0) {
        return { success: false, message: "引擎未返回任何群组数据", updated: 0, total: 0, scanned: 0 };
      }

      const allGroups = await db.select({ id: publicMonitorGroups.id, groupId: publicMonitorGroups.groupId }).from(publicMonitorGroups);
      let updated = 0;
      for (const group of allGroups) {
        const normalizedGroupId = group.groupId.replace(/^@/, "").toLowerCase();
        const chatId = dialogMap.get(normalizedGroupId);
        if (chatId) {
          await db.update(publicMonitorGroups).set({ realId: chatId }).where(eq(publicMonitorGroups.id, group.id));
          updated++;
        }
      }

      return {
        success: true,
        message: `同步完成：扫描 ${dialogMap.size} 个，成功回写 ${updated} / ${allGroups.length} 条`,
        updated,
        total: allGroups.length,
        scanned: dialogMap.size,
      };
    }),
});
