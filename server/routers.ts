import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router, protectedProcedure } from "./_core/trpc";
import { plansRouter } from "./routers/plans";
import { tgAccountsRouter } from "./routers/tgAccounts";
import { keywordsRouter } from "./routers/keywords";
import { monitorGroupsRouter } from "./routers/monitorGroups";
import { templatesRouter } from "./routers/templates";
import { hitRecordsRouter, dmQueueRouter, antibanRouter, blacklistRouter, dashboardRouter, adminRouter } from "./routers/hitRecords";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // 功能路由
  plans: plansRouter,
  tgAccounts: tgAccountsRouter,
  keywords: keywordsRouter,
  monitorGroups: monitorGroupsRouter,
  templates: templatesRouter,
  hitRecords: hitRecordsRouter,
  dmQueue: dmQueueRouter,
  antiban: antibanRouter,
  blacklist: blacklistRouter,
  dashboard: dashboardRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;
