import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getAllPlans, getPlanById, updateUserPlan, upsertPlan } from "../db";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";

// 默认套餐配置
const DEFAULT_PLANS = [
  {
    id: "free" as const,
    name: "免费版",
    price: "0.00",
    maxMonitorGroups: 2,
    maxKeywords: 10,
    maxDailyDm: 5,
    maxTgAccounts: 1,
    maxTemplates: 2,
    features: ["基础关键词匹配", "每日5条私信"],
    isActive: true,
  },
  {
    id: "basic" as const,
    name: "基础版",
    price: "29.00",
    maxMonitorGroups: 10,
    maxKeywords: 50,
    maxDailyDm: 30,
    maxTgAccounts: 3,
    maxTemplates: 5,
    features: ["精确/正则匹配", "每日30条私信", "命中记录7天"],
    isActive: true,
  },
  {
    id: "pro" as const,
    name: "专业版",
    price: "99.00",
    maxMonitorGroups: 50,
    maxKeywords: 200,
    maxDailyDm: 100,
    maxTgAccounts: 10,
    maxTemplates: 20,
    features: ["AND/OR/NOT逻辑", "每日100条私信", "命中记录30天", "防封策略配置", "模板轮换"],
    isActive: true,
  },
  {
    id: "enterprise" as const,
    name: "企业版",
    price: "299.00",
    maxMonitorGroups: 200,
    maxKeywords: 1000,
    maxDailyDm: 500,
    maxTgAccounts: 50,
    maxTemplates: 100,
    features: ["无限制功能", "每日500条私信", "命中记录90天", "账号池管理", "优先支持"],
    isActive: true,
  },
];

export const plansRouter = router({
  // 获取所有套餐
  list: protectedProcedure.query(async () => {
    let plans = await getAllPlans();
    if (plans.length === 0) {
      // 初始化默认套餐
      for (const plan of DEFAULT_PLANS) {
        await upsertPlan(plan);
      }
      plans = await getAllPlans();
    }
    return plans;
  }),

  // 获取当前用户套餐信息
  myPlan: protectedProcedure.query(async ({ ctx }) => {
    let plans = await getAllPlans();
    if (plans.length === 0) {
      for (const plan of DEFAULT_PLANS) {
        await upsertPlan(plan);
      }
      plans = await getAllPlans();
    }
    const userPlan = plans.find((p) => p.id === ctx.user.planId) ?? plans.find((p) => p.id === "free");
    return {
      currentPlan: userPlan,
      planId: ctx.user.planId,
      planExpiresAt: ctx.user.planExpiresAt,
      dailyDmSent: ctx.user.dailyDmSent,
    };
  }),

  // 管理员：更新用户套餐
  updateUserPlan: adminProcedure
    .input(z.object({
      userId: z.number(),
      planId: z.enum(["free", "basic", "pro", "enterprise"]),
      expiresAt: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await updateUserPlan(input.userId, input.planId, input.expiresAt ? new Date(input.expiresAt) : undefined);
      return { success: true };
    }),

  // 管理员：更新套餐配置
  upsertPlan: adminProcedure
    .input(z.object({
      id: z.enum(["free", "basic", "pro", "enterprise"]),
      name: z.string(),
      price: z.string(),
      maxMonitorGroups: z.number(),
      maxKeywords: z.number(),
      maxDailyDm: z.number(),
      maxTgAccounts: z.number(),
      maxTemplates: z.number(),
      features: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input }) => {
      await upsertPlan({ ...input, features: input.features ?? [], isActive: true });
      return { success: true };
    }),
});
