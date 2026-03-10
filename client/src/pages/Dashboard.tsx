import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Activity,
  Bot,
  CheckCircle2,
  Clock,
  Hash,
  MessageSquare,
  Monitor,
  Send,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { useLocation } from "wouter";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
  onClick?: () => void;
}) {
  return (
    <Card
      className={`bg-card border-border hover:border-primary/30 transition-all duration-200 ${onClick ? "cursor-pointer" : ""}`}
      onClick={onClick}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground mb-1">{label}</p>
            <p className="text-2xl font-bold text-foreground">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div className={`w-10 h-10 rounded-lg ${color} flex items-center justify-center`}>
            <Icon className="w-5 h-5 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function dmStatusBadge(status: string) {
  const map: Record<string, { label: string; className: string }> = {
    none: { label: "未发送", className: "bg-slate-700 text-slate-300" },
    queued: { label: "排队中", className: "bg-blue-900 text-blue-300" },
    sent: { label: "已发送", className: "bg-emerald-900 text-emerald-300" },
    failed: { label: "失败", className: "bg-red-900 text-red-300" },
    skipped: { label: "已跳过", className: "bg-slate-700 text-slate-400" },
  };
  const s = map[status] ?? map.none;
  return <Badge className={`text-xs ${s.className} border-0`}>{s.label}</Badge>;
}

export default function Dashboard() {
  const [, navigate] = useLocation();
  const { data: stats, isLoading } = trpc.dashboard.stats.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const weeklyData = stats?.weeklyHits?.map((d) => ({
    date: d.date?.slice(5) ?? "",
    命中数: d.count,
  })) ?? [];

  const topKwData = stats?.topKeywords?.map((k) => ({
    name: k.matchedKeyword?.slice(0, 8) ?? "",
    次数: k.count,
  })) ?? [];

  return (
    <AppLayout title="仪表盘">
      <div className="p-6 space-y-6">
        {/* 统计卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <StatCard
            icon={Activity}
            label="今日命中"
            value={isLoading ? "—" : stats?.todayHits ?? 0}
            color="bg-blue-600"
            onClick={() => navigate("/records")}
          />
          <StatCard
            icon={Send}
            label="今日发信"
            value={isLoading ? "—" : stats?.todayDmSent ?? 0}
            color="bg-emerald-600"
            onClick={() => navigate("/queue")}
          />
          <StatCard
            icon={TrendingUp}
            label="总命中数"
            value={isLoading ? "—" : stats?.totalHits ?? 0}
            color="bg-purple-600"
            onClick={() => navigate("/records")}
          />
          <StatCard
            icon={Monitor}
            label="活跃群组"
            value={isLoading ? "—" : stats?.activeGroups ?? 0}
            color="bg-cyan-600"
            onClick={() => navigate("/monitor")}
          />
          <StatCard
            icon={Bot}
            label="活跃账号"
            value={isLoading ? "—" : stats?.activeAccounts ?? 0}
            color="bg-indigo-600"
            onClick={() => navigate("/accounts")}
          />
          <StatCard
            icon={Clock}
            label="待发队列"
            value={isLoading ? "—" : stats?.pendingQueue ?? 0}
            sub={`发信成功率 ${stats?.dmSuccessRate ?? 0}%`}
            color="bg-amber-600"
            onClick={() => navigate("/queue")}
          />
        </div>

        {/* 图表区域 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 命中趋势 */}
          <Card className="lg:col-span-2 bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                近7天命中趋势
              </CardTitle>
            </CardHeader>
            <CardContent>
              {weeklyData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={weeklyData}>
                    <defs>
                      <linearGradient id="colorHits" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="oklch(0.60 0.20 240)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="oklch(0.60 0.20 240)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.22 0.015 240)" />
                    <XAxis dataKey="date" tick={{ fill: "oklch(0.55 0.01 240)", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "oklch(0.55 0.01 240)", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ background: "oklch(0.14 0.015 240)", border: "1px solid oklch(0.22 0.015 240)", borderRadius: "8px", color: "oklch(0.92 0.01 240)" }}
                    />
                    <Area type="monotone" dataKey="命中数" stroke="oklch(0.60 0.20 240)" fill="url(#colorHits)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
                  暂无数据，开始监控后将显示趋势图
                </div>
              )}
            </CardContent>
          </Card>

          {/* 热门关键词 */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Hash className="w-4 h-4" />
                热门关键词 Top 5
              </CardTitle>
            </CardHeader>
            <CardContent>
              {topKwData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={topKwData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.22 0.015 240)" horizontal={false} />
                    <XAxis type="number" tick={{ fill: "oklch(0.55 0.01 240)", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis dataKey="name" type="category" tick={{ fill: "oklch(0.55 0.01 240)", fontSize: 11 }} axisLine={false} tickLine={false} width={60} />
                    <Tooltip
                      contentStyle={{ background: "oklch(0.14 0.015 240)", border: "1px solid oklch(0.22 0.015 240)", borderRadius: "8px", color: "oklch(0.92 0.01 240)" }}
                    />
                    <Bar dataKey="次数" fill="oklch(0.60 0.20 240)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
                  暂无数据
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 最近命中记录 */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Activity className="w-4 h-4" />
              最近命中记录
            </CardTitle>
            <button
              onClick={() => navigate("/records")}
              className="text-xs text-primary hover:underline"
            >
              查看全部
            </button>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 bg-muted/30 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : stats?.recentHits && stats.recentHits.length > 0 ? (
              <div className="space-y-2">
                {stats.recentHits.map((hit) => (
                  <div
                    key={hit.id}
                    className="flex items-center gap-4 p-3 bg-background/50 rounded-lg border border-border/50 hover:border-border transition-colors"
                  >
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                      <Users className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-foreground">
                          {hit.senderUsername ? `@${hit.senderUsername}` : `ID: ${hit.senderTgId}`}
                        </span>
                        <Badge className="text-xs bg-primary/20 text-primary border-0">
                          {hit.matchedKeyword}
                        </Badge>
                        {dmStatusBadge(hit.dmStatus)}
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {hit.messageContent}
                      </p>
                    </div>
                    <div className="text-xs text-muted-foreground shrink-0">
                      {new Date(hit.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center text-muted-foreground text-sm">
                <Activity className="w-8 h-8 mx-auto mb-3 opacity-30" />
                <p>暂无命中记录</p>
                <p className="text-xs mt-1">添加监控群组和关键词后开始监控</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
