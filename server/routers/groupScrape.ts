/**
 * 群组采集路由 - 完全重构版 v4
 * 
 * 三大功能：
 * 1. 关键词采集：搜索群组/频道，展示结果，支持导入监控
 * 2. 指定群组采集：输入群组链接，采集成员列表
 * 3. 消息提取链接：扫描群组消息中的链接，按类别分类（群组/频道/用户），用户支持条件过滤
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  publicMonitorGroups,
  tgAccounts,
} from "../../drizzle/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

// ── 管理员鉴权 ──────────────────────────────────────────────────────────
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user?.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "仅管理员可操作" });
  }
  return next({ ctx });
});

// ══════════════════════════════════════════════════════════════════════════
// 工具函数
// ══════════════════════════════════════════════════════════════════════════

/** 获取引擎端口（从数据库读取，fallback 到 7100+id） */
async function getEnginePort(accountId: number): Promise<number> {
  const db = await getDb();
  if (db) {
    const rows = await db.select({ enginePort: tgAccounts.enginePort }).from(tgAccounts).where(eq(tgAccounts.id, accountId));
    if (rows.length > 0 && rows[0].enginePort) return rows[0].enginePort;
  }
  return parseInt(process.env.ENGINE_HTTP_PORT_BASE || "7100", 10) + accountId;
}

/** 获取一个可用的活跃账号ID */
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

