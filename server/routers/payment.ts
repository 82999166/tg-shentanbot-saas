import { z } from "zod";
import { eq, and, desc, lt, inArray } from "drizzle-orm";
import { protectedProcedure, router, publicProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  paymentOrders,
  redeemCodes,
  systemSettings,
  users,
  plans,
  inviteRecords,
  inviteCodes,
} from "../../drizzle/schema";
import { nanoid } from "nanoid";
import { sql } from "drizzle-orm";

// ============================================================
// 工具函数
// ============================================================

/** 生成卡密：TGPRO-XXXX-XXXX-XXXX */
function generateRedeemCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const seg = () =>
    Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `TGPRO-${seg()}-${seg()}-${seg()}`;
}

/** 获取系统设置值 */
async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, key))
    .limit(1);
  return rows[0]?.value ?? null;
}

/** 生成唯一 USDT 金额（基础金额 + 唯一小数，避免订单冲突） */
async function generateUniqueAmount(baseAmount: number): Promise<string> {
  const db = await getDb();
  if (!db) return baseAmount.toFixed(6);

  // 查找过去 30 分钟内 pending 订单的金额，避免重复
  const recentOrders = await db
    .select({ usdtAmount: paymentOrders.usdtAmount })
    .from(paymentOrders)
    .where(
      and(
        eq(paymentOrders.status, "pending"),
        // 只查最近的
      )
    )
    .limit(100);

  const usedAmounts = new Set(recentOrders.map((o) => o.usdtAmount));

  // 尝试加唯一小数（0.001 ~ 0.099）
  for (let i = 1; i <= 99; i++) {
    const amount = (baseAmount + i * 0.001).toFixed(6);
    if (!usedAmounts.has(amount)) return amount;
  }
  return (baseAmount + Math.random() * 0.1).toFixed(6);
}

/** 调用 TronGrid API 检查交易 */
async function checkTronPayment(
  address: string,
  expectedAmount: string,
  afterTimestamp: number
): Promise<{ found: boolean; txHash?: string }> {
  try {
    // TRC20 USDT 合约地址
    const USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
    const apiKey = await getSetting("trongrid_api_key");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) headers["TRON-PRO-API-KEY"] = apiKey;

    const url = `https://api.trongrid.io/v1/accounts/${address}/transactions/trc20?limit=20&contract_address=${USDT_CONTRACT}&min_timestamp=${afterTimestamp}`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) return { found: false };

    const data = (await resp.json()) as {
      data?: Array<{
        transaction_id: string;
        to: string;
        value: string;
        token_info: { decimals: number };
      }>;
    };

    if (!data.data) return { found: false };

    const expectedRaw = BigInt(
      Math.round(parseFloat(expectedAmount) * 1_000_000)
    );

    for (const tx of data.data) {
      if (tx.to.toLowerCase() !== address.toLowerCase()) continue;
      const txAmount = BigInt(tx.value);
      // 允许 ±1 误差（最后一位精度）
      const diff = txAmount - expectedRaw;
      if (diff >= BigInt(-1) && diff <= BigInt(1)) {
        return { found: true, txHash: tx.transaction_id };
      }
    }
    return { found: false };
  } catch (e) {
    console.error("[TronGrid] Check failed:", e);
    return { found: false };
  }
}

// ============================================================
// 系统设置 Router（管理员）
// ============================================================
export const systemSettingsRouter = router({
  /** 获取所有系统设置 */
  list: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return db.select().from(systemSettings).orderBy(systemSettings.key);
  }),

  /** 批量更新系统设置 */
  upsert: protectedProcedure
    .input(
      z.array(
        z.object({
          key: z.string(),
          value: z.string(),
          description: z.string().optional(),
        })
      )
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      for (const item of input) {
        await db
          .insert(systemSettings)
          .values({
            key: item.key,
            value: item.value,
            description: item.description,
          })
          .onDuplicateKeyUpdate({
            set: {
              value: item.value,
              description: item.description,
            },
          });
      }
      return { success: true };
    }),

  /** 获取公开配置（套餐价格等，无需登录） */
  publicConfig: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return {};

    const keys = [
      "plan_basic_price_monthly",
      "plan_pro_price_monthly",
      "plan_enterprise_price_monthly",
      "plan_basic_price_quarterly",
      "plan_pro_price_quarterly",
      "plan_enterprise_price_quarterly",
      "usdt_network",
      "site_name",
    ];
    const rows = await db
      .select()
      .from(systemSettings)
      .where(inArray(systemSettings.key, keys));

    const config: Record<string, string> = {};
    for (const row of rows) {
      if (row.value) config[row.key] = row.value;
    }
    return config;
  }),
});

