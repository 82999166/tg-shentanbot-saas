import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Inbox, Send, Clock, CheckCircle2, XCircle, SkipForward, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";

const STATUS_OPTIONS = [
  { value: "all", label: "全部状态" },
  { value: "queued", label: "排队中" },
  { value: "sending", label: "发送中" },
  { value: "sent", label: "已发送" },
  { value: "failed", label: "失败" },
  { value: "skipped", label: "已跳过" },
];

const statusConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  queued: { label: "排队中", color: "bg-blue-900 text-blue-300", icon: Clock },
  pending: { label: "排队中", color: "bg-blue-900 text-blue-300", icon: Clock },
  sending: { label: "发送中", color: "bg-amber-900 text-amber-300", icon: Send },
  sent: { label: "已发送", color: "bg-emerald-900 text-emerald-300", icon: CheckCircle2 },
  failed: { label: "失败", color: "bg-red-900 text-red-300", icon: XCircle },
  skipped: { label: "已跳过", color: "bg-slate-700 text-slate-400", icon: SkipForward },
  cancelled: { label: "已取消", color: "bg-slate-700 text-slate-400", icon: SkipForward },
};

export default function DmQueue() {
  const utils = trpc.useUtils();
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const { data, isLoading, isRefetching, refetch } = trpc.dmQueue.list.useQuery({
    status: statusFilter === "all" ? undefined : statusFilter as any,
    limit: 100,
  });

  const retryMut = trpc.dmQueue.retry.useMutation({
    onSuccess: () => { utils.dmQueue.list.invalidate(); toast.success("已重新加入队列"); },
    onError: (e) => toast.error(e.message),
  });
  const cancelMut = trpc.dmQueue.cancel.useMutation({
    onSuccess: () => { utils.dmQueue.list.invalidate(); toast.success("已取消发送"); },
    onError: (e) => toast.error(e.message),
  });
  const batchDeleteMut = trpc.dmQueue.batchDelete.useMutation({
    onSuccess: (res) => {
      utils.dmQueue.list.invalidate();
      setSelectedIds([]);
      toast.success(`已删除 ${res.deleted} 条记录`);
    },
    onError: (e) => toast.error(e.message),
  });

  const items = data ?? [];
  const stats = {
    queued: items.filter((i: any) => i.status === 'pending').length,
    sentToday: items.filter((i: any) => i.status === 'sent').length,
    failedToday: items.filter((i: any) => i.status === 'failed').length,
    successRate: items.length > 0 ? Math.round(items.filter((i: any) => i.status === 'sent').length / items.length * 100) : 0,
  };

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };
  const selectAll = () => {
    if (selectedIds.length === items.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(items.map((i: any) => i.id));
    }
  };

  return (
    <AppLayout title="私信队列">
      <div className="p-6 space-y-6">
        {/* 统计卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "排队中", value: stats?.queued ?? 0, color: "text-blue-400" },
            { label: "今日已发", value: stats?.sentToday ?? 0, color: "text-emerald-400" },
            { label: "今日失败", value: stats?.failedToday ?? 0, color: "text-red-400" },
            { label: "成功率", value: `${stats?.successRate ?? 0}%`, color: "text-purple-400" },
          ].map((s, i) => (
            <Card key={i} className="bg-card border-border">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* 过滤器 + 批量操作 */}
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setSelectedIds([]); }}>
            <SelectTrigger className="w-40 bg-card border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-card border-border">
              {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching} className="border-border">
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefetching ? 'animate-spin' : ''}`} /> 刷新
          </Button>
          {selectedIds.length > 0 && (
            <>
              <span className="text-sm text-muted-foreground">已选 {selectedIds.length} 条</span>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => batchDeleteMut.mutate({ ids: selectedIds })}
                disabled={batchDeleteMut.isPending}
              >
                <Trash2 className="w-4 h-4 mr-1" /> 批量删除
              </Button>
            </>
          )}
        </div>

        {/* 队列列表 */}
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-card rounded-xl animate-pulse" />)}
          </div>
        ) : items.length > 0 ? (
          <div className="space-y-2">
            {/* 全选行 */}
            <div className="flex items-center gap-3 px-4 py-2 text-sm text-muted-foreground">
              <Checkbox
                checked={selectedIds.length === items.length && items.length > 0}
                onCheckedChange={selectAll}
              />
              <span>全选（共 {items.length} 条）</span>
            </div>
            {items.map((item: any) => {
              const sc = statusConfig[item.status] ?? statusConfig.queued;
              const StatusIcon = sc.icon;
              return (
                <div key={item.id} className="flex items-start gap-4 p-4 bg-card border border-border rounded-xl hover:border-primary/30 transition-colors">
                  <Checkbox
                    checked={selectedIds.includes(item.id)}
                    onCheckedChange={() => toggleSelect(item.id)}
                    className="mt-1"
                  />
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${sc.color.split(" ")[0]}`}>
                    <StatusIcon className="w-4 h-4" style={{ color: "inherit" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-medium">
                        {item.targetUsername ? `@${item.targetUsername}` : `ID: ${item.targetTgId}`}
                      </span>
                      <Badge className={`text-xs border-0 ${sc.color}`}>{sc.label}</Badge>
                      {item.retryCount > 0 && (
                        <Badge className="text-xs bg-slate-700 text-slate-300 border-0">重试 {item.retryCount} 次</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{item.content}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      {item.scheduledAt && (
                        <span>计划发送: {new Date(item.scheduledAt).toLocaleString("zh-CN")}</span>
                      )}
                      {item.sentAt && (
                        <span>发送时间: {new Date(item.sentAt).toLocaleString("zh-CN")}</span>
                      )}
                      {item.errorMessage && (
                        <span className="text-red-400">错误: {item.errorMessage}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {item.status === "failed" && (
                      <Button size="sm" variant="outline" className="text-xs border-border" onClick={() => retryMut.mutate({ id: item.id })}>
                        <RefreshCw className="w-3 h-3 mr-1" /> 重试
                      </Button>
                    )}
                    {(item.status === "pending" || item.status === "queued") && (
                      <Button size="sm" variant="outline" className="text-xs text-destructive hover:text-destructive border-border" onClick={() => cancelMut.mutate({ id: item.id })}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-20 text-center text-muted-foreground">
            <Inbox className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="font-medium">队列为空</p>
            <p className="text-sm mt-1">命中关键词后，私信任务将自动加入队列</p>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
