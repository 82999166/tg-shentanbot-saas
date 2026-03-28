import { TRPCError } from "@trpc/server";
import { z } from "zod";
import http from "http";
import {
  createTgAccount,
  deleteTgAccount,
  getAllPlans,
  getTgAccountById,
  getTgAccountsByUserId,
  updateTgAccount,
} from "../db";
import { getDb } from "../db";
import { systemSettings, tgAccounts } from "../../drizzle/schema";
import { sql, eq } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";

// ─── Pyrogram 登录服务地址（本地 Python HTTP 服务）─────────────────────────
const LOGIN_SERVICE_URL = process.env.LOGIN_SERVICE_URL ?? "http://127.0.0.1:5051";

// ─── 调用 Pyrogram 登录服务的辅助函数（使用内置 http 模块）──────────────────
function callLoginService(path: string, body: Record<string, any>): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${LOGIN_SERVICE_URL}${path}`);
    const postData = JSON.stringify(body);
    const options = {
      hostname: url.hostname,
      port: parseInt(url.port || "5051"),
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
    };
    const req = http.request(options, (res: any) => {
      let data = "";
      res.on("data", (chunk: any) => { data += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (!parsed.success) {
            reject(new TRPCError({
              code: res.statusCode === 400 ? "BAD_REQUEST" : res.statusCode === 429 ? "TOO_MANY_REQUESTS" : "INTERNAL_SERVER_ERROR",
              message: parsed.error ?? "登录服务异常，请稍后重试",
            }));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "登录服务响应解析失败" }));
        }
      });
    });
    req.on("error", (e: any) => {
      reject(new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `登录服务连接失败: ${e.message}` }));
    });
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new TRPCError({ code: "TIMEOUT", message: "登录服务超时" }));
    });
    req.write(postData);
    req.end();
  });
}

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

  // ─── 手机号登录：第一步 - 发送验证码（调用 Pyrogram 服务）────────────────
  sendCode: protectedProcedure
    .input(z.object({
      phone: z.string().min(7, "请输入有效手机号").regex(/^\+?[0-9]{7,15}$/, "手机号格式不正确（含国际区号，如 +8613800000000）"),
      proxyHost: z.string().optional(),
      proxyPort: z.number().optional(),
      proxyType: z.enum(["socks5", "http", "mtproto"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const phone = input.phone.startsWith("+") ? input.phone : `+${input.phone}`;
      // 从数据库读取 TG API 凭证
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '数据库未初始化' });
      const rows = await db.select().from(systemSettings)
        .where(sql`${systemSettings.key} IN ('tg_api_id', 'tg_api_hash')`);
      const map: Record<string, string> = {};
      for (const r of rows) map[r.key] = r.value ?? "";
      const apiId = parseInt(map["tg_api_id"] || "0");
      const apiHash = map["tg_api_hash"] || "";
      if (!apiId || !apiHash) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "请先在系统设置中配置 TG API ID 和 API Hash" });
      }
      const data = await callLoginService("/send_code", { phone, api_id: apiId, api_hash: apiHash });
      return {
        success: true,
        message: data.message ?? `验证码已发送至 ${phone}，请在 Telegram 中查收`,
        phoneCodeHash: data.phone_code_hash ?? "",
      };
    }),

  // ─── 手机号登录：第二步 - 验证验证码（调用 Pyrogram 服务）───────────────
  verifyCode: protectedProcedure
    .input(z.object({
      phone: z.string(),
      phoneCodeHash: z.string(),
      code: z.string().min(4, "验证码至少4位").max(8),
    }))
    .mutation(async ({ ctx, input }) => {
      const phone = input.phone.startsWith("+") ? input.phone : `+${input.phone}`;
      const data = await callLoginService("/verify_code", {
        phone,
        code: input.code,
        phone_code_hash: input.phoneCodeHash,
      });

      if (data.needs_2fa || data.next_step === "verify_2fa") {
        return { success: true, needs2FA: true, message: "该账号已开启二步验证，请输入密码" };
      }

      // 登录成功，保存 TDLib 数据目录路径（files_directory）作为 sessionString
      const sessionVal = data.files_directory ?? data.session_string ?? "";
      return await saveAccount(ctx.user, phone, sessionVal);
    }),

  // ─── 手机号登录：第三步 - 二步验证密码（调用 Pyrogram 服务）─────────────
  verify2FA: protectedProcedure
    .input(z.object({
      phone: z.string(),
      password: z.string().min(1, "请输入二步验证密码"),
    }))
    .mutation(async ({ ctx, input }) => {
      const phone = input.phone.startsWith("+") ? input.phone : `+${input.phone}`;
      const data = await callLoginService("/verify_2fa", {
        phone,
        password: input.password,
      });

      // 二步验证成功，保存 TDLib 数据目录路径（files_directory）作为 sessionString
      const sessionVal = data.files_directory ?? data.session_string ?? "";
      return await saveAccount(ctx.user, phone, sessionVal);
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
      // 管理员不受套餐配额限制
      let toImport = input.sessions;
      let skipped = 0;
      if ((ctx.user as any).role !== "admin") {
        const plans = await getAllPlans();
        const userPlan = plans.find((p) => p.id === (ctx.user as any).planId) ?? plans.find((p) => p.id === "free");
        const existing = await getTgAccountsByUserId(ctx.user.id);
        const maxAllowed = userPlan?.maxTgAccounts ?? 3;
        const remaining = maxAllowed - existing.length;
        if (remaining <= 0) {
          throw new TRPCError({ code: "FORBIDDEN", message: `当前套餐账号配额已满（${maxAllowed} 个），请升级套餐` });
        }
        toImport = input.sessions.slice(0, remaining);
        skipped = input.sessions.length - toImport.length;
      }
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

  // ─── 测试账号连接（通过 Pyrogram 登录服务验证）───────────────────────────
  testConnection: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const account = await getTgAccountById(input.id, ctx.user.id);
      if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "账号不存在" });
      if (!account.sessionString) {
        return { success: false, message: "账号无有效 Session，请重新登录" };
      }
      try {
        const res = await fetch(`${LOGIN_SERVICE_URL}/test_session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_string: account.sessionString }),
          // @ts-ignore
          signal: AbortSignal.timeout(20000),
        });
        const data = await res.json() as any;
        if (data.success) {
          await updateTgAccount(input.id, ctx.user.id, {
            sessionStatus: "active",
            healthStatus: "healthy",
            healthScore: 95,
            tgUserId: data.user_id?.toString(),
            tgUsername: data.username,
            tgFirstName: data.first_name,
          });
          return { success: true, message: `连接正常，账号：@${data.username ?? data.user_id}` };
        } else {
          await updateTgAccount(input.id, ctx.user.id, { sessionStatus: "expired", healthStatus: "warning", healthScore: 20 });
          return { success: false, message: `连接失败：${data.error ?? "Session 已失效"}` };
        }
      } catch (err: any) {
        await updateTgAccount(input.id, ctx.user.id, { sessionStatus: "expired", healthStatus: "warning", healthScore: 20 });
        return { success: false, message: `连接失败：${err?.message ?? err}` };
      }
    }),

  // ─── 获取账号已加入的群组/频道列表 ──────────────────────────────────────────
  getDialogs: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const account = await getTgAccountById(input.id, ctx.user.id);
      if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "账号不存在" });
      if (!account.sessionString) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "账号无有效 Session，请重新登录" });
      }
      const data = await callLoginService("/get_dialogs", { session_string: account.sessionString });
      return { success: true, dialogs: data.dialogs as Array<{
        id: string;
        title: string;
        username: string;
        type: string;
        members_count: number | null;
      }> };
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
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });

  // 检查手机号是否已存在（重新登录场景：直接更新，不受配额限制）
  const existing = await db.select().from(tgAccounts).where(eq(tgAccounts.phone, phone)).limit(1);
  if (existing.length > 0) {
    await db.update(tgAccounts)
      .set({
        sessionString,
        sessionStatus: "active",
        isActive: true,
        healthScore: 90,
        healthStatus: "healthy",
        updatedAt: new Date(),
      })
      .where(eq(tgAccounts.phone, phone));
    return { success: true, needs2FA: false, accountId: existing[0].id, message: "账号重新登录成功，Session 已更新" };
  }

  // 新账号：检查套餐配额
  if (user.role !== "admin") {
    const plans = await getAllPlans();
    const userPlan = plans.find((p: any) => p.id === user.planId) ?? plans.find((p: any) => p.id === "free");
    const accounts = await getTgAccountsByUserId(user.id);
    if (userPlan && accounts.length >= (userPlan as any).maxTgAccounts) {
      throw new TRPCError({ code: "FORBIDDEN", message: `当前套餐最多支持 ${(userPlan as any).maxTgAccounts} 个TG账号，请升级套餐` });
    }
  }

  const id = await createTgAccount({
    userId: user.id,
    phone,
    sessionString,
    sessionStatus: "active",
    accountRole: "both",
    isActive: true,
    healthScore: 90,
    healthStatus: "healthy",
  });

  return { success: true, needs2FA: false, accountId: id, message: "账号登录成功，已添加到账号列表" };
}
