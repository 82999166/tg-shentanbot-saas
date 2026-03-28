import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  RefreshCw,
  Trash2,
  Database,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Info,
  RotateCcw,
} from "lucide-react";
import { useState } from "react";

export default function SystemMaintenance() {
  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = trpc.engine.getRecordStats.useQuery();

  const [syncLoading, setSyncLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<{ success: boolean; message: string } | null>(null);

  // 清理配置
  const [cleanupConfig, setCleanupConfig] = useState({
    hitRecordsDays: 30,
    dmQueueDays: 7,
    senderHistoryDays: 30,
    loginAttemptsDays: 7,
  });
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<{
    success: boolean;
    message: string;
    details: Record<string, number>;
  } | null>(null);

  const forceSync = trpc.engine.forceSync.useMutation();
  const cleanupRecords = trpc.engine.cleanupRecords.useMutation();

  const handleForceSync = async () => {
    setSyncLoading(true);
    setSyncResult(null);
    try {
      const res = await forceSync.mutateAsync();
      setSyncResult(res);
      if (res.success) {
        toast.success("已触发立即同步");
      } else {
        toast.warning(res.message);
      }
    } catch (e: any) {
      setSyncResult({ success: false, message: e.message ?? "触发失败" });
      toast.error(e.message ?? "触发失败");
    } finally {
      setSyncLoading(false);
    }
  };

  const handleCleanup = async () => {
    setCleanupLoading(true);
    setCleanupResult(null);
    try {
      const input: Record<string, number> = {};
      if (cleanupConfig.hitRecordsDays > 0) input.hitRecordsDays = cleanupConfig.hitRecordsDays;
      if (cleanupConfig.dmQueueDays > 0) input.dmQueueDays = cleanupConfig.dmQueueDays;
      if (cleanupConfig.senderHistoryDays > 0) input.senderHistoryDays = cleanupConfig.senderHistoryDays;
      if (cleanupConfig.loginAttemptsDays > 0) input.loginAttemptsDays = cleanupConfig.loginAttemptsDays;
      const res = await cleanupRecords.mutateAsync(input as any);
      setCleanupResult(res);
      toast.success(res.message);
      refetchStats();
    } catch (e: any) {
      toast.error(e.message ?? "清理失败");
    } finally {
      setCleanupLoading(false);
    }
  };

  const formatCount = (n: number) => {
    if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
    return n.toLocaleString();
  };

  return (
    <AdminLayout>
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">系统维护</h1>
        <p className="text-muted-foreground mt-1">监控引擎管理、数据清理与系统健康维护</p>
      </div>

      {/* ─── 监控引擎同步 ─── */}
      <Card className="bg-slate-900 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-cyan-400" /> 监控引擎同步
          </CardTitle>
          <CardDescription className="text-slate-400">
            引擎每 30 秒自动同步一次公共群组配置。添加新群组后，点击「立即同步」可跳过等待，引擎将立即重新加载群组列表并触发加群操作。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-slate-800/60 rounded-lg p-4 border border-slate-700">
            <div className="flex items-start gap-3">
              <Info className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
              <div className="text-sm text-slate-300 space-y-1">
                <p>引擎会检测公共群组列表变化，发现新群组后自动触发所有监控账号加入。</p>
                <p>如果添加群组后监控账号未能及时加入，可点击下方按钮立即触发同步。</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Button
              onClick={handleForceSync}
              disabled={syncLoading}
              className="bg-cyan-600 hover:bg-cyan-700"
            >
              {syncLoading
                ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />同步中...</>
                : <><RefreshCw className="w-4 h-4 mr-2" />立即同步群组配置</>
              }
            </Button>
            {syncResult && (
              <div className={`flex items-center gap-2 text-sm ${syncResult.success ? "text-green-400" : "text-yellow-400"}`}>
                {syncResult.success
                  ? <CheckCircle2 className="w-4 h-4" />
                  : <AlertTriangle className="w-4 h-4" />
                }
                <span>{syncResult.message}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ─── 数据库记录统计 ─── */}
      <Card className="bg-slate-900 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Database className="w-5 h-5 text-purple-400" /> 数据库记录统计
          </CardTitle>
          <CardDescription className="text-slate-400">
            各类历史记录的当前数量，建议定期清理以保持系统性能
          </CardDescription>
        </CardHeader>
        <CardContent>
          {statsLoading ? (
            <div className="flex items-center gap-2 text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" /> 加载中...
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "命中记录", key: "hitRecords", color: "text-orange-400", desc: "关键词命中的消息记录" },
                { label: "DM 队列", key: "dmQueue", color: "text-blue-400", desc: "私信发送队列记录" },
                { label: "发送历史", key: "senderHistory", color: "text-green-400", desc: "消息发送历史记录" },
                { label: "登录记录", key: "loginAttempts", color: "text-slate-400", desc: "用户登录尝试记录" },
              ].map((item) => (
                <div key={item.key} className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                  <p className={`text-2xl font-bold ${item.color}`}>
                    {formatCount((stats as any)?.[item.key] ?? 0)}
                  </p>
                  <p className="text-sm text-white mt-1">{item.label}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{item.desc}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── 数据清理 ─── */}
      <Card className="bg-slate-900 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-red-400" /> 历史数据清理
          </CardTitle>
          <CardDescription className="text-slate-400">
            清理指定天数之前的历史记录，释放数据库空间。设置为 0 表示不清理该类型数据。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-amber-900/20 border border-amber-700/40 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-sm text-amber-300">清理操作不可撤销，请谨慎设置天数。建议保留至少 7 天的命中记录用于审计追溯。</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { key: "hitRecordsDays", label: "命中记录", desc: "保留最近 N 天的关键词命中记录", color: "border-orange-700/40" },
              { key: "dmQueueDays", label: "DM 队列", desc: "保留最近 N 天的私信队列记录", color: "border-blue-700/40" },
              { key: "senderHistoryDays", label: "发送历史", desc: "保留最近 N 天的消息发送历史", color: "border-green-700/40" },
              { key: "loginAttemptsDays", label: "登录记录", desc: "保留最近 N 天的登录尝试记录", color: "border-slate-700/40" },
            ].map((item) => (
              <div key={item.key} className={`bg-slate-800 rounded-lg p-4 border ${item.color}`}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-white">{item.label}</p>
                  <Badge variant="outline" className="border-slate-600 text-slate-400 text-xs">
                    {(cleanupConfig as any)[item.key]} 天前
                  </Badge>
                </div>
                <p className="text-xs text-slate-500 mb-3">{item.desc}</p>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={365}
                    step={1}
                    value={(cleanupConfig as any)[item.key]}
                    onChange={(e) => setCleanupConfig(prev => ({ ...prev, [item.key]: Number(e.target.value) }))}
                    className="flex-1 accent-cyan-500"
                  />
                  <input
                    type="number"
                    min={0}
                    max={365}
                    value={(cleanupConfig as any)[item.key]}
                    onChange={(e) => setCleanupConfig(prev => ({ ...prev, [item.key]: Math.max(0, Math.min(365, Number(e.target.value))) }))}
                    className="w-16 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-white text-center"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-4">
            <Button
              onClick={handleCleanup}
              disabled={cleanupLoading}
              variant="destructive"
              className="bg-red-700 hover:bg-red-600"
            >
              {cleanupLoading
                ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />清理中...</>
                : <><Trash2 className="w-4 h-4 mr-2" />执行清理</>
              }
            </Button>
            <Button
              variant="ghost"
              className="text-slate-400"
              onClick={() => setCleanupConfig({ hitRecordsDays: 30, dmQueueDays: 7, senderHistoryDays: 30, loginAttemptsDays: 7 })}
            >
              <RotateCcw className="w-4 h-4 mr-2" /> 恢复默认
            </Button>
          </div>

          {cleanupResult && (
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-2">
              <div className="flex items-center gap-2 text-green-400 font-medium">
                <CheckCircle2 className="w-4 h-4" /> {cleanupResult.message}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {Object.entries(cleanupResult.details).map(([key, count]) => {
                  const labels: Record<string, string> = {
                    hitRecords: "命中记录",
                    dmQueue: "DM 队列",
                    senderHistory: "发送历史",
                    loginAttempts: "登录记录",
                  };
                  return (
                    <div key={key} className="text-center">
                      <p className="text-lg font-bold text-white">{count.toLocaleString()}</p>
                      <p className="text-xs text-slate-400">{labels[key] ?? key}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
    </AdminLayout>
  );
}
