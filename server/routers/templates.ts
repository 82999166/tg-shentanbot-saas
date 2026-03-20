import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createTemplate,
  deleteTemplate,
  getAllPlans,
  getTemplateById,
  getTemplatesByUserId,
  updateTemplate,
} from "../db";
import { protectedProcedure, router } from "../_core/trpc";

// 支持的模板变量
const TEMPLATE_VARIABLES = [
  { key: "{username}", desc: "目标用户名 (@xxx)" },
  { key: "{first_name}", desc: "目标用户名字" },
  { key: "{keyword}", desc: "命中的关键词" },
  { key: "{group_name}", desc: "来源群组名称" },
  { key: "{message}", desc: "原始消息内容（截取前100字）" },
  { key: "{date}", desc: "当前日期 (YYYY-MM-DD)" },
  { key: "{time}", desc: "当前时间 (HH:MM)" },
];

// 渲染模板变量
export function renderTemplate(content: string, vars: Record<string, string>): string {
  let result = content;
  for (const [key, value] of Object.entries(vars)) {
    result = result.split(`{${key}}`).join(value);
  }
  return result;
}

export const templatesRouter = router({
  // 获取模板变量说明
  variables: protectedProcedure.query(() => TEMPLATE_VARIABLES),

  list: protectedProcedure.query(async ({ ctx }) => {
    return getTemplatesByUserId(ctx.user.id);
  }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const template = await getTemplateById(input.id, ctx.user.id);
      if (!template) throw new TRPCError({ code: "NOT_FOUND", message: "模板不存在" });
      return template;
    }),

  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(128),
      content: z.string().min(1).max(4096),
      weight: z.number().min(1).max(100).default(1),
    }))
    .mutation(async ({ ctx, input }) => {
      // 管理员不受套餐配额限制
      if (ctx.user.role !== "admin") {
        const plans = await getAllPlans();
        const userPlan = plans.find((p) => p.id === ctx.user.planId) ?? plans.find((p) => p.id === "free");
        const templates = await getTemplatesByUserId(ctx.user.id);
        if (userPlan && templates.length >= userPlan.maxTemplates) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `当前套餐最多支持 ${userPlan.maxTemplates} 个消息模板，请升级套餐`,
          });
        }
      }

      const id = await createTemplate({
        userId: ctx.user.id,
        name: input.name,
        content: input.content,
        weight: input.weight,
      });
      return { id, success: true };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(128).optional(),
      content: z.string().min(1).max(4096).optional(),
      weight: z.number().min(1).max(100).optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const template = await getTemplateById(id, ctx.user.id);
      if (!template) throw new TRPCError({ code: "NOT_FOUND", message: "模板不存在" });
      await updateTemplate(id, ctx.user.id, data);
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const template = await getTemplateById(input.id, ctx.user.id);
      if (!template) throw new TRPCError({ code: "NOT_FOUND", message: "模板不存在" });
      await deleteTemplate(input.id, ctx.user.id);
      return { success: true };
    }),

  // 预览模板渲染效果
  preview: protectedProcedure
    .input(z.object({
      content: z.string(),
      vars: z.record(z.string(), z.string()).optional(),
    }))
    .mutation(async ({ input }) => {
      const defaultVars = {
        username: "@zhangsan",
        first_name: "张三",
        keyword: "求购",
        group_name: "加密货币交流群",
        message: "我想求购一些比特币，有人出售吗？",
        date: new Date().toISOString().split("T")[0],
        time: new Date().toTimeString().slice(0, 5),
        ...input.vars,
      };
      return { rendered: renderTemplate(input.content, defaultVars) };
    }),
});
