/**
 * 群组采集路由
 * 管理员通过关键词配置采集任务，引擎调用 TDLib searchPublicChats 采集群组，
 * 人工审核后选择导入公共监控群组池
 *
 * v2: 新增指定群组采集模式（target mode），支持：
 *   - 指定群组列表（单个/批量）
 *   - 采集内容分类（群组/频道/用户）
 *   - AI 质量评分（多维度）
 *   - 去重入库（scrape_collected_groups / scrape_collected_users）
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
} from "../../drizzle/schema";
import { eq, desc, and, inArray, sql, like, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

// ── 管理员鉴权（复用 protectedProcedure，仅管理员可操作）
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user?.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "仅管理员可操作" });
  }
  return next({ ctx });
});

// ── AI 质量评分函数（纯计算，不依赖外部 API）─────────────────────────────
interface GroupScoreInput {
  memberCount?: number;
  username?: string;
  title?: string;
  description?: string;
  type?: string;
}

function calcGroupAiScore(g: GroupScoreInput): { score: number; detail: Record<string, number> } {
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
  const hasUsername = !!(g.username && g.username.trim().length > 0);
  detail.hasUsername = hasUsername ? 20 : 0;

  // 3. 标题质量（20分）：非空、非纯数字、长度合理
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

  // 5. 类型加成（15分）：频道通常质量更高
  detail.typeBonus = g.type === "channel" ? 10 : 5;

  const total = Object.values(detail).reduce((a, b) => a + b, 0);
  return { score: Math.min(Math.round(total), 100), detail };
}

interface UserScoreInput {
  username?: string;
  displayName?: string;
  isBot?: boolean;
  isPremium?: boolean;
}

function calcUserAiScore(u: UserScoreInput): number {
  let score = 50; // 基础分
  if (u.username && u.username.trim().length > 0) score += 25;
  if (u.isPremium) score += 15;
  if (u.isBot) score -= 30; // 机器人扣分
  const name = u.displayName || "";
  if (name.length >= 2 && !/^\d+$/.test(name)) score += 10;
  return Math.max(0, Math.min(score, 100));
}

// ── 调用引擎接口采集群组成员 ──────────────────────────────────────────────
async function fetchMembersFromEngine(
  accountId: number,
  group: string,
  limit: number
): Promise<Array<{ tgId: string; username?: string; displayName?: string; isBot?: boolean; isPremium?: boolean }>> {
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

// ── 调用引擎接口采集群组内链接（群组/频道）────────────────────────────────
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

// ── 获取可用的监控账号 ID ─────────────────────────────────────────────────
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

export const groupScrapeRouter = router({
  // ── 创建采集任务 ─────────────────────────────────────────────
  createTask: adminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(128),
        keywords: z.array(z.string().min(1)).min(1),
        minMemberCount: z.number().int().min(0).default(1000),
        maxResults: z.number().int().min(1).max(500).default(50),
        fissionEnabled: z.boolean().default(false),
        fissionDepth: z.number().int().min(1).max(3).default(1),
        fissionMaxPerSeed: z.number().int().min(1).max(50).default(10),
        // v2 新增字段
        scrapeMode: z.enum(["keyword", "target"]).default("keyword"),
        targetGroups: z.array(z.string()).optional(),
        collectTypes: z.string().default("group,channel,user"),
        userLimit: z.number().int().min(1).max(5000).default(500),
        aiScoreEnabled: z.boolean().default(false),
        aiMinScore: z.number().min(0).max(100).default(60),
      })
    )
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
        scrapeMode: input.scrapeMode,
        targetGroups: input.targetGroups ? JSON.stringify(input.targetGroups) : null,
        collectTypes: input.collectTypes,
        userLimit: input.userLimit,
        aiScoreEnabled: input.aiScoreEnabled,
        aiMinScore: input.aiMinScore,
      }).$returningId();
      return { id: task.id };
    }),

  // ── 更新采集任务 ─────────────────────────────────────────────
  updateTask: adminProcedure
    .input(
      z.object({
        id: z.number().int(),
        name: z.string().min(1).max(128).optional(),
        keywords: z.array(z.string().min(1)).min(1).optional(),
        minMemberCount: z.number().int().min(0).optional(),
        maxResults: z.number().int().min(1).max(500).optional(),
        fissionEnabled: z.boolean().optional(),
        fissionDepth: z.number().int().min(1).max(3).optional(),
        fissionMaxPerSeed: z.number().int().min(1).max(50).optional(),
        // v2 新增
        scrapeMode: z.enum(["keyword", "target"]).optional(),
        targetGroups: z.array(z.string()).optional(),
        collectTypes: z.string().optional(),
        userLimit: z.number().int().min(1).max(5000).optional(),
        aiScoreEnabled: z.boolean().optional(),
        aiMinScore: z.number().min(0).max(100).optional(),
      })
    )
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
      if (input.scrapeMode !== undefined) updates.scrapeMode = input.scrapeMode;
      if (input.targetGroups !== undefined) updates.targetGroups = JSON.stringify(input.targetGroups);
      if (input.collectTypes !== undefined) updates.collectTypes = input.collectTypes;
      if (input.userLimit !== undefined) updates.userLimit = input.userLimit;
      if (input.aiScoreEnabled !== undefined) updates.aiScoreEnabled = input.aiScoreEnabled;
      if (input.aiMinScore !== undefined) updates.aiMinScore = input.aiMinScore;
      await db.update(groupScrapeTasks).set(updates).where(eq(groupScrapeTasks.id, input.id));
      return { success: true };
    }),

  // ── 删除采集任务（同时删除结果）────────────────────────────────
  deleteTask: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db.delete(groupScrapeResults).where(eq(groupScrapeResults.taskId, input.id));
      await db.delete(scrapeCollectedGroups).where(eq(scrapeCollectedGroups.taskId, input.id));
      await db.delete(scrapeCollectedUsers).where(eq(scrapeCollectedUsers.taskId, input.id));
      await db.delete(groupScrapeTasks).where(eq(groupScrapeTasks.id, input.id));
      return { success: true };
    }),

  // ── 触发采集任务（将状态设为 pending，引擎轮询后执行）──────────
  triggerTask: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [task] = await db.select().from(groupScrapeTasks).where(eq(groupScrapeTasks.id, input.id));
      if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
      if (task.status === "running") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "任务正在运行中" });
      }
      await db.update(groupScrapeTasks)
        .set({ status: "pending" })
        .where(eq(groupScrapeTasks.id, input.id));
      return { success: true };
    }),

  // ── 获取所有采集任务列表 ─────────────────────────────────────
  listTasks: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    const tasks = await db.select().from(groupScrapeTasks).orderBy(desc(groupScrapeTasks.createdAt));
    return tasks.map((t) => ({
      ...t,
      keywords: JSON.parse(t.keywords || "[]") as string[],
      targetGroups: t.targetGroups ? (JSON.parse(t.targetGroups) as string[]) : [],
    }));
  }),

  // ── 获取采集结果列表（支持按任务、状态过滤）──────────────────
  listResults: adminProcedure
    .input(
      z.object({
        taskId: z.number().int().optional(),
        importStatus: z.enum(["pending", "imported", "ignored", "all"]).default("all"),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions = [];
      if (input.taskId) conditions.push(eq(groupScrapeResults.taskId, input.taskId));
      if (input.importStatus !== "all") {
        conditions.push(eq(groupScrapeResults.importStatus, input.importStatus));
      }

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
        items: results,
        total: Number(countResult[0]?.count || 0),
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  // ── 批量导入选中结果到公共监控群组池 ─────────────────────────
  importToPublicPool: adminProcedure
    .input(
      z.object({
        resultIds: z.array(z.number().int()).min(1),
      })
    )
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
              note: `采集导入 - 关键词: ${r.keyword}`,
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

  // ── 忽略选中结果（标记为 ignored）────────────────────────────
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

  // ── 清空某任务的所有结果 ─────────────────────────────────────
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

  // ── 从群组历史消息中提取 t.me 群组链接 ───────────────────────
  extractFromGroup: adminProcedure
    .input(
      z.object({
        accountId: z.number().int(),
        groupUrl: z.string().min(1),
        limit: z.number().int().min(50).max(5000).default(500),
      })
    )
    .mutation(async ({ input }) => {
      const engineUrl = process.env.ENGINE_URL || "http://127.0.0.1:7001";
      const engineSecret = process.env.ENGINE_SECRET || 'shentanbot-engine-secret-2026';
      try {
        const resp = await fetch(`${engineUrl}/extract-group-links`, {
          method: "POST",
          headers: { "X-Engine-Secret": engineSecret, "Content-Type": "application/json" },
          body: JSON.stringify({
            account_id: input.accountId,
            group_url: input.groupUrl,
            limit: input.limit,
          }),
          // @ts-ignore
          signal: AbortSignal.timeout(120000),
        });
        const data = (await resp.json()) as any;
        if (!resp.ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: data.error || `引擎响应 ${resp.status}` });
        }
        return {
          success: true,
          total: data.total ?? 0,
          scanned: data.scanned ?? 0,
          links: (data.links ?? []) as Array<{ url: string; slug: string }>,
        };
      } catch (err: any) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `无法连接引擎: ${err.message}` });
      }
    }),

  // ── 批量同步公共群组 realId ────────────────────────────────────
  syncGroupRealIds: adminProcedure
    .mutation(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const engineSecret = process.env.ENGINE_SECRET || 'shentanbot-engine-secret-2026';
      const engineHttpPortBase = parseInt(process.env.ENGINE_HTTP_PORT_BASE || "7100", 10);

      const accounts = await db
        .select({ id: tgAccounts.id, accountRole: tgAccounts.accountRole })
        .from(tgAccounts)
        .where(eq(tgAccounts.isActive, true));

      const monitorAccounts = accounts.filter(
        (a) => a.accountRole === "monitor" || a.accountRole === "both"
      );

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
          const dialogs: Array<{ chatId: string; username?: string; title?: string }> =
            Array.isArray(data) ? data : (data.dialogs ?? data.groups ?? []);
          for (const d of dialogs) {
            if (d.username && d.chatId) {
              const username = d.username.replace(/^@/, "").toLowerCase();
              dialogMap.set(username, d.chatId);
            }
          }
        } catch {
          continue;
        }
      }

      if (dialogMap.size === 0) {
        return { success: false, message: "引擎未返回任何群组数据，请确认监控账号正在运行", updated: 0, total: 0, scanned: 0 };
      }

      const allGroups = await db
        .select({ id: publicMonitorGroups.id, groupId: publicMonitorGroups.groupId })
        .from(publicMonitorGroups);

      let updated = 0;
      for (const group of allGroups) {
        const normalizedGroupId = group.groupId.replace(/^@/, "").toLowerCase();
        const chatId = dialogMap.get(normalizedGroupId);
        if (chatId) {
          await db
            .update(publicMonitorGroups)
            .set({ realId: chatId })
            .where(eq(publicMonitorGroups.id, group.id));
          updated++;
        }
      }

      return {
        success: true,
        message: `同步完成：共扫描 ${dialogMap.size} 个群组，成功回写 ${updated} / ${allGroups.length} 条记录`,
        updated,
        total: allGroups.length,
        scanned: dialogMap.size,
      };
    }),

  // ════════════════════════════════════════════════════════════════
  // v2 新增：指定群组采集模式
  // ════════════════════════════════════════════════════════════════

  // ── 执行指定群组采集（直接调用引擎，同步返回结果）─────────────
  runTargetScrape: adminProcedure
    .input(
      z.object({
        taskId: z.number().int(),
        targetGroups: z.array(z.string().min(1)).min(1).max(50),
        collectTypes: z.string().default("group,channel,user"),
        userLimit: z.number().int().min(1).max(2000).default(500),
        aiScoreEnabled: z.boolean().default(true),
        aiMinScore: z.number().min(0).max(100).default(60),
        accountId: z.number().int().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // 确定使用的账号
      let accountId = input.accountId;
      if (!accountId) {
        accountId = await getAvailableAccountId();
      }
      if (!accountId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "没有可用的 TG 账号，请先添加账号" });
      }

      const collectTypes = input.collectTypes.split(",").map((s) => s.trim());
      const collectGroups = collectTypes.includes("group");
      const collectChannels = collectTypes.includes("channel");
      const collectUsers = collectTypes.includes("user");

      // 更新任务状态为 running
      await db.update(groupScrapeTasks)
        .set({ status: "running" })
        .where(eq(groupScrapeTasks.id, input.taskId));

      let totalGroupsSaved = 0;
      let totalUsersSaved = 0;
      let totalGroupsSkipped = 0;
      let totalUsersSkipped = 0;

      try {
        for (const groupTarget of input.targetGroups) {
          const normalizedGroup = groupTarget.startsWith("@") ? groupTarget : `@${groupTarget}`;

          // 采集群组/频道链接
          if (collectGroups || collectChannels) {
            const links = await fetchLinksFromEngine(accountId, normalizedGroup, 200);
            for (const link of links) {
              const linkType = link.type || "group";
              if (linkType === "group" && !collectGroups) continue;
              if (linkType === "channel" && !collectChannels) continue;

              // AI 评分
              const { score, detail } = calcGroupAiScore({
                memberCount: link.memberCount,
                username: link.username,
                title: link.title,
                description: link.description,
                type: linkType,
              });

              if (input.aiScoreEnabled && score < input.aiMinScore) continue;

              // 去重入库
              try {
                const tgIdStr = link.tgId ? String(link.tgId) : null;
                if (!tgIdStr) continue;

                const existing = await db.select({ id: scrapeCollectedGroups.id })
                  .from(scrapeCollectedGroups)
                  .where(eq(scrapeCollectedGroups.tgId, tgIdStr))
                  .limit(1);

                if (existing.length === 0) {
                  await db.insert(scrapeCollectedGroups).values({
                    taskId: input.taskId,
                    sourceGroupId: normalizedGroup,
                    type: linkType,
                    tgId: tgIdStr,
                    username: link.username || null,
                    title: link.title || null,
                    memberCount: link.memberCount || 0,
                    description: link.description || null,
                    aiScore: score,
                    aiScoreDetail: JSON.stringify(detail),
                    importStatus: "pending",
                  });
                  totalGroupsSaved++;
                } else {
                  totalGroupsSkipped++;
                }
              } catch (e: any) {
                if (!e?.message?.includes("Duplicate")) {
                  console.error("[groupScrape] 插入群组失败:", e?.message);
                }
                totalGroupsSkipped++;
              }
            }
          }

          // 采集用户
          if (collectUsers) {
            const members = await fetchMembersFromEngine(accountId, normalizedGroup, input.userLimit);
            for (const member of members) {
              const userScore = calcUserAiScore({
                username: member.username,
                displayName: member.displayName,
                isBot: member.isBot,
                isPremium: member.isPremium,
              });

              if (input.aiScoreEnabled && userScore < input.aiMinScore) continue;

              try {
                const tgIdStr = String(member.tgId);
                const existing = await db.select({ id: scrapeCollectedUsers.id })
                  .from(scrapeCollectedUsers)
                  .where(eq(scrapeCollectedUsers.tgId, tgIdStr))
                  .limit(1);

                if (existing.length === 0) {
                  await db.insert(scrapeCollectedUsers).values({
                    taskId: input.taskId,
                    sourceGroupId: normalizedGroup,
                    tgId: tgIdStr,
                    username: member.username || null,
                    displayName: member.displayName || null,
                    isBot: member.isBot ?? false,
                    isPremium: member.isPremium ?? false,
                    aiScore: userScore,
                  });
                  totalUsersSaved++;
                } else {
                  totalUsersSkipped++;
                }
              } catch (e: any) {
                if (!e?.message?.includes("Duplicate")) {
                  console.error("[groupScrape] 插入用户失败:", e?.message);
                }
                totalUsersSkipped++;
              }
            }
          }
        }

        // 更新任务状态
        await db.update(groupScrapeTasks)
          .set({ status: "done", totalFound: totalGroupsSaved + totalUsersSaved })
          .where(eq(groupScrapeTasks.id, input.taskId));

        return {
          success: true,
          groupsSaved: totalGroupsSaved,
          groupsSkipped: totalGroupsSkipped,
          usersSaved: totalUsersSaved,
          usersSkipped: totalUsersSkipped,
        };
      } catch (err: any) {
        await db.update(groupScrapeTasks)
          .set({ status: "failed" })
          .where(eq(groupScrapeTasks.id, input.taskId));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `采集失败: ${err.message}` });
      }
    }),

  // ── 获取采集到的群组/频道列表 ─────────────────────────────────
  listCollectedGroups: adminProcedure
    .input(
      z.object({
        taskId: z.number().int().optional(),
        type: z.enum(["group", "channel", "all"]).default("all"),
        importStatus: z.enum(["pending", "imported", "ignored", "all"]).default("all"),
        minScore: z.number().min(0).max(100).optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions: any[] = [];
      if (input.taskId) conditions.push(eq(scrapeCollectedGroups.taskId, input.taskId));
      if (input.type !== "all") conditions.push(eq(scrapeCollectedGroups.type, input.type));
      if (input.importStatus !== "all") conditions.push(eq(scrapeCollectedGroups.importStatus, input.importStatus));
      if (input.minScore !== undefined) {
        conditions.push(sql`${scrapeCollectedGroups.aiScore} >= ${input.minScore}`);
      }

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
        items: items.map((item) => ({
          ...item,
          aiScoreDetail: item.aiScoreDetail ? JSON.parse(item.aiScoreDetail) : null,
        })),
        total: Number(countResult[0]?.count || 0),
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  // ── 获取采集到的用户列表 ──────────────────────────────────────
  listCollectedUsers: adminProcedure
    .input(
      z.object({
        taskId: z.number().int().optional(),
        onlyWithUsername: z.boolean().default(false),
        minScore: z.number().min(0).max(100).optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions: any[] = [];
      if (input.taskId) conditions.push(eq(scrapeCollectedUsers.taskId, input.taskId));
      if (input.onlyWithUsername) {
        conditions.push(sql`${scrapeCollectedUsers.username} IS NOT NULL AND ${scrapeCollectedUsers.username} != ''`);
      }
      if (input.minScore !== undefined) {
        conditions.push(sql`${scrapeCollectedUsers.aiScore} >= ${input.minScore}`);
      }

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
        items,
        total: Number(countResult[0]?.count || 0),
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  // ── 将采集到的群组导入公共监控池 ─────────────────────────────
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
            await db.insert(publicMonitorGroups).values({
              groupId: groupIdentifier,
              groupTitle: g.title || groupIdentifier,
              groupType: g.type || "group",
              memberCount: g.memberCount || 0,
              isActive: true,
              realId: g.tgId || null,
              note: `采集导入 - AI评分: ${g.aiScore}`,
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

  // ── 导出用户列表（返回 @username 列表）───────────────────────
  exportCollectedUsers: adminProcedure
    .input(
      z.object({
        taskId: z.number().int().optional(),
        onlyWithUsername: z.boolean().default(true),
        minScore: z.number().min(0).max(100).optional(),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions: any[] = [];
      if (input.taskId) conditions.push(eq(scrapeCollectedUsers.taskId, input.taskId));
      if (input.onlyWithUsername) {
        conditions.push(sql`${scrapeCollectedUsers.username} IS NOT NULL AND ${scrapeCollectedUsers.username} != ''`);
      }
      if (input.minScore !== undefined) {
        conditions.push(sql`${scrapeCollectedUsers.aiScore} >= ${input.minScore}`);
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const users = await db.select({
        tgId: scrapeCollectedUsers.tgId,
        username: scrapeCollectedUsers.username,
        displayName: scrapeCollectedUsers.displayName,
        aiScore: scrapeCollectedUsers.aiScore,
      })
        .from(scrapeCollectedUsers)
        .where(whereClause)
        .orderBy(desc(scrapeCollectedUsers.aiScore))
        .limit(5000);

      const lines = users.map((u) =>
        u.username ? `@${u.username}` : `tg://user?id=${u.tgId}`
      );

      return {
        total: users.length,
        content: lines.join("\n"),
        users,
      };
    }),

  // ── 清空采集到的群组/用户数据 ─────────────────────────────────
  clearCollectedData: adminProcedure
    .input(
      z.object({
        taskId: z.number().int(),
        clearGroups: z.boolean().default(true),
        clearUsers: z.boolean().default(true),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      if (input.clearGroups) {
        await db.delete(scrapeCollectedGroups).where(eq(scrapeCollectedGroups.taskId, input.taskId));
      }
      if (input.clearUsers) {
        await db.delete(scrapeCollectedUsers).where(eq(scrapeCollectedUsers.taskId, input.taskId));
      }

      await db.update(groupScrapeTasks)
        .set({ status: "idle", totalFound: 0 })
        .where(eq(groupScrapeTasks.id, input.taskId));

      return { success: true };
    }),

  // ── 获取采集统计（某任务的群组/用户数量）─────────────────────
  getCollectedStats: adminProcedure
    .input(z.object({ taskId: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [groupCount, channelCount, userCount] = await Promise.all([
        db.select({ count: sql<number>`count(*)` })
          .from(scrapeCollectedGroups)
          .where(and(eq(scrapeCollectedGroups.taskId, input.taskId), eq(scrapeCollectedGroups.type, "group"))),
        db.select({ count: sql<number>`count(*)` })
          .from(scrapeCollectedGroups)
          .where(and(eq(scrapeCollectedGroups.taskId, input.taskId), eq(scrapeCollectedGroups.type, "channel"))),
        db.select({ count: sql<number>`count(*)` })
          .from(scrapeCollectedUsers)
          .where(eq(scrapeCollectedUsers.taskId, input.taskId)),
      ]);

      return {
        groups: Number(groupCount[0]?.count || 0),
        channels: Number(channelCount[0]?.count || 0),
        users: Number(userCount[0]?.count || 0),
      };
    }),
});
