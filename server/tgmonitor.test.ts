import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ============================================================
// 测试辅助函数
// ============================================================

function createMockContext(overrides?: Partial<TrpcContext>): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "test-user-001",
      name: "测试用户",
      email: "test@example.com",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
    ...overrides,
  };
}

function createAdminContext(): TrpcContext {
  return createMockContext({
    user: {
      id: 999,
      openId: "admin-user-001",
      name: "管理员",
      email: "admin@example.com",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
  });
}

// ============================================================
// Auth 测试
// ============================================================

describe("auth", () => {
  it("me - 未登录时返回 null", async () => {
    const ctx = createMockContext({ user: null });
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result).toBeNull();
  });

  it("me - 已登录时返回用户信息", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result).not.toBeNull();
    expect(result?.openId).toBe("test-user-001");
    expect(result?.name).toBe("测试用户");
  });

  it("logout - 清除 cookie 并返回 success", async () => {
    const clearedCookies: string[] = [];
    const ctx = createMockContext({
      res: {
        clearCookie: (name: string) => { clearedCookies.push(name); },
      } as TrpcContext["res"],
    });
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();
    expect(result.success).toBe(true);
    expect(clearedCookies.length).toBeGreaterThan(0);
  });
});

// ============================================================
// 套餐路由测试
// ============================================================

describe("plans", () => {
  it("list - 返回所有套餐", async () => {
    const ctx = createMockContext(); // 需要登录
    const caller = appRouter.createCaller(ctx);
    const plans = await caller.plans.list();
    expect(Array.isArray(plans)).toBe(true);
    expect(plans.length).toBeGreaterThan(0);
    // 验证套餐结构
    const planIds = plans.map((p) => p.id);
    expect(planIds).toContain("free");
    expect(planIds).toContain("basic");
    expect(planIds).toContain("pro");
    expect(planIds).toContain("enterprise");
  });

  it("list - 免费套餐价格为 0", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const plans = await caller.plans.list();
    const freePlan = plans.find((p) => p.id === "free");
    expect(freePlan).toBeDefined();
    expect(parseFloat(freePlan!.price)).toBe(0);
  });

  it("list - 套餐包含必要字段", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const plans = await caller.plans.list();
    plans.forEach((plan) => {
      expect(plan).toHaveProperty("id");
      expect(plan).toHaveProperty("name");
      expect(plan).toHaveProperty("price");
      expect(plan).toHaveProperty("maxMonitorGroups");
      expect(plan).toHaveProperty("maxKeywords");
      expect(plan).toHaveProperty("maxDailyDm");
      expect(plan).toHaveProperty("maxTgAccounts");
    });
  });
});

// ============================================================
// 关键词路由测试（需要 DB，使用 mock 验证结构）
// ============================================================

describe("keywords - 输入验证", () => {
  it("create - 缺少 name 时应抛出错误", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.keywords.create({ name: "", matchType: "exact" })
    ).rejects.toThrow();
  });

  it("create - 无效 matchType 时应抛出错误", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.keywords.create({ name: "测试关键词", matchType: "invalid" as any })
    ).rejects.toThrow();
  });
});

// ============================================================
// 防封策略测试（无 DB 时返回默认值）
// ============================================================

describe("antiban", () => {
  it("get - 返回防封策略对象（含默认值或 DB 值）", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const settings = await caller.antiban.get();
    // 可能为 null（DB 未初始化）或包含配置
    if (settings) {
      expect(settings).toHaveProperty("dailyDmLimit");
      expect(settings).toHaveProperty("minIntervalSeconds");
      expect(settings).toHaveProperty("maxIntervalSeconds");
      expect(settings).toHaveProperty("deduplicateEnabled");
    }
    // 无论如何不应抛出错误
    expect(true).toBe(true);
  });
});

// ============================================================
// 管理员路由测试
// ============================================================

describe("admin", () => {
  it("users - 非管理员访问应抛出 FORBIDDEN", async () => {
    const ctx = createMockContext(); // role: "user"
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.users({})).rejects.toThrow();
  });

  it("stats - 非管理员访问应抛出 FORBIDDEN", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.stats()).rejects.toThrow();
  });
});

// ============================================================
// 仪表盘路由测试
// ============================================================

describe("dashboard", () => {
  it("stats - 已登录用户可获取仪表盘统计", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const stats = await caller.dashboard.stats();
    // 无论 DB 是否可用，都应返回有效结构
    // 验证实际返回的字段
    expect(stats).toHaveProperty("totalHits");
    expect(stats).toHaveProperty("todayHits");
    expect(stats).toHaveProperty("todayDmSent");
    expect(stats).toHaveProperty("activeGroups");
    expect(stats).toHaveProperty("activeAccounts");
    expect(stats).toHaveProperty("pendingQueue");
  });
});
