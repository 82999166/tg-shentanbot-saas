/**
 * GroupScrape.tsx v3
 * 群组采集 - 重构版
 * Tab1: 关键词采集（任务管理 + 结果审核 + AI评分）
 * Tab2: 指定群组采集（批次管理 + AI标签 + 全局去重）
 * Tab3: 消息提取链接（工具 + AI过滤）
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  Search, Target, Link2, Plus, Play, Trash2, RefreshCw,
  Download, Upload, Tag, Star, Users, Globe, Bot,
  CheckCircle, AlertTriangle, Info, Copy, FileText, Settings2, Layers,
  Hash
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";

// ── 工具函数 ──────────────────────────────────────────────────────────────

function AiScoreBar({ score }: { score: number | null | undefined }) {
  if (score == null) return <span className="text-slate-400 text-xs">-</span>;
  const pct = Math.min(100, Math.max(0, score));
  const color = pct >= 80 ? "bg-emerald-500" : pct >= 60 ? "bg-blue-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500";
  const textColor = pct >= 80 ? "text-emerald-600" : pct >= 60 ? "text-blue-600" : pct >= 40 ? "text-amber-600" : "text-red-600";
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-medium ${textColor} w-6 text-right`}>{Math.round(pct)}</span>
    </div>
  );
}

const TAG_STYLES: Record<string, string> = {
  "优质": "bg-emerald-100 text-emerald-700 border-emerald-200",
  "高质量": "bg-emerald-100 text-emerald-700 border-emerald-200",
  "活跃": "bg-blue-100 text-blue-700 border-blue-200",
  "活跃用户": "bg-blue-100 text-blue-700 border-blue-200",
  "Premium": "bg-purple-100 text-purple-700 border-purple-200",
  "频道": "bg-sky-100 text-sky-700 border-sky-200",
  "群组": "bg-indigo-100 text-indigo-700 border-indigo-200",
  "公开": "bg-teal-100 text-teal-700 border-teal-200",
  "大群": "bg-orange-100 text-orange-700 border-orange-200",
  "机器人": "bg-slate-100 text-slate-500 border-slate-200",
  "广告群": "bg-red-100 text-red-600 border-red-200",
  "疑似广告": "bg-red-100 text-red-600 border-red-200",
  "低质量": "bg-red-100 text-red-600 border-red-200",
  "低质": "bg-red-100 text-red-600 border-red-200",
  "僵尸群": "bg-gray-100 text-slate-400 border-gray-200",
  "中文用户": "bg-yellow-100 text-yellow-700 border-yellow-200",
  "海外用户": "bg-cyan-100 text-cyan-700 border-cyan-200",
  "有用户名": "bg-green-100 text-green-700 border-green-200",
  "沉默用户": "bg-slate-100 text-slate-500 border-slate-200",
  "资源群": "bg-violet-100 text-violet-700 border-violet-200",
};

function TagBadge({ tag }: { tag: string }) {
  const cls = TAG_STYLES[tag] || "bg-slate-100 text-slate-600 border-slate-200";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs border font-medium ${cls}`}>
      {tag}
    </span>
  );
}

function TagList({ tags }: { tags: string[] }) {
  if (!tags || tags.length === 0) return <span className="text-slate-400 text-xs">-</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.slice(0, 4).map(t => <TagBadge key={t} tag={t} />)}
      {tags.length > 4 && <span className="text-xs text-slate-400">+{tags.length - 4}</span>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    idle: { label: "空闲", cls: "bg-slate-100 text-slate-600" },
    pending: { label: "等待中", cls: "bg-amber-100 text-amber-700" },
    running: { label: "运行中", cls: "bg-blue-100 text-blue-700" },
    done: { label: "完成", cls: "bg-emerald-100 text-emerald-700" },
    failed: { label: "失败", cls: "bg-red-100 text-red-700" },
    pending_import: { label: "待导入", cls: "bg-amber-100 text-amber-700" },
    imported: { label: "已导入", cls: "bg-emerald-100 text-emerald-700" },
    ignored: { label: "已忽略", cls: "bg-slate-100 text-slate-500" },
  };
  const s = map[status] || { label: status, cls: "bg-slate-100 text-slate-600" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

function Pagination({ page, pageSize, total, onChange }: {
  page: number; pageSize: number; total: number; onChange: (p: number) => void;
}) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center gap-2 justify-end mt-3">
      <span className="text-xs text-slate-500">共 {total} 条</span>
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>上一页</Button>
      <span className="text-xs text-slate-600">{page} / {totalPages}</span>
      <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>下一页</Button>
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────────────

export default function GroupScrape() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<"keyword" | "target" | "extract">("keyword");

  const tabs = [
    { key: "keyword" as const, label: "关键词采集", icon: <Search className="w-4 h-4" /> },
    { key: "target" as const, label: "指定群组采集", icon: <Target className="w-4 h-4" /> },
    { key: "extract" as const, label: "消息提取链接", icon: <Link2 className="w-4 h-4" /> },
  ];

  return (
    <AdminLayout title="群组采集">
      <div className="min-h-full bg-slate-50">
        {/* 页面头部 */}
        <div className="bg-white border-b border-slate-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-slate-800 flex items-center gap-2">
                <Search className="w-5 h-5 text-blue-500" />
                群组采集
              </h1>
              <p className="text-sm text-slate-500 mt-0.5">
                通过关键词搜索、指定群组深度采集或消息提取，发现并导入高质量群组/频道/用户
              </p>
            </div>
          </div>

          {/* Tab 导航 */}
          <div className="flex gap-1 mt-4">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === tab.key
                    ? "bg-blue-500 text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab 内容 */}
        <div className="p-6">
          {activeTab === "keyword" && <KeywordTab />}
          {activeTab === "target" && <TargetTab />}
          {activeTab === "extract" && <ExtractTab />}
        </div>
      </div>
    </AdminLayout>
  );
}

