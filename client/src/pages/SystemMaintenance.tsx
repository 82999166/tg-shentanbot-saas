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
  Activity,
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
  const restartEngine = trpc.sysConfig.restartEngine.useMutation();
  const stopEngine = trpc.sysConfig.stopEngine.useMutation();
  const startEngine = trpc.sysConfig.startEngine.useMutation();
  const engineStatus = trpc.sysConfig.getEngineStatus.useQuery(undefined, { refetchInterval: 5000 });
  const engineDetailsQuery = trpc.sysConfig.getEngineDetails.useQuery(undefined, { refetchInterval: 10000 });
  const engineDetails = engineDetailsQuery.data;
  const engineDetailsLoading = engineDetailsQuery.isLoading;
  const [stopEngineLoading, setStopEngineLoading] = useState(false);
  const [startEngineLoading, setStartEngineLoading] = useState(false);
  const restartBot = trpc.sysConfig.restartBot.useMutation();
  const [restartEngineLoading, setRestartEngineLoading] = useState(false);
  const [restartBotLoading, setRestartBotLoading] = useState(false);

  const handleRestartEngine = async () => {
    setRestartEngineLoading(true);
    try {
      await restartEngine.mutateAsync();
      toast.success("神探-引擎 重启成功，约 10 秒后恢复工作");
    } catch (e: any) {
      toast.error(e.message ?? "重启引擎失败");
    } finally {
      setRestartEngineLoading(false);
    }
  };

  const handleRestartBot = async () => {
    setRestartBotLoading(true);
    try {
      await restartBot.mutateAsync();
      toast.success("神探-Bot 重启成功，约 5 秒后恢复工作");
    } catch (e: any) {
      toast.error(e.message ?? "重启 Bot 失败");
    } finally {
      setRestartBotLoading(false);
    }
  };

  const handleStopEngine = async () => {
    setStopEngineLoading(true);
    try {
      const res = await stopEngine.mutateAsync();
      toast.success(res.message ?? "监控引擎已停止");
      engineStatus.refetch();
    } catch (e: any) {
      toast.error(e.message ?? "停止引擎失败");
    } finally {
      setStopEngineLoading(false);
    }
  };

  const handleStartEngine = async () => {
    setStartEngineLoading(true);
    try {
      const res = await startEngine.mutateAsync();
      toast.success(res.message ?? "监控引擎已启动");
      engineStatus.refetch();
    } catch (e: any) {
      toast.error(e.message ?? "启动引擎失败");
    } finally {
      setStartEngineLoading(false);
    }
  };

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

  const formatUptime = (seconds: number) => {
    if (seconds < 60) return `${seconds}秒`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟`;
    if (seconds < 86400) {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      return `${h}小时${m}分`;
    }
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    return `${d}天${h}小时`;
  };

  return (
    <AdminLayout>
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">系统维护</h1>
        <p className="text-muted-foreground mt-1">监控引擎管理、数据清理与系统健康维护</p>
      </div>

      {/* ─── 进程重启 ─── */}
      <Card className="bg-white border-slate-200">
        <CardHeader>
          <CardTitle className="text-slate-800 flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-orange-400" /> 进程重启
          </CardTitle>
          <CardDescription className="text-slate-500">
            当引擎出现断连、推送停止等异常情况时，可点击下方按鈕手动重启对应进程。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* 引擎状态指示 */}
          <div className="flex items-center gap-2 mb-4 p-3 rounded-lg bg-slate-50 border border-slate-200">
            <span className="text-sm text-slate-600 font-medium">监控引擎状态：</span>
            {engineStatus.data?.status === "online" ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                运行中
              </span>
            ) : engineStatus.data?.status === "stopped" ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                <span className="w-2 h-2 rounded-full bg-red-500"></span>
                已停止
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                <span className="w-2 h-2 rounded-full bg-gray-400"></span>
                未知
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-4">
            {/* 启动/停止引擎 */}
            {engineStatus.data?.status === "online" ? (
              <Button
                onClick={handleStopEngine}
                disabled={stopEngineLoading}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {stopEngineLoading
                  ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />停止中...</>
                  : <>⏹ 停止监控引擎</>
                }
              </Button>
            ) : (
              <Button
                onClick={handleStartEngine}
                disabled={startEngineLoading}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                {startEngineLoading
                  ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />启动中...</>
                  : <>▶ 启动监控引擎</>
                }
              </Button>
            )}
            <Button
              onClick={handleRestartEngine}
              disabled={restartEngineLoading}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              {restartEngineLoading
                ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />重启中...</>
                : <><RefreshCw className="w-4 h-4 mr-2" />重启监控引擎</>
              }
            </Button>
            <Button
              onClick={handleRestartBot}
              disabled={restartBotLoading}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {restartBotLoading
                ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />重启中...</>
                : <><RefreshCw className="w-4 h-4 mr-2" />重启 Bot进程</>
              }
            </Button>
          </div>
          <p className="text-xs text-slate-500 mt-3">⚠️ 停止引擎后监控将暂停，适合在需要 TDLib 执行其他操作（如同步群组信息、加群等）时使用。操作完成后请及时启动引擎恢复监控。</p>
        </CardContent>
      </Card>

      {/* ─── 引擎 Worker 状态详情 ─── */}
      <Card className="bg-white border-slate-200">
        <CardHeader>
          <CardTitle className="text-slate-800 flex items-center gap-2">
            <Activity className="w-5 h-5 text-purple-400" /> 引擎 Worker 状态详情
          </CardTitle>
          <CardDescription className="text-slate-500">
            实时显示每个监控 Worker 的运行状态、群组缓存、消息处理等详细信息。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {engineDetailsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
              <span className="ml-2 text-slate-500">加载中...</span>
            </div>
          ) : engineDetails ? (
            <>
              {/* 汇总统计 */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                <div className="bg-slate-50 rounded-lg p-3 border border-slate-200 text-center">
                  <p className="text-lg font-bold text-slate-800">{engineDetails.summary.onlineWorkers}/{engineDetails.summary.totalWorkers}</p>
                  <p className="text-xs text-slate-500">在线 Worker</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 border border-slate-200 text-center">
                  <p className="text-lg font-bold text-slate-800">{engineDetails.summary.totalDialogs.toLocaleString()}</p>
                  <p className="text-xs text-slate-500">监控群组总数</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 border border-slate-200 text-center">
                  <p className="text-lg font-bold text-slate-800">{engineDetails.summary.totalMessages.toLocaleString()}</p>
                  <p className="text-xs text-slate-500">处理消息总数</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 border border-slate-200 text-center">
                  <p className="text-lg font-bold text-orange-600">{engineDetails.summary.totalHits.toLocaleString()}</p>
                  <p className="text-xs text-slate-500">命中总数</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 border border-slate-200 text-center">
                  <p className="text-lg font-bold text-red-600">{engineDetails.summary.totalErrors.toLocaleString()}</p>
                  <p className="text-xs text-slate-500">错误总数</p>
                </div>
              </div>
              {/* Worker 详情表格 */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-2 px-2 text-slate-600 font-medium">账号</th>
                      <th className="text-center py-2 px-2 text-slate-600 font-medium">状态</th>
                      <th className="text-center py-2 px-2 text-slate-600 font-medium">连接</th>
                      <th className="text-right py-2 px-2 text-slate-600 font-medium">群组</th>
                      <th className="text-right py-2 px-2 text-slate-600 font-medium">待加载</th>
                      <th className="text-right py-2 px-2 text-slate-600 font-medium">消息</th>
                      <th className="text-right py-2 px-2 text-slate-600 font-medium">命中</th>
                      <th className="text-right py-2 px-2 text-slate-600 font-medium">错误</th>
                      <th className="text-right py-2 px-2 text-slate-600 font-medium">运行时长</th>
                      <th className="text-right py-2 px-2 text-slate-600 font-medium">最后消息</th>
                    </tr>
                  </thead>
                  <tbody>
                    {engineDetails.workers.map((w: any) => (
                      <tr key={w.accountId} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="py-2 px-2">
                          <div className="flex flex-col">
                            <span className="font-medium text-slate-800">
                              {w.tgFirstName || `ACC${w.accountId}`}
                            </span>
                            <span className="text-xs text-slate-500">
                              {w.tgUsername ? `@${w.tgUsername}` : w.phone}
                            </span>
                          </div>
                        </td>
                        <td className="text-center py-2 px-2">
                          {w.online ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                              在线
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                              离线
                            </span>
                          )}
                        </td>
                        <td className="text-center py-2 px-2">
                          {w.online ? (
                            <span className={`text-xs px-1.5 py-0.5 rounded ${
                              w.connectionState === "connectionStateReady"
                                ? "bg-green-50 text-green-700"
                                : "bg-yellow-50 text-yellow-700"
                            }`}>
                              {w.connectionState === "connectionStateReady" ? "已连接" :
                               w.connectionState === "connectionStateConnecting" ? "连接中" :
                               w.connectionState === "connectionStateUpdating" ? "更新中" : "未知"}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">-</span>
                          )}
                        </td>
                        <td className="text-right py-2 px-2 text-slate-700">{w.online ? w.dialogCount?.toLocaleString() : "-"}</td>
                        <td className="text-right py-2 px-2">
                          {w.online ? (
                            w.pendingCount > 0 ? (
                              <span className="text-yellow-600 font-medium">{w.pendingCount}</span>
                            ) : (
                              <span className="text-green-600">0</span>
                            )
                          ) : "-"}
                        </td>
                        <td className="text-right py-2 px-2 text-slate-700">{w.online ? w.msgCount?.toLocaleString() : "-"}</td>
                        <td className="text-right py-2 px-2 text-orange-600 font-medium">{w.online ? w.hitCount?.toLocaleString() : "-"}</td>
                        <td className="text-right py-2 px-2 text-red-600">{w.online ? w.errorCount?.toLocaleString() : "-"}</td>
                        <td className="text-right py-2 px-2 text-slate-600">
                          {w.online ? formatUptime(w.uptime) : "-"}
                        </td>
                        <td className="text-right py-2 px-2 text-slate-600">
                          {w.online ? (
                            w.lastMsgAge <= 60 ? (
                              <span className="text-green-600">{w.lastMsgAge}秒前</span>
                            ) : w.lastMsgAge <= 300 ? (
                              <span className="text-yellow-600">{Math.floor(w.lastMsgAge / 60)}分钟前</span>
                            ) : (
                              <span className="text-red-600">{Math.floor(w.lastMsgAge / 60)}分钟前</span>
                            )
                          ) : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between mt-2">
                <p className="text-xs text-slate-400">数据每 10 秒自动刷新</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => engineDetailsQuery.refetch()}
                  className="text-slate-500 hover:text-slate-700"
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1" /> 刷新
                </Button>
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-slate-500">
              <p>无法获取引擎状态信息</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── 监控引擎同步 ─── */}
      <Card className="bg-white border-slate-200">
        <CardHeader>
          <CardTitle className="text-slate-800 flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-cyan-400" /> 监控引擎同步
          </CardTitle>
          <CardDescription className="text-slate-500">
            引擎每 30 秒自动同步一次公共群组配置。添加新群组后，点击「立即同步」可跳过等待，引擎将立即重新加载群组列表并触发加群操作。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-slate-100/80 rounded-lg p-4 border border-slate-200">
            <div className="flex items-start gap-3">
              <Info className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
              <div className="text-sm text-slate-600 space-y-1">
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
      <Card className="bg-white border-slate-200">
        <CardHeader>
          <CardTitle className="text-slate-800 flex items-center gap-2">
            <Database className="w-5 h-5 text-purple-400" /> 数据库记录统计
          </CardTitle>
          <CardDescription className="text-slate-500">
            各类历史记录的当前数量，建议定期清理以保持系统性能
          </CardDescription>
        </CardHeader>
        <CardContent>
          {statsLoading ? (
            <div className="flex items-center gap-2 text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin" /> 加载中...
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "命中记录", key: "hitRecords", color: "text-orange-400", desc: "关键词命中的消息记录" },
                { label: "DM 队列", key: "dmQueue", color: "text-blue-400", desc: "私信发送队列记录" },
                { label: "发送历史", key: "senderHistory", color: "text-green-400", desc: "消息发送历史记录" },
                { label: "登录记录", key: "loginAttempts", color: "text-slate-500", desc: "用户登录尝试记录" },
              ].map((item) => (
                <div key={item.key} className="bg-slate-100 rounded-lg p-4 border border-slate-200">
                  <p className={`text-2xl font-bold ${item.color}`}>
                    {formatCount((stats as any)?.[item.key] ?? 0)}
                  </p>
                  <p className="text-sm text-slate-800 mt-1">{item.label}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{item.desc}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── 数据清理 ─── */}
      <Card className="bg-white border-slate-200">
        <CardHeader>
          <CardTitle className="text-slate-800 flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-red-400" /> 历史数据清理
          </CardTitle>
          <CardDescription className="text-slate-500">
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
              { key: "loginAttemptsDays", label: "登录记录", desc: "保留最近 N 天的登录尝试记录", color: "border-slate-200/40" },
            ].map((item) => (
              <div key={item.key} className={`bg-slate-100 rounded-lg p-4 border ${item.color}`}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-slate-800">{item.label}</p>
                  <Badge variant="outline" className="border-slate-300 text-slate-500 text-xs">
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
                    className="w-16 bg-slate-200 border border-slate-300 rounded px-2 py-1 text-sm text-slate-800 text-center"
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
              className="text-slate-500"
              onClick={() => setCleanupConfig({ hitRecordsDays: 30, dmQueueDays: 7, senderHistoryDays: 30, loginAttemptsDays: 7 })}
            >
              <RotateCcw className="w-4 h-4 mr-2" /> 恢复默认
            </Button>
          </div>

          {cleanupResult && (
            <div className="bg-slate-100 rounded-lg p-4 border border-slate-200 space-y-2">
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
                      <p className="text-lg font-bold text-slate-800">{count.toLocaleString()}</p>
                      <p className="text-xs text-slate-500">{labels[key] ?? key}</p>
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