/** 引擎请求通用封装 */
async function engineRequest(accountId: number, path: string, body: Record<string, any>, timeoutMs = 120000): Promise<any> {
  const port = await getEnginePort(accountId);
  const engineSecret = process.env.ENGINE_SECRET || "shentanbot-engine-secret-2026";
  const resp = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "X-Engine-Secret": engineSecret, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    // @ts-ignore
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Engine ${port}${path} returned ${resp.status}: ${text}`);
  }
  return resp.json();
}

/** AI评分计算 */
function calcAiScore(item: { memberCount?: number; username?: string; title?: string; description?: string; type?: string }): number {
  let score = 0;
  const mc = item.memberCount ?? 0;
  if (mc >= 50000) score += 25;
  else if (mc >= 10000) score += 22;
  else if (mc >= 5000) score += 18;
  else if (mc >= 1000) score += 14;
  else if (mc >= 500) score += 10;
  else if (mc >= 100) score += 6;
  else score += 2;
  if (item.username && item.username.trim().length > 0) score += 20;
  const title = item.title || "";
  if (title.length >= 2) score += 8;
  if (title.length >= 5) score += 6;
  if (!/^\d+$/.test(title)) score += 6;
  const d = item.description || "";
  if (d.length >= 10) score += 10;
  if (d.length >= 50) score += 10;
  score += item.type === "channel" ? 10 : 5;
  return Math.min(score, 100);
}

// ══════════════════════════════════════════════════════════════════════════
// 路由定义
// ══════════════════════════════════════════════════════════════════════════
export const groupScrapeRouter = router({

  // ────────────────────────────────────────────────────────────────────────
  // Tab1: 关键词采集
  // ────────────────────────────────────────────────────────────────────────

  /** 关键词搜索群组 */
  searchByKeyword: adminProcedure
    .input(z.object({ keyword: z.string().min(1), limit: z.number().min(1).max(100).default(30) }))
    .mutation(async ({ input }) => {
      const accountId = await getAvailableAccountId();
      if (!accountId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "无可用TG账号" });
      try {
        const data = await engineRequest(accountId, "/search-groups", { keyword: input.keyword, limit: input.limit });
        const groups = (data.groups ?? data.results ?? []).map((g: any) => ({
          tgId: g.chatId || g.tgId || "",
          username: g.username || "",
          title: g.title || "",
          memberCount: g.memberCount ?? 0,
          type: g.type || "group",
          description: g.description || "",
          aiScore: calcAiScore(g),
        }));
        return { success: true, groups, total: groups.length };
      } catch (e: any) {
        return { success: false, groups: [], total: 0, error: e.message };
      }
    }),

  /** 将搜索结果导入到公共监控池 */
  importToMonitorPool: adminProcedure
    .input(z.object({
      groups: z.array(z.object({
        username: z.string(),
        title: z.string().optional(),
        type: z.string().optional(),
        memberCount: z.number().optional(),
      })),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      let imported = 0;
      let skipped = 0;
      for (const g of input.groups) {
        if (!g.username) { skipped++; continue; }
        const groupId = g.username.startsWith("@") ? g.username : `@${g.username}`;
        try {
          await db.insert(publicMonitorGroups).values({
            groupId,
            groupTitle: g.title || null,
            groupType: g.type || "group",
            memberCount: g.memberCount || 0,
            isActive: true,
            addedBy: ctx.user?.id ?? null,
          });
          imported++;
        } catch (e: any) {
          // 重复记录跳过
          skipped++;
        }
      }
      return { success: true, imported, skipped };
    }),

  // ────────────────────────────────────────────────────────────────────────
  // Tab2: 指定群组采集（成员列表）
  // ────────────────────────────────────────────────────────────────────────

  /** 采集指定群组的成员 */
  scrapeMembers: adminProcedure
    .input(z.object({
      group: z.string().min(1),
      limit: z.number().min(1).max(1000).default(200),
    }))
    .mutation(async ({ input }) => {
      const accountId = await getAvailableAccountId();
      if (!accountId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "无可用TG账号" });
      try {
        const data = await engineRequest(accountId, "/scrape-members", { group: input.group, limit: input.limit });
        const members = (data.members ?? []).map((m: any) => ({
          tgId: m.tgId || m.userId || "",
          username: m.username || "",
          displayName: m.displayName || m.firstName || "",
          isBot: m.isBot ?? false,
          isPremium: m.isPremium ?? false,
        }));
        return { success: true, members, total: members.length };
      } catch (e: any) {
        return { success: false, members: [], total: 0, error: e.message };
      }
    }),

  // ────────────────────────────────────────────────────────────────────────
  // Tab3: 消息提取链接
  // ────────────────────────────────────────────────────────────────────────

  /** 从群组消息中提取链接 */
  extractLinks: adminProcedure
    .input(z.object({
      group: z.string().min(1),
      limit: z.number().min(1).max(500).default(100),
    }))
    .mutation(async ({ input }) => {
      const accountId = await getAvailableAccountId();
      if (!accountId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "无可用TG账号" });
      try {
        const data = await engineRequest(accountId, "/scrape-links", { group: input.group, limit: input.limit });
        const results = (data.results ?? []).map((r: any) => ({
          tgId: r.tgId || r.chatId || "",
          username: r.username || "",
          title: r.title || "",
          type: r.type || "unknown",
          memberCount: r.memberCount ?? 0,
          description: r.description || "",
          isPremium: r.isPremium ?? false,
          lastOnline: r.lastOnline || "",
          aiScore: calcAiScore(r),
        }));
        return { success: true, results, total: results.length };
      } catch (e: any) {
        return { success: false, results: [], total: 0, error: e.message };
      }
    }),

  /** 将提取的链接导入到监控池 */
  importExtractedLinks: adminProcedure
    .input(z.object({
      items: z.array(z.object({
        username: z.string(),
        title: z.string().optional(),
        type: z.string().optional(),
        memberCount: z.number().optional(),
      })),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      let imported = 0;
      let skipped = 0;
      for (const item of input.items) {
        if (!item.username) { skipped++; continue; }
        const groupId = item.username.startsWith("@") ? item.username : `@${item.username}`;
        try {
          await db.insert(publicMonitorGroups).values({
            groupId,
            groupTitle: item.title || null,
            groupType: item.type || "group",
            memberCount: item.memberCount || 0,
            isActive: true,
            addedBy: ctx.user?.id ?? null,
          });
          imported++;
        } catch (e: any) {
          skipped++;
        }
      }
      return { success: true, imported, skipped };
    }),

  // ────────────────────────────────────────────────────────────────────────
  // 通用：同步群组 realId
  // ────────────────────────────────────────────────────────────────────────
  syncGroupRealIds: adminProcedure
    .mutation(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const engineSecret = process.env.ENGINE_SECRET || "shentanbot-engine-secret-2026";
      const accounts = await db
        .select({ id: tgAccounts.id })
        .from(tgAccounts)
        .where(eq(tgAccounts.isActive, true));
      if (accounts.length === 0) {
        return { success: false, message: "没有活跃的账号", updated: 0, total: 0 };
      }
      const dialogMap = new Map<string, { chatId: string; memberCount?: number }>();
      const chatIdMap = new Map<string, { memberCount?: number }>();
      for (const acc of accounts) {
        const port = await getEnginePort(acc.id);
        try {
          const resp = await fetch(`http://127.0.0.1:${port}/dialogs`, {
            headers: { "X-Engine-Secret": engineSecret },
            // @ts-ignore
            signal: AbortSignal.timeout(300000),
          });
          if (!resp.ok) continue;
          const data = (await resp.json()) as any;
          const dialogs: Array<{ chatId: string; username?: string; memberCount?: number }> =
            Array.isArray(data) ? data : (data.dialogs ?? data.groups ?? []);
          for (const d of dialogs) {
            if (d.chatId) {
              chatIdMap.set(d.chatId, { memberCount: d.memberCount });
              if (d.username) {
                dialogMap.set(d.username.replace(/^@/, "").toLowerCase(), {
                  chatId: d.chatId,
                  memberCount: d.memberCount,
                });
              }
            }
          }
        } catch { continue; }
      }
      if (dialogMap.size === 0 && chatIdMap.size === 0) {
        return { success: false, message: "引擎未返回群组数据", updated: 0, total: 0 };
      }
      const allGroups = await db.select({
        id: publicMonitorGroups.id,
        groupId: publicMonitorGroups.groupId,
        realId: publicMonitorGroups.realId,
      }).from(publicMonitorGroups);
      let updated = 0;
      for (const group of allGroups) {
        const raw = (group.groupId ?? "").trim();
        const idMatch = raw.match(/^@?(-\d+)$/);
        if (idMatch) {
          const extractedId = idMatch[1];
          const engineInfo = chatIdMap.get(extractedId);
          const updateData: Record<string, any> = {};
          if (group.realId !== extractedId) updateData.realId = extractedId;
          if (engineInfo?.memberCount != null) updateData.memberCount = engineInfo.memberCount;
          if (Object.keys(updateData).length > 0) {
            await db.update(publicMonitorGroups).set(updateData).where(eq(publicMonitorGroups.id, group.id));
            updated++;
          }
          continue;
        }
        const normalizedGroupId = raw.replace(/^@/, "").toLowerCase();
        const engineInfo = dialogMap.get(normalizedGroupId);
        if (engineInfo) {
          const updateData: Record<string, any> = { realId: engineInfo.chatId };
          if (engineInfo.memberCount != null) updateData.memberCount = engineInfo.memberCount;
          await db.update(publicMonitorGroups).set(updateData).where(eq(publicMonitorGroups.id, group.id));
          updated++;
        }
      }
      return { success: true, message: `同步完成`, updated, total: allGroups.length };
    }),
});
