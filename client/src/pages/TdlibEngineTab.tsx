/**
 * 监控引擎状态 Tab
 * 显示 shentanbot 引擎运行状态、账号健康、群组监控、消息命中等实时指标
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Activity, RefreshCw, Wifi, WifiOff, Shield,
  Server, AlertTriangle, CheckCircle2,
  TrendingUp, Users, Hash, ChevronDown, ChevronUp,
  MessageSquare, Send, Globe, Zap,
} from "lucide-react";

// ── 引擎状态卡片 ──────────────────────────────────────────────────
function EngineStatusCard({ heartbeat, platformStats }: { heartbeat: any; platformStats: any }) {
  const lastSeen = heartbeat?.timestamp
    ? new Date(heartbeat.timestamp > 1e12 ? heartbeat.timestamp : heartbeat.timestamp * 1000)
    : null;
  const secondsAgo = lastSeen ? Math.floor((Date.now() - lastSeen.getTime()) / 1000) : null;
  const isOnline = secondsAgo !== null && secondsAgo < 120;

  if (!heartbeat && !platformStats) {
    return (
      <Card className="bg-slate-800 border-slate-700">
        <CardContent className="p-6 flex flex-col items-center justify-center gap-3 text-center">
          <WifiOff className="w-10 h-10 text-slate-500" />
          <p className="text-slate-400 text-sm">引擎未连接</p>
          <p className="text-slate-600 text-xs">尚未收到心跳，请确认监控引擎已启动</p>
        </CardContent>
      </Card>
    );
  }

  const activeAccounts = heartbeat?.activeAccounts ?? platformStats?.activeAccounts ?? 0;
  const totalGroups = heartbeat?.totalGroups ?? platformStats?.activeGroups ?? 0;

  return (
    <Card className={`border ${isOnline ? "bg-green-950/30 border-green-800" : "bg-slate-800 border-slate-700"}`}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {isOnline
              ? <Wifi className="w-5 h-5 text-green-400" />
              : <WifiOff className="w-5 h-5 text-slate-400" />
            }
            <span className="font-semibold text-white">引擎状态</span>
          </div>
          <Badge className={isOnline ? "bg-green-700 text-green-100" : "bg-slate-600 text-slate-300"}>
            {isOnline ? "在线" : "心跳未知"}
          </Badge>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="bg-slate-800/60 rounded-lg p-3">
            <p className="text-slate-400 text-xs mb-1">引擎类型</p>
            <p className="text-white font-mono font-bold">🐍 Pyrogram</p>
          </div>
          <div className="bg-slate-800/60 rounded-lg p-3">
            <p className="text-slate-400 text-xs mb-1">最后心跳</p>
            <p className="text-slate-300 text-xs font-medium">
              {lastSeen && secondsAgo !== null
                ? secondsAgo < 60
                  ? `${secondsAgo}秒前`
                  : secondsAgo < 3600
                  ? `${Math.floor(secondsAgo / 60)}分钟前`
                  : `${Math.floor(secondsAgo / 3600)}小时前`
                : "—"}
            </p>
          </div>
          <div className="bg-slate-800/60 rounded-lg p-3">
            <p className="text-slate-400 text-xs mb-1">活跃账号</p>
            <p className="text-green-400 font-bold text-lg">{activeAccounts}</p>
          </div>
          <div className="bg-slate-800/60 rounded-lg p-3">
            <p className="text-slate-400 text-xs mb-1">监控群组</p>
            <p className="text-blue-400 font-bold text-lg">{totalGroups}</p>
          </div>
          <div className="bg-slate-800/60 rounded-lg p-3">
            <p className="text-slate-400 text-xs mb-1">今日命中</p>
            <p className="text-yellow-400 font-bold text-lg">{platformStats?.todayHits ?? 0}</p>
          </div>
          <div className="bg-slate-800/60 rounded-lg p-3">
            <p className="text-slate-400 text-xs mb-1">待处理私信</p>
            <p className="text-orange-400 font-bold text-lg">{platformStats?.pendingQueue ?? 0}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── 统计数据卡片行 ────────────────────────────────────────────────
function StatsRow({ platformStats }: { platformStats: any }) {
  if (!platformStats) return null;
  const cards = [
    { icon: <MessageSquare className="w-4 h-4 text-yellow-400" />, label: "今日命中", value: platformStats.todayHits ?? 0, color: "text-yellow-400" },
    { icon: <TrendingUp className="w-4 h-4 text-blue-400" />, label: "累计命中", value: platformStats.totalHits ?? 0, color: "text-blue-400" },
    { icon: <Send className="w-4 h-4 text-green-400" />, label: "今日私信", value: platformStats.todayDmSent ?? 0, color: "text-green-400" },
    { icon: <Globe className="w-4 h-4 text-purple-400" />, label: "监控群组", value: platformStats.activeGroups ?? 0, color: "text-purple-400" },
    { icon: <Users className="w-4 h-4 text-cyan-400" />, label: "活跃账号", value: platformStats.activeAccounts ?? 0, color: "text-cyan-400" },
    { icon: <Zap className="w-4 h-4 text-orange-400" />, label: "私信成功率", value: `${platformStats.dmSuccessRate ?? 0}%`, color: "text-orange-400" },
  ];
  return (
    <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
      {cards.map((c, i) => (
        <Card key={i} className="bg-slate-800 border-slate-700">
          <CardContent className="p-3 text-center">
            <div className="flex justify-center mb-1">{c.icon}</div>
            <p className={`font-bold text-base ${c.color}`}>{c.value}</p>
            <p className="text-slate-500 text-xs mt-0.5">{c.label}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── 账号健康度列表 ────────────────────────────────────────────────
function AccountHealthList({ accounts }: { accounts: any[] }) {
  const [expanded, setExpanded] = useState(true);

  const healthColor = (score: number) => {
    if (score >= 80) return "text-green-400";
    if (score >= 60) return "text-yellow-400";
    if (score >= 40) return "text-orange-400";
    return "text-red-400";
  };

  const statusLabel: Record<string, string> = {
    active: "运行中", limited: "受限", banned: "已封禁",
    needs_2fa: "需验证", error: "异常", inactive: "未激活",
  };

  return (
    <Card className="bg-slate-800 border-slate-700">
      <CardHeader className="pb-2">
        <button
          className="flex items-center justify-between w-full text-left"
          onClick={() => setExpanded(!expanded)}
        >
          <CardTitle className="text-sm font-semibold text-slate-300 flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue-400" />
            账号健康度监控
            <Badge className="bg-slate-700 text-slate-300 text-xs ml-1">{accounts.length}</Badge>
          </CardTitle>
          {expanded ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
        </button>
      </CardHeader>
      {expanded && (
        <CardContent className="pt-0">
          {accounts.length === 0 ? (
            <p className="text-slate-500 text-xs text-center py-4">暂无账号数据</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {accounts.map((acc) => {
                const score = acc.healthScore ?? (acc.sessionStatus === "active" ? 90 : acc.sessionStatus === "banned" ? 10 : 50);
                return (
                  <div key={acc.id} className="bg-slate-700/50 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-white text-sm font-medium truncate">
                          {acc.tgFirstName ?? acc.phone ?? `账号 #${acc.id}`}
                        </p>
                        <p className="text-slate-400 text-xs font-mono flex items-center gap-2">
                          {acc.phone ?? (acc.tgUsername ? `@${acc.tgUsername}` : `ID: ${acc.id}`)}
                          {acc.joinedGroupCount !== undefined && (
                            <span className="text-blue-400">已加 {acc.joinedGroupCount} 群</span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className={`font-bold text-sm ${healthColor(score)}`}>{score}</span>
                        <Badge className={`text-xs border ${
                          acc.sessionStatus === "active"
                            ? "border-green-700 text-green-300"
                            : acc.sessionStatus === "banned"
                            ? "border-red-700 text-red-300"
                            : "border-slate-600 text-slate-400"
                        }`}>
                          {statusLabel[acc.sessionStatus ?? "inactive"] ?? acc.sessionStatus ?? "未知"}
                        </Badge>
                      </div>
                    </div>
                    <Progress
                      value={score}
                      className="h-1.5"
                      style={{
                        "--progress-bg": score >= 80 ? "#22c55e" : score >= 60 ? "#eab308" : score >= 40 ? "#f97316" : "#ef4444",
                      } as React.CSSProperties}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ── 引擎特性说明卡片 ──────────────────────────────────────────────
function EngineFeaturesCard() {
  return (
    <Card className="bg-slate-800 border-slate-700">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-slate-300 flex items-center gap-2">
          <Server className="w-4 h-4 text-blue-400" />
          引擎核心能力
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {[
          { icon: <Activity className="w-3.5 h-3.5 text-green-400" />, title: "多账号并发监控", desc: "多个 TG 账号同时监控，轮流分配群组，互不干扰" },
          { icon: <Globe className="w-3.5 h-3.5 text-blue-400" />, title: "公共群组池", desc: "统一管理公共群组，每群只加一个账号，高效利用资源" },
          { icon: <MessageSquare className="w-3.5 h-3.5 text-yellow-400" />, title: "关键词命中推送", desc: "实时扫描消息，命中关键词后立即通知用户" },
          { icon: <Send className="w-3.5 h-3.5 text-purple-400" />, title: "自动私信发送", desc: "命中后自动发送私信，支持模板变量和防封策略" },
          { icon: <Shield className="w-3.5 h-3.5 text-orange-400" />, title: "断线自动重连", desc: "网络中断后自动重连，账号异常自动切换备用账号" },
        ].map((f, i) => (
          <div key={i} className="flex items-start gap-2.5 bg-slate-700/40 rounded-lg p-2.5">
            <div className="mt-0.5 shrink-0">{f.icon}</div>
            <div>
              <p className="text-white text-xs font-medium">{f.title}</p>
              <p className="text-slate-400 text-xs mt-0.5">{f.desc}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ── 近期命中 Top 关键词 ───────────────────────────────────────────
function TopKeywordsCard({ topKeywords }: { topKeywords: any[] }) {
  if (!topKeywords || topKeywords.length === 0) return null;
  return (
    <Card className="bg-slate-800 border-slate-700">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-slate-300 flex items-center gap-2">
          <Hash className="w-4 h-4 text-yellow-400" />
          近7日 Top 关键词
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {topKeywords.map((kw, i) => (
          <div key={i} className="flex items-center justify-between bg-slate-700/40 rounded-lg px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-slate-500 text-xs w-4">{i + 1}</span>
              <span className="text-white text-sm font-medium">{kw.matchedKeyword ?? `关键词 #${kw.keywordId}`}</span>
            </div>
            <Badge className="bg-yellow-900/50 text-yellow-300 border border-yellow-800 text-xs">
              {kw.count} 次
            </Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────
export default function TdlibEngineTab() {
  const { data: heartbeatConfig, refetch, isRefetching } = trpc.sysConfig.getPublic.useQuery(
    { key: "engine_last_heartbeat" },
    { refetchInterval: 30_000 }
  );
  const { data: allAccounts = [] } = trpc.admin.allTgAccounts.useQuery();
  const { data: platformStats, refetch: refetchStats } = trpc.admin.platformStats.useQuery(
    undefined,
    { refetchInterval: 60_000 }
  );

  let heartbeat: any = null;
  try {
    if (heartbeatConfig?.value) {
      heartbeat = JSON.parse(heartbeatConfig.value);
    }
  } catch (_) {}

  const handleRefresh = () => {
    refetch();
    refetchStats();
  };

  // 判断引擎是否在线：优先用心跳，其次看活跃账号数
  const lastSeen = heartbeat?.timestamp
    ? new Date(heartbeat.timestamp > 1e12 ? heartbeat.timestamp : heartbeat.timestamp * 1000)
    : null;
  const secondsAgo = lastSeen ? Math.floor((Date.now() - lastSeen.getTime()) / 1000) : null;
  const isOnline = secondsAgo !== null && secondsAgo < 120;

  return (
    <div className="space-y-4">
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-white font-semibold text-base flex items-center gap-2">
            <Activity className="w-5 h-5 text-green-400" />
            监控引擎状态
          </h2>
          <p className="text-slate-400 text-xs mt-0.5">
            实时监控 Pyrogram 引擎运行状态、账号健康度和消息命中情况
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="border-slate-600 text-slate-300 hover:bg-slate-700 h-8"
          onClick={handleRefresh}
          disabled={isRefetching}
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isRefetching ? "animate-spin" : ""}`} />
          刷新
        </Button>
      </div>

      {/* 引擎状态卡片 */}
      <EngineStatusCard heartbeat={heartbeat} platformStats={platformStats} />

      {/* 引擎在线提示 */}
      {isOnline && (
        <div className="flex items-start gap-2.5 bg-green-950/30 border border-green-800 rounded-lg p-3">
          <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-green-300 text-sm font-medium">监控引擎运行正常</p>
            <p className="text-green-400/70 text-xs mt-0.5">
              Pyrogram 引擎已连接，{secondsAgo}秒前收到心跳，
              当前活跃 {heartbeat?.activeAccounts ?? 0} 个账号，
              监控 {heartbeat?.totalGroups ?? 0} 个群组。
            </p>
          </div>
        </div>
      )}

      {!isOnline && heartbeat && (
        <div className="flex items-start gap-2.5 bg-yellow-950/30 border border-yellow-800 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-yellow-300 text-sm font-medium">引擎心跳超时</p>
            <p className="text-yellow-400/70 text-xs mt-0.5">
              最后心跳时间超过 2 分钟，请检查引擎进程是否正常运行。
            </p>
          </div>
        </div>
      )}

      {/* 统计数据行 */}
      <StatsRow platformStats={platformStats} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 账号健康度 */}
        <AccountHealthList accounts={allAccounts} />
        {/* 引擎特性 */}
        <div className="space-y-4">
          <TopKeywordsCard topKeywords={platformStats?.topKeywords ?? []} />
          <EngineFeaturesCard />
        </div>
      </div>
    </div>
  );
}
