import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Activity, Download, RefreshCw, Search, Users } from "lucide-react";
import { useState } from "react";

const DM_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  none: { label: "未发送", color: "bg-slate-700 text-slate-300" },
  queued: { label: "排队中", color: "bg-blue-900 text-blue-300" },
  pending: { label: "排队中", color: "bg-blue-900 text-blue-300" },
  sent: { label: "已发送", color: "bg-emerald-900 text-emerald-300" },
  failed: { label: "失败", color: "bg-red-900 text-red-300" },
  skipped: { label: "已跳过", color: "bg-slate-700 text-slate-400" },
};

export default function HitRecords() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [dmFilter, setDmFilter] = useState("all");
  const [page, setPage] = useState(1);

  const { data, isLoading } = trpc.hitRecords.list.useQuery({
    search: search || undefined,
    dmStatus: dmFilter === "all" ? undefined : dmFilter as any,
    offset: (page - 1) * 20,
    limit: 20,
  });

  const records = data?.records ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  const handleExport = () => {
    const csv = [
      ["ID", "发送者", "用户名", "关键词", "群组", "消息内容", "私信状态", "时间"].join(","),
      ...records.map((r) => [
        r.id,
        r.senderTgId,
        r.senderUsername ?? "",
        r.matchedKeyword,
        "",
        `"${(r.messageContent ?? "").replace(/"/g, '""')}"`,
        r.dmStatus,
        new Date(r.createdAt).toLocaleString("zh-CN"),
      ].join(","))
    ].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hit_records_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <AppLayout title="命中记录">
      <div className="p-6 space-y-4">
        {/* 过滤器 */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="搜索关键词、用户名..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-9 bg-card border-border"
            />
          </div>
          <Select value={dmFilter} onValueChange={(v) => { setDmFilter(v); setPage(1); }}>
            <SelectTrigger className="w-40 bg-card border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-card border-border">
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="none">未发送</SelectItem>
              <SelectItem value="pending">排队中</SelectItem>
              <SelectItem value="sent">已发送</SelectItem>
              <SelectItem value="failed">失败</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => utils.hitRecords.list.invalidate()} className="border-border">
            <RefreshCw className="w-4 h-4 mr-2" /> 刷新
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} className="border-border" disabled={records.length === 0}>
            <Download className="w-4 h-4 mr-2" /> 导出 CSV
          </Button>
        </div>

        {/* 总数 */}
        <div className="text-sm text-muted-foreground">
          共 <span className="text-foreground font-medium">{total}</span> 条记录
        </div>

        {/* 列表 */}
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-20 bg-card rounded-xl animate-pulse" />)}
          </div>
        ) : records.length > 0 ? (
          <div className="space-y-2">
            {records.map((r) => {
              const dmSt = DM_STATUS_CONFIG[r.dmStatus] ?? DM_STATUS_CONFIG.none;
              return (
                <div key={r.id} className="flex items-start gap-4 p-4 bg-card border border-border rounded-xl hover:border-primary/30 transition-colors">
                  <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                    <Users className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-medium">
                        {r.senderUsername ? `@${r.senderUsername}` : `ID: ${r.senderTgId}`}
                      </span>
                      <Badge className="text-xs bg-primary/20 text-primary border-0">
                        {r.matchedKeyword}
                      </Badge>
                      <Badge className={`text-xs border-0 ${dmSt.color}`}>{dmSt.label}</Badge>

                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{r.messageContent}</p>
                  </div>
                  <div className="text-xs text-muted-foreground shrink-0 text-right">
                    <div>{new Date(r.createdAt).toLocaleDateString("zh-CN")}</div>
                    <div>{new Date(r.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-20 text-center text-muted-foreground">
            <Activity className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="font-medium">暂无命中记录</p>
            <p className="text-sm mt-1">添加监控群组和关键词后开始监控</p>
          </div>
        )}

        {/* 分页 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} className="border-border">上一页</Button>
            <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="border-border">下一页</Button>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
