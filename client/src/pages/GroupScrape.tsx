import { useState } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  Plus, Trash2, RefreshCw, Play, Search, Download,
  Users, CheckCircle2, XCircle, Clock, Loader2, Tag, Filter, ArrowRight
} from "lucide-react";

// 预置关键词
const PRESET_KEYWORDS = [
  "搜索", "索引", "找群", "导航", "中文搜索",
  "资源", "群组搜索", "TG搜索", "电报搜索", "频道搜索",
  "搜群", "群导航", "资源搜索", "搜资源",
];

type Task = {
  id: number;
  name: string;
  keywords: string[];
  minMemberCount: number;
  maxResults: number;
  status: "idle" | "pending" | "running" | "done" | "failed";
  totalFound: number | null;
  lastRunAt: string | null;
  createdAt: string;
};

type ScrapeResult = {
  id: number;
  taskId: number;
  keyword: string;
  groupId: string;
  groupTitle: string | null;
  groupType: string;
  memberCount: number;
  description: string | null;
  username: string | null;
  importStatus: "pending" | "imported" | "ignored";
  importedAt: string | null;
  createdAt: string;
};

function StatusBadge({ status }: { status: Task["status"] }) {
  const map: Record<string, { label: string; className: string }> = {
    idle: { label: "待触发", className: "bg-gray-700 text-gray-300" },
    pending: { label: "等待执行", className: "bg-yellow-900/50 text-yellow-400" },
    running: { label: "采集中", className: "bg-blue-900/50 text-blue-400" },
    done: { label: "已完成", className: "bg-green-900/50 text-green-400" },
    failed: { label: "失败", className: "bg-red-900/50 text-red-400" },
  };
  const { label, className } = map[status] || map.idle;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${className}`}>{label}</span>;
}

function ImportStatusBadge({ status }: { status: ScrapeResult["importStatus"] }) {
  const map = {
    pending: { label: "待审核", className: "bg-gray-700 text-gray-300" },
    imported: { label: "已导入", className: "bg-green-900/50 text-green-400" },
    ignored: { label: "已忽略", className: "bg-gray-800 text-gray-500" },
  };
  const { label, className } = map[status] || map.pending;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${className}`}>{label}</span>;
}

