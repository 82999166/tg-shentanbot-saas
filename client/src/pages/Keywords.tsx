import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Hash, Plus, Trash2, TestTube2, CheckCircle2, XCircle, Tag, ChevronDown } from "lucide-react";
import { useState } from "react";

const MATCH_TYPES = [
  { value: "contains", label: "包含匹配", desc: "消息中包含关键词即命中" },
  { value: "exact", label: "精确匹配", desc: "消息完全等于关键词" },
  { value: "regex", label: "正则表达式", desc: "使用正则表达式匹配" },
  { value: "and", label: "AND 逻辑", desc: "所有子关键词都出现才命中" },
  { value: "or", label: "OR 逻辑", desc: "任意子关键词出现即命中" },
  { value: "not", label: "NOT 排除", desc: "不包含任何子关键词才命中" },
];

const matchTypeColors: Record<string, string> = {
  contains: "bg-blue-900 text-blue-300",
  exact: "bg-purple-900 text-purple-300",
  regex: "bg-amber-900 text-amber-300",
  and: "bg-emerald-900 text-emerald-300",
  or: "bg-cyan-900 text-cyan-300",
  not: "bg-red-900 text-red-300",
};

export default function Keywords() {
  const utils = trpc.useUtils();
  const { data: groups } = trpc.keywords.listGroups.useQuery();
  const { data: keywords, isLoading } = trpc.keywords.list.useQuery({ groupId: undefined });

  const createMut = trpc.keywords.create.useMutation({
    onSuccess: () => { utils.keywords.list.invalidate(); toast.success("关键词添加成功"); setOpen(false); resetForm(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMut = trpc.keywords.delete.useMutation({
    onSuccess: () => { utils.keywords.list.invalidate(); toast.success("关键词已删除"); },
    onError: (e) => toast.error(e.message),
  });
  const toggleMut = trpc.keywords.update.useMutation({
    onSuccess: () => utils.keywords.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const testMut = trpc.keywords.test.useMutation();
  const createGroupMut = trpc.keywords.createGroup.useMutation({
    onSuccess: () => { utils.keywords.listGroups.invalidate(); toast.success("分组创建成功"); setGroupOpen(false); setGroupName(""); },
    onError: (e) => toast.error(e.message),
  });

  const [open, setOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [testText, setTestText] = useState("");
  const [testResult, setTestResult] = useState<{ matched: boolean; reason: string } | null>(null);

  const [form, setForm] = useState({
    keyword: "",
    matchType: "contains" as "exact" | "contains" | "regex" | "and" | "or" | "not",
    subKeywords: "",
    caseSensitive: false,
    groupId: undefined as number | undefined,
  });

  const resetForm = () => setForm({ keyword: "", matchType: "contains", subKeywords: "", caseSensitive: false, groupId: undefined });

  const handleSubmit = () => {
    createMut.mutate({
      keyword: form.keyword,
      matchType: form.matchType,
      subKeywords: form.subKeywords ? form.subKeywords.split("\n").map((s) => s.trim()).filter(Boolean) : undefined,
      caseSensitive: form.caseSensitive,
      groupId: form.groupId,
    });
  };

  const handleTest = async () => {
    if (!testText) return;
    const result = await testMut.mutateAsync({
      keyword: form.keyword,
      matchType: form.matchType,
      subKeywords: form.subKeywords ? form.subKeywords.split("\n").map((s) => s.trim()).filter(Boolean) : undefined,
      caseSensitive: form.caseSensitive,
      testText,
    });
    setTestResult(result);
  };

  const needsSubKeywords = ["and", "or", "not"].includes(form.matchType);
  const groupMap = Object.fromEntries((groups ?? []).map((g) => [g.id, g]));

  return (
    <AppLayout title="关键词管理">
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <p className="text-sm text-muted-foreground">配置触发监控的关键词规则</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setGroupOpen(true)} className="border-border">
              <Tag className="w-4 h-4 mr-2" /> 新建分组
            </Button>
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="w-4 h-4 mr-2" /> 添加关键词
            </Button>
          </div>
        </div>

        {/* 分组标签 */}
        {groups && groups.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {groups.map((g) => (
              <Badge key={g.id} className="text-xs border-0 cursor-pointer" style={{ background: (g.color ?? "#888") + "33", color: g.color ?? "#888" }}>
                {g.name}
              </Badge>
            ))}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-card rounded-xl animate-pulse" />)}
          </div>
        ) : keywords && keywords.length > 0 ? (
          <div className="space-y-2">
            {keywords.map((kw) => (
              <div key={kw.id} className="flex items-center gap-4 p-4 bg-card border border-border rounded-xl hover:border-primary/30 transition-colors">
                <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
                  <Hash className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-medium">{kw.keyword}</span>
                    <Badge className={`text-xs border-0 ${matchTypeColors[kw.matchType]}`}>
                      {MATCH_TYPES.find((t) => t.value === kw.matchType)?.label}
                    </Badge>
                    {kw.caseSensitive && <Badge className="text-xs bg-slate-700 text-slate-300 border-0">区分大小写</Badge>}
                    {kw.groupId && groupMap[kw.groupId] && (
                      <Badge className="text-xs border-0" style={{ background: (groupMap[kw.groupId].color ?? "#888") + "33", color: groupMap[kw.groupId].color ?? "#888" }}>
                        {groupMap[kw.groupId].name}
                      </Badge>
                    )}
                  </div>
                  {Array.isArray(kw.subKeywords) && (kw.subKeywords as string[]).length > 0 && (
                    <div className="text-xs text-muted-foreground mt-1">
                      子关键词: {(kw.subKeywords as string[]).join(" · ")}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <Switch
                    checked={kw.isActive}
                    onCheckedChange={(v) => toggleMut.mutate({ id: kw.id, isActive: v })}
                    className="scale-90"
                  />
                  <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive w-8 h-8 p-0" onClick={() => deleteMut.mutate({ id: kw.id })}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-20 text-center text-muted-foreground">
            <Hash className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="font-medium">还没有添加任何关键词</p>
            <p className="text-sm mt-1">添加关键词后，系统将监控群组中包含这些词的消息</p>
            <Button onClick={() => setOpen(true)} className="mt-4" size="sm">
              <Plus className="w-4 h-4 mr-2" /> 添加第一个关键词
            </Button>
          </div>
        )}
      </div>

      {/* 添加关键词对话框 */}
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { resetForm(); setTestResult(null); } }}>
        <DialogContent className="bg-card border-border max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>添加关键词</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs text-muted-foreground">匹配类型</Label>
              <Select value={form.matchType} onValueChange={(v) => setForm({ ...form, matchType: v as any })}>
                <SelectTrigger className="bg-background border-border mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {MATCH_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      <div>
                        <div className="font-medium text-sm">{t.label}</div>
                        <div className="text-xs text-muted-foreground">{t.desc}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">
                {needsSubKeywords ? "主关键词（描述用）" : "关键词"}
              </Label>
              <Input
                placeholder={form.matchType === "regex" ? "^.*求购.*$" : "输入关键词..."}
                value={form.keyword}
                onChange={(e) => setForm({ ...form, keyword: e.target.value })}
                className="bg-background border-border mt-1 font-mono"
              />
            </div>

            {needsSubKeywords && (
              <div>
                <Label className="text-xs text-muted-foreground">子关键词（每行一个）</Label>
                <Textarea
                  placeholder={"关键词1\n关键词2\n关键词3"}
                  value={form.subKeywords}
                  onChange={(e) => setForm({ ...form, subKeywords: e.target.value })}
                  className="bg-background border-border mt-1 font-mono text-sm h-24 resize-none"
                />
              </div>
            )}

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs font-medium">区分大小写</Label>
                <p className="text-xs text-muted-foreground">开启后大小写需完全匹配</p>
              </div>
              <Switch checked={form.caseSensitive} onCheckedChange={(v) => setForm({ ...form, caseSensitive: v })} />
            </div>

            {groups && groups.length > 0 && (
              <div>
                <Label className="text-xs text-muted-foreground">所属分组（可选）</Label>
                <Select value={form.groupId?.toString() ?? ""} onValueChange={(v) => setForm({ ...form, groupId: v ? parseInt(v) : undefined })}>
                  <SelectTrigger className="bg-background border-border mt-1">
                    <SelectValue placeholder="不分组" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="">不分组</SelectItem>
                    {groups.map((g) => <SelectItem key={g.id} value={g.id.toString()}>{g.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* 测试区域 */}
            <div className="border border-border rounded-lg p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <TestTube2 className="w-3.5 h-3.5" /> 测试匹配效果
              </p>
              <Textarea
                placeholder="输入测试文本，验证关键词是否能正确匹配..."
                value={testText}
                onChange={(e) => setTestText(e.target.value)}
                className="bg-background border-border text-sm h-16 resize-none"
              />
              <Button size="sm" variant="outline" onClick={handleTest} disabled={!form.keyword || !testText || testMut.isPending} className="w-full border-border text-xs">
                {testMut.isPending ? "测试中..." : "立即测试"}
              </Button>
              {testResult && (
                <div className={`flex items-center gap-2 text-sm p-2 rounded-lg ${testResult.matched ? "bg-emerald-900/30 text-emerald-300" : "bg-red-900/30 text-red-300"}`}>
                  {testResult.matched ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
                  <span>{testResult.reason}</span>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} className="border-border">取消</Button>
            <Button onClick={handleSubmit} disabled={!form.keyword || createMut.isPending}>
              {createMut.isPending ? "添加中..." : "添加关键词"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 新建分组对话框 */}
      <Dialog open={groupOpen} onOpenChange={setGroupOpen}>
        <DialogContent className="bg-card border-border max-w-sm">
          <DialogHeader>
            <DialogTitle>新建关键词分组</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-xs text-muted-foreground">分组名称</Label>
            <Input placeholder="例如：求购类、出售类..." value={groupName} onChange={(e) => setGroupName(e.target.value)} className="bg-background border-border mt-1" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGroupOpen(false)} className="border-border">取消</Button>
            <Button onClick={() => createGroupMut.mutate({ name: groupName })} disabled={!groupName || createGroupMut.isPending}>
              创建分组
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
