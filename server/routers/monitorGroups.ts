import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  countMonitorGroupsByUserId,
  createMonitorGroup,
  deleteMonitorGroup,
  getAllPlans,
  getMonitorGroupById,
  getMonitorGroupsByUserId,
  updateMonitorGroup,
} from "../db";
import { protectedProcedure, router } from "../_core/trpc";

export const monitorGroupsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return getMonitorGroupsByUserId(ctx.user.id);
  }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const group = await getMonitorGroupById(input.id, ctx.user.id);
      if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "监控群组不存在" });
      return group;
    }),

  create: protectedProcedure
    .input(z.object({
      tgAccountId: z.number(),
      groupId: z.string().min(1),
      groupTitle: z.string().optional(),
      groupUsername: z.string().optional(),
      groupType: z.enum(["group", "supergroup", "channel"]).default("supergroup"),
      memberCount: z.number().optional(),
      keywordIds: z.array(z.number()).default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      // 管理员不受套餐配额限制
      if (ctx.user.role !== "admin") {
        const plans = await getAllPlans();
        const userPlan = plans.find((p) => p.id === ctx.user.planId) ?? plans.find((p) => p.id === "free");
        const count = await countMonitorGroupsByUserId(ctx.user.id);
        if (userPlan && count >= userPlan.maxMonitorGroups) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `当前套餐最多支持 ${userPlan.maxMonitorGroups} 个监控群组，请升级套餐`,
          });
        }
      }

      const id = await createMonitorGroup({
        userId: ctx.user.id,
        tgAccountId: input.tgAccountId,
        groupId: input.groupId,
        groupTitle: input.groupTitle,
        groupUsername: input.groupUsername,
        groupType: input.groupType,
        memberCount: input.memberCount,
        keywordIds: input.keywordIds,
        monitorStatus: "active",
      });
      return { id, success: true };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      groupTitle: z.string().optional(),
      groupUsername: z.string().optional(),
      memberCount: z.number().optional(),
      keywordIds: z.array(z.number()).optional(),
      monitorStatus: z.enum(["active", "paused", "error"]).optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const group = await getMonitorGroupById(id, ctx.user.id);
      if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "监控群组不存在" });
      await updateMonitorGroup(id, ctx.user.id, data);
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const group = await getMonitorGroupById(input.id, ctx.user.id);
      if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "监控群组不存在" });
      await deleteMonitorGroup(input.id, ctx.user.id);
      return { success: true };
    }),

  // 批量创建监控群组
  batchCreate: protectedProcedure
    .input(z.object({
      tgAccountId: z.number(),
      groups: z.array(z.object({
        groupId: z.string().min(1),
        groupTitle: z.string().optional(),
        groupUsername: z.string().optional(),
        groupType: z.enum(["group", "supergroup", "channel"]).default("supergroup"),
        memberCount: z.number().optional(),
      })).min(1, "至少选择一个群组"),
    }))
    .mutation(async ({ ctx, input }) => {
      // 管理员不受套餐配额限制
      let toCreate = input.groups;
      let skipped = 0;
      if (ctx.user.role !== "admin") {
        const plans = await getAllPlans();
        const userPlan = plans.find((p) => p.id === ctx.user.planId) ?? plans.find((p) => p.id === "free");
        const count = await countMonitorGroupsByUserId(ctx.user.id);
        const maxAllowed = userPlan?.maxMonitorGroups ?? 10;
        const remaining = maxAllowed - count;
        if (remaining <= 0) {
          throw new TRPCError({ code: "FORBIDDEN", message: `当前套餐监控群组配额已满（${maxAllowed} 个），请升级套餐` });
        }
        toCreate = input.groups.slice(0, remaining);
        skipped = input.groups.length - toCreate.length;
      }
      const results: { groupId: string; success: boolean; id?: number; error?: string }[] = [];
      for (const g of toCreate) {
        try {
          const id = await createMonitorGroup({
            userId: ctx.user.id,
            tgAccountId: input.tgAccountId,
            groupId: g.groupId,
            groupTitle: g.groupTitle,
            groupUsername: g.groupUsername,
            groupType: g.groupType,
            memberCount: g.memberCount,
            keywordIds: [],
            monitorStatus: "active",
          });
          results.push({ groupId: g.groupId, success: true, id });
        } catch (err: any) {
          results.push({ groupId: g.groupId, success: false, error: err.message });
        }
      }
      const successCount = results.filter((r) => r.success).length;
      return {
        success: true,
        total: input.groups.length,
        created: successCount,
        skipped,
        results,
        message: `成功添加 ${successCount} 个监控群组${skipped > 0 ? `，${skipped} 个因配额不足跳过` : ""}`,
      };
    }),

  // 切换监控状态
  toggleStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["active", "paused"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const group = await getMonitorGroupById(input.id, ctx.user.id);
      if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "监控群组不存在" });
      await updateMonitorGroup(input.id, ctx.user.id, { monitorStatus: input.status });
      return { success: true };
    }),
});