// ══════════════════════════════════════════════════════════════════
// Tab1: 关键词采集
// ══════════════════════════════════════════════════════════════════

function KeywordTab() {
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingTask, setEditingTask] = useState<any>(null);
  const [resultPage, setResultPage] = useState(1);
  const [resultFilter, setResultFilter] = useState<"all" | "pending" | "imported" | "ignored">("pending");
  const [selectedResultIds, setSelectedResultIds] = useState<number[]>([]);

  const { data: tasks, refetch: refetchTasks } = trpc.groupScrape.listTasks.useQuery();
  const { data: results, refetch: refetchResults } = trpc.groupScrape.listResults.useQuery(
    { taskId: selectedTaskId ?? undefined, importStatus: resultFilter, page: resultPage, pageSize: 20 },
    { enabled: true }
  );

  const createTask = trpc.groupScrape.createTask.useMutation({ onSuccess: () => { refetchTasks(); setShowCreateDialog(false); } });
  const updateTask = trpc.groupScrape.updateTask.useMutation({ onSuccess: () => { refetchTasks(); setShowEditDialog(false); } });
  const deleteTask = trpc.groupScrape.deleteTask.useMutation({ onSuccess: () => { refetchTasks(); setSelectedTaskId(null); } });
  const triggerTask = trpc.groupScrape.triggerTask.useMutation({ onSuccess: () => refetchTasks() });
  const importToPool = trpc.groupScrape.importToPublicPool.useMutation({ onSuccess: () => { refetchResults(); setSelectedResultIds([]); } });
  const ignoreResults = trpc.groupScrape.ignoreResults.useMutation({ onSuccess: () => { refetchResults(); setSelectedResultIds([]); } });
  const clearResults = trpc.groupScrape.clearResults.useMutation({ onSuccess: () => refetchResults() });

  return (
    <div className="grid grid-cols-12 gap-6">
      {/* 左侧任务列表 */}
      <div className="col-span-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <h3 className="font-medium text-slate-700 text-sm">采集任务</h3>
            <Button size="sm" onClick={() => setShowCreateDialog(true)} className="h-7 text-xs">
              <Plus className="w-3 h-3 mr-1" /> 新建
            </Button>
          </div>
          <div className="divide-y divide-slate-100">
            {tasks?.length === 0 && (
              <div className="py-8 text-center text-slate-400 text-sm">
                <Search className="w-8 h-8 mx-auto mb-2 opacity-30" />
                暂无任务，点击「新建」创建
              </div>
            )}
            {tasks?.map(task => (
              <div
                key={task.id}
                onClick={() => setSelectedTaskId(task.id)}
                className={`px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors ${selectedTaskId === task.id ? "bg-blue-50 border-l-2 border-blue-500" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-slate-700 truncate">{task.name}</div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(task.keywords as string[]).slice(0, 3).map(kw => (
                        <span key={kw} className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{kw}</span>
                      ))}
                      {(task.keywords as string[]).length > 3 && (
                        <span className="text-xs text-slate-400">+{(task.keywords as string[]).length - 3}</span>
                      )}
                    </div>
                  </div>
                  <StatusBadge status={task.status} />
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-slate-400">采集 {task.totalFound ?? 0} 个</span>
                  <div className="flex gap-1">
                    <button
                      onClick={e => { e.stopPropagation(); triggerTask.mutate({ id: task.id }); }}
                      className="p-1 text-blue-500 hover:bg-blue-50 rounded"
                      title="触发采集"
                    >
                      <Play className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); setEditingTask(task); setShowEditDialog(true); }}
                      className="p-1 text-slate-400 hover:bg-slate-100 rounded"
                      title="编辑"
                    >
                      <Settings2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); if (confirm("确认删除？")) deleteTask.mutate({ id: task.id }); }}
                      className="p-1 text-red-400 hover:bg-red-50 rounded"
                      title="删除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 右侧结果列表 */}
      <div className="col-span-8">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <h3 className="font-medium text-slate-700 text-sm">
                {selectedTaskId ? "采集结果" : "全部结果"}
              </h3>
              <div className="flex gap-1">
                {(["all", "pending", "imported", "ignored"] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => { setResultFilter(f); setResultPage(1); }}
                    className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${resultFilter === f ? "bg-blue-500 text-white" : "text-slate-500 hover:bg-slate-100"}`}
                  >
                    {{ all: "全部", pending: "待处理", imported: "已导入", ignored: "已忽略" }[f]}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              {selectedResultIds.length > 0 && (
                <>
                  <Button size="sm" variant="outline" className="h-7 text-xs text-blue-600 border-blue-200"
                    onClick={() => importToPool.mutate({ resultIds: selectedResultIds })}>
                    <Upload className="w-3 h-3 mr-1" /> 导入监控池 ({selectedResultIds.length})
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs text-slate-500"
                    onClick={() => ignoreResults.mutate({ resultIds: selectedResultIds })}>
                    忽略
                  </Button>
                </>
              )}
              {selectedTaskId && (
                <Button size="sm" variant="outline" className="h-7 text-xs text-red-500 border-red-200"
                  onClick={() => { if (confirm("确认清空？")) clearResults.mutate({ taskId: selectedTaskId }); }}>
                  <Trash2 className="w-3 h-3 mr-1" /> 清空
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => refetchResults()}>
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="w-8">
                    <Checkbox
                      checked={selectedResultIds.length === (results?.items.length ?? 0) && (results?.items.length ?? 0) > 0}
                      onCheckedChange={checked => setSelectedResultIds(checked ? (results?.items.map(r => r.id) ?? []) : [])}
                    />
                  </TableHead>
                  <TableHead className="text-xs">群组/频道</TableHead>
                  <TableHead className="text-xs">关键词</TableHead>
                  <TableHead className="text-xs">人数</TableHead>
                  <TableHead className="text-xs">AI评分</TableHead>
                  <TableHead className="text-xs">标签</TableHead>
                  <TableHead className="text-xs">状态</TableHead>
                  <TableHead className="text-xs">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results?.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-slate-400 text-sm">
                      暂无结果
                    </TableCell>
                  </TableRow>
                )}
                {results?.items.map(r => (
                  <TableRow key={r.id} className="hover:bg-slate-50">
                    <TableCell>
                      <Checkbox
                        checked={selectedResultIds.includes(r.id)}
                        onCheckedChange={checked => setSelectedResultIds(prev =>
                          checked ? [...prev, r.id] : prev.filter(id => id !== r.id)
                        )}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-sm text-slate-700">{r.groupTitle || r.groupId}</div>
                      {r.username && <div className="text-xs text-slate-400">@{r.username}</div>}
                    </TableCell>
                    <TableCell><span className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">{r.keyword}</span></TableCell>
                    <TableCell className="text-sm text-slate-600">{(r.memberCount ?? 0).toLocaleString()}</TableCell>
                    <TableCell><AiScoreBar score={r.aiScore} /></TableCell>
                    <TableCell><TagList tags={(r as any).tags || []} /></TableCell>
                    <TableCell><StatusBadge status={r.importStatus} /></TableCell>
                    <TableCell>
                      {r.importStatus === "pending" && (
                        <Button size="sm" variant="ghost" className="h-6 text-xs text-blue-500"
                          onClick={() => importToPool.mutate({ resultIds: [r.id] })}>
                          导入
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="px-4 py-3">
            <Pagination
              page={resultPage}
              pageSize={20}
              total={results?.total ?? 0}
              onChange={setResultPage}
            />
          </div>
        </div>
      </div>

      {/* 创建任务弹窗 */}
      <TaskFormDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onSubmit={data => createTask.mutate(data)}
        loading={createTask.isPending}
        title="新建采集任务"
      />

      {/* 编辑任务弹窗 */}
      {editingTask && (
        <TaskFormDialog
          open={showEditDialog}
          onClose={() => setShowEditDialog(false)}
          onSubmit={data => updateTask.mutate({ id: editingTask.id, ...data })}
          loading={updateTask.isPending}
          title="编辑采集任务"
          initialValues={editingTask}
        />
      )}
    </div>
  );
}

function TaskFormDialog({ open, onClose, onSubmit, loading, title, initialValues }: {
  open: boolean; onClose: () => void; onSubmit: (data: any) => void;
  loading: boolean; title: string; initialValues?: any;
}) {
  const [name, setName] = useState(initialValues?.name || "");
  const [keywords, setKeywords] = useState((initialValues?.keywords || []).join("\n"));
  const [minMemberCount, setMinMemberCount] = useState(initialValues?.minMemberCount ?? 1000);
  const [maxResults, setMaxResults] = useState(initialValues?.maxResults ?? 50);
  const [fissionEnabled, setFissionEnabled] = useState(initialValues?.fissionEnabled ?? false);
  const [fissionDepth, setFissionDepth] = useState(initialValues?.fissionDepth ?? 1);
  const [fissionMaxPerSeed, setFissionMaxPerSeed] = useState(initialValues?.fissionMaxPerSeed ?? 10);

  const handleSubmit = () => {
    const kwList = keywords.split("\n").map(s => s.trim()).filter(Boolean);
    if (!name.trim() || kwList.length === 0) return;
    onSubmit({ name, keywords: kwList, minMemberCount, maxResults, fissionEnabled, fissionDepth, fissionMaxPerSeed });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-sm">任务名称</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="如：中文群组采集" className="mt-1" />
          </div>
          <div>
            <Label className="text-sm">关键词（每行一个）</Label>
            <Textarea value={keywords} onChange={e => setKeywords(e.target.value)}
              placeholder={"搜索\n索引\n找群"} rows={4} className="mt-1 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm">最低人数</Label>
              <Input type="number" value={minMemberCount} onChange={e => setMinMemberCount(Number(e.target.value))} className="mt-1" />
            </div>
            <div>
              <Label className="text-sm">最多结果</Label>
              <Input type="number" value={maxResults} onChange={e => setMaxResults(Number(e.target.value))} className="mt-1" />
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
            <Switch checked={fissionEnabled} onCheckedChange={setFissionEnabled} />
            <div>
              <div className="text-sm font-medium text-slate-700">裂变采集</div>
              <div className="text-xs text-slate-500">从采集到的群组继续发现更多群组</div>
            </div>
          </div>
          {fissionEnabled && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm">裂变深度</Label>
                <Input type="number" min={1} max={3} value={fissionDepth} onChange={e => setFissionDepth(Number(e.target.value))} className="mt-1" />
              </div>
              <div>
                <Label className="text-sm">每个种子最多</Label>
                <Input type="number" min={1} max={50} value={fissionMaxPerSeed} onChange={e => setFissionMaxPerSeed(Number(e.target.value))} className="mt-1" />
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ══════════════════════════════════════════════════════════════════
// Tab2: 指定群组采集
// ══════════════════════════════════════════════════════════════════

function TargetTab() {
  // 目标群组配置
  const [targetInput, setTargetInput] = useState("");
  const [targetGroups, setTargetGroups] = useState<string[]>([]);
  const [batchInput, setBatchInput] = useState("");

  // 采集配置
  const [collectGroups, setCollectGroups] = useState(true);
  const [collectChannels, setCollectChannels] = useState(true);
  const [collectUsers, setCollectUsers] = useState(true);
  const [userLimit, setUserLimit] = useState(500);

  // AI 评分配置
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiMinScore, setAiMinScore] = useState(60);
  const [aiMinMembers, setAiMinMembers] = useState(0);
  const [aiFilterBots, setAiFilterBots] = useState(true);
  const [aiFilterAds, setAiFilterAds] = useState(true);
  const [aiRequireUsername, setAiRequireUsername] = useState(false);
  const [aiRequireDescription, setAiRequireDescription] = useState(false);
  const [aiMinActivity, setAiMinActivity] = useState(0);

  // 账号
  const [accountId, setAccountId] = useState<string>("auto");

  // 结果展示
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [resultSubTab, setResultSubTab] = useState<"groups" | "channels" | "users">("groups");
  const [groupPage, setGroupPage] = useState(1);
  const [channelPage, setChannelPage] = useState(1);
  const [userPage, setUserPage] = useState(1);
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([]);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportFormat, setExportFormat] = useState<"username" | "tgid" | "csv">("username");
  const [tagFilter, setTagFilter] = useState("");

  // 运行状态
  const [isRunning, setIsRunning] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);

  const { data: accounts } = trpc.tgAccounts.list.useQuery();
  const { data: batches, refetch: refetchBatches } = trpc.groupScrape.listBatches.useQuery({ scrapeMode: "target", page: 1, pageSize: 20 });
  const { data: globalStats, refetch: refetchStats } = trpc.groupScrape.getGlobalStats.useQuery();

  const { data: collectedGroups, refetch: refetchGroups } = trpc.groupScrape.listCollectedGroups.useQuery({
    batchId: selectedBatchId ?? undefined,
    type: "group",
    page: groupPage,
    pageSize: 20,
    tag: tagFilter || undefined,
  });
  const { data: collectedChannels, refetch: refetchChannels } = trpc.groupScrape.listCollectedGroups.useQuery({
    batchId: selectedBatchId ?? undefined,
    type: "channel",
    page: channelPage,
    pageSize: 20,
    tag: tagFilter || undefined,
  });
  const { data: collectedUsers, refetch: refetchUsers } = trpc.groupScrape.listCollectedUsers.useQuery({
    batchId: selectedBatchId ?? undefined,
    page: userPage,
    pageSize: 20,
    tag: tagFilter || undefined,
  });
  const { data: exportData } = trpc.groupScrape.exportCollectedUsers.useQuery(
    { batchId: selectedBatchId ?? undefined, format: exportFormat },
    { enabled: showExportDialog }
  );

  const runScrape = trpc.groupScrape.runTargetScrape.useMutation({
    onSuccess: (data) => {
      setIsRunning(false);
      setLastResult(data);
      refetchBatches();
      refetchStats();
      refetchGroups();
      refetchChannels();
      refetchUsers();
      if (data.batchId) setSelectedBatchId(data.batchId);
    },
    onError: () => setIsRunning(false),
  });

  const importToPool = trpc.groupScrape.importCollectedGroupsToPool.useMutation({
    onSuccess: () => { refetchGroups(); refetchChannels(); setSelectedGroupIds([]); }
  });
  const deleteBatch = trpc.groupScrape.deleteBatch.useMutation({ onSuccess: () => { refetchBatches(); refetchStats(); } });
  const clearAll = trpc.groupScrape.clearCollectedData.useMutation({ onSuccess: () => { refetchBatches(); refetchStats(); refetchGroups(); refetchChannels(); refetchUsers(); } });

  const addTarget = () => {
    const val = targetInput.trim();
    if (!val) return;
    const normalized = val.startsWith("@") ? val : val.startsWith("t.me/") ? `@${val.replace("t.me/", "")}` : `@${val}`;
    if (!targetGroups.includes(normalized)) {
      setTargetGroups(prev => [...prev, normalized]);
    }
    setTargetInput("");
  };

  const addBatch = () => {
    const lines = batchInput.split("\n").map(s => s.trim()).filter(Boolean);
    const newGroups = lines.map(l => l.startsWith("@") ? l : l.startsWith("t.me/") ? `@${l.replace("t.me/", "")}` : `@${l}`);
    const unique = [...new Set([...targetGroups, ...newGroups])];
    setTargetGroups(unique);
    setBatchInput("");
  };

  const handleRun = () => {
    if (targetGroups.length === 0) return;
    setIsRunning(true);
    setLastResult(null);
    const types = [collectGroups && "group", collectChannels && "channel", collectUsers && "user"].filter(Boolean).join(",");
    runScrape.mutate({
      targetGroups,
      collectTypes: types || "group,channel,user",
      userLimit,
      aiScoreEnabled: aiEnabled,
      aiMinScore,
      aiMinMembers,
      aiFilterBots,
      aiFilterAds,
      aiRequireUsername,
      aiRequireDescription,
      aiMinActivity,
      accountId: accountId !== "auto" ? Number(accountId) : undefined,
    });
  };

  const copyExport = () => {
    if (exportData?.content) navigator.clipboard.writeText(exportData.content);
  };

  const downloadExport = () => {
    if (!exportData?.content) return;
    const ext = exportFormat === "csv" ? "csv" : "txt";
    const blob = new Blob([exportData.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `users_export_${Date.now()}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* 全局统计 */}
      {globalStats && (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "群组", value: globalStats.groups, icon: <Users className="w-4 h-4 text-indigo-500" />, color: "text-indigo-600" },
            { label: "频道", value: globalStats.channels, icon: <Globe className="w-4 h-4 text-sky-500" />, color: "text-sky-600" },
            { label: "用户", value: globalStats.users, icon: <Users className="w-4 h-4 text-emerald-500" />, color: "text-emerald-600" },
            { label: "批次", value: globalStats.batches, icon: <Layers className="w-4 h-4 text-purple-500" />, color: "text-purple-600" },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
              <div className="p-2 bg-slate-50 rounded-lg">{s.icon}</div>
              <div>
                <div className={`text-2xl font-bold ${s.color}`}>{s.value.toLocaleString()}</div>
                <div className="text-xs text-slate-500">{s.label}（全局去重）</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-12 gap-6">
        {/* 左侧：配置区 */}
        <div className="col-span-5 space-y-4">
          {/* 目标群组配置 */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="px-4 py-3 border-b border-slate-100">
              <h3 className="font-medium text-slate-700 text-sm flex items-center gap-2">
                <Target className="w-4 h-4 text-blue-500" /> 目标群组
              </h3>
            </div>
            <div className="p-4 space-y-3">
              {/* 单个输入 */}
              <div className="flex gap-2">
                <Input
                  value={targetInput}
                  onChange={e => setTargetInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addTarget()}
                  placeholder="@username 或 t.me/xxx"
                  className="text-sm"
                />
                <Button size="sm" onClick={addTarget} className="shrink-0">添加</Button>
              </div>

              {/* 批量输入 */}
              <div>
                <div className="text-xs text-slate-500 mb-1">批量导入（每行一个）</div>
                <Textarea
                  value={batchInput}
                  onChange={e => setBatchInput(e.target.value)}
                  placeholder={"@group1\n@group2\nt.me/group3"}
                  rows={3}
                  className="text-sm"
                />
                <Button size="sm" variant="outline" className="mt-2 text-xs h-7" onClick={addBatch}>
                  批量添加
                </Button>
              </div>

              {/* 已添加列表 */}
              {targetGroups.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-slate-500">已添加 {targetGroups.length} 个</span>
                    <button onClick={() => setTargetGroups([])} className="text-xs text-red-400 hover:text-red-600">清空</button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                    {targetGroups.map(g => (
                      <span key={g} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full border border-blue-200">
                        {g}
                        <button onClick={() => setTargetGroups(prev => prev.filter(x => x !== g))} className="hover:text-red-500">×</button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 采集配置 */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="px-4 py-3 border-b border-slate-100">
              <h3 className="font-medium text-slate-700 text-sm flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-blue-500" /> 采集配置
              </h3>
            </div>
            <div className="p-4 space-y-4">
              {/* 采集类型 */}
              <div>
                <div className="text-xs font-medium text-slate-600 mb-2">采集内容类型</div>
                <div className="space-y-2">
                  {[
                    { key: "group", label: "群组", icon: <Users className="w-3.5 h-3.5 text-indigo-500" />, checked: collectGroups, onChange: setCollectGroups },
                    { key: "channel", label: "频道", icon: <Globe className="w-3.5 h-3.5 text-sky-500" />, checked: collectChannels, onChange: setCollectChannels },
                    { key: "user", label: "用户成员", icon: <Users className="w-3.5 h-3.5 text-emerald-500" />, checked: collectUsers, onChange: setCollectUsers },
                  ].map(item => (
                    <label key={item.key} className="flex items-center gap-2 cursor-pointer">
                      <Checkbox checked={item.checked} onCheckedChange={v => item.onChange(!!v)} />
                      {item.icon}
                      <span className="text-sm text-slate-700">{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* 用户采集上限 */}
              {collectUsers && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-slate-600">用户采集上限</span>
                    <span className="text-xs text-blue-600 font-medium">{userLimit}</span>
                  </div>
                  <Slider value={[userLimit]} onValueChange={v => setUserLimit(v[0])} min={50} max={2000} step={50} />
                  <div className="flex justify-between text-xs text-slate-400 mt-1">
                    <span>50</span><span>2000</span>
                  </div>
                </div>
              )}

              {/* 使用账号 */}
              <div>
                <div className="text-xs font-medium text-slate-600 mb-1">使用账号</div>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">自动选择</SelectItem>
                    {(accounts as any[])?.map((acc: any) => (
                      <SelectItem key={acc.id} value={String(acc.id)}>
                        {acc.phone || acc.username || `账号 ${acc.id}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* AI 质量评分配置 */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="px-4 py-3 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-slate-700 text-sm flex items-center gap-2">
                  <Star className="w-4 h-4 text-amber-500" /> AI 质量评分
                </h3>
                <Switch checked={aiEnabled} onCheckedChange={setAiEnabled} />
              </div>
            </div>
            {aiEnabled && (
              <div className="p-4 space-y-4">
                {/* 最低评分 */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-slate-600">最低评分阈值（低于此分过滤）</span>
                    <span className="text-xs text-amber-600 font-bold">{aiMinScore}</span>
                  </div>
                  <Slider value={[aiMinScore]} onValueChange={v => setAiMinScore(v[0])} min={0} max={100} step={5} />
                </div>

                {/* 最低人数 */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-slate-600">群组最低人数（0=不限）</span>
                    <span className="text-xs text-slate-600">{aiMinMembers}</span>
                  </div>
                  <Slider value={[aiMinMembers]} onValueChange={v => setAiMinMembers(v[0])} min={0} max={10000} step={100} />
                </div>

                {/* 最低活跃度 */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-slate-600">最低活跃度分（0=不限）</span>
                    <span className="text-xs text-slate-600">{aiMinActivity}</span>
                  </div>
                  <Slider value={[aiMinActivity]} onValueChange={v => setAiMinActivity(v[0])} min={0} max={100} step={5} />
                </div>

                {/* 过滤选项 */}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "过滤机器人", checked: aiFilterBots, onChange: setAiFilterBots, icon: <Bot className="w-3 h-3 text-slate-400" /> },
                    { label: "过滤广告用户", checked: aiFilterAds, onChange: setAiFilterAds, icon: <AlertTriangle className="w-3 h-3 text-amber-400" /> },
                    { label: "必须有用户名", checked: aiRequireUsername, onChange: setAiRequireUsername, icon: <Hash className="w-3 h-3 text-blue-400" /> },
                    { label: "必须有群组简介", checked: aiRequireDescription, onChange: setAiRequireDescription, icon: <FileText className="w-3 h-3 text-slate-400" /> },
                  ].map(opt => (
                    <label key={opt.label} className="flex items-center gap-1.5 cursor-pointer">
                      <Checkbox checked={opt.checked} onCheckedChange={v => opt.onChange(!!v)} />
                      {opt.icon}
                      <span className="text-xs text-slate-600">{opt.label}</span>
                    </label>
                  ))}
                </div>

                <div className="text-xs text-slate-400 bg-slate-50 rounded p-2">
                  评分维度：成员数、用户名、标题质量、有简介、类型 · 标签维度：活跃/广告/中文/海外/Premium
                </div>
              </div>
            )}
          </div>

          {/* 开始采集按钮 */}
          <Button
            className="w-full h-11 text-base font-medium"
            disabled={targetGroups.length === 0 || isRunning}
            onClick={handleRun}
          >
            {isRunning ? (
              <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> 采集中...</>
            ) : (
              <><Play className="w-4 h-4 mr-2" /> 开始采集</>
            )}
          </Button>

          {/* 上次结果摘要 */}
          {lastResult && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
              <div className="flex items-center gap-2 text-emerald-700 font-medium text-sm mb-2">
                <CheckCircle className="w-4 h-4" /> 采集完成
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div><div className="text-lg font-bold text-emerald-700">{lastResult.groupsSaved}</div><div className="text-xs text-slate-500">新增群组</div></div>
                <div><div className="text-lg font-bold text-sky-700">{lastResult.channelsSaved}</div><div className="text-xs text-slate-500">新增频道</div></div>
                <div><div className="text-lg font-bold text-indigo-700">{lastResult.usersSaved}</div><div className="text-xs text-slate-500">新增用户</div></div>
              </div>
              {lastResult.skipped > 0 && (
                <div className="text-xs text-slate-400 mt-2 text-center">已去重跳过 {lastResult.skipped} 条</div>
              )}
            </div>
          )}
        </div>

        {/* 右侧：结果区 */}
        <div className="col-span-7 space-y-4">
          {/* 批次历史 */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <h3 className="font-medium text-slate-700 text-sm flex items-center gap-2">
                <Layers className="w-4 h-4 text-purple-500" /> 采集批次
              </h3>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => refetchBatches()}>
                  <RefreshCw className="w-3.5 h-3.5" />
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs text-red-500 border-red-200"
                  onClick={() => { if (confirm("确认清空全部采集数据？")) clearAll.mutate({}); }}>
                  <Trash2 className="w-3 h-3 mr-1" /> 清空全部
                </Button>
              </div>
            </div>
            <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto">
              {batches?.items.length === 0 && (
                <div className="py-6 text-center text-slate-400 text-sm">暂无批次记录</div>
              )}
              {batches?.items.map(batch => (
                <div
                  key={batch.id}
                  onClick={() => setSelectedBatchId(selectedBatchId === batch.id ? null : batch.id)}
                  className={`px-4 py-2.5 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors ${selectedBatchId === batch.id ? "bg-blue-50" : ""}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${selectedBatchId === batch.id ? "bg-blue-500" : "bg-slate-300"}`} />
                    <div>
                      <div className="text-xs text-slate-500">
                        {new Date(batch.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        来源：{(batch.sourceGroups as string[]).slice(0, 2).join(", ")}{(batch.sourceGroups as string[]).length > 2 ? ` +${(batch.sourceGroups as string[]).length - 2}` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex gap-2 text-xs">
                      <span className="text-indigo-600">{batch.totalGroups}群</span>
                      <span className="text-sky-600">{batch.totalChannels}频</span>
                      <span className="text-emerald-600">{batch.totalUsers}人</span>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); if (confirm("删除此批次？")) deleteBatch.mutate({ batchId: batch.id }); }}
                      className="p-1 text-red-400 hover:bg-red-50 rounded"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 采集结果 */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <h3 className="font-medium text-slate-700 text-sm">
                  采集结果 {selectedBatchId ? `（批次 #${selectedBatchId}）` : "（全部）"}
                </h3>
                {/* 子Tab */}
                <div className="flex gap-1">
                  {[
                    { key: "groups" as const, label: "群组", count: collectedGroups?.total ?? 0, color: "text-indigo-600" },
                    { key: "channels" as const, label: "频道", count: collectedChannels?.total ?? 0, color: "text-sky-600" },
                    { key: "users" as const, label: "用户", count: collectedUsers?.total ?? 0, color: "text-emerald-600" },
                  ].map(sub => (
                    <button
                      key={sub.key}
                      onClick={() => setResultSubTab(sub.key)}
                      className={`px-2.5 py-0.5 rounded text-xs font-medium transition-colors ${resultSubTab === sub.key ? "bg-blue-500 text-white" : "text-slate-500 hover:bg-slate-100"}`}
                    >
                      {sub.label} <span className={resultSubTab === sub.key ? "text-blue-200" : sub.color}>{sub.count}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                {/* 标签过滤 */}
                <Input
                  value={tagFilter}
                  onChange={e => setTagFilter(e.target.value)}
                  placeholder="按标签过滤..."
                  className="h-7 text-xs w-28"
                />
                {selectedGroupIds.length > 0 && (
                  <Button size="sm" variant="outline" className="h-7 text-xs text-blue-600 border-blue-200"
                    onClick={() => importToPool.mutate({ ids: selectedGroupIds })}>
                    <Upload className="w-3 h-3 mr-1" /> 导入监控池 ({selectedGroupIds.length})
                  </Button>
                )}
                {resultSubTab === "users" && (
                  <Button size="sm" variant="outline" className="h-7 text-xs"
                    onClick={() => setShowExportDialog(true)}>
                    <Download className="w-3 h-3 mr-1" /> 导出用户
                  </Button>
                )}
              </div>
            </div>

            {/* 群组/频道列表 */}
            {(resultSubTab === "groups" || resultSubTab === "channels") && (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50">
                        <TableHead className="w-8">
                          <Checkbox
                            checked={selectedGroupIds.length > 0 && selectedGroupIds.length === (resultSubTab === "groups" ? collectedGroups?.items.length : collectedChannels?.items.length)}
                            onCheckedChange={checked => {
                              const items = resultSubTab === "groups" ? collectedGroups?.items : collectedChannels?.items;
                              setSelectedGroupIds(checked ? (items?.map(i => i.id) ?? []) : []);
                            }}
                          />
                        </TableHead>
                        <TableHead className="text-xs">名称</TableHead>
                        <TableHead className="text-xs">人数</TableHead>
                        <TableHead className="text-xs">AI评分</TableHead>
                        <TableHead className="text-xs">标签</TableHead>
                        <TableHead className="text-xs">状态</TableHead>
                        <TableHead className="text-xs">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(resultSubTab === "groups" ? collectedGroups?.items : collectedChannels?.items)?.map(item => (
                        <TableRow key={item.id} className="hover:bg-slate-50">
                          <TableCell>
                            <Checkbox
                              checked={selectedGroupIds.includes(item.id)}
                              onCheckedChange={checked => setSelectedGroupIds(prev =>
                                checked ? [...prev, item.id] : prev.filter(id => id !== item.id)
                              )}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="font-medium text-sm text-slate-700">{item.title || item.username || item.tgId}</div>
                            {item.username && <div className="text-xs text-slate-400">@{item.username}</div>}
                            {item.description && (
                              <div className="text-xs text-slate-400 truncate max-w-[200px]">{item.description}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-slate-600">{(item.memberCount ?? 0).toLocaleString()}</TableCell>
                          <TableCell><AiScoreBar score={item.aiScore} /></TableCell>
                          <TableCell><TagList tags={(item as any).tags || []} /></TableCell>
                          <TableCell><StatusBadge status={item.importStatus} /></TableCell>
                          <TableCell>
                            {item.importStatus === "pending" && (
                              <Button size="sm" variant="ghost" className="h-6 text-xs text-blue-500"
                                onClick={() => importToPool.mutate({ ids: [item.id] })}>
                                导入
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                      {(resultSubTab === "groups" ? collectedGroups?.items : collectedChannels?.items)?.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-8 text-slate-400 text-sm">暂无数据</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
                <div className="px-4 py-3">
                  <Pagination
                    page={resultSubTab === "groups" ? groupPage : channelPage}
                    pageSize={20}
                    total={resultSubTab === "groups" ? (collectedGroups?.total ?? 0) : (collectedChannels?.total ?? 0)}
                    onChange={resultSubTab === "groups" ? setGroupPage : setChannelPage}
                  />
                </div>
              </>
            )}

            {/* 用户列表 */}
            {resultSubTab === "users" && (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50">
                        <TableHead className="text-xs">用户</TableHead>
                        <TableHead className="text-xs">AI评分</TableHead>
                        <TableHead className="text-xs">标签</TableHead>
                        <TableHead className="text-xs">发言数</TableHead>
                        <TableHead className="text-xs">来源群</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {collectedUsers?.items.map(user => (
                        <TableRow key={user.id} className="hover:bg-slate-50">
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-xs font-bold">
                                {(user.displayName || user.username || "?")[0].toUpperCase()}
                              </div>
                              <div>
                                <div className="font-medium text-sm text-slate-700">{user.displayName || user.username || `ID:${user.tgId}`}</div>
                                {user.username && <div className="text-xs text-slate-400">@{user.username}</div>}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell><AiScoreBar score={user.aiScore} /></TableCell>
                          <TableCell><TagList tags={(user as any).tags || []} /></TableCell>
                          <TableCell className="text-xs text-slate-500">{user.messageCount ?? 0}</TableCell>
                          <TableCell className="text-xs text-slate-400">{user.sourceGroupId}</TableCell>
                        </TableRow>
                      ))}
                      {collectedUsers?.items.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-8 text-slate-400 text-sm">暂无用户数据</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
                <div className="px-4 py-3">
                  <Pagination page={userPage} pageSize={20} total={collectedUsers?.total ?? 0} onChange={setUserPage} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 导出用户弹窗 */}
      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>导出用户列表</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              {(["username", "tgid", "csv"] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setExportFormat(f)}
                  className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${exportFormat === f ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                >
                  {{ username: "@用户名", tgid: "TG ID", csv: "CSV 完整" }[f]}
                </button>
              ))}
            </div>
            <div className="bg-slate-50 rounded-lg p-3 max-h-48 overflow-y-auto">
              <pre className="text-xs text-slate-600 whitespace-pre-wrap">
                {exportData?.content ? exportData.content.slice(0, 2000) : "加载中..."}
                {(exportData?.content?.length ?? 0) > 2000 && "\n...（更多内容请下载）"}
              </pre>
            </div>
            <div className="text-xs text-slate-500">共 {exportData?.total ?? 0} 条</div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={copyExport}><Copy className="w-3.5 h-3.5 mr-1" /> 复制</Button>
            <Button onClick={downloadExport}><Download className="w-3.5 h-3.5 mr-1" /> 下载</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Tab3: 消息提取链接
// ══════════════════════════════════════════════════════════════════

function ExtractTab() {
  const [groupUrl, setGroupUrl] = useState("");
  const [limit, setLimit] = useState(500);
  const [accountId, setAccountId] = useState<string>("1");
  const [aiFilter, setAiFilter] = useState(false);
  const [aiMinMembers, setAiMinMembers] = useState(0);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedLinks, setExtractedLinks] = useState<any[]>([]);
  const [scannedCount, setScannedCount] = useState(0);
  const [selectedUrls, setSelectedUrls] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState("");

  const { data: accounts } = trpc.tgAccounts.list.useQuery();

  const extractMutation = trpc.groupScrape.extractFromGroup.useMutation({
    onSuccess: (data) => {
      setIsExtracting(false);
      setExtractedLinks(data.links as any[]);
      setScannedCount(data.scanned);
    },
    onError: () => setIsExtracting(false),
  });

  const importLinks = trpc.groupScrape.importExtractedLinks.useMutation({
    onSuccess: (data) => {
      alert(`导入完成：新增 ${data.added} 个，跳过 ${data.skipped} 个`);
      setSelectedUrls([]);
    },
  });

  const handleExtract = () => {
    if (!groupUrl.trim()) return;
    setIsExtracting(true);
    setExtractedLinks([]);
    extractMutation.mutate({
      accountId: Number(accountId),
      groupUrl: groupUrl.trim(),
      limit,
      aiFilter,
      aiMinMembers,
    });
  };

  const filteredLinks = tagFilter
    ? extractedLinks.filter(l => (l.tags || []).includes(tagFilter))
    : extractedLinks;

  return (
    <div className="grid grid-cols-12 gap-6">
      {/* 左侧：配置 */}
      <div className="col-span-4 space-y-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="font-medium text-slate-700 text-sm flex items-center gap-2">
              <Link2 className="w-4 h-4 text-blue-500" /> 提取配置
            </h3>
          </div>
          <div className="p-4 space-y-4">
            <div>
              <Label className="text-sm">目标群组</Label>
              <Input
                value={groupUrl}
                onChange={e => setGroupUrl(e.target.value)}
                placeholder="@username 或 t.me/xxx"
                className="mt-1"
              />
              <div className="text-xs text-slate-400 mt-1">将扫描该群组的历史消息，提取其中的 t.me/ 链接</div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-sm">扫描消息数</Label>
                <span className="text-xs text-blue-600 font-medium">{limit}</span>
              </div>
              <Slider value={[limit]} onValueChange={v => setLimit(v[0])} min={100} max={5000} step={100} />
              <div className="flex justify-between text-xs text-slate-400 mt-1">
                <span>100</span><span>5000</span>
              </div>
            </div>

            <div>
              <Label className="text-sm">使用账号</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger className="mt-1 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(accounts as any[])?.map((acc: any) => (
                    <SelectItem key={acc.id} value={String(acc.id)}>
                      {acc.phone || acc.username || `账号 ${acc.id}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* AI 过滤 */}
            <div className="p-3 bg-amber-50 rounded-lg border border-amber-100 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Star className="w-3.5 h-3.5 text-amber-500" />
                  <span className="text-sm font-medium text-slate-700">AI 过滤</span>
                </div>
                <Switch checked={aiFilter} onCheckedChange={setAiFilter} />
              </div>
              {aiFilter && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-slate-600">最低人数</span>
                    <span className="text-xs text-amber-600">{aiMinMembers}</span>
                  </div>
                  <Slider value={[aiMinMembers]} onValueChange={v => setAiMinMembers(v[0])} min={0} max={10000} step={100} />
                </div>
              )}
            </div>

            <Button className="w-full" disabled={!groupUrl.trim() || isExtracting} onClick={handleExtract}>
              {isExtracting ? (
                <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> 提取中...</>
              ) : (
                <><Link2 className="w-4 h-4 mr-2" /> 开始提取</>
              )}
            </Button>
          </div>
        </div>

        {/* 说明 */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
            <div className="text-xs text-slate-600 space-y-1">
              <div className="font-medium text-blue-700">使用说明</div>
              <div>扫描目标群组的历史消息，自动识别消息中的 t.me/ 链接，提取群组/频道信息。</div>
              <div>适用于导航群、搜索群等包含大量群组链接的频道。</div>
              <div>提取结果可直接批量导入公共监控群组池。</div>
            </div>
          </div>
        </div>
      </div>

      {/* 右侧：结果 */}
      <div className="col-span-8">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <h3 className="font-medium text-slate-700 text-sm">
                提取结果
                {extractedLinks.length > 0 && (
                  <span className="ml-2 text-xs text-slate-400">
                    共 {extractedLinks.length} 个链接（扫描 {scannedCount} 条消息）
                  </span>
                )}
              </h3>
            </div>
            <div className="flex gap-2">
              <Input
                value={tagFilter}
                onChange={e => setTagFilter(e.target.value)}
                placeholder="按标签过滤..."
                className="h-7 text-xs w-28"
              />
              {selectedUrls.length > 0 && (
                <Button size="sm" className="h-7 text-xs"
                  onClick={() => importLinks.mutate({ urls: selectedUrls })}>
                  <Upload className="w-3 h-3 mr-1" /> 导入监控池 ({selectedUrls.length})
                </Button>
              )}
            </div>
          </div>

          {extractedLinks.length === 0 && !isExtracting && (
            <div className="py-16 text-center text-slate-400">
              <Link2 className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <div className="text-sm">配置目标群组后点击「开始提取」</div>
            </div>
          )}

          {isExtracting && (
            <div className="py-16 text-center text-slate-400">
              <RefreshCw className="w-8 h-8 mx-auto mb-3 animate-spin opacity-40" />
              <div className="text-sm">正在扫描消息历史...</div>
            </div>
          )}

          {filteredLinks.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="w-8">
                        <Checkbox
                          checked={selectedUrls.length === filteredLinks.length && filteredLinks.length > 0}
                          onCheckedChange={checked => setSelectedUrls(checked ? filteredLinks.map(l => l.url) : [])}
                        />
                      </TableHead>
                      <TableHead className="text-xs">链接</TableHead>
                      <TableHead className="text-xs">人数</TableHead>
                      <TableHead className="text-xs">AI评分</TableHead>
                      <TableHead className="text-xs">标签</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLinks.map((link, idx) => (
                      <TableRow key={idx} className="hover:bg-slate-50">
                        <TableCell>
                          <Checkbox
                            checked={selectedUrls.includes(link.url)}
                            onCheckedChange={checked => setSelectedUrls(prev =>
                              checked ? [...prev, link.url] : prev.filter(u => u !== link.url)
                            )}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-sm text-slate-700">{link.title || link.slug}</div>
                          <a href={link.url} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-blue-500 hover:underline">{link.url}</a>
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {link.memberCount ? link.memberCount.toLocaleString() : "-"}
                        </TableCell>
                        <TableCell><AiScoreBar score={link.aiScore} /></TableCell>
                        <TableCell><TagList tags={link.tags || []} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
