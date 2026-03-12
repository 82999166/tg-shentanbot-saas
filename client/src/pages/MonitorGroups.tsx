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
import { toast } from "sonner";
import { Monitor, Plus, Trash2, Play, Pause, Users, Hash, Pencil } from "lucide-react";
import { useState } from "react";

type FormState = {
  tgGroupId: string;
  groupName: string;
  tgAccountId: number | undefined;
  keywordIds: number[];
  notifyTarget: string;
  autoReply: boolean;
  templateId: number | undefined;
};

const defaultForm: FormState = {
  tgGroupId: "",
  groupName: "",
  tgAccountId: undefined,
  keywordIds: [],
  notifyTarget: "",
  autoReply: false,
  templateId: undefined,
};

export default function MonitorGroups() {
  const utils = trpc.useUtils();
  const { data: groups, isLoading } = trpc.monitorGroups.list.useQuery();
  const { data: tgAccounts } = trpc.tgAccounts.list.useQuery();
  const { data: keywords } = trpc.keywords.list.useQuery({ groupId: undefined });

  const createMut = trpc.monitorGroups.create.useMutation({
    onSuccess: () => { utils.monitorGroups.list.invalidate(); toast.success("监控群组添加成功"); setOpen(false); setForm(defaultForm); },
    onError: (e) => toast.error(e.message),
  });
  const updateMut = trpc.monitorGroups.update.useMutation({
    onSuccess: () => { utils.monitorGroups.list.invalidate(); toast.success("群组信息已更新"); setEditOpen(false); setEditId(null); setForm(defaultForm); },
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

  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm);

  const openEdit = (g: any) => {
    setEditId(g.id);
    setForm({
      tgGroupId: g.groupId ?? "",
      groupName: g.groupTitle ?? "",
      tgAccountId: g.tgAccountId ?? undefined,
      keywordIds: [],
      notifyTarget: g.notifyTarget ?? "",
      autoReply: g.autoReply ?? false,
      templateId: g.templateId ?? undefined,
    });
    setEditOpen(true);
  };

  const handleCreate = () => {
    if (!form.tgGroupId) return toast.error("请填写群组 ID");
    if (!form.tgAccountId) return toast.error("请选择监控账号");
    createMut.mutate({ tgAccountId: form.tgAccountId!, groupId: form.tgGroupId, groupTitle: form.groupName || undefined, keywordIds: form.keywordIds });
  };

  const handleUpdate = () => {
    if (!editId) return;
    updateMut.mutate({ id: editId, groupTitle: form.groupName || undefined });
  };

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

  return (
    <AppLayout title="群组监控">
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <p className="text-sm text-muted-foreground">配置需要监控的 Telegram 群组</p>
          <Button size="sm" onClick={() => { setForm(defaultForm); setOpen(true); }}>
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
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 text-xs border-border"
                      onClick={() => toggleMut.mutate({ id: g.id, status: g.monitorStatus === "paused" ? "active" : "paused" })}
                    >
                      {g.monitorStatus !== "paused" ? (
                        <><Pause className="w-3 h-3 mr-1" /> 暂停监控</>
                      ) : (
                        <><Play className="w-3 h-3 mr-1" /> 开始监控</>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs border-border"
                      title="编辑群组"
                      onClick={() => openEdit(g)}
                    >
                      <Pencil className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs text-destructive hover:text-destructive border-border"
                      onClick={() => deleteMut.mutate({ id: g.id })}
                    >
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

      {/* 添加群组对话框 */}
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setForm(defaultForm); }}>
        <DialogContent className="bg-card border-border max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>添加监控群组</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">群组 ID / 用户名 <span className="text-destructive">*</span></Label>
                <Input placeholder="-1001234567890" value={form.tgGroupId} onChange={(e) => setForm({ ...form, tgGroupId: e.target.value })} className="bg-background border-border mt-1 font-mono" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">群组名称（备注）</Label>
                <Input placeholder="自定义备注名" value={form.groupName} onChange={(e) => setForm({ ...form, groupName: e.target.value })} className="bg-background border-border mt-1" />
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">监控账号 <span className="text-destructive">*</span></Label>
              <Select value={form.tgAccountId?.toString() ?? ""} onValueChange={(v) => setForm({ ...form, tgAccountId: parseInt(v) })}>
                <SelectTrigger className="bg-background border-border mt-1">
                  <SelectValue placeholder="选择用于监控的 TG 账号" />
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
            <div>
              <Label className="text-xs text-muted-foreground">通知目标群组/用户 ID</Label>
              <Input placeholder="-1009876543210 或 @username" value={form.notifyTarget} onChange={(e) => setForm({ ...form, notifyTarget: e.target.value })} className="bg-background border-border mt-1 font-mono" />
              <p className="text-xs text-muted-foreground mt-1">命中时将通知发送到此群组或用户</p>
            </div>
            <div className="flex items-center justify-between p-3 bg-background/50 rounded-lg border border-border">
              <div>
                <Label className="text-xs font-medium">开启自动私信</Label>
                <p className="text-xs text-muted-foreground">命中关键词后自动向发送者发送预设消息</p>
              </div>
              <Switch checked={form.autoReply} onCheckedChange={(v) => setForm({ ...form, autoReply: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} className="border-border">取消</Button>
            <Button onClick={handleCreate} disabled={createMut.isPending}>
              {createMut.isPending ? "添加中..." : "添加群组"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑群组对话框 */}
      <Dialog open={editOpen} onOpenChange={(v) => { setEditOpen(v); if (!v) { setEditId(null); setForm(defaultForm); } }}>
        <DialogContent className="bg-card border-border max-w-lg">
          <DialogHeader>
            <DialogTitle>编辑监控群组</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs text-muted-foreground">群组 ID</Label>
              <Input value={form.tgGroupId} disabled className="bg-background border-border mt-1 font-mono opacity-60" />
              <p className="text-xs text-muted-foreground mt-1">群组 ID 不可修改</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">群组名称（备注）</Label>
              <Input placeholder="自定义备注名" value={form.groupName} onChange={(e) => setForm({ ...form, groupName: e.target.value })} className="bg-background border-border mt-1" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">监控账号</Label>
              <Select value={form.tgAccountId?.toString() ?? ""} onValueChange={(v) => setForm({ ...form, tgAccountId: parseInt(v) })}>
                <SelectTrigger className="bg-background border-border mt-1">
                  <SelectValue placeholder="选择用于监控的 TG 账号" />
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
