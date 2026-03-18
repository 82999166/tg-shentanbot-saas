import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Monitor, Plus, Trash2, Play, Pause, Users, Hash, Pencil, RefreshCw, Search } from "lucide-react";
import { useState, useMemo } from "react";

type TgDialog = {
  id: string;
  title: string;
  username: string;
  type: string; // "group" | "supergroup" | "channel"
  members_count: number | null;
};

type FormState = {
  tgAccountId: number | undefined;
  notifyTarget: string;
  autoReply: boolean;
};

const defaultForm: FormState = {
  tgAccountId: undefined,
  notifyTarget: "",
  autoReply: false,
};

// 编辑表单
type EditFormState = {
  tgGroupId: string;
  groupName: string;
  tgAccountId: number | undefined;
};

const defaultEditForm: EditFormState = {
  tgGroupId: "",
  groupName: "",
  tgAccountId: undefined,
};

export default function MonitorGroups() {
  const utils = trpc.useUtils();
  const { data: groups, isLoading } = trpc.monitorGroups.list.useQuery();
  const { data: tgAccounts } = trpc.tgAccounts.list.useQuery();

  const batchCreateMut = trpc.monitorGroups.batchCreate.useMutation({
    onSuccess: (res) => {
      utils.monitorGroups.list.invalidate();
      toast.success(res.message);
      setOpen(false);
      resetAddDialog();
    },
    onError: (e) => toast.error(e.message),
  });
  const updateMut = trpc.monitorGroups.update.useMutation({
    onSuccess: () => { utils.monitorGroups.list.invalidate(); toast.success("群组信息已更新"); setEditOpen(false); setEditId(null); setEditForm(defaultEditForm); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMut = trpc.monitorGroups.delete.useMutation({
    onSuccess: () => { utils.monitorGroups.list.invalidate(); toast.success("已移除监控群组"); },
    onError: (e) => toast.error(e.message),
  });
  const toggleMut = trpc.monitorGroups.toggleStatus.useMutation({
    onSuccess: () => utils.monitorGroups.list.invalidate(),
    onError: (err: any) => toast.error(err.message),
  });

  // ─── 添加对话框状态 ───────────────────────────────────────────────────────
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(defaultForm);

  // 群组列表读取
  const [dialogs, setDialogs] = useState<TgDialog[]>([]);
  const [loadingDialogs, setLoadingDialogs] = useState(false);

  // 筛选与搜索
  const [dialogSearch, setDialogSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "group" | "channel">("all");

  // 多选
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ─── 编辑对话框状态 ───────────────────────────────────────────────────────
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EditFormState>(defaultEditForm);

  const resetAddDialog = () => {
    setForm(defaultForm);
    setDialogs([]);
    setDialogSearch("");
    setTypeFilter("all");
    setSelectedIds(new Set());
  };

  // 过滤后的群组列表
  const filteredDialogs = useMemo(() => {
    return dialogs.filter((d) => {
      // 类型筛选
      if (typeFilter === "group" && d.type === "channel") return false;
      if (typeFilter === "channel" && d.type !== "channel") return false;
      // 搜索
      if (dialogSearch) {
        const q = dialogSearch.toLowerCase();
        return d.title.toLowerCase().includes(q) || d.username.toLowerCase().includes(q) || d.id.includes(q);
      }
      return true;
    });
  }, [dialogs, typeFilter, dialogSearch]);

  // 全选逻辑（只针对当前过滤结果）
  const allFilteredSelected = filteredDialogs.length > 0 && filteredDialogs.every((d) => selectedIds.has(d.id));
  const someFilteredSelected = filteredDialogs.some((d) => selectedIds.has(d.id)) && !allFilteredSelected;

  const handleToggleAll = () => {
    if (allFilteredSelected) {
      // 取消选中当前过滤结果
      const next = new Set(selectedIds);
      filteredDialogs.forEach((d) => next.delete(d.id));
      setSelectedIds(next);
    } else {
      // 全选当前过滤结果
      const next = new Set(selectedIds);
      filteredDialogs.forEach((d) => next.add(d.id));
      setSelectedIds(next);
    }
  };

  const handleToggleItem = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleLoadDialogs = async () => {
    if (!form.tgAccountId) { toast.error("请先选择监控账号"); return; }
    setLoadingDialogs(true);
    setSelectedIds(new Set());
    try {
      const result = await utils.tgAccounts.getDialogs.fetch({ id: form.tgAccountId });
      if (result.success && result.dialogs.length > 0) {
        setDialogs(result.dialogs);
        toast.success(`已读取 ${result.dialogs.length} 个群组/频道`);
      } else {
        toast.error("未找到任何群组，请确认账号已加入群组");
      }
    } catch (err: any) {
      toast.error(err.message ?? "读取群组列表失败");
    } finally {
      setLoadingDialogs(false);
    }
  };

  const handleBatchCreate = () => {
    if (!form.tgAccountId) return toast.error("请选择监控账号");
    if (selectedIds.size === 0) return toast.error("请至少选择一个群组");
    const selected = dialogs.filter((d) => selectedIds.has(d.id));
    batchCreateMut.mutate({
      tgAccountId: form.tgAccountId!,
      groups: selected.map((d) => ({
        groupId: d.id,
        groupTitle: d.title || undefined,
        groupUsername: d.username || undefined,
        groupType: (d.type === "channel" ? "channel" : d.type === "group" ? "group" : "supergroup") as any,
        memberCount: d.members_count ?? undefined,
      })),
    });
  };

  const openEdit = (g: any) => {
    setEditId(g.id);
    setEditForm({ tgGroupId: g.groupId ?? "", groupName: g.groupTitle ?? "", tgAccountId: g.tgAccountId ?? undefined });
    setEditOpen(true);
  };

  const handleUpdate = () => {
    if (!editId) return;
    updateMut.mutate({ id: editId, groupTitle: editForm.groupName || undefined });
  };

  const typeIcon = (type: string) => type === "channel" ? "📢" : "👥";
  const typeLabel = (type: string) => type === "channel" ? "频道" : type === "group" ? "群组" : "超级群";

  const statusColors: Record<string, string> = {
    monitoring: "bg-emerald-900 text-emerald-300",
    paused: "bg-slate-700 text-slate-300",
    error: "bg-red-900 text-red-300",
    stopped: "bg-slate-700 text-slate-400",
    active: "bg-emerald-900 text-emerald-300",
  };
  const statusLabels: Record<string, string> = {
    monitoring: "监控中",
    paused: "已暂停",
    error: "异常",
    stopped: "已停止",
    active: "监控中",
  };

  // 统计数量
  const groupCount = dialogs.filter((d) => d.type !== "channel").length;
  const channelCount = dialogs.filter((d) => d.type === "channel").length;

  return (
    <AppLayout title="群组监控">
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <p className="text-sm text-muted-foreground">配置需要监控的 Telegram 群组</p>
          <Button size="sm" onClick={() => { resetAddDialog(); setOpen(true); }}>
            <Plus className="w-4 h-4 mr-2" /> 添加监控群组
          </Button>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2, 3].map((i) => <div key={i} className="h-40 bg-card rounded-xl animate-pulse" />)}
          </div>
        ) : groups && groups.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {groups.map((g) => (
              <Card key={g.id} className="bg-card border-border hover:border-primary/30 transition-colors">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                        <Monitor className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <div className="font-medium text-sm">{g.groupTitle ?? `群组 ${g.groupId}`}</div>
                        <div className="text-xs text-muted-foreground font-mono">ID: {g.groupId}</div>
                      </div>
                    </div>
                    <Badge className={`text-xs border-0 ${statusColors[g.monitorStatus] ?? "bg-slate-700 text-slate-300"}`}>
                      {statusLabels[g.monitorStatus] ?? g.monitorStatus}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Hash className="w-3 h-3" />
                      命中次数: {g.totalHits ?? 0}
                    </div>
                    <div className="flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      成员数: {g.memberCount ?? "—"}
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="outline" className="flex-1 text-xs border-border"
                      onClick={() => toggleMut.mutate({ id: g.id, status: g.monitorStatus === "paused" ? "active" : "paused" })}>
                      {g.monitorStatus !== "paused" ? <><Pause className="w-3 h-3 mr-1" /> 暂停监控</> : <><Play className="w-3 h-3 mr-1" /> 开始监控</>}
                    </Button>
                    <Button size="sm" variant="outline" className="text-xs border-border" title="编辑" onClick={() => openEdit(g)}>
                      <Pencil className="w-3 h-3" />
                    </Button>
                    <Button size="sm" variant="outline" className="text-xs text-destructive hover:text-destructive border-border"
                      onClick={() => deleteMut.mutate({ id: g.id })}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="py-20 text-center text-muted-foreground">
            <Monitor className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="font-medium">还没有添加任何监控群组</p>
            <p className="text-sm mt-1">添加群组后，系统将实时监控群内消息</p>
            <Button onClick={() => setOpen(true)} className="mt-4" size="sm">
              <Plus className="w-4 h-4 mr-2" /> 添加第一个群组
            </Button>
          </div>
        )}
      </div>

      {/* ─── 添加群组对话框 ──────────────────────────────────────────────────── */}
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetAddDialog(); }}>
        <DialogContent className="bg-card border-border max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>添加监控群组</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2 overflow-hidden flex-1 min-h-0">
            {/* 第一行：选账号 + 读取按钮 */}
            <div className="flex gap-3 items-end flex-shrink-0">
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground mb-1 block">监控账号 <span className="text-destructive">*</span></Label>
                <Select
                  value={form.tgAccountId?.toString() ?? ""}
                  onValueChange={(v) => { setForm({ ...form, tgAccountId: parseInt(v) }); setDialogs([]); setSelectedIds(new Set()); }}
                >
                  <SelectTrigger className="bg-background border-border">
                    <SelectValue placeholder="选择 TG 账号" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {tgAccounts?.filter((a) => a.accountRole !== "sender").map((a) => (
                      <SelectItem key={a.id} value={a.id.toString()}>
                        {a.tgFirstName ?? a.phone ?? `账号 #${a.id}`}
                        {a.tgUsername && ` (@${a.tgUsername})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="outline"
                className="border-border flex-shrink-0"
                onClick={handleLoadDialogs}
                disabled={!form.tgAccountId || loadingDialogs}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${loadingDialogs ? "animate-spin" : ""}`} />
                {loadingDialogs ? "读取中..." : dialogs.length > 0 ? "重新读取" : "读取群组列表"}
              </Button>
            </div>

            {/* 群组列表区域 */}
            {dialogs.length > 0 && (
              <div className="flex flex-col gap-2 flex-1 min-h-0">
                {/* 搜索 + 类型筛选 + 全选 */}
                <div className="flex gap-2 items-center flex-shrink-0">
                  {/* 搜索框 */}
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      className="pl-8 h-8 text-xs bg-background border-border"
                      placeholder="搜索群组名称、用户名或 ID..."
                      value={dialogSearch}
                      onChange={(e) => setDialogSearch(e.target.value)}
                    />
                  </div>
                  {/* 类型筛选 */}
                  <div className="flex gap-1 flex-shrink-0">
                    {(["all", "group", "channel"] as const).map((t) => (
                      <Button
                        key={t}
                        size="sm"
                        variant={typeFilter === t ? "default" : "outline"}
                        className="h-8 text-xs px-3 border-border"
                        onClick={() => setTypeFilter(t)}
                      >
                        {t === "all" ? `全部 (${dialogs.length})` : t === "group" ? `👥 群组 (${groupCount})` : `📢 频道 (${channelCount})`}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* 全选行 */}
                <div className="flex items-center justify-between px-3 py-2 bg-background/50 border border-border rounded-lg flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={allFilteredSelected}
                      onCheckedChange={handleToggleAll}
                      className="data-[state=checked]:bg-primary"
                      ref={(el) => { if (el) (el as any).indeterminate = someFilteredSelected; }}
                    />
                    <span className="text-xs text-muted-foreground">
                      全选当前列表（{filteredDialogs.length} 项）
                    </span>
                  </div>
                  {selectedIds.size > 0 && (
                    <Badge className="bg-primary/20 text-primary border-0 text-xs">
                      已选 {selectedIds.size} 个
                    </Badge>
                  )}
                </div>

                {/* 群组列表（可滚动） */}
                <div className="flex-1 overflow-y-auto border border-border rounded-lg bg-background min-h-0">
                  {filteredDialogs.length === 0 ? (
                    <div className="py-8 text-center text-xs text-muted-foreground">没有匹配的群组</div>
                  ) : (
                    filteredDialogs.map((d) => (
                      <div
                        key={d.id}
                        className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-primary/5 transition-colors border-b border-border/50 last:border-0 ${selectedIds.has(d.id) ? "bg-primary/10" : ""}`}
                        onClick={() => handleToggleItem(d.id)}
                      >
                        <Checkbox
                          checked={selectedIds.has(d.id)}
                          onCheckedChange={() => handleToggleItem(d.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="data-[state=checked]:bg-primary flex-shrink-0"
                        />
                        <span className="text-base flex-shrink-0">{typeIcon(d.type)}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{d.title}</div>
                          <div className="text-xs text-muted-foreground font-mono truncate">
                            <span className="text-primary/70 mr-1">[{typeLabel(d.type)}]</span>
                            {d.username ? `@${d.username} · ` : ""}
                            {d.id}
                            {d.members_count ? ` · ${d.members_count.toLocaleString()} 成员` : ""}
                          </div>
                        </div>
                        {selectedIds.has(d.id) && (
                          <span className="text-primary text-xs flex-shrink-0">✓</span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* 未读取时的提示 */}
            {dialogs.length === 0 && !loadingDialogs && (
              <div className="flex-1 flex items-center justify-center border border-dashed border-border rounded-lg text-muted-foreground text-sm">
                {form.tgAccountId ? "点击读取群组列表按钮加载该账号的群组" : "请先选择监控账号"}
              </div>
            )}
          </div>

          <DialogFooter className="flex-shrink-0 pt-2 border-t border-border">
            <Button variant="outline" onClick={() => setOpen(false)} className="border-border">取消</Button>
            <Button
              onClick={handleBatchCreate}
              disabled={batchCreateMut.isPending || selectedIds.size === 0}
            >
              {batchCreateMut.isPending ? "添加中..." : `添加 ${selectedIds.size > 0 ? selectedIds.size + " 个" : ""}群组`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── 编辑群组对话框 ──────────────────────────────────────────────────── */}
      <Dialog open={editOpen} onOpenChange={(v) => { setEditOpen(v); if (!v) { setEditId(null); setEditForm(defaultEditForm); } }}>
        <DialogContent className="bg-card border-border max-w-lg">
          <DialogHeader>
            <DialogTitle>编辑监控群组</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs text-muted-foreground">群组 ID</Label>
              <Input value={editForm.tgGroupId} disabled className="bg-background border-border mt-1 font-mono opacity-60" />
              <p className="text-xs text-muted-foreground mt-1">群组 ID 不可修改</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">群组名称（备注）</Label>
              <Input placeholder="自定义备注名" value={editForm.groupName} onChange={(e) => setEditForm({ ...editForm, groupName: e.target.value })} className="bg-background border-border mt-1" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">监控账号</Label>
              <Select value={editForm.tgAccountId?.toString() ?? ""} onValueChange={(v) => setEditForm({ ...editForm, tgAccountId: parseInt(v) })}>
                <SelectTrigger className="bg-background border-border mt-1">
                  <SelectValue placeholder="选择监控账号" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {tgAccounts?.filter((a) => a.accountRole !== "sender").map((a) => (
                    <SelectItem key={a.id} value={a.id.toString()}>
                      {a.tgFirstName ?? a.phone ?? `账号 #${a.id}`}
                      {a.tgUsername && ` (@${a.tgUsername})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} className="border-border">取消</Button>
            <Button onClick={handleUpdate} disabled={updateMut.isPending}>
              {updateMut.isPending ? "保存中..." : "保存修改"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
