import AppLayout from "@/components/AppLayout";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  CheckCircle2,
  Circle,
  Ban,
  History,
  ChevronLeft,
  ChevronRight,
  Search,
  RefreshCw,
  UserX,
  MessageSquare,
} from "lucide-react";

type HitRecord = {
  id: number;
  senderTgId: string | null;
  senderUsername: string | null;
  senderFirstName: string | null;
  messageContent: string | null;
  matchedKeyword: string | null;
  monitorGroupId: number;
  keywordId: number;
  isProcessed: boolean;
  processedAt: Date | null;
  createdAt: Date;
  // 群组信息（后端关联 public_monitor_groups 返回）
  groupTitle?: string | null;
  groupUsername?: string | null;
};

export default function HitMessages() {
  const [page, setPage] = useState(1);
  const [filterProcessed, setFilterProcessed] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [blockDialog, setBlockDialog] = useState<HitRecord | null>(null);
  const [blockReason, setBlockReason] = useState("");
  const [deleteHistory, setDeleteHistory] = useState(false);
  const [historyDialog, setHistoryDialog] = useState<string | null>(null);

  const utils = trpc.useUtils();

  const { data, isLoading, refetch } = trpc.hitMessages.list.useQuery({
    page,
    pageSize: 20,
    isProcessed: filterProcessed === "all" ? undefined : filterProcessed === "processed",
  });

  const markHandled = trpc.hitMessages.markHandled.useMutation({
    onSuccess: () => {
      utils.hitMessages.list.invalidate();
      toast.success("已更新处理状态");
    },
  });

  const batchMark = trpc.hitMessages.batchMarkHandled.useMutation({
    onSuccess: () => {
      utils.hitMessages.list.invalidate();
      setSelectedIds([]);
      toast.success(`已批量标记 ${selectedIds.length} 条记录`);
    },
  });

  const blockSender = trpc.hitMessages.blockSender.useMutation({
    onSuccess: () => {
      utils.hitMessages.list.invalidate();
      setBlockDialog(null);
      setBlockReason("");
      setDeleteHistory(false);
      toast.success("已屏蔽该用户，该用户的消息将不再推送");
    },
  });

  const { data: historyData } = trpc.hitMessages.senderHistory.useQuery(
    { senderTgId: historyDialog! },
    { enabled: !!historyDialog }
  );

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    if (selectedIds.length === rows.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(rows.map((r) => r.id));
    }
  };

  const senderDisplay = (r: HitRecord) => {
    if (r.senderUsername) return `@${r.senderUsername}`;
    if (r.senderFirstName) return r.senderFirstName;
    return r.senderTgId ?? "未知";
  };

  return (
    <AppLayout title="命中消息">
    <div className="p-6 space-y-6">
      {/* 页头 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">命中消息</h1>
          <p className="text-muted-foreground text-sm mt-1">
            管理关键词命中的消息记录，标记处理状态或屏蔽发送者
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          刷新
        </Button>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-blue-600">{total}</div>
            <div className="text-sm text-muted-foreground">总命中数</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-orange-500">
              {rows.filter((r) => !r.isProcessed).length}
            </div>
            <div className="text-sm text-muted-foreground">待处理</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-green-600">
              {rows.filter((r) => r.isProcessed).length}
            </div>
            <div className="text-sm text-muted-foreground">已处理</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-purple-600">{page}</div>
            <div className="text-sm text-muted-foreground">当前页 / {totalPages} 页</div>
          </CardContent>
        </Card>
      </div>

      {/* 过滤和批量操作 */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={filterProcessed} onValueChange={setFilterProcessed}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部消息</SelectItem>
                <SelectItem value="unprocessed">待处理</SelectItem>
                <SelectItem value="processed">已处理</SelectItem>
              </SelectContent>
            </Select>

            {selectedIds.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  已选 {selectedIds.length} 条
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => batchMark.mutate({ ids: selectedIds, isProcessed: true })}
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  批量标记已处理
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => batchMark.mutate({ ids: selectedIds, isProcessed: false })}
                >
                  <Circle className="h-4 w-4 mr-1" />
                  批量标记未处理
                </Button>
              </div>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground">加载中...</div>
          ) : rows.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>暂无命中消息</p>
              <p className="text-xs mt-1">配置关键词和监控群组后，命中的消息将显示在这里</p>
            </div>
          ) : (
            <div className="divide-y">
              {/* 表头 */}
              <div className="flex items-center gap-3 px-4 py-2 bg-muted/30 text-xs text-muted-foreground">
                <Checkbox
                  checked={selectedIds.length === rows.length && rows.length > 0}
                  onCheckedChange={selectAll}
                />
                <span className="w-32">发送者</span>
                <span className="flex-1">消息内容</span>
                <span className="w-28">群组</span>
                <span className="w-32">时间</span>
                <span className="w-24">状态</span>
                <span className="w-28">操作</span>
              </div>

              {rows.map((r) => (
                <div
                  key={r.id}
                  className={`flex items-start gap-3 px-4 py-3 hover:bg-muted/20 transition-colors ${
                    r.isProcessed ? "opacity-60" : ""
                  }`}
                >
                  <Checkbox
                    checked={selectedIds.includes(r.id)}
                    onCheckedChange={() => toggleSelect(r.id)}
                    className="mt-1"
                  />
                  <div className="w-32 min-w-0">
                    <div className="font-medium text-sm truncate">{senderDisplay(r)}</div>
                    <div className="text-xs text-muted-foreground truncate">{r.senderTgId}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm line-clamp-2">{r.messageContent ?? "—"}</p>
                    {r.matchedKeyword && (
                      <span className="text-xs text-blue-500">关键词: {r.matchedKeyword}</span>
                    )}
                  </div>
                  <div className="w-28 min-w-0">
                    {r.groupTitle ? (
                      <a
                        href={r.groupUsername ? `https://t.me/${r.groupUsername.replace(/^@/, '')}` : undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-500 hover:underline truncate block"
                        title={r.groupUsername || r.groupTitle}
                      >
                        {r.groupTitle}
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground truncate block">
                        {r.monitorGroupId > 0 ? `群组 #${r.monitorGroupId}` : '未知群组'}
                      </span>
                    )}
                  </div>
                  <div className="w-32 min-w-0">
                    <span className="text-xs text-muted-foreground">
                      {new Date(r.createdAt).toLocaleString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <div className="w-24">
                    {r.isProcessed ? (
                      <Badge variant="secondary" className="text-xs bg-green-100 text-green-700">
                        已处理
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-700">
                        待处理
                      </Badge>
                    )}
                  </div>
                  <div className="w-28 flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      title={r.isProcessed ? "标记未处理" : "标记已处理"}
                      onClick={() =>
                        markHandled.mutate({ id: r.id, isProcessed: !r.isProcessed })
                      }
                    >
                      {r.isProcessed ? (
                        <Circle className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      )}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      title="查看历史"
                      onClick={() => setHistoryDialog(r.senderTgId)}
                    >
                      <History className="h-4 w-4 text-blue-500" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      title="屏蔽用户"
                      onClick={() => setBlockDialog(r)}
                    >
                      <Ban className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            第 {page} / {totalPages} 页
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page === totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* 屏蔽对话框 */}
      <Dialog open={!!blockDialog} onOpenChange={() => setBlockDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserX className="h-5 w-5 text-red-500" />
              屏蔽用户
            </DialogTitle>
          </DialogHeader>
          {blockDialog && (
            <div className="space-y-4">
              <div className="bg-muted rounded-lg p-3 text-sm">
                <div className="font-medium">{senderDisplay(blockDialog)}</div>
                <div className="text-muted-foreground text-xs">{blockDialog.senderTgId ?? ""}</div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">屏蔽原因（可选）</label>
                <Textarea
                  placeholder="例如：广告账号、无效用户..."
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  rows={2}
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="deleteHistory"
                  checked={deleteHistory}
                  onCheckedChange={(v) => setDeleteHistory(!!v)}
                />
                <label htmlFor="deleteHistory" className="text-sm cursor-pointer">
                  同时删除该用户的历史推送记录
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                屏蔽后，该用户的消息将不再触发关键词推送。可在「屏蔽列表」中撤销。
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlockDialog(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                blockDialog &&
                blockSender.mutate({
                  senderTgId: blockDialog.senderTgId ?? "",
                  senderUsername: blockDialog.senderUsername ?? undefined,
                  reason: blockReason || undefined,
                  deleteHistory,
                })
              }
              disabled={blockSender.isPending}
            >
              确认屏蔽
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 历史记录对话框 */}
      <Dialog open={!!historyDialog} onOpenChange={() => setHistoryDialog(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5 text-blue-500" />
              用户历史记录（近7天）
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-96 overflow-y-auto space-y-2">
            {!historyData || historyData.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                暂无历史记录
              </div>
            ) : (
              historyData.map((h, i) => (
                <div key={i} className="border rounded-lg p-3 text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground">
                      {new Date(h.messageDate).toLocaleString("zh-CN")}
                    </span>
                    {h.groupTitle && (
                      <Badge variant="outline" className="text-xs">
                        {h.groupTitle}
                      </Badge>
                    )}
                  </div>
                  <p className="line-clamp-3">{h.messageContent ?? ""}</p>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryDialog(null)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </AppLayout>
  );
}