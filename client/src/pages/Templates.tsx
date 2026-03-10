import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { MessageSquare, Plus, Trash2, Copy, Star, StarOff } from "lucide-react";
import { useState } from "react";

const VARIABLES = [
  { var: "{{sender_name}}", desc: "发送者姓名" },
  { var: "{{sender_username}}", desc: "发送者用户名" },
  { var: "{{sender_id}}", desc: "发送者 TG ID" },
  { var: "{{keyword}}", desc: "命中的关键词" },
  { var: "{{group_name}}", desc: "来源群组名称" },
  { var: "{{message}}", desc: "原始消息内容" },
  { var: "{{date}}", desc: "当前日期" },
  { var: "{{time}}", desc: "当前时间" },
];

export default function Templates() {
  const utils = trpc.useUtils();
  const { data: templates, isLoading } = trpc.templates.list.useQuery();

  const createMut = trpc.templates.create.useMutation({
    onSuccess: () => { utils.templates.list.invalidate(); toast.success("模板创建成功"); setOpen(false); resetForm(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMut = trpc.templates.delete.useMutation({
    onSuccess: () => { utils.templates.list.invalidate(); toast.success("模板已删除"); },
    onError: (e) => toast.error(e.message),
  });
  const toggleMut = trpc.templates.update.useMutation({
    onSuccess: () => utils.templates.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", content: "", isDefault: false });
  const resetForm = () => setForm({ name: "", content: "", isDefault: false });

  const insertVar = (v: string) => setForm((f) => ({ ...f, content: f.content + v }));

  return (
    <AppLayout title="消息模板">
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <p className="text-sm text-muted-foreground">配置命中关键词后自动发送的私信内容</p>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="w-4 h-4 mr-2" /> 新建模板
          </Button>
        </div>

        {/* 变量说明 */}
        <div className="mb-6 p-4 bg-card border border-border rounded-xl">
          <p className="text-xs font-medium text-muted-foreground mb-3">可用变量（点击插入）</p>
          <div className="flex flex-wrap gap-2">
            {VARIABLES.map((v) => (
              <button
                key={v.var}
                onClick={() => setForm((f) => ({ ...f, content: f.content + v.var }))}
                className="text-xs font-mono bg-background border border-border rounded px-2 py-1 text-primary hover:bg-primary/10 transition-colors"
                title={v.desc}
              >
                {v.var}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2].map((i) => <div key={i} className="h-40 bg-card rounded-xl animate-pulse" />)}
          </div>
        ) : templates && templates.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {templates.map((t) => (
              <Card key={t.id} className="bg-card border-border hover:border-primary/30 transition-colors">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-primary" />
                      <span className="font-medium text-sm">{t.name}</span>
                      {t.weight >= 10 && <Badge className="text-xs bg-amber-900 text-amber-300 border-0">默认</Badge>}
                    </div>
                    <Switch
                      checked={t.isActive}
                      onCheckedChange={(v) => toggleMut.mutate({ id: t.id, isActive: v })}
                      className="scale-75"
                    />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-sm text-muted-foreground bg-background/50 rounded-lg p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto border border-border/50">
                    {t.content}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1 text-xs border-border" onClick={() => { navigator.clipboard.writeText(t.content); toast.success("已复制"); }}>
                      <Copy className="w-3 h-3 mr-1" /> 复制内容
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs border-border"
                      onClick={() => toggleMut.mutate({ id: t.id, weight: t.weight >= 10 ? 1 : 10 })}
                    >
                      {t.weight >= 10 ? <StarOff className="w-3 h-3" /> : <Star className="w-3 h-3" />}
                    </Button>
                    <Button size="sm" variant="outline" className="text-xs text-destructive hover:text-destructive border-border" onClick={() => deleteMut.mutate({ id: t.id })}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="py-20 text-center text-muted-foreground">
            <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="font-medium">还没有创建任何消息模板</p>
            <p className="text-sm mt-1">创建模板后，命中关键词时将自动发送给目标用户</p>
            <Button onClick={() => setOpen(true)} className="mt-4" size="sm">
              <Plus className="w-4 h-4 mr-2" /> 创建第一个模板
            </Button>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
        <DialogContent className="bg-card border-border max-w-lg">
          <DialogHeader>
            <DialogTitle>新建消息模板</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs text-muted-foreground">模板名称</Label>
              <Input placeholder="例如：求购客户开场白" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-background border-border mt-1" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs text-muted-foreground">消息内容</Label>
                <div className="flex flex-wrap gap-1">
                  {VARIABLES.slice(0, 4).map((v) => (
                    <button key={v.var} onClick={() => insertVar(v.var)} className="text-xs font-mono bg-background border border-border rounded px-1.5 py-0.5 text-primary hover:bg-primary/10 transition-colors">
                      {v.var.replace(/[{}]/g, "")}
                    </button>
                  ))}
                </div>
              </div>
              <Textarea
                placeholder={"您好 {{sender_name}}，看到您在群里问到了「{{keyword}}」，我们正好有相关资源，欢迎私聊了解详情！"}
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                className="bg-background border-border font-mono text-sm h-36 resize-none"
              />
              <p className="text-xs text-muted-foreground mt-1">支持变量插值，发送时自动替换为真实内容</p>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs font-medium">设为默认模板</Label>
                <p className="text-xs text-muted-foreground">未指定模板时自动使用此模板</p>
              </div>
              <Switch checked={form.isDefault} onCheckedChange={(v) => setForm({ ...form, isDefault: v })} />
            </div>
            {/* isDefault maps to weight=10 */}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} className="border-border">取消</Button>
            <Button onClick={() => createMut.mutate({ name: form.name, content: form.content, weight: form.isDefault ? 10 : 1 })} disabled={!form.name || !form.content || createMut.isPending}>
              {createMut.isPending ? "创建中..." : "创建模板"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
