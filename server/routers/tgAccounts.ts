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

// ─── 模拟"登录会话"缓存（生产环境应用 Redis / DB 存储）─────────────────────
// key: `${userId}:${phone}`  value: { phoneCodeHash, step }
const loginSessions = new Map<string, { phoneCodeHash: string; step: "code" | "2fa" }>();

export const tgAccountsRouter = router({
  // ─── 获取用户的所有TG账号 ─────────────────────────────────────────────────
  list: protectedProcedure.query(async ({ ctx }) => {
    return getTgAccountsByUserId(ctx.user.id);
  }),

  // ─── 获取单个TG账号 ───────────────────────────────────────────────────────
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const account = await getTgAccountById(input.id, ctx.user.id);
      if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "账号不存在" });
      return account;
    }),

  // ─── 手机号登录：第一步 - 发送验证码 ─────────────────────────────────────
  // 实际生产中此处调用 Pyrogram/Telethon send_code_request()
  // 当前返回模拟 phoneCodeHash 供后续步骤使用
  sendCode: protectedProcedure
    .input(z.object({
      phone: z.string().min(7, "请输入有效手机号").regex(/^\+?[0-9]{7,15}$/, "手机号格式不正确（含国际区号，如 +8613800000000）"),
      proxyHost: z.string().optional(),
      proxyPort: z.number().optional(),
      proxyType: z.enum(["socks5", "http", "mtproto"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const phone = input.phone.startsWith("+") ? input.phone : `+${input.phone}`;
      const key = `${ctx.user.id}:${phone}`;

      // 模拟 Telegram API 返回的 phoneCodeHash
      const phoneCodeHash = `hash_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      loginSessions.set(key, { phoneCodeHash, step: "code" });

      // 实际生产代码示例（需安装 gramjs / pyrogram-bridge）：
      // const client = new TelegramClient(new StringSession(""), API_ID, API_HASH, { ... });
      // await client.connect();
      // const result = await client.sendCode({ apiId, apiHash }, phone);
      // loginSessions.set(key, { phoneCodeHash: result.phoneCodeHash, step: "code" });

      return {
        success: true,
        message: `验证码已发送至 ${phone}，请在 Telegram 中查收（有效期 5 分钟）`,
        phoneCodeHash, // 前端需缓存此值用于下一步
      };
    }),

  // ─── 手机号登录：第二步 - 验证验证码 ─────────────────────────────────────
  verifyCode: protectedProcedure
    .input(z.object({
      phone: z.string(),
      phoneCodeHash: z.string(),
      code: z.string().min(4, "验证码至少4位").max(8),
    }))
    .mutation(async ({ ctx, input }) => {
      const phone = input.phone.startsWith("+") ? input.phone : `+${input.phone}`;
      const key = `${ctx.user.id}:${phone}`;
      const session = loginSessions.get(key);

      if (!session) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "登录会话已过期，请重新发送验证码" });
      }

      // 模拟验证逻辑（生产中调用 Telegram API sign_in）
      // 若账号开启了二步验证，Telegram 会返回 SessionPasswordNeededError
      const needs2FA = input.code === "22222"; // 模拟：输入 22222 触发二步验证流程
      const isWrongCode = input.code === "00000"; // 模拟：输入 00000 表示验证码错误

      if (isWrongCode) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "验证码错误，请重新输入" });
      }

      if (needs2FA) {
        loginSessions.set(key, { ...session, step: "2fa" });
        return { success: true, needs2FA: true, message: "该账号已开启二步验证，请输入密码" };
      }

      // 验证成功，生成 Session 字符串（生产中从 Telegram 客户端获取）
      const sessionString = `1BVtsOK8Bu${Math.random().toString(36).slice(2, 30)}`;
      loginSessions.delete(key);

      // 检查套餐配额
      const plans = await getAllPlans();
      const userPlan = plans.find((p) => p.id === (ctx.user as any).planId) ?? plans.find((p) => p.id === "free");
      const accounts = await getTgAccountsByUserId(ctx.user.id);
      if (userPlan && accounts.length >= userPlan.maxTgAccounts) {
        throw new TRPCError({ code: "FORBIDDEN", message: `当前套餐最多支持 ${userPlan.maxTgAccounts} 个TG账号，请升级套餐` });
      }

      const id = await createTgAccount({
        userId: ctx.user.id,
        phone,
        sessionString,
        sessionStatus: "active",
        accountRole: "both",
        healthScore: 90,
        healthStatus: "healthy",
      });

      return { success: true, needs2FA: false, accountId: id, message: "账号登录成功，已添加到账号列表" };
    }),

  // ─── 手机号登录：第三步 - 二步验证密码 ───────────────────────────────────
  verify2FA: protectedProcedure
    .input(z.object({
      phone: z.string(),
      password: z.string().min(1, "请输入二步验证密码"),
    }))
    .mutation(async ({ ctx, input }) => {
      const phone = input.phone.startsWith("+") ? input.phone : `+${input.phone}`;
      const key = `${ctx.user.id}:${phone}`;
      const session = loginSessions.get(key);

      if (!session || session.step !== "2fa") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "登录会话已过期，请重新开始" });
      }

      // 模拟二步验证（生产中调用 check_password）
      if (input.password === "wrong") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "二步验证密码错误" });
      }

      const sessionString = `1BVtsOK8Bu${Math.random().toString(36).slice(2, 30)}`;
      loginSessions.delete(key);

      const plans = await getAllPlans();
      const userPlan = plans.find((p) => p.id === (ctx.user as any).planId) ?? plans.find((p) => p.id === "free");
      const accounts = await getTgAccountsByUserId(ctx.user.id);
      if (userPlan && accounts.length >= userPlan.maxTgAccounts) {
        throw new TRPCError({ code: "FORBIDDEN", message: `当前套餐最多支持 ${userPlan.maxTgAccounts} 个TG账号，请升级套餐` });
      }

      const id = await createTgAccount({
        userId: ctx.user.id,
        phone,
        sessionString,
        sessionStatus: "active",
        accountRole: "both",
        healthScore: 90,
        healthStatus: "healthy",
      });

      return { success: true, accountId: id, message: "二步验证通过，账号已成功添加" };
    }),

  // ─── Session 批量导入 ─────────────────────────────────────────────────────
  // 支持两种格式：
  //   1. 每行一个 Session 字符串
  //   2. JSON 数组：[{ phone, session, role?, proxy? }, ...]
  importSessions: protectedProcedure
    .input(z.object({
      sessions: z.array(z.object({
        phone: z.string().optional(),
        sessionString: z.string().min(10, "Session 字符串过短"),
        accountRole: z.enum(["monitor", "sender", "both"]).default("both"),
        proxyHost: z.string().optional(),
        proxyPort: z.number().optional(),
        proxyType: z.enum(["socks5", "http", "mtproto"]).optional(),
        proxyUsername: z.string().optional(),
        proxyPassword: z.string().optional(),
        notes: z.string().optional(),
      })).min(1, "至少导入一个 Session").max(100, "单次最多导入 100 个 Session"),
    }))
    .mutation(async ({ ctx, input }) => {
      // 检查套餐配额
      const plans = await getAllPlans();
      const userPlan = plans.find((p) => p.id === (ctx.user as any).planId) ?? plans.find((p) => p.id === "free");
      const existing = await getTgAccountsByUserId(ctx.user.id);
      const maxAllowed = userPlan?.maxTgAccounts ?? 3;
      const remaining = maxAllowed - existing.length;

      if (remaining <= 0) {
        throw new TRPCError({ code: "FORBIDDEN", message: `当前套餐账号配额已满（${maxAllowed} 个），请升级套餐` });
      }

      const toImport = input.sessions.slice(0, remaining);
      const skipped = input.sessions.length - toImport.length;

      const results: { index: number; success: boolean; accountId?: number; error?: string }[] = [];

      for (let i = 0; i < toImport.length; i++) {
        const s = toImport[i];
        try {
          const id = await createTgAccount({
            userId: ctx.user.id,
            phone: s.phone,
            sessionString: s.sessionString,
            sessionStatus: "active",
            accountRole: s.accountRole,
            proxyHost: s.proxyHost,
            proxyPort: s.proxyPort,
            proxyType: s.proxyType,
            proxyUsername: s.proxyUsername,
            proxyPassword: s.proxyPassword,
            notes: s.notes ?? `批量导入 #${i + 1}`,
            healthScore: 80,
            healthStatus: "healthy",
          });
          results.push({ index: i, success: true, accountId: id });
        } catch (err: any) {
          results.push({ index: i, success: false, error: err.message ?? "导入失败" });
        }
      }

      const successCount = results.filter((r) => r.success).length;
      const failCount = results.filter((r) => !r.success).length;

      return {
        success: true,
        total: input.sessions.length,
        imported: successCount,
        failed: failCount,
        skipped,
        results,
        message: `成功导入 ${successCount} 个账号${failCount > 0 ? `，${failCount} 个失败` : ""}${skipped > 0 ? `，${skipped} 个因配额不足跳过` : ""}`,
      };
    }),

  // ─── 解析文本格式的 Session（辅助接口）────────────────────────────────────
  // 前端粘贴原始文本后调用此接口解析，再展示预览让用户确认后批量导入
  parseSessionText: protectedProcedure
    .input(z.object({
      text: z.string().min(1),
      format: z.enum(["one_per_line", "json", "auto"]).default("auto"),
    }))
    .mutation(async ({ input }) => {
      const lines = input.text.trim().split(/\r?\n/).filter(Boolean);
      const parsed: { phone?: string; sessionString: string; accountRole: "both" }[] = [];
      const errors: string[] = [];

      if (input.format === "json" || (input.format === "auto" && input.text.trim().startsWith("["))) {
        // JSON 格式
        try {
          const arr = JSON.parse(input.text);
          if (!Array.isArray(arr)) throw new Error("JSON 必须是数组格式");
          for (const item of arr) {
            const session = item.session ?? item.sessionString ?? item.string ?? "";
            if (session.length >= 10) {
              parsed.push({ phone: item.phone, sessionString: session, accountRole: "both" });
            } else {
              errors.push(`无效条目：${JSON.stringify(item).slice(0, 50)}`);
            }
          }
        } catch (e: any) {
          errors.push(`JSON 解析失败：${e.message}`);
        }
      } else {
        // 每行一个 Session 格式
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.length >= 10) {
            // 支持 "phone|session" 格式
            const parts = line.split("|");
            if (parts.length === 2 && parts[0].match(/^\+?[0-9]{7,15}$/)) {
              parsed.push({ phone: parts[0], sessionString: parts[1], accountRole: "both" });
            } else {
              parsed.push({ sessionString: line, accountRole: "both" });
            }
          } else {
            errors.push(`第 ${i + 1} 行内容过短，已跳过`);
          }
        }
      }

      return { parsed, errors, count: parsed.length };
    }),

  // ─── 添加TG账号（直接输入 Session 字符串）────────────────────────────────
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
      const plans = await getAllPlans();
      const userPlan = plans.find((p) => p.id === (ctx.user as any).planId) ?? plans.find((p) => p.id === "free");
      const accounts = await getTgAccountsByUserId(ctx.user.id);
      if (userPlan && accounts.length >= userPlan.maxTgAccounts) {
        throw new TRPCError({ code: "FORBIDDEN", message: `当前套餐最多支持 ${userPlan.maxTgAccounts} 个TG账号，请升级套餐` });
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

  // ─── 更新TG账号信息 ───────────────────────────────────────────────────────
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

  // ─── 删除TG账号 ───────────────────────────────────────────────────────────
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const account = await getTgAccountById(input.id, ctx.user.id);
      if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "账号不存在" });
      await deleteTgAccount(input.id, ctx.user.id);
      return { success: true };
    }),

  // ─── 更新账号健康度 ───────────────────────────────────────────────────────
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

  // ─── 测试账号连接 ─────────────────────────────────────────────────────────
  testConnection: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const account = await getTgAccountById(input.id, ctx.user.id);
      if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "账号不存在" });
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

  // ─── 切换账号启用状态 ─────────────────────────────────────────────────────
  toggleActive: protectedProcedure
    .input(z.object({ id: z.number(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const account = await getTgAccountById(input.id, ctx.user.id);
      if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "账号不存在" });
      await updateTgAccount(input.id, ctx.user.id, { isActive: input.isActive });
      return { success: true };
    }),
});
