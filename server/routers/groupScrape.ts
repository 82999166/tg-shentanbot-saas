/**
 * 群组采集路由
 * 管理员通过关键词配置采集任务，引擎调用 TDLib searchPublicChats 采集群组，
 * 人工审核后选择导入公共监控群组池
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { publicProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  groupScrapeTasks,
  groupScrapeResults,
  publicMonitorGroups,
} from "../../drizzle/schema";
import { eq, desc, and, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

// ── 管理员鉴权（复用 protectedProcedure，仅管理员可操作）
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user?.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "仅管理员可操作" });
  }
  return next({ ctx });
});

export const groupScrapeRouter = router({
  // ── 创建采集任务 ─────────────────────────────────────────────
  createTask: adminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(128),
        keywords: z.array(z.string().min(1)).min(1),
        minMemberCount: z.number().int().min(0).default(1000),
        maxResults: z.number().int().min(1).max(200).default(50),
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
        status: "idle",
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
        maxResults: z.number().int().min(1).max(200).optional(),
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
      await db.delete(groupScrapeTasks).where(eq(groupScrapeTasks.id, input.id));
      return { success: true };
    }),

  // ── 触发采集任务（将状态设为 pending，引擎轮询后执行）──────────
  triggerTask: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      // 只有 idle / done / failed 状态才能触发
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

      // 查询选中的采集结果
      const results = await db.select().from(groupScrapeResults)
        .where(inArray(groupScrapeResults.id, input.resultIds));

      let importedCount = 0;
      let skippedCount = 0;

      for (const r of results) {
        try {
          // 检查是否已存在
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

          // 更新采集结果状态
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
});
