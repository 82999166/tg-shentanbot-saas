import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/StringSession.js";
import {
  createTgAccount,
  deleteTgAccount,
  getAllPlans,
  getTgAccountById,
  getTgAccountsByUserId,
  updateTgAccount,
} from "../db";
import { protectedProcedure, router } from "../_core/trpc";

// ─── Telegram API 凭证 ─────────────────────────────────────────────────────
const TG_API_ID = 37358587;
const TG_API_HASH = "d673f19449baeaf208d0cacd1cb16ad8";

// ─── 登录会话缓存（key: `${userId}:${phone}`）─────────────────────────────
interface LoginSession {
  client: TelegramClient;
  phoneCodeHash: string;
  step: "code" | "2fa";
  phone: string;
  // 存储用户提供的验证码/密码，等待回调取用
  pendingCode?: string;
  pendingPassword?: string;
  resolvePassword?: (password: string) => void;
  loginPromise?: Promise<void>;
}
const loginSessions = new Map<string, LoginSession>();

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

      // 清理旧会话
      const existing = loginSessions.get(key);
      if (existing) {
        try { await existing.client.disconnect(); } catch {}
        loginSessions.delete(key);
      }

      // 构建代理配置
      let proxyOpts: any = {};
      if (input.proxyHost && input.proxyPort) {
        if (input.proxyType === "mtproto") {
          proxyOpts = { proxy: { ip: input.proxyHost, port: input.proxyPort, MTProxy: true as const } };
        } else {
          proxyOpts = { proxy: { ip: input.proxyHost, port: input.proxyPort, socksType: 5 as const } };
        }
      }

      const client = new TelegramClient(
        new StringSession(""),
        TG_API_ID,
        TG_API_HASH,
        { connectionRetries: 3, useWSS: false, ...proxyOpts }
      );

      try {
        await client.connect();

        const result = await client.sendCode(
          { apiId: TG_API_ID, apiHash: TG_API_HASH },
          phone
        );

        loginSessions.set(key, {
          client,
          phoneCodeHash: result.phoneCodeHash,
          step: "code",
          phone,
        });

        // 10分钟后自动清理
        setTimeout(async () => {
          const s = loginSessions.get(key);
          if (s) {
            try { await s.client.disconnect(); } catch {}
            loginSessions.delete(key);
          }
        }, 10 * 60 * 1000);

        return {
          success: true,
          message: `验证码已发送至 ${phone}，请在 Telegram 中查收（有效期 5 分钟）`,
          phoneCodeHash: result.phoneCodeHash,
        };
      } catch (err: any) {
        try { await client.disconnect(); } catch {}
        const msg = String(err?.message ?? err);
        if (msg.includes("PHONE_NUMBER_INVALID")) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "手机号格式不正确，请检查国际区号" });
        }
        if (msg.includes("PHONE_NUMBER_BANNED")) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "该手机号已被 Telegram 封禁" });
        }
        if (msg.includes("FLOOD_WAIT")) {
          const seconds = msg.match(/(\d+)/)?.[1] ?? "60";
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `请求过于频繁，请等待 ${seconds} 秒后重试` });
        }
        console.error("[TG sendCode error]", msg);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `发送验证码失败：${msg}` });
      }
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

      if (!session || session.step !== "code") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "登录会话已过期，请重新发送验证码" });
      }

      const { client } = session;

      let needs2FA = false;
      let resolvePassword!: (pwd: string) => void;

      // 先把验证码存入会话，phoneCode 回调会来取
      loginSessions.set(key, { ...session, pendingCode: input.code });

      const loginPromise = client.signInUser(
        { apiId: TG_API_ID, apiHash: TG_API_HASH },
        {
          phoneNumber: phone,
          phoneCode: async () => {
            // 直接从会话取已存好的验证码
            const s = loginSessions.get(key);
            return s?.pendingCode ?? input.code;
          },
          password: async (_hint?: string) => {
            needs2FA = true;
            // 等待 verify2FA 提供密码
            return new Promise<string>((res) => {
              resolvePassword = res;
              const s = loginSessions.get(key);
              loginSessions.set(key, {
                ...(s ?? session),
                step: "2fa",
                resolvePassword: res,
              });
            });
          },
          onError: async (err: Error) => {
            console.error("[TG signInUser error]", err.message);
            return false;
          },
        }
      ).then(() => {}) as Promise<void>;

      // 更新会话，保存 loginPromise 供 verify2FA 使用
      const currentSess = loginSessions.get(key);
      loginSessions.set(key, { ...(currentSess ?? session), loginPromise });

      // 等待最多 20 秒，看是否需要 2FA 或直接登录成功
      const result = await Promise.race([
        loginPromise.then(() => ({ type: "success" as const })),
        new Promise<{ type: "2fa" | "timeout" }>((res) => {
          const check = setInterval(() => {
            const s = loginSessions.get(key);
            if (s?.step === "2fa" || needs2FA) {
              clearInterval(check);
              res({ type: "2fa" });
            }
          }, 200);
          setTimeout(() => { clearInterval(check); res({ type: "timeout" }); }, 20000);
        }),
      ]);

      if (result.type === "2fa") {
        return { success: true, needs2FA: true, message: "该账号已开启二步验证，请输入密码" };
      }

      if (result.type === "timeout") {
        const s = loginSessions.get(key);
        if (s?.step === "2fa") {
          return { success: true, needs2FA: true, message: "该账号已开启二步验证，请输入密码" };
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "登录超时，请重试" });
      }

      // 登录成功
      const sessionString = (client.session as StringSession).save();
      await client.disconnect();
      loginSessions.delete(key);

      return await saveAccount(ctx.user, phone, sessionString);
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

      if (!session.resolvePassword) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "登录会话状态异常，请重新开始" });
      }

      // 提供二步验证密码，让 signInUser 继续执行
      session.resolvePassword(input.password);

      // 等待登录完成
      try {
        await Promise.race([
          session.loginPromise,
          new Promise<void>((_, rej) => setTimeout(() => rej(new Error("2FA timeout")), 20000)),
        ]);
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        if (msg.includes("PASSWORD_HASH_INVALID") || msg.includes("2FA timeout")) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "二步验证密码错误，请重新输入" });
        }
        console.error("[TG verify2FA error]", msg);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `二步验证失败：${msg}` });
      }

      const { client } = session;
      const sessionString = (client.session as StringSession).save();
      await client.disconnect();
      loginSessions.delete(key);

      return await saveAccount(ctx.user, phone, sessionString);
    }),

  // ─── Session 批量导入 ─────────────────────────────────────────────────────
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

  // ─── 解析文本格式的 Session ────────────────────────────────────────────────
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
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.length >= 10) {
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

  // ─── 更新TG账号 ───────────────────────────────────────────────────────────
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      accountRole: z.enum(["monitor", "sender", "both"]).optional(),
      proxyHost: z.string().optional(),
      proxyPort: z.number().optional(),
      proxyType: z.enum(["socks5", "http", "mtproto"]).optional(),
      proxyUsername: z.string().optional(),
      proxyPassword: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const account = await getTgAccountById(input.id, ctx.user.id);
      if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "账号不存在" });
      const { id, ...updates } = input;
      await updateTgAccount(id, ctx.user.id, updates);
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

  // ─── 测试账号连接 ─────────────────────────────────────────────────────────
  testConnection: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const account = await getTgAccountById(input.id, ctx.user.id);
      if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "账号不存在" });
      if (!account.sessionString) {
        return { success: false, message: "账号无有效 Session，请重新登录" };
      }
      try {
        const client = new TelegramClient(
          new StringSession(account.sessionString),
          TG_API_ID,
          TG_API_HASH,
          { connectionRetries: 2, useWSS: false }
        );
        await client.connect();
        const me = await client.getMe();
        await client.disconnect();
        await updateTgAccount(input.id, ctx.user.id, {
          sessionStatus: "active",
          healthStatus: "healthy",
          healthScore: 95,
          tgUserId: (me as any).id?.toString(),
          tgUsername: (me as any).username,
          tgFirstName: (me as any).firstName,
          tgLastName: (me as any).lastName,
        });
        return { success: true, message: "连接正常" };
      } catch (err: any) {
        await updateTgAccount(input.id, ctx.user.id, { sessionStatus: "expired", healthStatus: "warning", healthScore: 20 });
        return { success: false, message: `连接失败：${err?.message ?? err}` };
      }
    }),

  // ─── 启用/停用账号 ────────────────────────────────────────────────────────
  toggleActive: protectedProcedure
    .input(z.object({ id: z.number(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const account = await getTgAccountById(input.id, ctx.user.id);
      if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "账号不存在" });
      await updateTgAccount(input.id, ctx.user.id, {
        sessionStatus: input.isActive ? "active" : "expired",
      });
      return { success: true };
    }),
});

// ─── 保存账号到数据库（检查配额）─────────────────────────────────────────
async function saveAccount(user: any, phone: string, sessionString: string) {
  const plans = await getAllPlans();
  const userPlan = plans.find((p: any) => p.id === user.planId) ?? plans.find((p: any) => p.id === "free");
  const accounts = await getTgAccountsByUserId(user.id);
  if (userPlan && accounts.length >= (userPlan as any).maxTgAccounts) {
    throw new TRPCError({ code: "FORBIDDEN", message: `当前套餐最多支持 ${(userPlan as any).maxTgAccounts} 个TG账号，请升级套餐` });
  }

  const id = await createTgAccount({
    userId: user.id,
    phone,
    sessionString,
    sessionStatus: "active",
    accountRole: "both",
    healthScore: 90,
    healthStatus: "healthy",
  });

  return { success: true, needs2FA: false, accountId: id, message: "账号登录成功，已添加到账号列表" };
}


