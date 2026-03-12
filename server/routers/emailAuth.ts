import { z } from "zod";
import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { eq, and, gt, desc, count } from "drizzle-orm";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  users,
  passwordResetTokens,
  loginAttempts,
} from "../../drizzle/schema";
import { sendVerifyEmail, sendResetPasswordEmail } from "../mailer";import { sdk } from "../_core/sdk";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "../_core/cookies";

// 登录失败限制：5分钟内失败5次则锁定15分钟
const MAX_ATTEMPTS = 5;
const WINDOW_MINUTES = 5;
const LOCKOUT_MINUTES = 15;

async function checkLoginRateLimit(email: string, ip: string) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

  const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);
  const [result] = await db
    .select({ cnt: count() })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.email, email),
        eq(loginAttempts.success, false),
        gt(loginAttempts.createdAt, windowStart)
      )
    );

  if ((result?.cnt ?? 0) >= MAX_ATTEMPTS) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `登录失败次数过多，请 ${LOCKOUT_MINUTES} 分钟后再试`,
    });
  }
}

async function recordLoginAttempt(email: string, ip: string, success: boolean) {
  const db = await getDb();
  if (!db) return;
  await db.insert(loginAttempts).values({ email, ip, success });
}

export const emailAuthRouter = router({
  // ── 注册 ────────────────────────────────────────────────────
  register: publicProcedure
    .input(
      z.object({
        email: z.string().email("请输入有效的邮箱地址"),
        password: z
          .string()
          .min(8, "密码至少 8 位")
          .regex(/[A-Z]/, "密码需包含大写字母")
          .regex(/[0-9]/, "密码需包含数字"),
        name: z.string().min(1, "请输入用户名").max(64),
        inviteCode: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 检查邮箱是否已注册
      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, input.email));
      if (existing.length > 0) {
        throw new TRPCError({ code: "CONFLICT", message: "该邮箱已注册" });
      }

      // 哈希密码
      const passwordHash = await bcrypt.hash(input.password, 12);

      // 生成邮箱验证 token
      const emailVerifyToken = crypto.randomBytes(32).toString("hex");
      const emailVerifyExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24小时

      // 创建用户
      const [result] = await db.insert(users).values({
        email: input.email,
        name: input.name,
        passwordHash,
        emailVerified: false,
        emailVerifyToken,
        emailVerifyExpiry,
        loginMethod: "email",
        openId: `email_${crypto.randomBytes(8).toString("hex")}`,
      });

      // 发送验证邮件（失败不影响注册）
      try {
        await sendVerifyEmail(input.email, input.name, emailVerifyToken);
      } catch (e) {
        console.error("[EmailAuth] 发送验证邮件失败:", e);
      }

      return { success: true, message: "注册成功！请查收验证邮件并激活账号。" };
    }),

  // ── 邮箱验证 ────────────────────────────────────────────────
  verifyEmail: publicProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.emailVerifyToken, input.token));

      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "验证链接无效或已过期" });
      }
      if (user.emailVerifyExpiry && user.emailVerifyExpiry < new Date()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "验证链接已过期，请重新发送" });
      }

      await db
        .update(users)
        .set({ emailVerified: true, emailVerifyToken: null, emailVerifyExpiry: null })
        .where(eq(users.id, user.id));

      return { success: true, message: "邮箱验证成功！请登录。" };
    }),

  // ── 重新发送验证邮件 ────────────────────────────────────────
  resendVerifyEmail: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, input.email));

      if (!user) {
        // 不暴露用户是否存在
        return { success: true, message: "如果邮箱已注册，验证邮件已发送。" };
      }
      if (user.emailVerified) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "该邮箱已验证" });
      }

      const emailVerifyToken = crypto.randomBytes(32).toString("hex");
      const emailVerifyExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await db
        .update(users)
        .set({ emailVerifyToken, emailVerifyExpiry })
        .where(eq(users.id, user.id));

      try {
        await sendVerifyEmail(input.email, user.name || "", emailVerifyToken);
      } catch (e) {
        console.error("[EmailAuth] 发送验证邮件失败:", e);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "邮件发送失败，请检查 SMTP 配置" });
      }

      return { success: true, message: "验证邮件已重新发送。" };
    }),

  // ── 登录 ────────────────────────────────────────────────────
  login: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(1),
        rememberMe: z.boolean().optional().default(false),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const ip = (ctx.req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || ctx.req.socket.remoteAddress || "";

      // 检查频率限制
      await checkLoginRateLimit(input.email, ip);

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, input.email));

      if (!user || !user.passwordHash) {
        await recordLoginAttempt(input.email, ip, false);
        throw new TRPCError({ code: "UNAUTHORIZED", message: "邮箱或密码错误" });
      }

      const passwordMatch = await bcrypt.compare(input.password, user.passwordHash);
      if (!passwordMatch) {
        await recordLoginAttempt(input.email, ip, false);
        throw new TRPCError({ code: "UNAUTHORIZED", message: "邮箱或密码错误" });
      }

      if (!user.emailVerified) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "请先验证邮箱后再登录",
        });
      }

      // 记录成功登录
      await recordLoginAttempt(input.email, ip, true);
      await db
        .update(users)
        .set({ lastSignedIn: new Date() })
        .where(eq(users.id, user.id));

      // 签发 session cookie
      const maxAge = input.rememberMe ? 30 * 24 * 60 * 60 : 24 * 60 * 60; // 30天 or 1天
      const token = await sdk.createEmailSessionToken(user.id, user.email!, { maxAge });
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: maxAge * 1000 });

      return {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      };
    }),

  // ── 请求重置密码 ────────────────────────────────────────────
  forgotPassword: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, input.email));

      // 无论用户是否存在，都返回相同消息（防止枚举）
      if (!user) {
        return { success: true, message: "如果邮箱已注册，重置链接已发送。" };
      }

      // 生成重置 token
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1小时

      // 使旧 token 失效（删除旧的）
      await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));

      await db.insert(passwordResetTokens).values({
        userId: user.id,
        token,
        expiresAt,
      });

      try {
        await sendResetPasswordEmail(input.email, user.name || "", token);
      } catch (e) {
        console.error("[EmailAuth] 发送重置邮件失败:", e);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "邮件发送失败，请检查 SMTP 配置" });
      }

      return { success: true, message: "重置密码邮件已发送，请查收。" };
    }),

  //  // ── 验证重置 token 是否有效 ─────────────────────────────
  verifyResetToken: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [resetToken] = await db
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.token, input.token));
      if (!resetToken) throw new TRPCError({ code: "NOT_FOUND", message: "重置链接无效" });
      if (resetToken.expiresAt < new Date()) throw new TRPCError({ code: "BAD_REQUEST", message: "重置链接已过期" });
      if (resetToken.usedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "该链接已使用" });
      return { valid: true };
    }),
  // ── 重置密码 ────────────────────────────────────────────
  resetPassword: publicProcedure
    .input(
      z.object({
        token: z.string(),
        newPassword: z
          .string()
          .min(8, "密码至少 8 位")
          .regex(/[A-Z]/, "密码需包含大写字母")
          .regex(/[0-9]/, "密码需包含数字"),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [resetToken] = await db
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.token, input.token));

      if (!resetToken) {
        throw new TRPCError({ code: "NOT_FOUND", message: "重置链接无效或已过期" });
      }
      if (resetToken.expiresAt < new Date()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "重置链接已过期，请重新申请" });
      }
      if (resetToken.usedAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "该重置链接已使用" });
      }

      const passwordHash = await bcrypt.hash(input.newPassword, 12);

      await db
        .update(users)
        .set({ passwordHash })
        .where(eq(users.id, resetToken.userId));

      await db
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokens.id, resetToken.id));

      return { success: true, message: "密码已重置，请使用新密码登录。" };
    }),

  // ── 修改密码（需登录）────────────────────────────────────────
  changePassword: protectedProcedure
    .input(
      z.object({
        oldPassword: z.string().min(1),
        newPassword: z
          .string()
          .min(8, "密码至少 8 位")
          .regex(/[A-Z]/, "密码需包含大写字母")
          .regex(/[0-9]/, "密码需包含数字"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, ctx.user.id));

      if (!user?.passwordHash) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "当前账号不支持密码修改" });
      }

      const match = await bcrypt.compare(input.oldPassword, user.passwordHash);
      if (!match) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "原密码错误" });
      }

      const passwordHash = await bcrypt.hash(input.newPassword, 12);
      await db.update(users).set({ passwordHash }).where(eq(users.id, ctx.user.id));

      return { success: true, message: "密码已更新" };
    }),
});
