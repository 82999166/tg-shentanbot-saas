import { z } from "zod";
import { eq, desc, and, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  inviteCodes,
  inviteRecords,
  users,
  plans,
  systemSettings,
} from "../../drizzle/schema";
import { nanoid } from "nanoid";

// ── 工具函数 ──────────────────────────────────────────────────

/** 生成邀请码，格式：TGM-XXXXXX（6位大写字母数字） */
function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "TGM-";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
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

/** 给用户延长套餐天数 */
async function grantRewardDays(userId: number, days: number): Promise<void> {
  const db = await getDb();
  if (!db || days <= 0) return;

  const user = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user[0]) return;

  const now = new Date();
  const currentExpiry = user[0].planExpiresAt;

  // 如果套餐已过期或是免费版，先升级到基础版
  let baseDate = currentExpiry && currentExpiry > now ? currentExpiry : now;

  // 如果是免费版，升级到基础版
  const newPlanId = user[0].planId === "free" ? "basic" : user[0].planId;
  const newExpiry = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);

  await db
    .update(users)
    .set({
      planId: newPlanId,
      planExpiresAt: newExpiry,
      updatedAt: now,
    })
    .where(eq(users.id, userId));
}

// ── 路由 ──────────────────────────────────────────────────────

export const inviteRouter = router({
  /** 获取或创建当前用户的邀请码 */
  myCode: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    // 查找已有邀请码
    let existing = await db
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.userId, ctx.user.id))
      .limit(1);

    if (existing.length > 0) {
      return existing[0];
    }

    // 创建新邀请码（确保唯一）
    let code = generateInviteCode();
    let attempts = 0;
    while (attempts < 10) {
      const dup = await db
        .select()
        .from(inviteCodes)
        .where(eq(inviteCodes.code, code))
        .limit(1);
      if (dup.length === 0) break;
      code = generateInviteCode();
      attempts++;
    }

    await db.insert(inviteCodes).values({
      userId: ctx.user.id,
      code,
      totalInvited: 0,
      totalPaidInvited: 0,
      totalRewardDays: 0,
    });

    const created = await db
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.userId, ctx.user.id))
      .limit(1);
    return created[0];
  }),

  /** 获取邀请记录列表 */
  myRecords: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const records = await db
      .select({
        id: inviteRecords.id,
        inviteeId: inviteRecords.inviteeId,
        inviteeName: users.name,
        inviteeEmail: users.email,
        inviteePlanId: users.planId,
        registrationRewarded: inviteRecords.registrationRewarded,
        paymentRewarded: inviteRecords.paymentRewarded,
        rewardDaysGranted: inviteRecords.rewardDaysGranted,
        registeredAt: inviteRecords.registeredAt,
        paidAt: inviteRecords.paidAt,
      })
      .from(inviteRecords)
      .leftJoin(users, eq(inviteRecords.inviteeId, users.id))
      .where(eq(inviteRecords.inviterId, ctx.user.id))
      .orderBy(desc(inviteRecords.registeredAt))
      .limit(100);

    return records;
  }),

  /** 获取邀请排行榜（前 20 名） */
  leaderboard: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const board = await db
      .select({
        userId: inviteCodes.userId,
        userName: users.name,
        code: inviteCodes.code,
        totalInvited: inviteCodes.totalInvited,
        totalPaidInvited: inviteCodes.totalPaidInvited,
        totalRewardDays: inviteCodes.totalRewardDays,
      })
      .from(inviteCodes)
      .leftJoin(users, eq(inviteCodes.userId, users.id))
      .orderBy(desc(inviteCodes.totalPaidInvited))
      .limit(20);

    return board;
  }),

  /** 获取邀请奖励配置 */
  rewardConfig: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const rows = await db
      .select()
      .from(systemSettings)
      .where(
        sql`${systemSettings.key} IN ('invite_register_reward_days', 'invite_payment_reward_days', 'invite_enabled')`
      );

    const config: Record<string, string> = {};
    rows.forEach((r) => {
      config[r.key] = r.value ?? "";
    });

    return {
      enabled: config["invite_enabled"] !== "false",
      registerRewardDays: parseInt(config["invite_register_reward_days"] ?? "3"),
      paymentRewardDays: parseInt(config["invite_payment_reward_days"] ?? "15"),
    };
  }),

  /** 注册时绑定邀请关系（公开接口，注册后调用） */
  bindInvite: publicProcedure
    .input(z.object({ code: z.string(), inviteeId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { success: false };

      // 检查邀请功能是否开启
      const enabled = await getSetting("invite_enabled");
      if (enabled === "false") return { success: false };

      // 查找邀请码
      const inviteCode = await db
        .select()
        .from(inviteCodes)
        .where(eq(inviteCodes.code, input.code.toUpperCase()))
        .limit(1);
      if (!inviteCode[0]) return { success: false, error: "邀请码不存在" };

      const inviterId = inviteCode[0].userId;

      // 不能自己邀请自己
      if (inviterId === input.inviteeId) return { success: false, error: "不能使用自己的邀请码" };

      // 检查是否已被邀请
      const existing = await db
        .select()
        .from(inviteRecords)
        .where(eq(inviteRecords.inviteeId, input.inviteeId))
        .limit(1);
      if (existing.length > 0) return { success: false, error: "已使用过邀请码" };

      // 创建邀请记录
      await db.insert(inviteRecords).values({
        inviterId,
        inviteeId: input.inviteeId,
        inviteCode: input.code.toUpperCase(),
        registrationRewarded: false,
        paymentRewarded: false,
        rewardDaysGranted: 0,
      });

      // 更新邀请码统计
      await db
        .update(inviteCodes)
        .set({
          totalInvited: sql`${inviteCodes.totalInvited} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(inviteCodes.userId, inviterId));

      // 发放注册奖励
      const registerRewardDays = parseInt(
        (await getSetting("invite_register_reward_days")) ?? "3"
      );
      if (registerRewardDays > 0) {
        await grantRewardDays(inviterId, registerRewardDays);

        // 更新记录
        await db
          .update(inviteRecords)
          .set({
            registrationRewarded: true,
            rewardDaysGranted: registerRewardDays,
          })
          .where(
            and(
              eq(inviteRecords.inviterId, inviterId),
              eq(inviteRecords.inviteeId, input.inviteeId)
            )
          );

        // 更新邀请码累计奖励天数
        await db
          .update(inviteCodes)
          .set({
            totalRewardDays: sql`${inviteCodes.totalRewardDays} + ${registerRewardDays}`,
            updatedAt: new Date(),
          })
          .where(eq(inviteCodes.userId, inviterId));
      }

      return { success: true };
    }),

  /** 付费后触发邀请奖励（内部调用） */
  triggerPaymentReward: protectedProcedure
    .input(z.object({ inviteeId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { success: false };

      // 查找邀请记录
      const record = await db
        .select()
        .from(inviteRecords)
        .where(eq(inviteRecords.inviteeId, input.inviteeId))
        .limit(1);
      if (!record[0] || record[0].paymentRewarded) return { success: false };

      const paymentRewardDays = parseInt(
        (await getSetting("invite_payment_reward_days")) ?? "15"
      );
      if (paymentRewardDays <= 0) return { success: false };

      // 发放付费奖励给邀请人
      await grantRewardDays(record[0].inviterId, paymentRewardDays);

      // 更新记录
      await db
        .update(inviteRecords)
        .set({
          paymentRewarded: true,
          rewardDaysGranted: record[0].rewardDaysGranted + paymentRewardDays,
          paidAt: new Date(),
        })
        .where(eq(inviteRecords.id, record[0].id));

      // 更新邀请码统计
      await db
        .update(inviteCodes)
        .set({
          totalPaidInvited: sql`${inviteCodes.totalPaidInvited} + 1`,
          totalRewardDays: sql`${inviteCodes.totalRewardDays} + ${paymentRewardDays}`,
          updatedAt: new Date(),
        })
        .where(eq(inviteCodes.userId, record[0].inviterId));

      return { success: true, rewardDays: paymentRewardDays };
    }),
});
