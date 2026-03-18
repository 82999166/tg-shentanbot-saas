import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  countKeywordsByUserId,
  createKeyword,
  createKeywordGroup,
  deleteKeyword,
  deleteKeywordGroup,
  getAllPlans,
  getKeywordById,
  getKeywordGroupsByUserId,
  getKeywordsByUserId,
  updateKeyword,
  updateKeywordGroup,
} from "../db";
import { protectedProcedure, router } from "../_core/trpc";

export const keywordsRouter = router({
  // ---- 关键词分组 ----
  listGroups: protectedProcedure.query(async ({ ctx }) => {
    return getKeywordGroupsByUserId(ctx.user.id);
  }),

  createGroup: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(128),
      description: z.string().optional(),
      color: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = await createKeywordGroup({
        userId: ctx.user.id,
        name: input.name,
        description: input.description,
        color: input.color ?? "#3B82F6",
      });
      return { id, success: true };
    }),

  updateGroup: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(128).optional(),
      description: z.string().optional(),
      color: z.string().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await updateKeywordGroup(id, ctx.user.id, data);
      return { success: true };
    }),

  deleteGroup: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await deleteKeywordGroup(input.id, ctx.user.id);
      return { success: true };
    }),

  // ---- 关键词 ----
  list: protectedProcedure
    .input(z.object({ groupId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      return getKeywordsByUserId(ctx.user.id, input.groupId);
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const kw = await getKeywordById(input.id, ctx.user.id);
      if (!kw) throw new TRPCError({ code: "NOT_FOUND", message: "关键词不存在" });
      return kw;
    }),

  create: protectedProcedure
    .input(z.object({
      keyword: z.string().min(1).max(512),
      matchType: z.enum(["exact", "contains", "regex", "and", "or", "not"]).default("contains"),
      subKeywords: z.array(z.string()).optional(),
      caseSensitive: z.boolean().default(false),
      groupId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // 检查套餐配额
      const plans = await getAllPlans();
      const userPlan = plans.find((p) => p.id === ctx.user.planId) ?? plans.find((p) => p.id === "free");
      const count = await countKeywordsByUserId(ctx.user.id);
      if (userPlan && count >= userPlan.maxKeywords) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `当前套餐最多支持 ${userPlan.maxKeywords} 个关键词，请升级套餐`,
        });
      }

      // 正则表达式验证
      if (input.matchType === "regex") {
        try {
          new RegExp(input.keyword);
        } catch {
          throw new TRPCError({ code: "BAD_REQUEST", message: "正则表达式格式不正确" });
        }
      }

      // 检查重复关键词（同一用户、同一 pattern、同一 matchType）
      const existing = await getKeywordsByUserId(ctx.user.id);
      const isDuplicate = existing.some(
        (k) => k.keyword === input.keyword && k.matchType === input.matchType
      );
      if (isDuplicate) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `关键词「${input.keyword}」已存在，请勿重复添加`,
        });
      }

      const id = await createKeyword({
        userId: ctx.user.id,
        keyword: input.keyword,
        matchType: input.matchType,
        subKeywords: input.subKeywords ?? null,
        caseSensitive: input.caseSensitive,
        groupId: input.groupId ?? null,
      });
      return { id, success: true };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      keyword: z.string().min(1).max(512).optional(),
      matchType: z.enum(["exact", "contains", "regex", "and", "or", "not"]).optional(),
      subKeywords: z.array(z.string()).optional(),
      caseSensitive: z.boolean().optional(),
      groupId: z.number().nullable().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const kw = await getKeywordById(id, ctx.user.id);
      if (!kw) throw new TRPCError({ code: "NOT_FOUND", message: "关键词不存在" });
      await updateKeyword(id, ctx.user.id, { ...data, subKeywords: data.subKeywords ?? null });
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const kw = await getKeywordById(input.id, ctx.user.id);
      if (!kw) throw new TRPCError({ code: "NOT_FOUND", message: "关键词不存在" });
      await deleteKeyword(input.id, ctx.user.id);
      return { success: true };
    }),

  // 测试关键词匹配
  test: protectedProcedure
    .input(z.object({
      keyword: z.string(),
      matchType: z.enum(["exact", "contains", "regex", "and", "or", "not"]),
      subKeywords: z.array(z.string()).optional(),
      caseSensitive: z.boolean().default(false),
      testText: z.string(),
    }))
    .mutation(async ({ input }) => {
      const { keyword, matchType, subKeywords, caseSensitive, testText } = input;
      const text = caseSensitive ? testText : testText.toLowerCase();
      const kw = caseSensitive ? keyword : keyword.toLowerCase();

      let matched = false;
      let reason = "";

      try {
        switch (matchType) {
          case "exact":
            matched = text === kw;
            reason = matched ? "完全匹配" : "不匹配";
            break;
          case "contains":
            matched = text.includes(kw);
            reason = matched ? `包含关键词 "${keyword}"` : "不包含关键词";
            break;
          case "regex":
            const regex = new RegExp(keyword, caseSensitive ? "" : "i");
            matched = regex.test(testText);
            reason = matched ? "正则表达式匹配成功" : "正则表达式不匹配";
            break;
          case "and":
            const andKws = (subKeywords ?? []).map((k) => caseSensitive ? k : k.toLowerCase());
            matched = andKws.every((k) => text.includes(k));
            reason = matched ? "所有关键词均匹配" : `缺少关键词: ${andKws.filter((k) => !text.includes(k)).join(", ")}`;
            break;
          case "or":
            const orKws = (subKeywords ?? []).map((k) => caseSensitive ? k : k.toLowerCase());
            const matchedKws = orKws.filter((k) => text.includes(k));
            matched = matchedKws.length > 0;
            reason = matched ? `匹配到: ${matchedKws.join(", ")}` : "没有关键词匹配";
            break;
          case "not":
            const notKws = (subKeywords ?? []).map((k) => caseSensitive ? k : k.toLowerCase());
            matched = !notKws.some((k) => text.includes(k));
            reason = matched ? "排除关键词均不存在" : `包含排除关键词: ${notKws.filter((k) => text.includes(k)).join(", ")}`;
            break;
        }
      } catch (e: any) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `匹配出错: ${e.message}` });
      }

      return { matched, reason };
    }),
});
