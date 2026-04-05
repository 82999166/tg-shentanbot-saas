import { TRPCError } from "@trpc/server";
import { z } from "zod";
import http from "http";
import {
  createTgAccount,
  deleteTgAccount,
  getAllPlans,
  getTgAccountById,
  getTgAccountByIdAdmin,
  getTgAccountsByUserId,
  updateTgAccount,
} from "../db";
import { getDb } from "../db";
import { systemSettings, tgAccounts, users, monitorGroups, publicMonitorGroups, publicGroupJoinStatus } from "../../drizzle/schema";
import { sql, eq, desc, count, inArray } from "drizzle-orm";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";

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
    // 管理员返回所有账号（含归属用户信息），普通用户只返回自己的账号
    if ((ctx.user as any).role === "admin") {
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select({
          id: tgAccounts.id,
          userId: tgAccounts.userId,
          phone: tgAccounts.phone,
          tgFirstName: tgAccounts.tgFirstName,
          tgLastName: tgAccounts.tgLastName,
          tgUsername: tgAccounts.tgUsername,
          accountRole: tgAccounts.accountRole,
          sessionStatus: tgAccounts.sessionStatus,
          isActive: tgAccounts.isActive,
          inEngine: tgAccounts.inEngine,
          notes: tgAccounts.notes,
          proxyHost: tgAccounts.proxyHost,
          proxyPort: tgAccounts.proxyPort,
          proxyType: tgAccounts.proxyType,
          createdAt: tgAccounts.createdAt,
          updatedAt: tgAccounts.updatedAt,
          healthScore: tgAccounts.healthScore,
          healthStatus: tgAccounts.healthStatus,
          lastActiveAt: tgAccounts.lastActiveAt,
          dailyDmSent: tgAccounts.dailyDmSent,
          totalMonitored: tgAccounts.totalMonitored,
          maxGroupsLimit: tgAccounts.maxGroupsLimit,
          ownerName: users.name,
          ownerEmail: users.email,
          ownerTgUsername: users.tgUsername,
        })
        .from(tgAccounts)
        .leftJoin(users, eq(tgAccounts.userId, users.id))
        .orderBy(desc(tgAccounts.createdAt));
      // 查询每个账号的私有群组数量
      const privateGroupCounts = await db
        .select({ tgAccountId: monitorGroups.tgAccountId, cnt: count() })
        .from(monitorGroups)
        .where(eq(monitorGroups.isActive, true))
        .groupBy(monitorGroups.tgAccountId);
      const privateCountMap: Record<number, number> = {};
      for (const r of privateGroupCounts) {
        if (r.tgAccountId) privateCountMap[r.tgAccountId] = r.cnt;
      }
      // 查询每个账号的公共群组监控数量（subscribed = 已在监控中，兼容旧状态 joined）
      const publicGroupCounts = await db
        .select({ monitorAccountId: publicGroupJoinStatus.monitorAccountId, cnt: count() })
        .from(publicGroupJoinStatus)
        .where(inArray(publicGroupJoinStatus.status, ["subscribed", "joined"]))
        .groupBy(publicGroupJoinStatus.monitorAccountId);
      const publicCountMap: Record<number, number> = {};
      for (const r of publicGroupCounts) {
        if (r.monitorAccountId) publicCountMap[r.monitorAccountId] = r.cnt;
      }
      // joinedGroupCount 直接使用数据库中的公共群组加入数量（避免实时调用引擎导致加载慢）
      return rows.map(r => ({
        ...r,
        privateGroupCount: privateCountMap[r.id] ?? 0,
        publicGroupCount: publicCountMap[r.id] ?? 0,
        totalGroupCount: (privateCountMap[r.id] ?? 0) + (publicCountMap[r.id] ?? 0),
        joinedGroupCount: publicCountMap[r.id] ?? 0,
      }));
    }
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
      maxGroupsLimit: z.number().min(1).max(10000).nullable().optional(),
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
      const isAdmin = (ctx.user as any).role === "admin";
      if (isAdmin) {
        // Admin 可以删除任何账号，不限制 userId
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
        const rows = await db.select({ id: tgAccounts.id }).from(tgAccounts).where(eq(tgAccounts.id, input.id)).limit(1);
        if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "账号不存在" });
        await deleteTgAccount(input.id); // 不传 userId，跳过用户限制
      } else {
        const account = await getTgAccountById(input.id, ctx.user.id);
        if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "账号不存在" });
        await deleteTgAccount(input.id, ctx.user.id);
      }
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
        // 判断 sessionString 类型：
        // - TDLib 模式：sessionString 是文件路径（以 / 开头）
        // - Pyrogram 模式：sessionString 是 base64 session 字符串
        const isTdlibPath = account.sessionString.startsWith("/");
        let requestBody: Record<string, string>;
        if (isTdlibPath) {
          // TDLib 模式：传 account_id 给 login_service
          requestBody = { account_id: String(input.id) };
        } else {
          // Pyrogram 模式：传 session_string
          requestBody = { session_string: account.sessionString };
        }
        const res = await fetch(`${LOGIN_SERVICE_URL}/test_session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
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
          const displayName = data.username ? `@${data.username}` : (data.first_name ?? account.phone);
          return { success: true, message: `连接正常，账号：${displayName}` };
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
  // 设置账号是否加入监控引擎（支持批量）
  setInEngine: adminProcedure
    .input(z.object({ ids: z.array(z.number()), inEngine: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接失败" });
      for (const id of input.ids) {
        await db.update(tgAccounts)
          .set({ inEngine: input.inEngine, updatedAt: new Date() })
          .where(eq(tgAccounts.id, id));
      }
      return { success: true, count: input.ids.length };
    }),

  toggleActive: protectedProcedure
    .input(z.object({ id: z.number(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const isAdmin = (ctx.user as any).role === "admin";
      const account = isAdmin ? await getTgAccountByIdAdmin(input.id) : await getTgAccountById(input.id, ctx.user.id);
      if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "账号不存在" });
      await updateTgAccount(input.id, isAdmin ? (account as any).userId : ctx.user.id, {
        isActive: input.isActive,
        sessionStatus: input.isActive ? "active" : "expired",
      });
      return { success: true };
    }),
  // ─── 同步账号群组（触发引擎为指定账号加入所有公共群组）────────────────────
  syncGroups: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
      // 验证账号存在
      const rows = await db.select({ id: tgAccounts.id, isActive: tgAccounts.isActive })
        .from(tgAccounts).where(eq(tgAccounts.id, input.id)).limit(1);
      if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "账号不存在" });
      if (!rows[0].isActive) throw new TRPCError({ code: "BAD_REQUEST", message: "账号未启用，请先启用账号" });
      // 调用引擎 /sync-account 接口
      const engineUrl = process.env.WEB_API_URL
        ? process.env.WEB_API_URL.replace(/:3002$/, ':8765').replace(/\/api$/, '')
        : 'http://127.0.0.1:8765';
      const engineSecret = process.env.ENGINE_SECRET || 'tg-monitor-engine-secret';
      try {
        const resp = await fetch(`${engineUrl}/sync-account`, {
          method: 'POST',
          headers: {
            'X-Engine-Secret': engineSecret,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ account_id: input.id }),
          // @ts-ignore
          signal: AbortSignal.timeout(10000),
        });
        const data = await resp.json() as any;
        if (!resp.ok) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: data.error || `引擎响应 ${resp.status}` });
        }
        return { success: true, message: data.message || '已触发群组同步，请稍后刷新查看' };
      } catch (err: any) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `无法连接引擎: ${err.message}` });
      }
    }),
  // ─── 从TG账号获取群组列表（用于导入到公共群组池）──────────────────────────
  getAccountChats: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const engineUrl = process.env.WEB_API_URL
        ? process.env.WEB_API_URL.replace(/:3002$/, ':8765').replace(/\/api$/, '')
        : 'http://127.0.0.1:8765';
      const engineSecret = process.env.ENGINE_SECRET || 'tg-monitor-engine-secret';
      try {
        const resp = await fetch(`${engineUrl}/get-account-chats`, {
          method: 'POST',
          headers: { 'X-Engine-Secret': engineSecret, 'Content-Type': 'application/json' },
          body: JSON.stringify({ account_id: input.id }),
          // @ts-ignore
          signal: AbortSignal.timeout(60000),
        });
        const data = await resp.json() as any;
        if (!resp.ok) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: data.error || `引擎响应 ${resp.status}` });
        }
        return { success: true, chats: (data.chats ?? []) as Array<{ chatId: string; title: string; username: string; type: string }>, total: data.total ?? 0 };
      } catch (err: any) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `无法连接引擎: ${err.message}` });
      }
    }),
  // ─── 批量导入群组到公共群组池 ──────────────────────────────────────────────
  importChatsToPublic: adminProcedure
    .input(z.object({
      chats: z.array(z.object({
        chatId: z.string(),
        title: z.string(),
        username: z.string(),
        type: z.string(),
      })).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '数据库不可用' });
      let added = 0, skipped = 0;
      for (const chat of input.chats) {
        // 优先用 username，没有则用 chatId（数字 ID）
        const groupId = chat.username ? chat.username : chat.chatId;
        // 检查是否已存在
        const existing = await db.select({ id: publicMonitorGroups.id })
          .from(publicMonitorGroups)
          .where(eq(publicMonitorGroups.groupId, groupId))
          .limit(1);
        if (existing.length > 0) {
          // 已存在则重新激活
          await db.update(publicMonitorGroups)
            .set({ isActive: true, groupTitle: chat.title, updatedAt: new Date() })
            .where(eq(publicMonitorGroups.id, existing[0].id));
          skipped++;
        } else {
          await db.insert(publicMonitorGroups).values({
            groupId,
            groupTitle: chat.title || groupId,
            groupType: chat.type || 'group',
            isActive: true,
            addedBy: ctx.user.id,
            note: `从TG账号导入`,
          });
          added++;
        }
      }
      return { success: true, added, skipped, message: `成功导入 ${added} 个群组${skipped > 0 ? `，${skipped} 个已存在（已重新激活）` : ''}` };
    }),
});

// ─── 保存账号到数据库（检查配额）─────────────────────────────────────────
async function saveAccount(user: any, phone: string, sessionString: string) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });

  // 检查手机号是否已存在（重新登录场景：直接更新，不受配额限制）
  const existing = await db.select().from(tgAccounts).where(eq(tgAccounts.phone, phone)).limit(1);
  if (existing.length > 0) {
    const accountId = existing[0].id;
    // 如果 sessionString 是 login_temp 路径，更新为 account_{id} 规范路径
    const finalSession = sessionString.startsWith("/") && sessionString.includes("login_")
      ? `${process.env.TDLIB_DATA_DIR ?? "/home/hjroot/tg-monitor-tdlib/monitor-engine/tdlib_data"}/account_${accountId}`
      : sessionString;
    // 如果 login_temp 目录存在，把最新的 td.binlog 复制到 account_{id} 目录（覆盖旧的）
    const tdlibDataDir = process.env.TDLIB_DATA_DIR ?? "/home/hjroot/tg-monitor-tdlib/monitor-engine/tdlib_data";
    const loginTempDir = `${tdlibDataDir}/login_temp_${phone.replace(/^\+/, '')}`;
    const accountDir = `${tdlibDataDir}/account_${accountId}`;
    try {
      const { execSync } = await import('child_process');
      // 确保目标目录存在
      execSync(`mkdir -p "${accountDir}/database"`);
      // 从 login_temp 复制最新 td.binlog（覆盖旧的，使新 session 生效）
      for (const sub of ['database', 'db']) {
        const src = `${loginTempDir}/${sub}/td.binlog`;
        try {
          execSync(`test -f "${src}" && cp -f "${src}" "${accountDir}/database/td.binlog"`, { stdio: 'ignore' });
          break;
        } catch (_) { /* 子目录不存在，继续尝试 */ }
      }
    } catch (_) { /* 文件操作失败不影响登录流程 */ }
    await db.update(tgAccounts)
      .set({
        sessionString: finalSession,
        sessionStatus: "active",
        isActive: true,
        inEngine: true,
        healthScore: 90,
        healthStatus: "healthy",
        updatedAt: new Date(),
      })
      .where(eq(tgAccounts.phone, phone));
    // 触发引擎强制重新加载配置
    const engineUrl = process.env.WEB_API_URL
      ? process.env.WEB_API_URL.replace(/:3002$/, ':8765').replace(/\/api$/, '')
      : 'http://127.0.0.1:8765';
    const engineSecret = process.env.ENGINE_SECRET ?? 'tg-monitor-engine-secret';
    try {
      await fetch(`${engineUrl}/force-sync`, {
        method: 'POST',
        headers: { 'X-Engine-Secret': engineSecret },
        // @ts-ignore
        signal: AbortSignal.timeout(3000),
      });
    } catch (_) { /* 引擎不可达时忽略 */ }
    // 后台异步：等引擎加载账号后，自动获取群组并写入公共群组池
    autoSyncChatsToPublic(accountId, engineUrl, engineSecret, user.id).catch(() => {});
    return { success: true, needs2FA: false, accountId, message: "账号重新登录成功，正在后台同步群组..." };
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

  // 登录成功后，将 sessionString 更新为 account_{id} 规范路径，并设置 inEngine=true
  const tdlibDataDir2 = process.env.TDLIB_DATA_DIR ?? "/home/hjroot/tg-monitor-tdlib/monitor-engine/tdlib_data";
  if (sessionString.startsWith("/") && sessionString.includes("login_")) {
    const finalSession2 = `${tdlibDataDir2}/account_${id}`;
    // 复制 login_temp 的 td.binlog 到 account_{id} 目录
    try {
      const { execSync } = await import('child_process');
      execSync(`mkdir -p "${finalSession2}/database"`);
      for (const sub of ['database', 'db']) {
        const src = `${sessionString}/${sub}/td.binlog`;
        try {
          execSync(`test -f "${src}" && cp -f "${src}" "${finalSession2}/database/td.binlog"`, { stdio: 'ignore' });
          break;
        } catch (_) { /* 继续尝试 */ }
      }
    } catch (_) { /* 文件操作失败不影响登录流程 */ }
    await db.update(tgAccounts).set({ sessionString: finalSession2, inEngine: true }).where(eq(tgAccounts.id, id));
  } else {
    await db.update(tgAccounts).set({ inEngine: true }).where(eq(tgAccounts.id, id));
  }
  // 触发引擎强制重新加载配置
  const engineUrl3 = process.env.WEB_API_URL
    ? process.env.WEB_API_URL.replace(/:3002$/, ':8765').replace(/\/api$/, '')
    : 'http://127.0.0.1:8765';
  const engineSecret3 = process.env.ENGINE_SECRET ?? 'tg-monitor-engine-secret';
  try {
    await fetch(`${engineUrl3}/force-sync`, {
      method: 'POST',
      headers: { 'X-Engine-Secret': engineSecret3 },
      // @ts-ignore
      signal: AbortSignal.timeout(3000),
    });
  } catch (_) { /* 引擎不可达时忽略 */ }
  // 后台异步：等引擎加载账号后，自动获取群组并写入公共群组池
  autoSyncChatsToPublic(id, engineUrl3, engineSecret3, user.id).catch(() => {});
  return { success: true, needs2FA: false, accountId: id, message: "账号登录成功，正在后台同步群组..." };
}

// ─── 后台异步：登录成功后自动获取账号群组并写入公共群组池 ─────────────────────
async function autoSyncChatsToPublic(
  accountId: number,
  engineUrl: string,
  engineSecret: string,
  userId: number,
) {
  // 等待引擎加载账号（最多等 90 秒，每 5 秒轮询一次）
  let ready = false;
  for (let i = 0; i < 18; i++) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const statusResp = await fetch(`${engineUrl}/status`, {
        headers: { 'X-Engine-Secret': engineSecret },
        // @ts-ignore
        signal: AbortSignal.timeout(3000),
      });
      if (statusResp.ok) {
        const statusData = await statusResp.json() as any;
        const accounts: Array<{ accountId: number; chatCount: number }> = statusData.accounts ?? [];
        const acc = accounts.find(a => a.accountId === accountId);
        // chatCount >= 0 表示引擎已成功连接 TDLib
        if (acc && acc.chatCount >= 0) { ready = true; break; }
      }
    } catch (_) { /* 继续等待 */ }
  }
  if (!ready) return; // 90 秒内未就绪，放弃

  // 获取账号已加入的群组列表
  let chats: Array<{ chatId: string; title: string; username: string; type: string }> = [];
  try {
    const chatResp = await fetch(`${engineUrl}/get-account-chats`, {
      method: 'POST',
      headers: { 'X-Engine-Secret': engineSecret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_id: accountId }),
      // @ts-ignore
      signal: AbortSignal.timeout(60000),
    });
    if (chatResp.ok) {
      const chatData = await chatResp.json() as any;
      chats = chatData.chats ?? [];
    }
  } catch (_) { return; }
  if (!chats.length) return;

  // 写入公共群组池
  const db = await getDb();
  if (!db) return;
  for (const chat of chats) {
    const groupId = chat.username ? chat.username : chat.chatId;
    try {
      const existing = await db.select({ id: publicMonitorGroups.id })
        .from(publicMonitorGroups)
        .where(eq(publicMonitorGroups.groupId, groupId))
        .limit(1);
      if (existing.length > 0) {
        await db.update(publicMonitorGroups)
          .set({ isActive: true, groupTitle: chat.title, updatedAt: new Date() })
          .where(eq(publicMonitorGroups.id, existing[0].id));
      } else {
        await db.insert(publicMonitorGroups).values({
          groupId,
          groupTitle: chat.title || groupId,
          groupType: chat.type || 'group',
          isActive: true,
          addedBy: userId,
          note: `账号 #${accountId} 登录时自动导入`,
        });
      }
    } catch (_) { /* 单条失败不影响其他 */ }
  }
  // 再次触发 force-sync，让引擎加载新的公共群组
  try {
    await fetch(`${engineUrl}/force-sync`, {
      method: 'POST',
      headers: { 'X-Engine-Secret': engineSecret },
      // @ts-ignore
      signal: AbortSignal.timeout(3000),
    });
  } catch (_) { /* 忽略 */ }
}
