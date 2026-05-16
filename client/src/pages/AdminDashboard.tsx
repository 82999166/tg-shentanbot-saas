import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { useEffect, useState } from "react";
import {
  Users, Activity, Globe, Bot, Zap, TrendingUp, CheckCircle2,
  XCircle, Clock, RefreshCw, Loader2, MessageSquare, BarChart2,
  Shield, Send, AlertTriangle, ArrowUpRight, Hash, Wifi, WifiOff,
  Target, Database, Crown, ShoppingCart
} from "lucide-react";

// ─── 统计卡片组件 ──────────────────────────────────────────────────────────────
function StatCard({
  icon: Icon,
  label,
  value,
  subValue,
  color,
  bgColor,
  onClick,
  loading,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  subValue?: string;
  color: string;
  bgColor: string;
  onClick?: () => void;
  loading?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className={[
        "rounded-xl p-4 border border-slate-200 flex items-center gap-4 transition-all duration-150",
        bgColor,
        onClick ? "cursor-pointer hover:border-slate-300 hover:scale-[1.02]" : "",
      ].join(" ")}
    >
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${color} bg-opacity-20`}
        style={{ background: "rgba(255,255,255,0.05)" }}>
        <Icon className={`w-6 h-6 ${color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-500 mb-0.5">{label}</p>
        {loading ? (
          <div className="h-7 w-16 bg-slate-100 animate-pulse rounded" />
        ) : (
          <p className={`text-2xl font-bold ${color}`}>{value}</p>
        )}
        {subValue && <p className="text-xs text-slate-500 mt-0.5">{subValue}</p>}
      </div>
      {onClick && <ArrowUpRight className="w-4 h-4 text-slate-500 shrink-0" />}
    </div>
  );
}

// ─── 引擎进程状态卡片 ──────────────────────────────────────────────────────────
function EngineStatusCard({
  accounts,
  loading,
  onNavigate,
}: {
  accounts: any[];
  loading: boolean;
  onNavigate: () => void;
}) {
  const online = accounts.filter((a: any) => a.sessionStatus === "active").length;
  const total = accounts.length;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-yellow-400" />
          <span className="text-sm font-semibold text-slate-700">监控引擎状态</span>
        </div>
        <button
          onClick={onNavigate}
          className="text-xs text-slate-500 hover:text-slate-600 flex items-center gap-1 transition-colors"
        >
          管理 <ArrowUpRight className="w-3 h-3" />
        </button>
      </div>
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-10 bg-slate-100 animate-pulse rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {accounts.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-3">暂无监控账号</p>
          ) : (
            accounts.map((acc: any) => (
              <div key={acc.id} className="flex items-center justify-between bg-slate-100 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  {acc.sessionStatus === "active" ? (
                    <Wifi className="w-3.5 h-3.5 text-green-400" />
                  ) : (
                    <WifiOff className="w-3.5 h-3.5 text-red-400" />
                  )}
                  <span className="text-sm text-slate-700 font-medium">
                    {acc.username ? `@${acc.username}` : acc.phone || `账号 ${acc.id}`}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">{acc.joinedGroupsCount ?? 0} 群</span>
                  <span className={[
                    "text-xs px-2 py-0.5 rounded-full font-medium",
                    acc.sessionStatus === "active"
                      ? "bg-green-900/50 text-green-400"
                      : acc.sessionStatus === "banned"
                        ? "bg-red-900/50 text-red-400"
                        : "bg-slate-200 text-slate-500",
                  ].join(" ")}>
                    {acc.sessionStatus === "active" ? "在线" : acc.sessionStatus === "banned" ? "封禁" : "离线"}
                  </span>
                </div>
              </div>
            ))
          )}
          <div className="flex items-center justify-between pt-1 border-t border-slate-200 mt-2">
            <span className="text-xs text-slate-500">在线账号</span>
            <span className={`text-sm font-bold ${online === total && total > 0 ? "text-green-400" : online > 0 ? "text-yellow-400" : "text-red-400"}`}>
              {online} / {total}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 近7日命中趋势 ─────────────────────────────────────────────────────────────
