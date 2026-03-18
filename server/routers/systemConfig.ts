import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { systemConfig } from "../../drizzle/schema";
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
});
