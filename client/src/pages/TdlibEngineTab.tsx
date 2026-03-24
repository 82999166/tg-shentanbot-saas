/**
 * TDLib 引擎状态监控 Tab
 * 显示引擎心跳、账号健康、updates gap 恢复次数等 TDLib 专属指标
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Cpu, Activity, RefreshCw, Wifi, WifiOff, Zap, Shield,
  Clock, Server, Database, AlertTriangle, CheckCircle2,
  TrendingUp, Users, Hash, ChevronDown, ChevronUp,
} from "lucide-react";

// ── 心跳状态卡片 ──────────────────────────────────────────────────
function HeartbeatCard({ heartbeat }: { heartbeat: any }) {
  if (!heartbeat) {
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

  const lastSeen = heartbeat.timestamp ? new Date(heartbeat.timestamp) : null;
  const secondsAgo = lastSeen ? Math.floor((Date.now() - lastSeen.getTime()) / 1000) : null;
  const isOnline = secondsAgo !== null && secondsAgo < 120;

  return (
    <Card className={`border ${isOnline ? "bg-green-950/30 border-green-800" : "bg-red-950/30 border-red-800"}`}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {isOnline
              ? <Wifi className="w-5 h-5 text-green-400" />
              : <WifiOff className="w-5 h-5 text-red-400" />
            }
            <span className="font-semibold text-white">引擎状态</span>
          </div>
          <Badge className={isOnline ? "bg-green-700 text-green-100" : "bg-red-700 text-red-100"}>
            {isOnline ? "在线" : "离线"}
          </Badge>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="bg-slate-800/60 rounded-lg p-3">
            <p className="text-slate-400 text-xs mb-1">引擎类型</p>
            <p className="text-white font-mono font-bold">
              {heartbeat.engineType === "tdlib" ? "🚀 TDLib" : "🐍 Pyrogram"}
            </p>
          </div>
          <div className="bg-slate-800/60 rounded-lg p-3">
            <p className="text-slate-400 text-xs mb-1">TDLib 版本</p>
            <p className="text-white font-mono font-bold">{heartbeat.tdlibVersion ?? "—"}</p>
          </div>
          <div className="bg-slate-800/60 rounded-lg p-3">
            <p className="text-slate-400 text-xs mb-1">活跃账号</p>
            <p className="text-green-400 font-bold text-lg">{heartbeat.activeAccounts ?? 0}</p>
          </div>
          <div className="bg-slate-800/60 rounded-lg p-3">
            <p className="text-slate-400 text-xs mb-1">监控群组</p>
            <p className="text-blue-400 font-bold text-lg">{heartbeat.totalGroups ?? 0}</p>
          </div>
          <div className="bg-slate-800/60 rounded-lg p-3">
            <p className="text-slate-400 text-xs mb-1">Gap 恢复次数</p>
            <p className="text-yellow-400 font-bold text-lg">{heartbeat.gapRecoveries ?? 0}</p>
          </div>
          <div className="bg-slate-800/60 rounded-lg p-3">
            <p className="text-slate-400 text-xs mb-1">最后心跳</p>
            <p className="text-slate-300 text-xs">
              {lastSeen
                ? secondsAgo! < 60
                  ? `${secondsAgo}秒前`
                  : `${Math.floor(secondsAgo! / 60)}分钟前`
                : "—"
              }
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
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

  const healthBg = (score: number) => {
    if (score >= 80) return "bg-green-500";
    if (score >= 60) return "bg-yellow-500";
    if (score >= 40) return "bg-orange-500";
    return "bg-red-500";
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
                const score = acc.healthScore ?? 80;
                return (
                  <div key={acc.id} className="bg-slate-700/50 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-white text-sm font-medium truncate">
                          {acc.tgFirstName ?? acc.phone ?? `账号 #${acc.id}`}
                        </p>
                        <p className="text-slate-400 text-xs font-mono">
                          {acc.phone ?? (acc.tgUsername ? `@${acc.tgUsername}` : `ID: ${acc.id}`)}
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

// ── TDLib 特性说明卡片 ────────────────────────────────────────────
function TdlibFeaturesCard() {
  return (
    <Card className="bg-slate-800 border-slate-700">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-slate-300 flex items-center gap-2">
          <Zap className="w-4 h-4 text-yellow-400" />
          TDLib 核心优势
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {[
          { icon: <Database className="w-3.5 h-3.5 text-blue-400" />, title: "Updates Gap 自动修复", desc: "内置 getDifference 机制，断线后自动补齐丢失消息" },
          { icon: <Server className="w-3.5 h-3.5 text-green-400" />, title: "状态持久化", desc: "td.binlog 持久化 session 状态，重启无需重新登录" },
          { icon: <Activity className="w-3.5 h-3.5 text-purple-400" />, title: "断线自动重连", desc: "网络中断后自动重连，无需人工干预" },
          { icon: <Shield className="w-3.5 h-3.5 text-yellow-400" />, title: "官方 C++ 实现", desc: "Telegram 官方维护，协议兼容性最佳" },
          { icon: <TrendingUp className="w-3.5 h-3.5 text-red-400" />, title: "多账号并发", desc: "每账号独立 TDLib 实例，互不干扰" },
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

// ── 主组件 ────────────────────────────────────────────────────────
export default function TdlibEngineTab() {
  const { data: heartbeatConfig, refetch, isLoading } = trpc.sysConfig.getPublic.useQuery(
    { key: "engine_last_heartbeat" },
    { refetchInterval: 30_000 }
  );
  const { data: allAccounts = [] } = trpc.admin.allTgAccounts.useQuery();

  let heartbeat: any = null;
  try {
    if (heartbeatConfig?.value) {
      heartbeat = JSON.parse(heartbeatConfig.value);
    }
  } catch (_) {}

  return (
    <div className="space-y-4">
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-white font-semibold text-base flex items-center gap-2">
            <Cpu className="w-5 h-5 text-blue-400" />
            TDLib 引擎监控
          </h2>
          <p className="text-slate-400 text-xs mt-0.5">
            实时监控 TDLib 监控引擎运行状态、账号健康度和 updates gap 恢复情况
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="border-slate-600 text-slate-300 hover:bg-slate-700 h-8"
          onClick={() => refetch()}
          disabled={isLoading}
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />
          刷新
        </Button>
      </div>

      {/* 心跳状态 */}
      <HeartbeatCard heartbeat={heartbeat} />

      {/* 引擎类型提示 */}
      {heartbeat && heartbeat.engineType !== "tdlib" && (
        <div className="flex items-start gap-2.5 bg-yellow-950/30 border border-yellow-800 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-yellow-300 text-sm font-medium">引擎未升级到 TDLib</p>
            <p className="text-yellow-400/70 text-xs mt-0.5">
              当前引擎类型为 <code className="font-mono">{heartbeat.engineType}</code>，
              建议升级到 TDLib 引擎以获得更稳定的 updates gap 处理能力。
            </p>
          </div>
        </div>
      )}

      {heartbeat && heartbeat.engineType === "tdlib" && (
        <div className="flex items-start gap-2.5 bg-green-950/30 border border-green-800 rounded-lg p-3">
          <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-green-300 text-sm font-medium">TDLib 引擎运行正常</p>
            <p className="text-green-400/70 text-xs mt-0.5">
              已启用 TDLib {heartbeat.tdlibVersion} 官方 C++ 客户端，
              updates gap 自动修复已激活，累计恢复 {heartbeat.gapRecoveries ?? 0} 次。
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 账号健康度 */}
        <AccountHealthList accounts={allAccounts} />
        {/* TDLib 特性说明 */}
        <TdlibFeaturesCard />
      </div>
    </div>
  );
}