function WeeklyTrendCard({
  weeklyHits,
  loading,
}: {
  weeklyHits: { date: string; count: number }[];
  loading: boolean;
}) {
  const maxCount = Math.max(...(weeklyHits.map(d => d.count) || [1]), 1);
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().slice(0, 10);
  });

  const chartData = last7Days.map(date => {
    const found = weeklyHits.find(d => String(d.date).slice(0, 10) === date);
    return { date, count: found ? Number(found.count) : 0 };
  });

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-semibold text-slate-700">近 7 日命中趋势</span>
      </div>
      {loading ? (
        <div className="h-32 bg-slate-100 animate-pulse rounded-lg" />
      ) : (
        <div className="flex items-end gap-1.5 h-32">
          {chartData.map(({ date, count }) => {
            const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
            const dayLabel = new Date(date + "T00:00:00").toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
            return (
              <div key={date} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-xs text-slate-500 font-medium">{count > 0 ? count : ""}</span>
                <div className="w-full flex flex-col justify-end" style={{ height: 80 }}>
                  <div
                    className="w-full rounded-t-sm bg-blue-600 transition-all duration-500"
                    style={{ height: `${Math.max(pct, count > 0 ? 8 : 2)}%`, minHeight: count > 0 ? 4 : 2, opacity: count > 0 ? 1 : 0.2 }}
                  />
                </div>
                <span className="text-xs text-slate-500">{dayLabel}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Top 关键词 ────────────────────────────────────────────────────────────────
function TopKeywordsCard({
  topKeywords,
  loading,
  onNavigate,
}: {
  topKeywords: { matchedKeyword: string; count: number }[];
  loading: boolean;
  onNavigate: () => void;
}) {
  const maxCount = Math.max(...(topKeywords.map(k => Number(k.count)) || [1]), 1);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Hash className="w-4 h-4 text-purple-400" />
          <span className="text-sm font-semibold text-slate-700">本周 Top 关键词</span>
        </div>
        <button
          onClick={onNavigate}
          className="text-xs text-slate-500 hover:text-slate-600 flex items-center gap-1 transition-colors"
        >
          统计 <ArrowUpRight className="w-3 h-3" />
        </button>
      </div>
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-8 bg-slate-100 animate-pulse rounded" />)}
        </div>
      ) : topKeywords.length === 0 ? (
        <p className="text-xs text-slate-500 text-center py-4">暂无数据</p>
      ) : (
        <div className="space-y-2">
          {topKeywords.map((kw, idx) => {
            const pct = Math.round((Number(kw.count) / maxCount) * 100);
            return (
              <div key={idx} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-600 font-medium truncate max-w-[120px]">{kw.matchedKeyword || "—"}</span>
                  <span className="text-slate-500 shrink-0 ml-2">{kw.count} 次</span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-purple-600 rounded-full transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── 最近命中记录 ──────────────────────────────────────────────────────────────
function RecentHitsCard({
  recentHits,
  loading,
  onNavigate,
}: {
  recentHits: any[];
  loading: boolean;
  onNavigate: () => void;
}) {
  const statusColor: Record<string, string> = {
    sent: "text-green-400",
    pending: "text-yellow-400",
    failed: "text-red-400",
  };
  const statusLabel: Record<string, string> = {
    sent: "已推送",
    pending: "待推送",
    failed: "失败",
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-green-400" />
          <span className="text-sm font-semibold text-slate-700">最近命中记录</span>
        </div>
        <button
          onClick={onNavigate}
          className="text-xs text-slate-500 hover:text-slate-600 flex items-center gap-1 transition-colors"
        >
          全部 <ArrowUpRight className="w-3 h-3" />
        </button>
      </div>
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-12 bg-slate-100 animate-pulse rounded" />)}
        </div>
      ) : recentHits.length === 0 ? (
        <p className="text-xs text-slate-500 text-center py-4">暂无命中记录</p>
      ) : (
        <div className="space-y-1.5">
          {recentHits.slice(0, 8).map((hit: any) => (
            <div key={hit.id} className="flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-2">
              <Target className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span className="text-xs text-slate-600 font-medium truncate flex-1">
                {hit.matchedKeyword || "—"}
              </span>
              <span className="text-xs text-slate-500 shrink-0">
                {new Date(hit.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
              </span>
              <span className={`text-xs shrink-0 ${statusColor[hit.dmStatus] || "text-slate-500"}`}>
                {statusLabel[hit.dmStatus] || hit.dmStatus}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 主仪表盘页面 ──────────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const [, navigate] = useLocation();
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const { data: platformStats, isLoading: platformLoading, refetch: refetchPlatform } =
    trpc.admin.platformStats.useQuery(undefined, { refetchInterval: 30000 });

  const { data: adminStats, isLoading: adminLoading, refetch: refetchAdmin } =
    trpc.admin.stats.useQuery(undefined, { refetchInterval: 30000 });

  const { data: allAccounts = [], isLoading: accountsLoading, refetch: refetchAccounts } =
    trpc.admin.allTgAccounts.useQuery(undefined, { refetchInterval: 30000 });

  const isLoading = platformLoading || adminLoading || accountsLoading;

  const handleRefresh = () => {
    refetchPlatform();
    refetchAdmin();
    refetchAccounts();
    setLastRefresh(new Date());
  };

  // 自动每30秒刷新时间显示
  useEffect(() => {
    const timer = setInterval(() => setLastRefresh(prev => prev), 30000);
    return () => clearInterval(timer);
  }, []);

  const planCounts = adminStats?.planCounts as Record<string, number> ?? {};
  const paidUsers = Object.entries(planCounts)
    .filter(([k]) => k !== "free")
    .reduce((a, [, v]) => a + v, 0);

  const dmSuccessRate = platformStats?.dmSuccessRate ?? 0;
  const weeklyHits = (platformStats?.weeklyHits ?? []) as { date: string; count: number }[];
  const topKeywords = (platformStats?.topKeywords ?? []) as { matchedKeyword: string; count: number }[];
  const recentHits = (platformStats?.recentHits ?? []) as any[];

  return (
    <AdminLayout>
      <div className="p-6 space-y-6">
        {/* ── 页头 ── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <BarChart2 className="w-5 h-5 text-red-400" />
              系统仪表盘
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              平台运行概览 · 每 30 秒自动刷新
              <span className="ml-2 text-slate-500">
                上次刷新: {lastRefresh.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            </p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            刷新
          </button>
        </div>

        {/* ── 核心指标卡片 ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            icon={Users}
            label="注册用户"
            value={platformStats?.totalUsers ?? adminStats?.totalUsers ?? 0}
            subValue={`付费 ${paidUsers} 人`}
            color="text-blue-400"
            bgColor="bg-white"
            onClick={() => navigate("/admin-users")}
            loading={isLoading}
          />
          <StatCard
            icon={Activity}
            label="今日命中"
            value={platformStats?.todayHits ?? 0}
            subValue={`累计 ${(platformStats?.totalHits ?? 0).toLocaleString()} 条`}
            color="text-green-400"
            bgColor="bg-white"
            onClick={() => navigate("/admin-hit-messages")}
            loading={isLoading}
          />
          <StatCard
            icon={Globe}
            label="监控群组"
            value={platformStats?.activeGroups ?? 0}
            subValue="公共群组池"
            color="text-cyan-400"
            bgColor="bg-white"
            onClick={() => navigate("/admin-groups")}
            loading={isLoading}
          />
          <StatCard
            icon={Send}
            label="推送成功率"
            value={`${dmSuccessRate}%`}
            subValue={`今日推送 ${platformStats?.todayDmSent ?? 0} 条`}
            color={dmSuccessRate >= 80 ? "text-green-400" : dmSuccessRate >= 50 ? "text-yellow-400" : "text-red-400"}
            bgColor="bg-white"
            onClick={() => navigate("/admin-hit-messages")}
            loading={isLoading}
          />
        </div>

        {/* ── 第二行指标 ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            icon={Wifi}
            label="在线账号"
            value={`${(allAccounts as any[]).filter((a: any) => a.sessionStatus === "active").length} / ${(allAccounts as any[]).length}`}
            subValue="监控 TG 账号"
            color="text-emerald-400"
            bgColor="bg-white"
            onClick={() => navigate("/admin-accounts")}
            loading={accountsLoading}
          />
          <StatCard
            icon={Crown}
            label="付费用户"
            value={paidUsers}
            subValue={`共 ${adminStats?.totalUsers ?? 0} 用户`}
            color="text-amber-400"
            bgColor="bg-white"
            onClick={() => navigate("/admin-users")}
            loading={adminLoading}
          />
          <StatCard
            icon={Clock}
            label="待推送队列"
            value={platformStats?.pendingQueue ?? 0}
            subValue="等待 Bot 处理"
            color={(platformStats?.pendingQueue ?? 0) > 10 ? "text-red-400" : "text-slate-500"}
            bgColor="bg-white"
            onClick={() => navigate("/admin-hit-messages")}
            loading={platformLoading}
          />
          <StatCard
            icon={ShoppingCart}
            label="订单管理"
            value="查看"
            subValue="财务数据"
            color="text-pink-400"
            bgColor="bg-white"
            onClick={() => navigate("/admin-orders")}
            loading={false}
          />
        </div>

        {/* ── 中间区域：引擎状态 + 趋势图 ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* 引擎状态 */}
          <EngineStatusCard
            accounts={allAccounts as any[]}
            loading={accountsLoading}
            onNavigate={() => navigate("/admin-accounts")}
          />

          {/* 近7日趋势 */}
          <div className="lg:col-span-2">
            <WeeklyTrendCard
              weeklyHits={weeklyHits}
              loading={platformLoading}
            />
          </div>
        </div>

        {/* ── 底部区域：Top关键词 + 最近命中 ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <TopKeywordsCard
            topKeywords={topKeywords}
            loading={platformLoading}
            onNavigate={() => navigate("/admin-keyword-stats")}
          />
          <RecentHitsCard
            recentHits={recentHits}
            loading={platformLoading}
            onNavigate={() => navigate("/admin-hit-messages")}
          />
        </div>

        {/* ── 快速操作入口 ── */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-yellow-400" />
            <span className="text-sm font-semibold text-slate-700">快速入口</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {[
              { icon: Users, label: "客户管理", path: "/admin-users", color: "text-blue-400" },
              { icon: Globe, label: "群组管理", path: "/admin-groups", color: "text-cyan-400" },
              { icon: MessageSquare, label: "命中消息", path: "/admin-hit-messages", color: "text-green-400" },
              { icon: BarChart2, label: "关键词统计", path: "/admin-keyword-stats", color: "text-purple-400" },
              { icon: Shield, label: "防封设置", path: "/admin-antiban", color: "text-orange-400" },
              { icon: Database, label: "系统设置", path: "/system-settings", color: "text-red-400" },
            ].map(item => (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className="flex flex-col items-center gap-2 p-3 rounded-lg bg-slate-100 hover:bg-slate-200 transition-colors group"
              >
                <item.icon className={`w-5 h-5 ${item.color} group-hover:scale-110 transition-transform`} />
                <span className="text-xs text-slate-500 group-hover:text-slate-700 transition-colors">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}