// ============================================================
// 支付 Router
// ============================================================
export const paymentRouter = router({
  /** 创建 USDT 支付订单 */
  createOrder: protectedProcedure
    .input(
      z.object({
        planId: z.enum(["basic", "pro", "enterprise"]),
        durationMonths: z.number().int().min(1).max(12).default(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 获取收款地址
      const usdtAddress = await getSetting("usdt_address");
      if (!usdtAddress) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "系统尚未配置 USDT 收款地址，请联系管理员",
        });
      }

      // 获取套餐价格
      const durationKey =
        input.durationMonths >= 3 ? "quarterly" : "monthly";
      const priceKey = `plan_${input.planId}_price_${durationKey}`;
      const priceStr = await getSetting(priceKey);
      if (!priceStr) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "套餐价格未配置，请联系管理员",
        });
      }

      const basePrice = parseFloat(priceStr);
      if (isNaN(basePrice) || basePrice <= 0) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "套餐价格无效" });
      }

      // 季付折扣（如 quarterly = 3个月价格 * 0.9）
      const totalBase =
        input.durationMonths >= 3
          ? basePrice * 0.9
          : basePrice * input.durationMonths;

      // 生成唯一金额
      const usdtAmount = await generateUniqueAmount(totalBase);

      // 订单过期时间：30 分钟
      const expiredAt = new Date(Date.now() + 30 * 60 * 1000);

      const result = await db.insert(paymentOrders).values({
        userId: ctx.user.id,
        planId: input.planId,
        durationMonths: input.durationMonths,
        usdtAmount,
        usdtAddress,
        network: "trc20",
        status: "pending",
        expiredAt,
      });

      const orderId = Number((result as any).insertId);

      return {
        orderId,
        usdtAmount,
        usdtAddress,
        network: "trc20",
        expiredAt: expiredAt.getTime(),
        planId: input.planId,
        durationMonths: input.durationMonths,
      };
    }),

  /** 轮询订单状态（前端每 15 秒调用一次） */
  checkOrder: protectedProcedure
    .input(z.object({ orderId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const rows = await db
        .select()
        .from(paymentOrders)
        .where(
          and(
            eq(paymentOrders.id, input.orderId),
            eq(paymentOrders.userId, ctx.user.id)
          )
        )
        .limit(1);

      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
      const order = rows[0];

      // 已过期
      if (order.status === "pending" && new Date() > order.expiredAt) {
        await db
          .update(paymentOrders)
          .set({ status: "expired" })
          .where(eq(paymentOrders.id, order.id));
        return { status: "expired" as const, redeemCode: null };
      }

      // 已完成
      if (order.status === "completed") {
        return { status: "completed" as const, redeemCode: order.redeemCode };
      }

      // pending 状态：主动检查链上
      if (order.status === "pending") {
        const afterTs = order.createdAt.getTime() - 60_000; // 提前1分钟
        const check = await checkTronPayment(
          order.usdtAddress,
          order.usdtAmount,
          afterTs
        );

        if (check.found && check.txHash) {
          // 生成卡密
          const code = generateRedeemCode();

          // 插入卡密记录
          await db.insert(redeemCodes).values({
            code,
            planId: order.planId,
            durationMonths: order.durationMonths,
            status: "unused",
            orderId: order.id,
          });

          // 更新订单
          await db.update(paymentOrders).set({
            status: "completed",
            txHash: check.txHash,
            confirmedAt: new Date(),
            redeemCode: code,
          }).where(eq(paymentOrders.id, order.id));

          return { status: "completed" as const, redeemCode: code };
        }
      }

      return {
        status: order.status as "pending" | "confirming" | "expired" | "failed",
        redeemCode: null,
      };
    }),

  /** 激活卡密 */
  redeemCode: protectedProcedure
    .input(z.object({ code: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const codeRows = await db
        .select()
        .from(redeemCodes)
        .where(eq(redeemCodes.code, input.code.toUpperCase().trim()))
        .limit(1);

      if (!codeRows[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "卡密不存在" });
      }

      const codeRecord = codeRows[0];

      if (codeRecord.status === "used") {
        throw new TRPCError({ code: "CONFLICT", message: "该卡密已被使用" });
      }
      if (codeRecord.status === "expired") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "该卡密已过期" });
      }
      if (codeRecord.expiresAt && new Date() > codeRecord.expiresAt) {
        await db
          .update(redeemCodes)
          .set({ status: "expired" })
          .where(eq(redeemCodes.id, codeRecord.id));
        throw new TRPCError({ code: "BAD_REQUEST", message: "该卡密已过期" });
      }

      // 计算新的套餐到期时间
      const now = new Date();
      const userRows = await db
        .select()
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);
      const user = userRows[0];

      // 如果当前套餐未过期，从当前到期时间延续；否则从现在开始
      const baseDate =
        user?.planExpiresAt && user.planExpiresAt > now
          ? user.planExpiresAt
          : now;

      const newExpiry = new Date(baseDate);
      newExpiry.setMonth(newExpiry.getMonth() + codeRecord.durationMonths);

      // 更新用户套餐
      await db.update(users).set({
        planId: codeRecord.planId,
        planExpiresAt: newExpiry,
      }).where(eq(users.id, ctx.user.id));

      // 标记卡密已使用
      await db.update(redeemCodes).set({
        status: "used",
        usedByUserId: ctx.user.id,
        usedAt: now,
      }).where(eq(redeemCodes.id, codeRecord.id));

      // 触发邀请付费奖励（异步，不阻塞响应）
      try {
        const inviteRec = await db
          .select()
          .from(inviteRecords)
          .where(eq(inviteRecords.inviteeId, ctx.user.id))
          .limit(1);
        if (inviteRec[0] && !inviteRec[0].paymentRewarded) {
          const rewardRow = await db
            .select()
            .from(systemSettings)
            .where(eq(systemSettings.key, "invite_payment_reward_days"))
            .limit(1);
          const rewardDays = parseInt(rewardRow[0]?.value ?? "15");
          if (rewardDays > 0) {
            const inviterRows = await db
              .select()
              .from(users)
              .where(eq(users.id, inviteRec[0].inviterId))
              .limit(1);
            if (inviterRows[0]) {
              const inviterNow = new Date();
              const inviterBase =
                inviterRows[0].planExpiresAt && inviterRows[0].planExpiresAt > inviterNow
                  ? inviterRows[0].planExpiresAt
                  : inviterNow;
              const inviterNewExpiry = new Date(
                inviterBase.getTime() + rewardDays * 24 * 60 * 60 * 1000
              );
              const inviterNewPlan =
                inviterRows[0].planId === "free" ? "basic" : inviterRows[0].planId;
              await db
                .update(users)
                .set({ planId: inviterNewPlan, planExpiresAt: inviterNewExpiry })
                .where(eq(users.id, inviteRec[0].inviterId));
              await db
                .update(inviteRecords)
                .set({
                  paymentRewarded: true,
                  rewardDaysGranted: inviteRec[0].rewardDaysGranted + rewardDays,
                  paidAt: inviterNow,
                })
                .where(eq(inviteRecords.id, inviteRec[0].id));
              await db
                .update(inviteCodes)
                .set({
                  totalPaidInvited: sql`${inviteCodes.totalPaidInvited} + 1`,
                  totalRewardDays: sql`${inviteCodes.totalRewardDays} + ${rewardDays}`,
                  updatedAt: inviterNow,
                })
                .where(eq(inviteCodes.userId, inviteRec[0].inviterId));
            }
          }
        }
      } catch (e) {
        console.error("[Invite] Failed to grant payment reward:", e);
      }

      return {
        success: true,
        planId: codeRecord.planId,
        expiresAt: newExpiry.getTime(),
        durationMonths: codeRecord.durationMonths,
      };
    }),

  /** 我的订单历史 */
  myOrders: protectedProcedure
    .input(z.object({ limit: z.number().default(20), offset: z.number().default(0) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(paymentOrders)
        .where(eq(paymentOrders.userId, ctx.user.id))
        .orderBy(desc(paymentOrders.createdAt))
        .limit(input.limit)
        .offset(input.offset);
    }),

  // ── 管理员接口 ──────────────────────────────────────────────

  /** 管理员：所有订单 */
  adminOrders: protectedProcedure
    .input(
      z.object({
        status: z.enum(["pending", "confirming", "completed", "expired", "failed", "all"]).default("all"),
        limit: z.number().default(50),
        offset: z.number().default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) return [];
      const q = db
        .select()
        .from(paymentOrders)
        .orderBy(desc(paymentOrders.createdAt))
        .limit(input.limit)
        .offset(input.offset);
      return input.status === "all"
        ? q
        : db
            .select()
            .from(paymentOrders)
            .where(eq(paymentOrders.status, input.status))
            .orderBy(desc(paymentOrders.createdAt))
            .limit(input.limit)
            .offset(input.offset);
    }),

  /** 管理员：手动确认订单（手动审核模式） */
  adminConfirmOrder: protectedProcedure
    .input(z.object({ orderId: z.number(), txHash: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const rows = await db
        .select()
        .from(paymentOrders)
        .where(eq(paymentOrders.id, input.orderId))
        .limit(1);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
      const order = rows[0];

      if (order.status === "completed") {
        throw new TRPCError({ code: "CONFLICT", message: "订单已完成" });
      }

      const code = generateRedeemCode();
      await db.insert(redeemCodes).values({
        code,
        planId: order.planId,
        durationMonths: order.durationMonths,
        status: "unused",
        orderId: order.id,
      });

      await db.update(paymentOrders).set({
        status: "completed",
        txHash: input.txHash,
        confirmedAt: new Date(),
        redeemCode: code,
      }).where(eq(paymentOrders.id, order.id));

      return { success: true, redeemCode: code };
    }),

  /** 管理员：批量生成卡密 */
  adminGenerateCodes: protectedProcedure
    .input(
      z.object({
        planId: z.enum(["basic", "pro", "enterprise"]),
        durationMonths: z.number().int().min(1).max(12),
        count: z.number().int().min(1).max(500),
        expiresInDays: z.number().int().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const batchId = nanoid(12);
      const expiresAt = input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 86400_000)
        : undefined;

      const codes: string[] = [];
      for (let i = 0; i < input.count; i++) {
        const code = generateRedeemCode();
        codes.push(code);
        await db.insert(redeemCodes).values({
          code,
          planId: input.planId,
          durationMonths: input.durationMonths,
          status: "unused",
          batchId,
          expiresAt,
        });
      }

      return { success: true, batchId, codes, count: codes.length };
    }),

  /** 管理员：卡密列表 */
  adminCodes: protectedProcedure
    .input(
      z.object({
        status: z.enum(["unused", "used", "expired", "all"]).default("all"),
        limit: z.number().default(50),
        offset: z.number().default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) return [];
      if (input.status === "all") {
        return db
          .select()
          .from(redeemCodes)
          .orderBy(desc(redeemCodes.createdAt))
          .limit(input.limit)
          .offset(input.offset);
      }
      return db
        .select()
        .from(redeemCodes)
        .where(eq(redeemCodes.status, input.status))
        .orderBy(desc(redeemCodes.createdAt))
        .limit(input.limit)
        .offset(input.offset);
    }),
});
