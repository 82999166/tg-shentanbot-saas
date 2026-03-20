import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { systemConfig, publicMonitorGroups, publicGroupKeywords, publicGroupJoinStatus, tgAccounts } from "../../drizzle/schema";
import { and } from "drizzle-orm";
import { adminProcedure, publicProcedure, router } from "../_core/trpc";

// 默认配置键列表
const CONFIG_KEYS = [
  { key: "support_username", description: "客服 TG 用户名（不含@）" },
  { key: "official_channel", description: "官方频道链接（如 https://t.me/xxx）" },
  { key: "tutorial_text", description: "使用教程内容（支持 Markdown）" },
  { key: "bot_name", description: "Bot 显示名称" },
  { key: "site_name", description: "平台名称" },
];

export const systemConfigRouter = router({
  // 公开接口：Bot 读取配置
  getPublic: publicProcedure
    .input(z.object({ key: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { value: null };
      const row = await db
        .select()
        .from(systemConfig)
        .where(eq(systemConfig.configKey, input.key))
        .limit(1);
      return { value: row[0]?.configValue ?? null };
    }),

  // 公开接口：批量获取多个配置（供 Bot 使用）
  getBatch: publicProcedure
    .input(z.object({ keys: z.array(z.string()) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return {} as Record<string, string | null>;
      const all = await db.select().from(systemConfig);
      const result: Record<string, string | null> = {};
      for (const key of input.keys) {
        const found = all.find((r: typeof systemConfig.$inferSelect) => r.configKey === key);
        result[key] = found?.configValue ?? null;
      }
      return result;
    }),

  // 管理员接口：获取所有配置
  getAll: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select().from(systemConfig);
    // 确保所有默认键都存在
    const result = CONFIG_KEYS.map((def) => {
      const found = rows.find((r: typeof systemConfig.$inferSelect) => r.configKey === def.key);
      return {
        key: def.key,
        description: def.description,
        value: found?.configValue ?? "",
        id: found?.id ?? null,
      };
    });
    return result;
  }),

  // 管理员接口：更新配置
  update: adminProcedure
    .input(
      z.object({
        key: z.string(),
        value: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const existing = await db
        .select()
        .from(systemConfig)
        .where(eq(systemConfig.configKey, input.key))
        .limit(1);

      const def = CONFIG_KEYS.find((d) => d.key === input.key);
      if (!def) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "未知配置键" });
      }

      if (existing.length > 0) {
        await db
          .update(systemConfig)
          .set({ configValue: input.value })
          .where(eq(systemConfig.configKey, input.key));
      } else {
        await db.insert(systemConfig).values({
          configKey: input.key,
          configValue: input.value,
          description: def.description,
        });
      }
      return { success: true };
    }),

  // 管理员接口：批量更新
  updateBatch: adminProcedure
    .input(
      z.object({
        configs: z.array(
          z.object({
            key: z.string(),
            value: z.string(),
          })
        ),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      for (const item of input.configs) {
        const existing = await db
          .select()
          .from(systemConfig)
          .where(eq(systemConfig.configKey, item.key))
          .limit(1);

        const def = CONFIG_KEYS.find((d) => d.key === item.key);
        const description = def?.description ?? item.key;

        if (existing.length > 0) {
          await db
            .update(systemConfig)
            .set({ configValue: item.value })
            .where(eq(systemConfig.configKey, item.key));
        } else {
          await db.insert(systemConfig).values({
            configKey: item.key,
            configValue: item.value,
            description,
          });
        }
      }
      return { success: true };
    }),

  // ── 公共监控群组管理 ──────────────────────────────────────────────────────────

  // 获取公共群组列表（管理员）
  getPublicGroups: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(publicMonitorGroups).orderBy(publicMonitorGroups.createdAt);
  }),

  // 添加公共群组
  addPublicGroup: adminProcedure
    .input(z.object({
      groupId: z.string().min(1),
      groupTitle: z.string().optional(),
      groupType: z.string().optional(),
      note: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // 检查是否已存在
      const existing = await db.select().from(publicMonitorGroups)
        .where(eq(publicMonitorGroups.groupId, input.groupId)).limit(1);
      if (existing[0]) {
        // 如果已存在，重新激活
        await db.update(publicMonitorGroups)
          .set({ isActive: true, groupTitle: input.groupTitle || existing[0].groupTitle, note: input.note || existing[0].note })
          .where(eq(publicMonitorGroups.id, existing[0].id));
        return { success: true, isNew: false };
      }
      await db.insert(publicMonitorGroups).values({
        groupId: input.groupId,
        groupTitle: input.groupTitle || input.groupId,
        groupType: input.groupType || "group",
        isActive: true,
        addedBy: ctx.user.id,
        note: input.note || null,
      });
      return { success: true, isNew: true };
    }),

  // 删除/禁用公共群组
  removePublicGroup: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(publicMonitorGroups)
        .set({ isActive: false })
        .where(eq(publicMonitorGroups.id, input.id));
      return { success: true };
    }),

  // 更新公共群组信息
  updatePublicGroup: adminProcedure
    .input(z.object({
      id: z.number(),
      groupTitle: z.string().optional(),
      note: z.string().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const updates: Record<string, any> = {};
      if (input.groupTitle !== undefined) updates.groupTitle = input.groupTitle;
      if (input.note !== undefined) updates.note = input.note;
      if (input.isActive !== undefined) updates.isActive = input.isActive;
      await db.update(publicMonitorGroups).set(updates)
        .where(eq(publicMonitorGroups.id, input.id));
      return { success: true };
    }),

  // ── 公共群组关键词管理 ──────────────────────────────────────────────────────
  // 获取某公共群组的关键词列表
  getPublicGroupKeywords: adminProcedure
    .input(z.object({ publicGroupId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(publicGroupKeywords)
        .where(and(
          eq(publicGroupKeywords.publicGroupId, input.publicGroupId),
          eq(publicGroupKeywords.isActive, true)
        ))
        .orderBy(publicGroupKeywords.createdAt);
    }),

  // 添加公共群组关键词
  addPublicGroupKeyword: adminProcedure
    .input(z.object({
      publicGroupId: z.number(),
      pattern: z.string().min(1).max(256),
      matchType: z.enum(["contains", "exact", "regex"]).default("contains"),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.insert(publicGroupKeywords).values({
        publicGroupId: input.publicGroupId,
        pattern: input.pattern,
        matchType: input.matchType,
        isActive: true,
      });
      return { success: true };
    }),

  // 删除公共群组关键词（软删除）
  removePublicGroupKeyword: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(publicGroupKeywords)
        .set({ isActive: false })
        .where(eq(publicGroupKeywords.id, input.id));
      return { success: true };
    }),

  // ── 监控账号加群状态查询 ────────────────────────────────────────────────────
  // 获取某公共群组的加群状态（各监控账号是否已加入）
  getPublicGroupJoinStatus: adminProcedure
    .input(z.object({ publicGroupId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const accounts = await db.select({
        id: tgAccounts.id,
        phone: tgAccounts.phone,
        tgUsername: tgAccounts.tgUsername,
        tgFirstName: tgAccounts.tgFirstName,
        sessionStatus: tgAccounts.sessionStatus,
      }).from(tgAccounts).where(eq(tgAccounts.isActive, true));

      const statusRecords = await db.select().from(publicGroupJoinStatus)
        .where(eq(publicGroupJoinStatus.publicGroupId, input.publicGroupId));

      const statusMap = new Map(statusRecords.map(r => [r.monitorAccountId, r]));

      return accounts.map(acc => ({
        accountId: acc.id,
        phone: acc.phone,
        tgUsername: acc.tgUsername,
        tgFirstName: acc.tgFirstName,
        sessionStatus: acc.sessionStatus,
        joinStatus: statusMap.get(acc.id)?.status ?? "pending",
        errorMsg: statusMap.get(acc.id)?.errorMsg ?? null,
        joinedAt: statusMap.get(acc.id)?.joinedAt ?? null,
      }));
    }),

  // Engine REST API：上报加群状态（供 main.py 调用）
  reportJoinStatus: publicProcedure
    .input(z.object({
      publicGroupId: z.number(),
      monitorAccountId: z.number(),
      status: z.enum(["joined", "failed"]),
      errorMsg: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const existing = await db.select().from(publicGroupJoinStatus)
        .where(and(
          eq(publicGroupJoinStatus.publicGroupId, input.publicGroupId),
          eq(publicGroupJoinStatus.monitorAccountId, input.monitorAccountId)
        )).limit(1);

      if (existing.length > 0) {
        await db.update(publicGroupJoinStatus)
          .set({
            status: input.status,
            errorMsg: input.errorMsg ?? null,
            joinedAt: input.status === "joined" ? new Date() : existing[0].joinedAt,
          })
          .where(eq(publicGroupJoinStatus.id, existing[0].id));
      } else {
        await db.insert(publicGroupJoinStatus).values({
          publicGroupId: input.publicGroupId,
          monitorAccountId: input.monitorAccountId,
          status: input.status,
          errorMsg: input.errorMsg ?? null,
          joinedAt: input.status === "joined" ? new Date() : null,
        });
      }
      return { success: true };
    }),
});
