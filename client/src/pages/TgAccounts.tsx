import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Bot, CheckCircle2, Plus, RefreshCw, Trash2, Wifi, WifiOff, AlertTriangle, Activity } from "lucide-react";
import { useState } from "react";

function HealthBadge({ score, status }: { score: number; status: string }) {
  const colors: Record<string, string> = {
    healthy: "bg-emerald-900 text-emerald-300",
    warning: "bg-amber-900 text-amber-300",
    degraded: "bg-orange-900 text-orange-300",
    suspended: "bg-red-900 text-red-300",
  };
  return (
    <Badge className={`text-xs border-0 ${colors[status] ?? "bg-slate-700 text-slate-300"}`}>
      {score}分 · {status === "healthy" ? "健康" : status === "warning" ? "警告" : status === "degraded" ? "降级" : "暂停"}
    </Badge>
  );
}

function SessionBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; icon: React.ElementType }> = {
    pending: { label: "待配置", color: "bg-slate-700 text-slate-300", icon: AlertTriangle },
    active: { label: "正常", color: "bg-emerald-900 text-emerald-300", icon: CheckCircle2 },
    expired: { label: "已过期", color: "bg-amber-900 text-amber-300", icon: WifiOff },
    banned: { label: "已封禁", color: "bg-red-900 text-red-300", icon: WifiOff },
  };
  const s = map[status] ?? map.pending;
  return (
    <Badge className={`text-xs border-0 flex items-center gap-1 ${s.color}`}>
      <s.icon className="w-3 h-3" />
      {s.label}
    </Badge>
  );
}