export default function GroupScrape() {
  const [activeTab, setActiveTab] = useState<"tasks" | "results">("tasks");

  // 任务管理状态
  const [createDialog, setCreateDialog] = useState(false);
  const [deleteTaskId, setDeleteTaskId] = useState<number | null>(null);
  const [taskName, setTaskName] = useState("");
  const [taskKeywords, setTaskKeywords] = useState<string[]>([
    "搜索", "索引", "找群", "导航", "中文搜索"
  ]);
  const [taskKeywordInput, setTaskKeywordInput] = useState("");
  const [taskMinMembers, setTaskMinMembers] = useState(1000);
  const [taskMaxResults, setTaskMaxResults] = useState(50);

  // 结果管理状态
  const [selectedTaskId, setSelectedTaskId] = useState<number | undefined>(undefined);
  const [importStatusFilter, setImportStatusFilter] = useState<"all" | "pending" | "imported" | "ignored">("pending");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [importConfirmDialog, setImportConfirmDialog] = useState(false);

  const utils = trpc.useUtils();

  // 查询任务列表
  const { data: tasks = [], isLoading: tasksLoading, refetch: refetchTasks } = trpc.groupScrape.listTasks.useQuery();

  // 查询采集结果
  const { data: resultsData, isLoading: resultsLoading, refetch: refetchResults } = trpc.groupScrape.listResults.useQuery({
    taskId: selectedTaskId,
    importStatus: importStatusFilter,
    page,
    pageSize: 20,
  });

  const results = resultsData?.items || [];
  const totalResults = resultsData?.total || 0;

  // 创建任务
  const createTask = trpc.groupScrape.createTask.useMutation({
    onSuccess: () => {
      toast.success("采集任务已创建");
      setCreateDialog(false);
      resetCreateForm();
      refetchTasks();
    },
    onError: (e) => toast.error(e.message),
  });

  // 删除任务
  const deleteTask = trpc.groupScrape.deleteTask.useMutation({
    onSuccess: () => {
      toast.success("任务已删除");
      setDeleteTaskId(null);
      refetchTasks();
    },
    onError: (e) => toast.error(e.message),
  });

  // 触发任务
  const triggerTask = trpc.groupScrape.triggerTask.useMutation({
    onSuccess: () => {
      toast.success("采集任务已触发，引擎将在 60 秒内开始执行");
      refetchTasks();
    },
    onError: (e) => toast.error(e.message),
  });

  // 批量导入
  const importToPool = trpc.groupScrape.importToPublicPool.useMutation({
    onSuccess: (data) => {
      toast.success(`成功导入 ${data.importedCount} 个群组，跳过 ${data.skippedCount} 个（已存在）`);
      setImportConfirmDialog(false);
      setSelectedIds(new Set());
      refetchResults();
    },
    onError: (e) => toast.error(e.message),
  });

  // 忽略结果
  const ignoreResults = trpc.groupScrape.ignoreResults.useMutation({
    onSuccess: () => {
      toast.success("已标记为忽略");
      setSelectedIds(new Set());
      refetchResults();
    },
    onError: (e) => toast.error(e.message),
  });

  // 清空结果
  const clearResults = trpc.groupScrape.clearResults.useMutation({
    onSuccess: () => {
      toast.success("采集结果已清空");
      refetchResults();
    },
    onError: (e) => toast.error(e.message),
  });

  function resetCreateForm() {
    setTaskName("");
    setTaskKeywords(["搜索", "索引", "找群", "导航", "中文搜索"]);
    setTaskKeywordInput("");
    setTaskMinMembers(1000);
    setTaskMaxResults(50);
  }

  function addKeyword(kw: string) {
    const trimmed = kw.trim();
    if (trimmed && !taskKeywords.includes(trimmed)) {
      setTaskKeywords(prev => [...prev, trimmed]);
    }
    setTaskKeywordInput("");
  }

  function removeKeyword(kw: string) {
    setTaskKeywords(prev => prev.filter(k => k !== kw));
  }

  function toggleSelect(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === results.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(results.map(r => r.id)));
    }
  }

  const totalPages = Math.ceil(totalResults / 20);

  return (
    <AdminLayout title="群组采集">
      <div className="p-6 max-w-7xl mx-auto">
        {/* 页面标题 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <Search className="w-5 h-5 text-red-400" />
              群组采集
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              通过关键词搜索公开群组，采集后人工审核，选择导入公共监控群组池
            </p>
          </div>
          <div className="flex gap-2">
            {activeTab === "tasks" && (
              <Button
                size="sm"
                onClick={() => setCreateDialog(true)}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                <Plus className="w-4 h-4 mr-1" /> 新建采集任务
              </Button>
            )}
          </div>
        </div>

        {/* Tab 切换 */}
        <div className="flex gap-1 mb-4 bg-gray-900 rounded-lg p-1 w-fit">
          <button
            onClick={() => setActiveTab("tasks")}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
              activeTab === "tasks" ? "bg-red-600 text-white" : "text-gray-400 hover:text-gray-200"
            }`}
          >
            采集任务
          </button>
          <button
            onClick={() => setActiveTab("results")}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
              activeTab === "results" ? "bg-red-600 text-white" : "text-gray-400 hover:text-gray-200"
            }`}
          >
            采集结果
            {totalResults > 0 && (
              <span className="ml-1.5 bg-gray-700 text-gray-300 text-xs px-1.5 py-0.5 rounded-full">
                {totalResults}
              </span>
            )}
          </button>
        </div>

        {/* ── 采集任务 Tab ── */}
        {activeTab === "tasks" && (
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-white text-base">采集任务列表</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => refetchTasks()} className="text-gray-400 hover:text-white">
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {tasksLoading ? (
                <div className="flex items-center justify-center py-12 text-gray-500">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载中...
                </div>
              ) : tasks.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <Search className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>暂无采集任务，点击右上角新建</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-800">
                      <TableHead className="text-gray-400">任务名称</TableHead>
                      <TableHead className="text-gray-400">关键词</TableHead>
                      <TableHead className="text-gray-400">最低人数</TableHead>
                      <TableHead className="text-gray-400">最多结果</TableHead>
                      <TableHead className="text-gray-400">状态</TableHead>
                      <TableHead className="text-gray-400">采集数量</TableHead>
                      <TableHead className="text-gray-400">上次执行</TableHead>
                      <TableHead className="text-gray-400 text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tasks.map((task: Task) => (
                      <TableRow key={task.id} className="border-gray-800 hover:bg-gray-800/50">
                        <TableCell className="text-white font-medium">{task.name}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1 max-w-xs">
                            {task.keywords.slice(0, 4).map(kw => (
                              <span key={kw} className="bg-gray-800 text-gray-300 text-xs px-1.5 py-0.5 rounded">
                                {kw}
                              </span>
                            ))}
                            {task.keywords.length > 4 && (
                              <span className="text-gray-500 text-xs">+{task.keywords.length - 4}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-gray-300">{task.minMemberCount.toLocaleString()}</TableCell>
                        <TableCell className="text-gray-300">{task.maxResults}</TableCell>
                        <TableCell><StatusBadge status={task.status} /></TableCell>
                        <TableCell>
                          {task.totalFound != null ? (
                            <button
                              onClick={() => { setSelectedTaskId(task.id); setActiveTab("results"); }}
                              className="text-blue-400 hover:text-blue-300 text-sm flex items-center gap-1"
                            >
                              {task.totalFound} 个 <ArrowRight className="w-3 h-3" />
                            </button>
                          ) : (
                            <span className="text-gray-500 text-sm">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-gray-400 text-sm">
                          {task.lastRunAt ? new Date(task.lastRunAt).toLocaleString("zh-CN") : "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={task.status === "running" || task.status === "pending"}
                              onClick={() => triggerTask.mutate({ id: task.id })}
                              className="text-green-400 hover:text-green-300 hover:bg-green-900/20"
                              title="触发采集"
                            >
                              {task.status === "running" ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Play className="w-4 h-4" />
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setDeleteTaskId(task.id)}
                              className="text-red-400 hover:text-red-300 hover:bg-red-900/20"
                              title="删除任务"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── 采集结果 Tab ── */}
        {activeTab === "results" && (
          <div className="space-y-4">
            {/* 过滤栏 */}
            <div className="flex flex-wrap items-center gap-3">
              <Select
                value={selectedTaskId?.toString() || "all"}
                onValueChange={(v) => { setSelectedTaskId(v === "all" ? undefined : parseInt(v)); setPage(1); }}
              >
                <SelectTrigger className="w-48 bg-gray-900 border-gray-700 text-gray-200">
                  <SelectValue placeholder="全部任务" />
                </SelectTrigger>
                <SelectContent className="bg-gray-900 border-gray-700">
                  <SelectItem value="all">全部任务</SelectItem>
                  {tasks.map((t: Task) => (
                    <SelectItem key={t.id} value={t.id.toString()}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={importStatusFilter}
                onValueChange={(v: any) => { setImportStatusFilter(v); setPage(1); }}
              >
                <SelectTrigger className="w-36 bg-gray-900 border-gray-700 text-gray-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gray-900 border-gray-700">
                  <SelectItem value="all">全部状态</SelectItem>
                  <SelectItem value="pending">待审核</SelectItem>
                  <SelectItem value="imported">已导入</SelectItem>
                  <SelectItem value="ignored">已忽略</SelectItem>
                </SelectContent>
              </Select>

              <Button variant="ghost" size="sm" onClick={() => refetchResults()} className="text-gray-400 hover:text-white">
                <RefreshCw className="w-4 h-4" />
              </Button>

              <div className="ml-auto flex gap-2">
                {selectedIds.size > 0 && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => setImportConfirmDialog(true)}
                      className="bg-green-700 hover:bg-green-600 text-white"
                    >
                      <Download className="w-4 h-4 mr-1" />
                      导入选中 ({selectedIds.size})
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => ignoreResults.mutate({ resultIds: Array.from(selectedIds) })}
                      className="text-gray-400 hover:text-gray-200"
                    >
                      <XCircle className="w-4 h-4 mr-1" />
                      忽略选中
                    </Button>
                  </>
                )}
                {selectedTaskId && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => clearResults.mutate({ taskId: selectedTaskId })}
                    className="text-red-400 hover:text-red-300"
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    清空结果
                  </Button>
                )}
              </div>
            </div>

            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-0">
                {resultsLoading ? (
                  <div className="flex items-center justify-center py-12 text-gray-500">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载中...
                  </div>
                ) : results.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <Search className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p>暂无采集结果</p>
                    <p className="text-xs mt-1">请先触发采集任务，等待引擎执行完成</p>
                  </div>
                ) : (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow className="border-gray-800">
                          <TableHead className="w-10">
                            <Checkbox
                              checked={selectedIds.size === results.length && results.length > 0}
                              onCheckedChange={toggleSelectAll}
                              className="border-gray-600"
                            />
                          </TableHead>
                          <TableHead className="text-gray-400">群组名称</TableHead>
                          <TableHead className="text-gray-400">群组 ID</TableHead>
                          <TableHead className="text-gray-400">类型</TableHead>
                          <TableHead className="text-gray-400">成员数</TableHead>
                          <TableHead className="text-gray-400">匹配关键词</TableHead>
                          <TableHead className="text-gray-400">简介</TableHead>
                          <TableHead className="text-gray-400">状态</TableHead>
                          <TableHead className="text-gray-400 text-right">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {results.map((r: ScrapeResult) => (
                          <TableRow key={r.id} className="border-gray-800 hover:bg-gray-800/50">
                            <TableCell>
                              <Checkbox
                                checked={selectedIds.has(r.id)}
                                onCheckedChange={() => toggleSelect(r.id)}
                                disabled={r.importStatus !== "pending"}
                                className="border-gray-600"
                              />
                            </TableCell>
                            <TableCell className="text-white font-medium max-w-[180px] truncate">
                              {r.groupTitle || r.groupId}
                            </TableCell>
                            <TableCell className="text-blue-400 text-sm font-mono">
                              <a
                                href={`https://t.me/${r.username || r.groupId.replace("@", "")}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:underline"
                              >
                                {r.groupId}
                              </a>
                            </TableCell>
                            <TableCell>
                              <span className="text-xs text-gray-400 bg-gray-800 px-1.5 py-0.5 rounded">
                                {r.groupType === "channel" ? "频道" : r.groupType === "supergroup" ? "超级群" : "群组"}
                              </span>
                            </TableCell>
                            <TableCell className="text-gray-300">
                              <div className="flex items-center gap-1">
                                <Users className="w-3 h-3 text-gray-500" />
                                {r.memberCount.toLocaleString()}
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className="bg-gray-800 text-gray-300 text-xs px-1.5 py-0.5 rounded">
                                {r.keyword}
                              </span>
                            </TableCell>
                            <TableCell className="text-gray-400 text-xs max-w-[200px] truncate">
                              {r.description || "-"}
                            </TableCell>
                            <TableCell>
                              <ImportStatusBadge status={r.importStatus} />
                            </TableCell>
                            <TableCell className="text-right">
                              {r.importStatus === "pending" && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    setSelectedIds(new Set([r.id]));
                                    setImportConfirmDialog(true);
                                  }}
                                  className="text-green-400 hover:text-green-300 hover:bg-green-900/20 text-xs"
                                >
                                  <Download className="w-3 h-3 mr-1" />
                                  导入
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>

                    {/* 分页 */}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
                        <span className="text-sm text-gray-400">
                          共 {totalResults} 条，第 {page}/{totalPages} 页
                        </span>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={page <= 1}
                            onClick={() => setPage(p => p - 1)}
                            className="text-gray-400"
                          >
                            上一页
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={page >= totalPages}
                            onClick={() => setPage(p => p + 1)}
                            className="text-gray-400"
                          >
                            下一页
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* ── 新建任务弹窗 ── */}
      <Dialog open={createDialog} onOpenChange={setCreateDialog}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle>新建采集任务</DialogTitle>
            <DialogDescription className="text-gray-400">
              配置搜索关键词和过滤条件，引擎将自动搜索并采集符合条件的公开群组
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm text-gray-300 block mb-1.5">任务名称</label>
              <Input
                value={taskName}
                onChange={e => setTaskName(e.target.value)}
                placeholder="如：搜索类群组采集"
                className="bg-gray-800 border-gray-700 text-white"
              />
            </div>

            <div>
              <label className="text-sm text-gray-300 block mb-1.5">搜索关键词</label>
              <div className="flex gap-2 mb-2">
                <Input
                  value={taskKeywordInput}
                  onChange={e => setTaskKeywordInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addKeyword(taskKeywordInput)}
                  placeholder="输入关键词后按 Enter 添加"
                  className="bg-gray-800 border-gray-700 text-white flex-1"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => addKeyword(taskKeywordInput)}
                  className="text-gray-400 hover:text-white border border-gray-700"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              {/* 已添加的关键词 */}
              <div className="flex flex-wrap gap-1.5 mb-2">
                {taskKeywords.map(kw => (
                  <span
                    key={kw}
                    className="bg-gray-700 text-gray-200 text-xs px-2 py-1 rounded flex items-center gap-1"
                  >
                    {kw}
                    <button onClick={() => removeKeyword(kw)} className="text-gray-400 hover:text-red-400">×</button>
                  </span>
                ))}
              </div>
              {/* 预置关键词快速添加 */}
              <div>
                <p className="text-xs text-gray-500 mb-1.5">快速添加预置关键词：</p>
                <div className="flex flex-wrap gap-1">
                  {PRESET_KEYWORDS.filter(k => !taskKeywords.includes(k)).map(kw => (
                    <button
                      key={kw}
                      onClick={() => addKeyword(kw)}
                      className="bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 text-xs px-2 py-0.5 rounded border border-gray-700 transition-colors"
                    >
                      + {kw}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-gray-300 block mb-1.5">最低成员数</label>
                <Input
                  type="number"
                  value={taskMinMembers}
                  onChange={e => setTaskMinMembers(parseInt(e.target.value) || 0)}
                  className="bg-gray-800 border-gray-700 text-white"
                />
                <p className="text-xs text-gray-500 mt-1">成员数低于此值的群组将被过滤</p>
              </div>
              <div>
                <label className="text-sm text-gray-300 block mb-1.5">最多采集数量</label>
                <Input
                  type="number"
                  value={taskMaxResults}
                  onChange={e => setTaskMaxResults(parseInt(e.target.value) || 10)}
                  className="bg-gray-800 border-gray-700 text-white"
                />
                <p className="text-xs text-gray-500 mt-1">每个关键词最多采集条数</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateDialog(false)} className="text-gray-400">取消</Button>
            <Button
              onClick={() => createTask.mutate({
                name: taskName || "采集任务",
                keywords: taskKeywords,
                minMemberCount: taskMinMembers,
                maxResults: taskMaxResults,
              })}
              disabled={createTask.isPending || taskKeywords.length === 0}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {createTask.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
              创建任务
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 删除确认弹窗 ── */}
      <Dialog open={deleteTaskId !== null} onOpenChange={() => setDeleteTaskId(null)}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription className="text-gray-400">
              删除任务将同时删除所有采集结果，此操作不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTaskId(null)} className="text-gray-400">取消</Button>
            <Button
              onClick={() => deleteTaskId && deleteTask.mutate({ id: deleteTaskId })}
              disabled={deleteTask.isPending}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleteTask.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Trash2 className="w-4 h-4 mr-1" />}
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 导入确认弹窗 ── */}
      <Dialog open={importConfirmDialog} onOpenChange={setImportConfirmDialog}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle>确认导入</DialogTitle>
            <DialogDescription className="text-gray-400">
              将选中的 <strong className="text-white">{selectedIds.size}</strong> 个群组导入公共监控群组池，引擎将自动加入并开始监控。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setImportConfirmDialog(false)} className="text-gray-400">取消</Button>
            <Button
              onClick={() => importToPool.mutate({ resultIds: Array.from(selectedIds) })}
              disabled={importToPool.isPending}
              className="bg-green-700 hover:bg-green-600 text-white"
            >
              {importToPool.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Download className="w-4 h-4 mr-1" />}
              确认导入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
