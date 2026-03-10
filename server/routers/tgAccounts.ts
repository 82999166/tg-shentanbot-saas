import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createTgAccount,
  deleteTgAccount,
  getAllPlans,
  getTgAccountById,
  getTgAccountsByUserId,
  updateTgAccount,
} from "../db";
import { protectedProcedure, router } from "../_core/trpc";

export const tgAccountsRouter = router({
  // 获取用户的所有TG账号
  list: protectedProcedure.query(async ({ ctx }) => {
    return getTgAccountsByUserId(ctx.user.id);
  }),

  // 获取单个TG账号
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const account = await getTgAccountById(input.id, ctx.user.id);
      if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "账号不存在" });
      return account;
    }),

  // 添加TG账号（手动输入Session字符串）
  create: protectedProcedure
    .input(z.object({
      phone: z.string().optional(),
      tgUserId: z.string().optional(),
      tgUsername: z.string().optional(),
      tgFirstName: z.string().optional(),
      tgLastName: z.string().optional(),
      sessionString: z.string().optional(),
      accountRole: z.enum(["monitor", "sender", "both"]).default("both"),
      proxyHost: z.string().optional(),
      proxyPort: z.number().optional(),
      proxyType: z.enum(["socks5", "http", "mtproto"]).optional(),
      proxyUsername: z.string().optional(),
      proxyPassword: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // 检查套餐配额
      const plans = await getAllPlans();
      const userPlan = plans.find((p) => p.id === ctx.user.planId) ?? plans.find((p) => p.id === "free");
      const accounts = await getTgAccountsByUserId(ctx.user.id);
      if (userPlan && accounts.length >= userPlan.maxTgAccounts) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `当前套餐最多支持 ${userPlan.maxTgAccounts} 个TG账号，请升级套餐`,
        });
      }

      const id = await createTgAccount({
        userId: ctx.user.id,
        phone: input.phone,
        tgUserId: input.tgUserId,
        tgUsername: input.tgUsername,
        tgFirstName: input.tgFirstName,
        tgLastName: input.tgLastName,
        sessionString: input.sessionString,
        sessionStatus: input.sessionString ? "active" : "pending",
        accountRole: input.accountRole,
        proxyHost: input.proxyHost,
        proxyPort: input.proxyPort,
        proxyType: input.proxyType,
        proxyUsername: input.proxyUsername,
        proxyPassword: input.proxyPassword,
        notes: input.notes,
      });
      return { id, success: true };
    }),

  // 更新TG账号信息
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      phone: z.string().optional(),
      tgUserId: z.string().optional(),
      tgUsername: z.string().optional(),
      tgFirstName: z.string().optional(),
      tgLastName: z.string().optional(),
      sessionString: z.string().optional(),
      sessionStatus: z.enum(["pending", "active", "expired", "banned"]).optional(),
      accountRole: z.enum(["monitor", "sender", "both"]).optional(),
      proxyHost: z.string().optional(),
      proxyPort: z.number().optional(),
      proxyType: z.enum(["socks5", "http", "mtproto"]).optional(),
      proxyUsername: z.string().optional(),
      proxyPassword: z.string().optional(),
      notes: z.string().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const account = await getTgAccountById(id, ctx.user.id);
      if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "账号不存在" });
      await updateTgAccount(id, ctx.user.id, data);
      return { success: true };
    }),

  // 删除TG账号
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const account = await getTgAccountById(input.id, ctx.user.id);
      if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "账号不存在" });
      await deleteTgAccount(input.id, ctx.user.id);
      return { success: true };
    }),

  // 更新账号健康度
  updateHealth: protectedProcedure
    .input(z.object({
      id: z.number(),
      healthScore: z.number().min(0).max(100),
      healthStatus: z.enum(["healthy", "warning", "degraded", "suspended"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await updateTgAccount(id, ctx.user.id, data);
      return { success: true };
    }),

  // 测试账号连接（模拟）
  testConnection: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const account = await getTgAccountById(input.id, ctx.user.id);
      if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "账号不存在" });
      // 实际场景中这里会调用 Pyrogram/Telethon 测试连接
      // 当前返回模拟结果
      if (!account.sessionString) {
        return { success: false, message: "未配置 Session，请先添加 Session 字符串" };
      }
      await updateTgAccount(input.id, ctx.user.id, {
        sessionStatus: "active",
        lastActiveAt: new Date(),
        healthScore: 95,
        healthStatus: "healthy",
      });
      return { success: true, message: "连接测试成功" };
    }),
});