export default function TgAccounts() {
  const utils = trpc.useUtils();
  const { data: accounts, isLoading } = trpc.tgAccounts.list.useQuery();
  const createMut = trpc.tgAccounts.create.useMutation({
    onSuccess: () => { utils.tgAccounts.list.invalidate(); toast.success("账号添加成功"); setOpen(false); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMut = trpc.tgAccounts.delete.useMutation({
    onSuccess: () => { utils.tgAccounts.list.invalidate(); toast.success("账号已删除"); },
    onError: (e) => toast.error(e.message),
  });
  const testMut = trpc.tgAccounts.testConnection.useMutation({
    onSuccess: (r) => { utils.tgAccounts.list.invalidate(); toast[r.success ? "success" : "error"](r.message); },
    onError: (e) => toast.error(e.message),
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    phone: "", tgUserId: "", tgUsername: "", tgFirstName: "",
    sessionString: "", accountRole: "both" as "monitor" | "sender" | "both",
    proxyHost: "", proxyPort: "", proxyType: "socks5" as "socks5" | "http" | "mtproto",
    proxyUsername: "", proxyPassword: "", notes: "",
  });

  const handleSubmit = () => {
    createMut.mutate({
      ...form,
      proxyPort: form.proxyPort ? parseInt(form.proxyPort) : undefined,
    });
  };

  const roleLabels: Record<string, string> = { monitor: "仅监控", sender: "仅发信", both: "监控+发信" };
  const roleColors: Record<string, string> = { monitor: "bg-blue-900 text-blue-300", sender: "bg-purple-900 text-purple-300", both: "bg-cyan-900 text-cyan-300" };

  return (
    <AppLayout title="TG 账号管理">
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <p className="text-sm text-muted-foreground">管理用于监控和发信的 Telegram 账号</p>
          <Button onClick={() => setOpen(true)} size="sm">
            <Plus className="w-4 h-4 mr-2" /> 添加账号
          </Button>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => <div key={i} className="h-48 bg-card rounded-xl animate-pulse" />)}
          </div>
        ) : accounts && accounts.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {accounts.map((acc) => (
              <Card key={acc.id} className="bg-card border-border hover:border-primary/30 transition-colors">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                        <Bot className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <div className="font-medium text-sm">
                          {acc.tgFirstName ?? acc.phone ?? `账号 #${acc.id}`}
                        </div>
                        {acc.tgUsername && (
                          <div className="text-xs text-muted-foreground">@{acc.tgUsername}</div>
                        )}
                      </div>
                    </div>
                    <SessionBadge status={acc.sessionStatus} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge className={`text-xs border-0 ${roleColors[acc.accountRole]}`}>
                      {roleLabels[acc.accountRole]}
                    </Badge>
                    <HealthBadge score={acc.healthScore} status={acc.healthStatus} />
                  </div>

                  {acc.proxyHost && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <Wifi className="w-3 h-3" />
                      代理: {acc.proxyHost}:{acc.proxyPort}
                    </div>
                  )}

                  <div className="text-xs text-muted-foreground">
                    今日发信: {acc.dailyDmSent ?? 0} 条
                    {acc.lastActiveAt && (
                      <span className="ml-2">
                        · 最后活跃: {new Date(acc.lastActiveAt).toLocaleString("zh-CN")}
                      </span>
                    )}
                  </div>

                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 text-xs"
                      onClick={() => testMut.mutate({ id: acc.id })}
                      disabled={testMut.isPending}
                    >
                      <RefreshCw className={`w-3 h-3 mr-1 ${testMut.isPending ? "animate-spin" : ""}`} />
                      测试连接
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs text-destructive hover:text-destructive"
                      onClick={() => deleteMut.mutate({ id: acc.id })}
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
            <Bot className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="font-medium">还没有添加任何 TG 账号</p>
            <p className="text-sm mt-1">添加账号后即可开始监控群组消息</p>
            <Button onClick={() => setOpen(true)} className="mt-4" size="sm">
              <Plus className="w-4 h-4 mr-2" /> 添加第一个账号
            </Button>
          </div>
        )}
      </div>

      {/* 添加账号对话框 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-card border-border max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>添加 Telegram 账号</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">手机号</Label>
                <Input placeholder="+8613800138000" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="bg-background border-border mt-1" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">TG 用户名</Label>
                <Input placeholder="username" value={form.tgUsername} onChange={(e) => setForm({ ...form, tgUsername: e.target.value })} className="bg-background border-border mt-1" />
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Session 字符串 <span className="text-destructive">*</span></Label>
              <Textarea
                placeholder="粘贴 Pyrogram/Telethon 生成的 Session 字符串..."
                value={form.sessionString}
                onChange={(e) => setForm({ ...form, sessionString: e.target.value })}
                className="bg-background border-border mt-1 font-mono text-xs h-24 resize-none"
              />
              <p className="text-xs text-muted-foreground mt-1">通过 Pyrogram 的 StringSession 或 Telethon 的 StringSession 获取</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">账号角色</Label>
              <Select value={form.accountRole} onValueChange={(v) => setForm({ ...form, accountRole: v as any })}>
                <SelectTrigger className="bg-background border-border mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="both">监控 + 发信（推荐）</SelectItem>
                  <SelectItem value="monitor">仅监控</SelectItem>
                  <SelectItem value="sender">仅发信</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="border border-border rounded-lg p-3 space-y-3">
              <p className="text-xs font-medium text-muted-foreground">代理配置（可选）</p>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <Input placeholder="代理主机 IP" value={form.proxyHost} onChange={(e) => setForm({ ...form, proxyHost: e.target.value })} className="bg-background border-border text-xs" />
                </div>
                <div>
                  <Input placeholder="端口" value={form.proxyPort} onChange={(e) => setForm({ ...form, proxyPort: e.target.value })} className="bg-background border-border text-xs" />
                </div>
              </div>
              <Select value={form.proxyType} onValueChange={(v) => setForm({ ...form, proxyType: v as any })}>
                <SelectTrigger className="bg-background border-border text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="socks5">SOCKS5</SelectItem>
                  <SelectItem value="http">HTTP</SelectItem>
                  <SelectItem value="mtproto">MTProto</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">备注</Label>
              <Input placeholder="账号备注（可选）" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="bg-background border-border mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} className="border-border">取消</Button>
            <Button onClick={handleSubmit} disabled={createMut.isPending}>
              {createMut.isPending ? "添加中..." : "添加账号"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
