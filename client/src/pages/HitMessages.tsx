import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  CheckCircle2,
  Circle,
  Ban,
  History,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  UserX,
  MessageSquare,
  Globe,
  User,
  ExternalLink,
  Send,
  Clock,
  XCircle,
} from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import DashboardLayout from "@/components/DashboardLayout";

type HitRecord = {
  id: number;
  userId?: number;
  userName?: string | null;
  userEmail?: string | null;
  senderTgId: string | null;
  senderUsername: string | null;
  senderFirstName: string | null;
  senderLastName?: string | null;
  messageText?: string | null;
  messageContent?: string | null;
  matchedKeyword: string | null;
  monitorGroupId?: number;
  tgAccountId?: number;
  groupId?: string | null;
  groupTitle?: string | null;
  groupMemberCount?: number | null;
  tgAccountName?: string | null;
  tgAccountPhone?: string | null;
  keywordId?: number;
  dmStatus?: string | null;
  isProcessed: boolean;
  processedAt: Date | null;
  messageDate?: Date | null;
  createdAt: Date;
};

export default function HitMessages() {
  const [location] = useLocation();
  const isAdminView = location === "/admin-hit-messages";

  const [page, setPage] = useState(1);
  const [filterProcessed, setFilterProcessed] = useState<string>("all");
  const [filterUserId, setFilterUserId] = useState<number | undefined>(undefined);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [blockDialog, setBlockDialog] = useState<HitRecord | null>(null);
  const [blockReason, setBlockReason] = useState("");
  const [deleteHistory, setDeleteHistory] = useState(false);
  const [historyDialog, setHistoryDialog] = useState<string | null>(null);
  const [detailDialog, setDetailDialog] = useState<HitRecord | null>(null);

  const utils = trpc.useUtils();

  const adminQuery = trpc.hitMessages.adminList.useQuery(
    {
      page,
      pageSize: 20,
      isProcessed: filterProcessed === "all" ? undefined : filterProcessed === "processed",
      userId: filterUserId,
    },
    { enabled: isAdminView }
  );

  const userQuery = trpc.hitMessages.list.useQuery(
    {
      page,
      pageSize: 20,
      isProcessed: filterProcessed === "all" ? undefined : filterProcessed === "processed",
    },
    { enabled: !isAdminView }
  );

  const activeQuery = isAdminView ? adminQuery : userQuery;
  const { data, isLoading, refetch } = activeQuery;

  const { data: usersData } = trpc.admin.users.useQuery(
    { page: 1, pageSize: 100 },
    { enabled: isAdminView }
  );

  const markHandled = trpc.hitMessages.markHandled.useMutation({
    onSuccess: () => {
      utils.hitMessages.list.invalidate();
      utils.hitMessages.adminList.invalidate();
      toast.success("已更新处理状态");
    },
  });

  const batchMark = trpc.hitMessages.batchMarkHandled.useMutation({
    onSuccess: () => {
      utils.hitMessages.list.invalidate();
      utils.hitMessages.adminList.invalidate();
      setSelectedIds([]);
      toast.success(`已批量标记 ${selectedIds.length} 条记录`);
    },
  });

  const blockSender = trpc.hitMessages.blockSender.useMutation({
    onSuccess: () => {
      utils.hitMessages.list.invalidate();
      utils.hitMessages.adminList.invalidate();
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

  const rows: HitRecord[] = (data?.rows ?? []) as HitRecord[];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 20));

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
    const name = [r.senderFirstName, r.senderLastName].filter(Boolean).join(" ");
    if (name) return name;
    return r.senderTgId ?? "未知";
  };

  const msgContent = (r: HitRecord) =>
    r.messageContent ?? (r as any).messageText ?? "—";

  const groupLink = (r: HitRecord) => {
    if (!r.groupTitle && !r.groupId && !r.monitorGroupId) return null;
    const title = r.groupTitle ?? (r.groupId ? `@${r.groupId}` : `群组 #${r.monitorGroupId}`);
    const url = r.groupId ? `https://t.me/${r.groupId}` : null;
    return { title, url };
  };

  const dmStatusBadge = (status: string | null | undefined) => {
    switch (status) {
      case "sent":
        return (
          <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 gap-1">
            <Send className="h-2.5 w-2.5" />已发
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="secondary" className="text-xs bg-red-100 text-red-700 gap-1">
            <XCircle className="h-2.5 w-2.5" />失败
          </Badge>
        );
      case "pending":
        return (
          <Badge variant="secondary" className="text-xs bg-yellow-100 text-yellow-700 gap-1">
            <Clock className="h-2.5 w-2.5" />待发
          </Badge>
        );
      default:
        return <span className="text-xs text-muted-foreground">—</span>;
    }
  };

  const content = (
    <div className="p-6 space-y-6">
      {/* 页头 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            {isAdminView ? (
              <Globe className="w-6 h-6 text-blue-400" />
            ) : (
              <MessageSquare className="w-6 h-6 text-blue-400" />
            )}
            {isAdminView ? "全平台命中消息" : "命中消息"}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isAdminView
              ? "查看全平台所有用户的关键词命中记录"
              : "管理关键词命中的消息记录，标记处理状态或屏蔽发送者"}
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
            <div className="text-sm text-muted-foreground">待处理（当页）</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-green-600">
              {rows.filter((r) => r.isProcessed).length}
            </div>
            <div className="text-sm text-muted-foreground">已处理（当页）</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-purple-600">{page}</div>
            <div className="text-sm text-muted-foreground">
              当前页 / {totalPages} 页
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 过滤和批量操作 */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={filterProcessed}
              onValueChange={(v) => {
                setFilterProcessed(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部消息</SelectItem>
                <SelectItem value="unprocessed">待处理</SelectItem>
                <SelectItem value="processed">已处理</SelectItem>
              </SelectContent>
            </Select>

            {isAdminView && (
              <Select
                value={filterUserId ? String(filterUserId) : "all"}
                onValueChange={(v) => {
                  setFilterUserId(v === "all" ? undefined : Number(v));
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-44">
                  <User className="w-3.5 h-3.5 mr-1.5 text-slate-400" />
                  <SelectValue placeholder="全部用户" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部用户</SelectItem>
                  {(usersData?.users ?? []).map((u: any) => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      {u.name ?? u.email ?? `用户 #${u.id}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {selectedIds.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  已选 {selectedIds.length} 条
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    batchMark.mutate({ ids: selectedIds, isProcessed: true })
                  }
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  批量标记已处理
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    batchMark.mutate({ ids: selectedIds, isProcessed: false })
                  }
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
            <div className="text-center py-12 text-muted-foreground">
              加载中...
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>暂无命中消息</p>
              <p className="text-xs mt-1">
                {isAdminView
                  ? "全平台暂无命中记录"
                  : "配置关键词和监控群组后，命中的消息将显示在这里"}
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {/* 表头 */}
              <div className="flex items-center gap-2 px-4 py-2 bg-muted/30 text-xs text-muted-foreground font-medium">
                <Checkbox
                  checked={selectedIds.length === rows.length && rows.length > 0}
                  onCheckedChange={selectAll}
                  className="shrink-0"
                />
                {isAdminView && <span className="w-24 shrink-0">用户</span>}
                <span className="w-28 shrink-0">发送者</span>
                <span className="flex-1 min-w-0">消息内容</span>
                <span className="w-36 shrink-0">来源群组</span>
                <span className="w-20 shrink-0">私信</span>
                <span className="w-28 shrink-0">时间</span>
                <span className="w-20 shrink-0">状态</span>
                <span className="w-24 shrink-0">操作</span>
              </div>

              {rows.map((r) => {
                const grp = groupLink(r);
                return (
                  <div
                    key={r.id}
                    className={`flex items-start gap-2 px-4 py-3 hover:bg-muted/20 transition-colors cursor-pointer ${
                      r.isProcessed ? "opacity-60" : ""
                    }`}
                    onClick={() => setDetailDialog(r)}
                  >
                    <Checkbox
                      checked={selectedIds.includes(r.id)}
                      onCheckedChange={() => toggleSelect(r.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1 shrink-0"
                    />

                    {isAdminView && (
                      <div className="w-24 shrink-0 min-w-0">
                        <div className="text-xs font-medium text-blue-400 truncate">
                          {r.userName ?? `#${r.userId}`}
                        </div>
                      </div>
                    )}

                    {/* 发送者 */}
                    <div className="w-28 shrink-0 min-w-0">
                      <div className="font-medium text-sm truncate">
                        {senderDisplay(r)}
                      </div>
                      <div className="text-xs text-muted-foreground/60 truncate">
                        {r.senderTgId}
                      </div>
                    </div>

                    {/* 消息内容 */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm line-clamp-2">{msgContent(r)}</p>
                      {r.matchedKeyword && (
                        <span className="text-xs text-blue-500">
                          关键词: {r.matchedKeyword}
                        </span>
                      )}
                    </div>

                    {/* 来源群组 */}
                    <div className="w-36 shrink-0 min-w-0">
                      {grp ? (
                        <div>
                          {grp.url ? (
                            <a
                              href={grp.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 truncate"
                            >
                              <ExternalLink className="h-3 w-3 shrink-0" />
                              <span className="truncate">{grp.title}</span>
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground truncate block">
                              {grp.title}
                            </span>
                          )}
                          {r.groupMemberCount != null && (
                            <span className="text-xs text-muted-foreground/60">
                              {r.groupMemberCount.toLocaleString()} 成员
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>

                    {/* 私信状态 */}
                    <div className="w-20 shrink-0">
                      {dmStatusBadge(r.dmStatus)}
                    </div>

                    {/* 时间 */}
                    <div className="w-28 shrink-0 min-w-0">
                      <span className="text-xs text-muted-foreground">
                        {new Date(r.messageDate ?? r.createdAt).toLocaleString(
                          "zh-CN",
                          {
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          }
                        )}
                      </span>
                    </div>

                    {/* 处理状态 */}
                    <div className="w-20 shrink-0">
                      {r.isProcessed ? (
                        <Badge
                          variant="secondary"
                          className="text-xs bg-green-100 text-green-700"
                        >
                          已处理
                        </Badge>
                      ) : (
                        <Badge
                          variant="secondary"
                          className="text-xs bg-orange-100 text-orange-700"
                        >
                          待处理
                        </Badge>
                      )}
                    </div>

                    {/* 操作按钮 */}
                    <div
                      className="w-24 shrink-0 flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title={r.isProcessed ? "标记未处理" : "标记已处理"}
                        onClick={() =>
                          markHandled.mutate({
                            id: r.id,
                            isProcessed: !r.isProcessed,
                          })
                        }
                      >
                        {r.isProcessed ? (
                          <Circle className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
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
                );
              })}
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
            第 {page} / {totalPages} 页，共 {total} 条
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

      {/* 消息详情对话框 */}
      <Dialog open={!!detailDialog} onOpenChange={() => setDetailDialog(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-blue-500" />
              命中消息详情
            </DialogTitle>
          </DialogHeader>
          {detailDialog && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-muted/40 rounded-lg p-3">
                  <div className="text-xs text-muted-foreground mb-1">发送者</div>
                  <div className="font-medium">{senderDisplay(detailDialog)}</div>
                  {detailDialog.senderTgId && (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      TG ID: {detailDialog.senderTgId}
                    </div>
                  )}
                </div>
                <div className="bg-muted/40 rounded-lg p-3">
                  <div className="text-xs text-muted-foreground mb-1">来源群组</div>
                  {groupLink(detailDialog) ? (
                    <>
                      <div className="font-medium">{groupLink(detailDialog)!.title}</div>
                      {groupLink(detailDialog)!.url && (
                        <a
                          href={groupLink(detailDialog)!.url!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-400 hover:underline flex items-center gap-1 mt-0.5"
                        >
                          <ExternalLink className="h-3 w-3" />
                          {groupLink(detailDialog)!.url}
                        </a>
                      )}
                      {detailDialog.groupMemberCount != null && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {detailDialog.groupMemberCount.toLocaleString()} 成员
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-muted-foreground">未知群组</div>
                  )}
                </div>
                <div className="bg-muted/40 rounded-lg p-3">
                  <div className="text-xs text-muted-foreground mb-1">命中关键词</div>
                  <div className="font-medium text-blue-400">
                    {detailDialog.matchedKeyword ?? "—"}
                  </div>
                </div>
                <div className="bg-muted/40 rounded-lg p-3">
                  <div className="text-xs text-muted-foreground mb-1">私信状态</div>
                  <div>{dmStatusBadge(detailDialog.dmStatus)}</div>
                </div>
                {detailDialog.tgAccountName && (
                  <div className="bg-muted/40 rounded-lg p-3">
                    <div className="text-xs text-muted-foreground mb-1">监控账号</div>
                    <div className="font-medium">{detailDialog.tgAccountName}</div>
                    {detailDialog.tgAccountPhone && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {detailDialog.tgAccountPhone}
                      </div>
                    )}
                  </div>
                )}
                <div className="bg-muted/40 rounded-lg p-3">
                  <div className="text-xs text-muted-foreground mb-1">消息时间</div>
                  <div className="font-medium">
                    {new Date(
                      detailDialog.messageDate ?? detailDialog.createdAt
                    ).toLocaleString("zh-CN")}
                  </div>
                </div>
              </div>
              <div className="bg-muted/40 rounded-lg p-3">
                <div className="text-xs text-muted-foreground mb-2">消息内容</div>
                <p className="whitespace-pre-wrap leading-relaxed">
                  {msgContent(detailDialog)}
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailDialog(null)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                <div className="text-muted-foreground text-xs">
                  {blockDialog.senderTgId ?? ""}
                </div>
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
      <Dialog
        open={!!historyDialog}
        onOpenChange={() => setHistoryDialog(null)}
      >
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
              historyData.map((h: any, i: number) => (
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
  );

  if (isAdminView) {
    return <AdminLayout title="全平台命中消息">{content}</AdminLayout>;
  }
  return <DashboardLayout>{content}</DashboardLayout>;
}
