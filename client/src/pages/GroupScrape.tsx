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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Plus, Trash2, RefreshCw, Play, Search, Download,
  Users, CheckCircle2, XCircle, Clock, Loader2, Tag, Filter, ArrowRight,
  Pencil, GitBranch, Link2, MessageSquare, FileText, FileDown,
  Target, Star, UserCheck, Globe, Radio, Bot, Crown
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
  fissionEnabled: boolean;
  fissionDepth: number;
  fissionMaxPerSeed: number;
  status: "idle" | "pending" | "running" | "done" | "failed";
  totalFound: number | null;
  lastRunAt: string | null;
  createdAt: string;
  scrapeMode?: "keyword" | "target";
  targetGroups?: string[];
  collectTypes?: string;
  userLimit?: number;
  aiScoreEnabled?: boolean;
  aiMinScore?: number;
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

type CollectedGroup = {
  id: number;
  taskId: number;
  sourceGroupId: string;
  type: string;
  tgId: string | null;
  username: string | null;
  title: string | null;
  memberCount: number | null;
  description: string | null;
  aiScore: number | null;
  aiScoreDetail: Record<string, number> | null;
  importStatus: string;
  createdAt: string;
};

type CollectedUser = {
  id: number;
  taskId: number;
  sourceGroupId: string;
  tgId: string;
  username: string | null;
  displayName: string | null;
  isBot: boolean | null;
  isPremium: boolean | null;
  aiScore: number | null;
  createdAt: string;
};

type ExtractedLink = {
  url: string;
  slug: string;
};

// AI 评分条组件
function AiScoreBar({ score }: { score: number | null }) {
  if (score === null || score === undefined) return <span className="text-slate-500 text-xs">-</span>;
  const pct = Math.max(0, Math.min(100, score));
  const color = pct >= 80 ? "bg-green-500" : pct >= 60 ? "bg-yellow-500" : pct >= 40 ? "bg-orange-500" : "bg-red-500";
  const textColor = pct >= 80 ? "text-green-400" : pct >= 60 ? "text-yellow-400" : pct >= 40 ? "text-orange-400" : "text-red-400";
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-medium ${textColor} w-6 text-right`}>{pct}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: Task["status"] }) {
  const map: Record<string, { label: string; className: string }> = {
    idle: { label: "待触发", className: "bg-slate-200 text-slate-600" },
    pending: { label: "等待执行", className: "bg-yellow-900/50 text-yellow-400" },
    running: { label: "采集中", className: "bg-blue-900/50 text-blue-400" },
    done: { label: "已完成", className: "bg-green-900/50 text-green-400" },
    failed: { label: "失败", className: "bg-red-900/50 text-red-400" },
  };
  const { label, className } = map[status] || map.idle;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${className}`}>{label}</span>;
}

function ImportStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    pending: { label: "待审核", className: "bg-slate-200 text-slate-600" },
    imported: { label: "已导入", className: "bg-green-900/50 text-green-400" },
    ignored: { label: "已忽略", className: "bg-slate-100 text-slate-500" },
  };
  const { label, className } = (map[status] || map.pending);
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${className}`}>{label}</span>;
}

// ── 任务表单（新建/编辑共用）──────────────────────────────────────────────
interface TaskFormProps {
  taskName: string; setTaskName: (v: string) => void;
  taskKeywords: string[]; setTaskKeywords: (v: string[]) => void;
  taskKeywordInput: string; setTaskKeywordInput: (v: string) => void;
  taskMinMembers: number; setTaskMinMembers: (v: number) => void;
  taskMaxResults: number; setTaskMaxResults: (v: number) => void;
  fissionEnabled: boolean; setFissionEnabled: (v: boolean) => void;
  fissionDepth: number; setFissionDepth: (v: number) => void;
  fissionMaxPerSeed: number; setFissionMaxPerSeed: (v: number) => void;
}

function TaskForm({
  taskName, setTaskName,
  taskKeywords, setTaskKeywords,
  taskKeywordInput, setTaskKeywordInput,
  taskMinMembers, setTaskMinMembers,
  taskMaxResults, setTaskMaxResults,
  fissionEnabled, setFissionEnabled,
  fissionDepth, setFissionDepth,
  fissionMaxPerSeed, setFissionMaxPerSeed,
}: TaskFormProps) {
  function addKeyword(kw: string) {
    const trimmed = kw.trim();
    if (trimmed && !taskKeywords.includes(trimmed)) {
      setTaskKeywords([...taskKeywords, trimmed]);
    }
    setTaskKeywordInput("");
  }
  function removeKeyword(kw: string) {
    setTaskKeywords(taskKeywords.filter(k => k !== kw));
  }

  return (
    <div className="space-y-4 py-2">
      <div>
        <label className="text-sm text-slate-600 block mb-1.5">任务名称</label>
        <Input
          value={taskName}
          onChange={e => setTaskName(e.target.value)}
          placeholder="如：搜索类群组采集"
          className="bg-slate-100 border-slate-200 text-slate-900"
        />
      </div>

      <div>
        <label className="text-sm text-slate-600 block mb-1.5">搜索关键词</label>
        <div className="flex gap-2 mb-2">
          <Input
            value={taskKeywordInput}
            onChange={e => setTaskKeywordInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addKeyword(taskKeywordInput)}
            placeholder="输入关键词后按 Enter 添加"
            className="bg-slate-100 border-slate-200 text-slate-900 flex-1"
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => addKeyword(taskKeywordInput)}
            className="text-slate-500 hover:text-slate-900 border border-slate-200"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {taskKeywords.map(kw => (
            <span
              key={kw}
              className="bg-slate-200 text-slate-700 text-xs px-2 py-1 rounded flex items-center gap-1"
            >
              {kw}
              <button onClick={() => removeKeyword(kw)} className="text-slate-500 hover:text-red-400">×</button>
            </span>
          ))}
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-1.5">快速添加预置关键词：</p>
          <div className="flex flex-wrap gap-1">
            {PRESET_KEYWORDS.filter(k => !taskKeywords.includes(k)).map(kw => (
              <button
                key={kw}
                onClick={() => addKeyword(kw)}
                className="bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-700 text-xs px-2 py-0.5 rounded border border-slate-200 transition-colors"
              >
                + {kw}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm text-slate-600 block mb-1.5">最低成员数</label>
          <Input
            type="number"
            value={taskMinMembers}
            onChange={e => setTaskMinMembers(parseInt(e.target.value) || 0)}
            className="bg-slate-100 border-slate-200 text-slate-900"
          />
          <p className="text-xs text-slate-500 mt-1">成员数低于此值的群组将被过滤</p>
        </div>
        <div>
          <label className="text-sm text-slate-600 block mb-1.5">每关键词最多采集数</label>
          <Input
            type="number"
            min={1}
            max={500}
            value={taskMaxResults}
            onChange={e => setTaskMaxResults(Math.min(500, Math.max(1, parseInt(e.target.value) || 10)))}
            className="bg-slate-100 border-slate-200 text-slate-900"
          />
          <p className="text-xs text-slate-500 mt-1">每个关键词最多采集条数（1~500）</p>
        </div>
      </div>

      {/* 裂变采集配置 */}
      <div className="border border-slate-200 rounded-lg p-4 space-y-3 bg-slate-50/80">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-purple-400" />
            <span className="text-sm font-medium text-slate-700">裂变采集</span>
            <span className="text-xs text-slate-500">从已采集群组扩展发现更多相似群</span>
          </div>
          <Switch
            checked={fissionEnabled}
            onCheckedChange={setFissionEnabled}
          />
        </div>
        {fissionEnabled && (
          <div className="grid grid-cols-2 gap-4 pt-1">
            <div>
              <label className="text-xs text-slate-500 block mb-1">裂变深度（1~3 层）</label>
              <Select
                value={String(fissionDepth)}
                onValueChange={v => setFissionDepth(parseInt(v))}
              >
                <SelectTrigger className="bg-slate-100 border-slate-200 text-slate-700 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white border-slate-200">
                  <SelectItem value="1">1 层（推荐）</SelectItem>
                  <SelectItem value="2">2 层</SelectItem>
                  <SelectItem value="3">3 层（较慢）</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500 mt-1">层数越多采集越多，耗时越长</p>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">每种子群最多扩展数</label>
              <Input
                type="number"
                value={fissionMaxPerSeed}
                onChange={e => setFissionMaxPerSeed(Math.min(50, parseInt(e.target.value) || 5))}
                className="bg-slate-100 border-slate-200 text-slate-900 h-8 text-sm"
                min={1}
                max={50}
              />
              <p className="text-xs text-slate-500 mt-1">每个种子群最多发现几个相似群</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function GroupScrape() {
  const [activeTab, setActiveTab] = useState<"tasks" | "results" | "extract" | "target">("tasks");

  // 新建任务状态
  const [createDialog, setCreateDialog] = useState(false);
  const [taskName, setTaskName] = useState("");
  const [taskKeywords, setTaskKeywords] = useState<string[]>(["搜索", "索引", "找群", "导航", "中文搜索"]);
  const [taskKeywordInput, setTaskKeywordInput] = useState("");
  const [taskMinMembers, setTaskMinMembers] = useState(1000);
  const [taskMaxResults, setTaskMaxResults] = useState(50);
  const [fissionEnabled, setFissionEnabled] = useState(false);
  const [fissionDepth, setFissionDepth] = useState(1);
  const [fissionMaxPerSeed, setFissionMaxPerSeed] = useState(10);

  // 编辑任务状态
  const [editDialog, setEditDialog] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editName, setEditName] = useState("");
  const [editKeywords, setEditKeywords] = useState<string[]>([]);
  const [editKeywordInput, setEditKeywordInput] = useState("");
  const [editMinMembers, setEditMinMembers] = useState(1000);
  const [editMaxResults, setEditMaxResults] = useState(50);
  const [editFissionEnabled, setEditFissionEnabled] = useState(false);
  const [editFissionDepth, setEditFissionDepth] = useState(1);
  const [editFissionMaxPerSeed, setEditFissionMaxPerSeed] = useState(10);

  // 删除任务状态
  const [deleteTaskId, setDeleteTaskId] = useState<number | null>(null);

  // 结果管理状态
  const [selectedTaskId, setSelectedTaskId] = useState<number | undefined>(undefined);
  const [importStatusFilter, setImportStatusFilter] = useState<"all" | "pending" | "imported" | "ignored">("pending");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [importConfirmDialog, setImportConfirmDialog] = useState(false);

  // ── 从群消息提取链接 状态 ──────────────────────────────────────
  const [extractAccountId, setExtractAccountId] = useState<string>("");
  const [extractGroupUrl, setExtractGroupUrl] = useState("");
  const [extractLimit, setExtractLimit] = useState(500);
  const [extractedLinks, setExtractedLinks] = useState<ExtractedLink[]>([]);
  const [extractScanned, setExtractScanned] = useState(0);
  const [extractSelectedUrls, setExtractSelectedUrls] = useState<Set<string>>(new Set());
  const [extractImportDialog, setExtractImportDialog] = useState(false);

  // ── 指定群组采集 状态 ────────────────────────────────────────────
  const [targetTaskId, setTargetTaskId] = useState<number | undefined>(undefined);
  const [targetGroupInput, setTargetGroupInput] = useState(""); // 单个输入
  const [targetGroupsBatch, setTargetGroupsBatch] = useState(""); // 批量输入
  const [targetGroups, setTargetGroups] = useState<string[]>([]);
  const [collectTypes, setCollectTypes] = useState<string[]>(["group", "channel", "user"]);
  const [userLimit, setUserLimit] = useState(500);
  const [aiScoreEnabled, setAiScoreEnabled] = useState(true);
  const [aiMinScore, setAiMinScore] = useState(60);
  // AI 评分扩展参数
  const [aiMinMembers, setAiMinMembers] = useState(100);          // 最低成员数
  const [aiRequireUsername, setAiRequireUsername] = useState(false); // 必须有用户名
  const [aiRequireDescription, setAiRequireDescription] = useState(false); // 必须有简介
  const [aiFilterBots, setAiFilterBots] = useState(true);         // 过滤机器人账号
  const [aiFilterAds, setAiFilterAds] = useState(true);           // 过滤广告用户（无用户名+无头像）
  const [aiMinActivity, setAiMinActivity] = useState(0);          // 最低活跃度分（0=不限）
  const [targetAccountId, setTargetAccountId] = useState<string>("");
  const [targetSubTab, setTargetSubTab] = useState<"groups" | "channels" | "users">("groups");
  const [collectedGroupPage, setCollectedGroupPage] = useState(1);
  const [collectedUserPage, setCollectedUserPage] = useState(1);
  const [collectedGroupType, setCollectedGroupType] = useState<"all" | "group" | "channel">("all");
  const [selectedCollectedGroupIds, setSelectedCollectedGroupIds] = useState<Set<number>>(new Set());
  const [importCollectedDialog, setImportCollectedDialog] = useState(false);
  const [exportUsersDialog, setExportUsersDialog] = useState(false);
  const [exportContent, setExportContent] = useState("");
  const [onlyWithUsername, setOnlyWithUsername] = useState(true);

  const utils = trpc.useUtils();

  // 查询任务列表
  const { data: tasks = [], isLoading: tasksLoading, isRefetching: tasksRefetching, refetch: refetchTasks } = trpc.groupScrape.listTasks.useQuery();

  // 查询采集结果（关键词模式）
  const { data: resultsData, isLoading: resultsLoading, isRefetching: resultsRefetching, refetch: refetchResults } = trpc.groupScrape.listResults.useQuery({
    taskId: selectedTaskId,
    importStatus: importStatusFilter,
    page,
    pageSize: 20,
  });

  // 查询采集到的群组/频道（指定群组模式）
  const { data: collectedGroupsData, isLoading: collectedGroupsLoading, refetch: refetchCollectedGroups } = trpc.groupScrape.listCollectedGroups.useQuery({
    taskId: targetTaskId,
    type: collectedGroupType,
    page: collectedGroupPage,
    pageSize: 20,
  }, { enabled: activeTab === "target" });

  // 查询采集到的用户（指定群组模式）
  const { data: collectedUsersData, isLoading: collectedUsersLoading, refetch: refetchCollectedUsers } = trpc.groupScrape.listCollectedUsers.useQuery({
    taskId: targetTaskId,
    onlyWithUsername,
    page: collectedUserPage,
    pageSize: 20,
  }, { enabled: activeTab === "target" });

  // 查询采集统计
  const { data: collectedStats, refetch: refetchStats } = trpc.groupScrape.getCollectedStats.useQuery(
    { taskId: targetTaskId! },
    { enabled: activeTab === "target" && !!targetTaskId }
  );

  // 查询 TG 账号列表
  const { data: accountsData } = trpc.tgAccounts.list.useQuery();
  const accounts = (accountsData as any)?.accounts ?? accountsData ?? [];

  const results = resultsData?.items || [];
  const totalResults = resultsData?.total || 0;
  const collectedGroups = (collectedGroupsData?.items || []) as CollectedGroup[];
  const totalCollectedGroups = collectedGroupsData?.total || 0;
  const collectedUsers = (collectedUsersData?.items || []) as CollectedUser[];
  const totalCollectedUsers = collectedUsersData?.total || 0;

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

  // 更新任务
  const updateTask = trpc.groupScrape.updateTask.useMutation({
    onSuccess: () => {
      toast.success("任务配置已更新");
      setEditDialog(false);
      setEditingTask(null);
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

  // 触发任务（关键词模式）
  const triggerTask = trpc.groupScrape.triggerTask.useMutation({
    onSuccess: () => {
      toast.success("采集任务已触发，引擎将在 60 秒内开始执行");
      refetchTasks();
    },
    onError: (e) => toast.error(e.message),
  });

  // 批量导入（采集结果）
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

  // 从群消息提取链接
  const extractFromGroup = trpc.groupScrape.extractFromGroup.useMutation({
    onSuccess: (data) => {
      setExtractedLinks(data.links);
      setExtractScanned(data.scanned);
      setExtractSelectedUrls(new Set(data.links.map(l => l.url)));
      toast.success(`扫描 ${data.scanned} 条消息，提取到 ${data.total} 个群组链接`);
    },
    onError: (e) => toast.error(e.message),
  });

  // 将提取的链接批量导入公共群池
  const importExtractedLinks = trpc.tgAccounts.importChatsToPublic.useMutation({
    onSuccess: (data: any) => {
      toast.success(`成功导入 ${data.added} 个群组，跳过 ${data.skipped} 个（已存在）`);
      setExtractImportDialog(false);
      setExtractSelectedUrls(new Set());
    },
    onError: (e) => toast.error(e.message),
  });

  // 指定群组采集（v2）
  const runTargetScrape = trpc.groupScrape.runTargetScrape.useMutation({
    onSuccess: (data) => {
      toast.success(
        `采集完成！群组/频道: ${data.groupsSaved} 条，用户: ${data.usersSaved} 条` +
        (data.groupsSkipped + data.usersSkipped > 0 ? `（去重跳过 ${data.groupsSkipped + data.usersSkipped} 条）` : "")
      );
      refetchCollectedGroups();
      refetchCollectedUsers();
      refetchStats();
      refetchTasks();
    },
    onError: (e) => toast.error(e.message),
  });

  // 导入采集到的群组到监控池
  const importCollectedGroups = trpc.groupScrape.importCollectedGroupsToPool.useMutation({
    onSuccess: (data) => {
      toast.success(`成功导入 ${data.importedCount} 个群组，跳过 ${data.skippedCount} 个`);
      setImportCollectedDialog(false);
      setSelectedCollectedGroupIds(new Set());
      refetchCollectedGroups();
    },
    onError: (e) => toast.error(e.message),
  });

  // 导出用户列表
  const exportUsers = trpc.groupScrape.exportCollectedUsers.useQuery(
    { taskId: targetTaskId, onlyWithUsername },
    { enabled: false }
  );

  // 清空采集数据
  const clearCollectedData = trpc.groupScrape.clearCollectedData.useMutation({
    onSuccess: () => {
      toast.success("采集数据已清空");
      refetchCollectedGroups();
      refetchCollectedUsers();
      refetchStats();
    },
    onError: (e) => toast.error(e.message),
  });

  function resetCreateForm() {
    setTaskName("");
    setTaskKeywords(["搜索", "索引", "找群", "导航", "中文搜索"]);
    setTaskKeywordInput("");
    setTaskMinMembers(1000);
    setTaskMaxResults(50);
    setFissionEnabled(false);
    setFissionDepth(1);
    setFissionMaxPerSeed(10);
  }

  function openEditDialog(task: Task) {
    setEditingTask(task);
    setEditName(task.name);
    setEditKeywords([...task.keywords]);
    setEditKeywordInput("");
    setEditMinMembers(task.minMemberCount);
    setEditMaxResults(task.maxResults);
    setEditFissionEnabled(task.fissionEnabled ?? false);
    setEditFissionDepth(task.fissionDepth ?? 1);
    setEditFissionMaxPerSeed(task.fissionMaxPerSeed ?? 10);
    setEditDialog(true);
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

  function toggleExtractSelect(url: string) {
    setExtractSelectedUrls(prev => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  function toggleExtractSelectAll() {
    if (extractSelectedUrls.size === extractedLinks.length) {
      setExtractSelectedUrls(new Set());
    } else {
      setExtractSelectedUrls(new Set(extractedLinks.map(l => l.url)));
    }
  }

  function toggleCollectedGroupSelect(id: number) {
    setSelectedCollectedGroupIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleCollectedGroupSelectAll() {
    if (selectedCollectedGroupIds.size === collectedGroups.length) {
      setSelectedCollectedGroupIds(new Set());
    } else {
      setSelectedCollectedGroupIds(new Set(collectedGroups.map(g => g.id)));
    }
  }

  // 添加目标群组（单个）
  function addTargetGroup(input: string) {
    const trimmed = input.trim().replace(/^@/, "");
    if (!trimmed) return;
    const normalized = trimmed;
    if (!targetGroups.includes(normalized)) {
      setTargetGroups(prev => [...prev, normalized]);
    }
    setTargetGroupInput("");
  }

  // 批量导入目标群组
  function importBatchGroups() {
    const lines = targetGroupsBatch.split(/[\n,，\s]+/).map(s => s.trim().replace(/^@/, "")).filter(Boolean);
    const unique = Array.from(new Set([...targetGroups, ...lines]));
    setTargetGroups(unique);
    setTargetGroupsBatch("");
    toast.success(`已添加 ${lines.length} 个群组`);
  }

  // 切换采集类型
  function toggleCollectType(type: string) {
    setCollectTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  }

  // 执行指定群组采集
  async function handleRunTargetScrape() {
    if (!targetTaskId) { toast.error("请先选择或创建一个采集任务"); return; }
    if (targetGroups.length === 0) { toast.error("请添加至少一个目标群组"); return; }
    if (collectTypes.length === 0) { toast.error("请至少选择一种采集内容类型"); return; }

    runTargetScrape.mutate({
      taskId: targetTaskId,
      targetGroups,
      collectTypes: collectTypes.join(","),
      userLimit,
      aiScoreEnabled,
      aiMinScore,
      aiMinMembers,
      aiRequireUsername,
      aiRequireDescription,
      aiFilterBots,
      aiFilterAds,
      aiMinActivity,
      accountId: targetAccountId ? parseInt(targetAccountId) : undefined,
    });
  }

  // 导出用户列表
  async function handleExportUsers() {
    const result = await utils.groupScrape.exportCollectedUsers.fetch({
      taskId: targetTaskId,
      onlyWithUsername,
    });
    setExportContent(result.content);
    setExportUsersDialog(true);
  }

  function downloadExportContent() {
    const blob = new Blob([exportContent], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `tg_users_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const totalPages = Math.ceil(totalResults / 20);
  const totalCollectedGroupPages = Math.ceil(totalCollectedGroups / 20);
  const totalCollectedUserPages = Math.ceil(totalCollectedUsers / 20);

  return (
    <AdminLayout title="群组采集">
      <div className="p-6 max-w-7xl mx-auto">
        {/* 页面标题 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Search className="w-5 h-5 text-red-400" />
              群组采集
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              通过关键词搜索公开群组，或指定群组采集成员/子群，导入公共监控群组池
            </p>
          </div>
          <div className="flex gap-2">
            {activeTab === "tasks" && (
              <Button
                size="sm"
                onClick={() => setCreateDialog(true)}
                className="bg-red-600 hover:bg-red-700 text-slate-900"
              >
                <Plus className="w-4 h-4 mr-1" /> 新建采集任务
              </Button>
            )}
          </div>
        </div>

        {/* Tab 切换 */}
        <div className="flex gap-1 mb-4 bg-white rounded-lg p-1 w-fit flex-wrap">
          <button
            onClick={() => setActiveTab("tasks")}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
              activeTab === "tasks" ? "bg-red-600 text-slate-900" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            采集任务
          </button>
          <button
            onClick={() => setActiveTab("results")}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
              activeTab === "results" ? "bg-red-600 text-slate-900" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            关键词结果
            {totalResults > 0 && (
              <span className="ml-1.5 bg-slate-200 text-slate-600 text-xs px-1.5 py-0.5 rounded-full">
                {totalResults}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("target")}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === "target" ? "bg-purple-600 text-slate-900" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <Target className="w-3.5 h-3.5" />
            指定群组采集
            {(collectedStats?.groups || 0) + (collectedStats?.channels || 0) + (collectedStats?.users || 0) > 0 && (
              <span className="ml-1 bg-purple-900/60 text-purple-300 text-xs px-1.5 py-0.5 rounded-full">
                {(collectedStats?.groups || 0) + (collectedStats?.channels || 0) + (collectedStats?.users || 0)}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("extract")}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === "extract" ? "bg-orange-600 text-slate-900" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <Link2 className="w-3.5 h-3.5" />
            从群消息提取链接
          </button>
        </div>

        {/* ── 采集任务 Tab ── */}
        {activeTab === "tasks" && (
          <Card className="bg-white border-slate-200">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-slate-900 text-base">采集任务列表</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => refetchTasks()} disabled={tasksRefetching} className="text-slate-500 hover:text-slate-900">
                  <RefreshCw className={`w-4 h-4 ${tasksRefetching ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {tasksLoading ? (
                <div className="flex items-center justify-center py-12 text-slate-500">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载中...
                </div>
              ) : tasks.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <Search className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>暂无采集任务，点击右上角新建</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-200">
                      <TableHead className="text-slate-500">任务名称</TableHead>
                      <TableHead className="text-slate-500">关键词</TableHead>
                      <TableHead className="text-slate-500">最低人数</TableHead>
                      <TableHead className="text-slate-500">最多结果</TableHead>
                      <TableHead className="text-slate-500">裂变</TableHead>
                      <TableHead className="text-slate-500">状态</TableHead>
                      <TableHead className="text-slate-500">采集数量</TableHead>
                      <TableHead className="text-slate-500">上次执行</TableHead>
                      <TableHead className="text-slate-500 text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(tasks as Task[]).map((task) => (
                      <TableRow key={task.id} className="border-slate-200 hover:bg-slate-50/80">
                        <TableCell className="text-slate-900 font-medium">{task.name}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1 max-w-xs">
                            {task.keywords.slice(0, 4).map(kw => (
                              <span key={kw} className="bg-slate-100 text-slate-600 text-xs px-1.5 py-0.5 rounded">
                                {kw}
                              </span>
                            ))}
                            {task.keywords.length > 4 && (
                              <span className="text-slate-500 text-xs">+{task.keywords.length - 4}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-slate-600">{task.minMemberCount.toLocaleString()}</TableCell>
                        <TableCell className="text-slate-600">{task.maxResults}</TableCell>
                        <TableCell>
                          {task.fissionEnabled ? (
                            <span className="inline-flex items-center gap-1 text-xs text-purple-400 bg-purple-900/30 px-1.5 py-0.5 rounded">
                              <GitBranch className="w-3 h-3" />
                              {task.fissionDepth}层/{task.fissionMaxPerSeed}个
                            </span>
                          ) : (
                            <span className="text-slate-500 text-xs">关闭</span>
                          )}
                        </TableCell>
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
                            <span className="text-slate-500 text-sm">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-slate-500 text-sm">
                          {task.lastRunAt ? new Date(task.lastRunAt).toLocaleString("zh-CN") : "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
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
                              onClick={() => { setTargetTaskId(task.id); setActiveTab("target"); }}
                              className="text-purple-400 hover:text-purple-300 hover:bg-purple-900/20"
                              title="指定群组采集"
                            >
                              <Target className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openEditDialog(task)}
                              className="text-blue-400 hover:text-blue-300 hover:bg-blue-900/20"
                              title="编辑任务"
                            >
                              <Pencil className="w-4 h-4" />
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

        {/* ── 关键词采集结果 Tab ── */}
        {activeTab === "results" && (
          <div className="space-y-4">
            {/* 过滤栏 */}
            <div className="flex flex-wrap items-center gap-3">
              <Select
                value={selectedTaskId?.toString() || "all"}
                onValueChange={(v) => { setSelectedTaskId(v === "all" ? undefined : parseInt(v)); setPage(1); }}
              >
                <SelectTrigger className="w-48 bg-white border-slate-200 text-slate-700">
                  <SelectValue placeholder="全部任务" />
                </SelectTrigger>
                <SelectContent className="bg-white border-slate-200">
                  <SelectItem value="all">全部任务</SelectItem>
                  {(tasks as Task[]).map((t) => (
                    <SelectItem key={t.id} value={t.id.toString()}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={importStatusFilter}
                onValueChange={(v: any) => { setImportStatusFilter(v); setPage(1); }}
              >
                <SelectTrigger className="w-36 bg-white border-slate-200 text-slate-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white border-slate-200">
                  <SelectItem value="all">全部状态</SelectItem>
                  <SelectItem value="pending">待审核</SelectItem>
                  <SelectItem value="imported">已导入</SelectItem>
                  <SelectItem value="ignored">已忽略</SelectItem>
                </SelectContent>
              </Select>

              <Button variant="ghost" size="sm" onClick={() => refetchResults()} disabled={resultsRefetching} className="text-slate-500 hover:text-slate-900">
                <RefreshCw className={`w-4 h-4 ${resultsRefetching ? 'animate-spin' : ''}`} />
              </Button>

              <div className="ml-auto flex gap-2">
                {selectedIds.size > 0 && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => setImportConfirmDialog(true)}
                      className="bg-green-700 hover:bg-green-600 text-slate-900"
                    >
                      <Download className="w-4 h-4 mr-1" />
                      导入选中 ({selectedIds.size})
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => ignoreResults.mutate({ resultIds: Array.from(selectedIds) })}
                      className="text-slate-500 hover:text-slate-700"
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

            <Card className="bg-white border-slate-200">
              <CardContent className="p-0">
                {resultsLoading ? (
                  <div className="flex items-center justify-center py-12 text-slate-500">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载中...
                  </div>
                ) : results.length === 0 ? (
                  <div className="text-center py-12 text-slate-500">
                    <Search className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p>暂无采集结果</p>
                    <p className="text-xs mt-1">请先触发采集任务，等待引擎执行完成</p>
                  </div>
                ) : (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow className="border-slate-200">
                          <TableHead className="w-10">
                            <Checkbox
                              checked={selectedIds.size === results.length && results.length > 0}
                              onCheckedChange={toggleSelectAll}
                              className="border-slate-300"
                            />
                          </TableHead>
                          <TableHead className="text-slate-500">群组名称</TableHead>
                          <TableHead className="text-slate-500">群组 ID</TableHead>
                          <TableHead className="text-slate-500">类型</TableHead>
                          <TableHead className="text-slate-500">成员数</TableHead>
                          <TableHead className="text-slate-500">匹配关键词</TableHead>
                          <TableHead className="text-slate-500">简介</TableHead>
                          <TableHead className="text-slate-500">状态</TableHead>
                          <TableHead className="text-slate-500 text-right">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(results as ScrapeResult[]).map((r) => (
                          <TableRow key={r.id} className="border-slate-200 hover:bg-slate-50/80">
                            <TableCell>
                              <Checkbox
                                checked={selectedIds.has(r.id)}
                                onCheckedChange={() => toggleSelect(r.id)}
                                disabled={r.importStatus !== "pending"}
                                className="border-slate-300"
                              />
                            </TableCell>
                            <TableCell className="text-slate-900 font-medium max-w-[180px] truncate">
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
                              <span className="text-xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                {r.groupType === "channel" ? "频道" : r.groupType === "supergroup" ? "超级群" : "群组"}
                              </span>
                            </TableCell>
                            <TableCell className="text-slate-600">
                              <div className="flex items-center gap-1">
                                <Users className="w-3 h-3 text-slate-500" />
                                {r.memberCount.toLocaleString()}
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className={`text-xs px-1.5 py-0.5 rounded ${
                                r.keyword.startsWith("[裂变]")
                                  ? "bg-purple-900/40 text-purple-300"
                                  : "bg-slate-100 text-slate-600"
                              }`}>
                                {r.keyword}
                              </span>
                            </TableCell>
                            <TableCell className="text-slate-500 text-xs max-w-[200px] truncate">
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
                      <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
                        <span className="text-sm text-slate-500">
                          共 {totalResults} 条，第 {page}/{totalPages} 页
                        </span>
                        <div className="flex gap-2">
                          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="text-slate-500">上一页</Button>
                          <Button size="sm" variant="ghost" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="text-slate-500">下一页</Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── 指定群组采集 Tab ── */}
        {activeTab === "target" && (
          <div className="space-y-4">
            {/* 配置区 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* 左侧：目标群组配置 */}
              <div className="lg:col-span-2 space-y-4">
                <Card className="bg-white border-slate-200">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-slate-900 text-base flex items-center gap-2">
                      <Target className="w-4 h-4 text-purple-400" />
                      目标群组配置
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* 选择任务 */}
                    <div>
                      <label className="text-sm text-slate-600 block mb-1.5">关联采集任务（用于保存结果）</label>
                      <Select
                        value={targetTaskId?.toString() || ""}
                        onValueChange={(v) => setTargetTaskId(parseInt(v))}
                      >
                        <SelectTrigger className="bg-slate-100 border-slate-200 text-slate-700">
                          <SelectValue placeholder="请选择任务（或先在任务列表新建）" />
                        </SelectTrigger>
                        <SelectContent className="bg-white border-slate-200">
                          {(tasks as Task[]).map((t) => (
                            <SelectItem key={t.id} value={t.id.toString()}>{t.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* 单个添加 */}
                    <div>
                      <label className="text-sm text-slate-600 block mb-1.5">添加目标群组</label>
                      <div className="flex gap-2">
                        <Input
                          value={targetGroupInput}
                          onChange={e => setTargetGroupInput(e.target.value)}
                          onKeyDown={e => e.key === "Enter" && addTargetGroup(targetGroupInput)}
                          placeholder="输入群组 @用户名 或 t.me/xxx"
                          className="bg-slate-100 border-slate-200 text-slate-900 flex-1"
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => addTargetGroup(targetGroupInput)}
                          className="text-slate-500 hover:text-slate-900 border border-slate-200"
                        >
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>

                    {/* 批量导入 */}
                    <div>
                      <label className="text-sm text-slate-600 block mb-1.5">批量导入（每行一个，支持 @用户名 或 t.me/xxx）</label>
                      <Textarea
                        value={targetGroupsBatch}
                        onChange={e => setTargetGroupsBatch(e.target.value)}
                        placeholder={"@group1\n@group2\nt.me/group3\n..."}
                        className="bg-slate-100 border-slate-200 text-slate-900 text-sm h-24 resize-none"
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={importBatchGroups}
                        disabled={!targetGroupsBatch.trim()}
                        className="mt-2 text-purple-400 hover:text-purple-300 border border-purple-800 hover:bg-purple-900/20"
                      >
                        <FileText className="w-4 h-4 mr-1" />
                        批量导入
                      </Button>
                    </div>

                    {/* 已添加的群组 */}
                    {targetGroups.length > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-sm text-slate-600">已添加 {targetGroups.length} 个目标群组</label>
                          <button
                            onClick={() => setTargetGroups([])}
                            className="text-xs text-red-400 hover:text-red-300"
                          >
                            清空
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                          {targetGroups.map(g => (
                            <span
                              key={g}
                              className="bg-slate-100 text-slate-700 text-xs px-2 py-1 rounded flex items-center gap-1 border border-slate-200"
                            >
                              @{g}
                              <button
                                onClick={() => setTargetGroups(prev => prev.filter(x => x !== g))}
                                className="text-slate-500 hover:text-red-400"
                              >×</button>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* 右侧：采集配置 */}
              <div className="space-y-4">
                <Card className="bg-white border-slate-200">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-slate-900 text-base flex items-center gap-2">
                      <Filter className="w-4 h-4 text-blue-400" />
                      采集配置
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* 采集内容类型 */}
                    <div>
                      <label className="text-sm text-slate-600 block mb-2">采集内容类型</label>
                      <div className="space-y-2">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <Checkbox
                            checked={collectTypes.includes("group")}
                            onCheckedChange={() => toggleCollectType("group")}
                            className="border-slate-300"
                          />
                          <Globe className="w-4 h-4 text-blue-400" />
                          <span className="text-sm text-slate-600">群组</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <Checkbox
                            checked={collectTypes.includes("channel")}
                            onCheckedChange={() => toggleCollectType("channel")}
                            className="border-slate-300"
                          />
                          <Radio className="w-4 h-4 text-orange-400" />
                          <span className="text-sm text-slate-600">频道</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <Checkbox
                            checked={collectTypes.includes("user")}
                            onCheckedChange={() => toggleCollectType("user")}
                            className="border-slate-300"
                          />
                          <Users className="w-4 h-4 text-green-400" />
                          <span className="text-sm text-slate-600">用户成员</span>
                        </label>
                      </div>
                    </div>

                    {/* 用户采集上限 */}
                    {collectTypes.includes("user") && (
                      <div>
                        <label className="text-sm text-slate-600 block mb-1.5">用户采集上限</label>
                        <Input
                          type="number"
                          value={userLimit}
                          onChange={e => setUserLimit(Math.min(2000, Math.max(1, parseInt(e.target.value) || 500)))}
                          className="bg-slate-100 border-slate-200 text-slate-900"
                          min={1}
                          max={2000}
                        />
                        <p className="text-xs text-slate-500 mt-1">每个群最多采集用户数（1~2000）</p>
                      </div>
                    )}

                    {/* 选择账号 */}
                    <div>
                      <label className="text-sm text-slate-600 block mb-1.5">使用账号（可选）</label>
                      <Select value={targetAccountId || "auto"} onValueChange={(v) => setTargetAccountId(v === "auto" ? "" : v)}>
                        <SelectTrigger className="bg-slate-100 border-slate-200 text-slate-700">
                          <SelectValue placeholder="自动选择" />
                        </SelectTrigger>
                        <SelectContent className="bg-white border-slate-200">
                          <SelectItem value="auto">自动选择</SelectItem>
                          {(Array.isArray(accounts) ? accounts : []).map((acc: any) => (
                            <SelectItem key={acc.id} value={String(acc.id)}>
                              {acc.phone || acc.tgUsername || `账号 #${acc.id}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* AI 评分 */}
                    <div className="border border-slate-200 rounded-lg p-3 space-y-3 bg-slate-50/80">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Star className="w-4 h-4 text-yellow-400" />
                          <span className="text-sm font-medium text-slate-700">AI 质量评分</span>
                        </div>
                        <Switch
                          checked={aiScoreEnabled}
                          onCheckedChange={setAiScoreEnabled}
                        />
                      </div>
                      {aiScoreEnabled && (
                        <div className="space-y-3">
                          {/* 最低评分阈值 */}
                          <div>
                            <label className="text-xs text-slate-500 block mb-1">最低评分阈值（低于此分过滤）</label>
                            <div className="flex items-center gap-2">
                              <Input
                                type="number"
                                value={aiMinScore}
                                onChange={e => setAiMinScore(Math.min(100, Math.max(0, parseInt(e.target.value) || 60)))}
                                className="bg-slate-100 border-slate-200 text-slate-900 h-8 text-sm"
                                min={0}
                                max={100}
                              />
                              <span className="text-slate-500 text-sm">/ 100</span>
                            </div>
                            <p className="text-xs text-slate-500 mt-1">评分维度：成员数、有用户名、标题质量、有简介、类型</p>
                          </div>

                          {/* 最低成员数 */}
                          <div>
                            <label className="text-xs text-slate-500 block mb-1">最低成员数（低于此数过滤）</label>
                            <div className="flex items-center gap-2">
                              <Input
                                type="number"
                                value={aiMinMembers}
                                onChange={e => setAiMinMembers(Math.max(0, parseInt(e.target.value) || 0))}
                                className="bg-slate-100 border-slate-200 text-slate-900 h-8 text-sm"
                                min={0}
                                placeholder="0 = 不限"
                              />
                              <span className="text-slate-500 text-sm">人</span>
                            </div>
                          </div>

                          {/* 活跃度要求 */}
                          <div>
                            <label className="text-xs text-slate-500 block mb-1">最低活跃度分（0 = 不限）</label>
                            <div className="flex items-center gap-2">
                              <Input
                                type="number"
                                value={aiMinActivity}
                                onChange={e => setAiMinActivity(Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
                                className="bg-slate-100 border-slate-200 text-slate-900 h-8 text-sm"
                                min={0}
                                max={100}
                                placeholder="0"
                              />
                              <span className="text-slate-500 text-sm">/ 100</span>
                            </div>
                            <p className="text-xs text-slate-500 mt-1">基于近期消息频率评估群组活跃程度</p>
                          </div>

                          {/* 过滤选项 */}
                          <div className="space-y-2 pt-1 border-t border-slate-200">
                            <p className="text-xs text-slate-500 font-medium">过滤选项</p>

                            <div className="flex items-center gap-2">
                              <Checkbox
                                id="filterBots"
                                checked={aiFilterBots}
                                onCheckedChange={v => setAiFilterBots(!!v)}
                                className="border-slate-300"
                              />
                              <label htmlFor="filterBots" className="text-xs text-slate-600 cursor-pointer flex items-center gap-1">
                                <Bot className="w-3 h-3 text-red-400" />
                                过滤机器人账号
                              </label>
                            </div>

                            <div className="flex items-center gap-2">
                              <Checkbox
                                id="filterAds"
                                checked={aiFilterAds}
                                onCheckedChange={v => setAiFilterAds(!!v)}
                                className="border-slate-300"
                              />
                              <label htmlFor="filterAds" className="text-xs text-slate-600 cursor-pointer flex items-center gap-1">
                                <Filter className="w-3 h-3 text-orange-400" />
                                过滤广告用户（无用户名且无头像）
                              </label>
                            </div>

                            <div className="flex items-center gap-2">
                              <Checkbox
                                id="requireUsername"
                                checked={aiRequireUsername}
                                onCheckedChange={v => setAiRequireUsername(!!v)}
                                className="border-slate-300"
                              />
                              <label htmlFor="requireUsername" className="text-xs text-slate-600 cursor-pointer flex items-center gap-1">
                                <UserCheck className="w-3 h-3 text-blue-400" />
                                仅保留有用户名的群组/用户
                              </label>
                            </div>

                            <div className="flex items-center gap-2">
                              <Checkbox
                                id="requireDescription"
                                checked={aiRequireDescription}
                                onCheckedChange={v => setAiRequireDescription(!!v)}
                                className="border-slate-300"
                              />
                              <label htmlFor="requireDescription" className="text-xs text-slate-600 cursor-pointer flex items-center gap-1">
                                <FileText className="w-3 h-3 text-green-400" />
                                仅保留有群组简介的群组
                              </label>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 开始采集按钮 */}
                    <Button
                      onClick={handleRunTargetScrape}
                      disabled={runTargetScrape.isPending || targetGroups.length === 0 || !targetTaskId}
                      className="w-full bg-purple-600 hover:bg-purple-700 text-slate-900"
                    >
                      {runTargetScrape.isPending ? (
                        <><Loader2 className="w-4 h-4 animate-spin mr-2" />采集中，请稍候...</>
                      ) : (
                        <><Play className="w-4 h-4 mr-2" />开始采集</>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* 采集结果展示 */}
            {targetTaskId && (
              <Card className="bg-white border-slate-200">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-slate-900 text-base flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-400" />
                      采集结果
                      {collectedStats && (
                        <div className="flex gap-2 ml-2">
                          <span className="text-xs bg-blue-900/40 text-blue-300 px-2 py-0.5 rounded">
                            群组 {collectedStats.groups}
                          </span>
                          <span className="text-xs bg-orange-900/40 text-orange-300 px-2 py-0.5 rounded">
                            频道 {collectedStats.channels}
                          </span>
                          <span className="text-xs bg-green-900/40 text-green-300 px-2 py-0.5 rounded">
                            用户 {collectedStats.users}
                          </span>
                        </div>
                      )}
                    </CardTitle>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { refetchCollectedGroups(); refetchCollectedUsers(); refetchStats(); }}
                        className="text-slate-500 hover:text-slate-900"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </Button>
                      {collectTypes.includes("user") && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleExportUsers}
                          className="border-slate-300 text-slate-600 hover:text-slate-900 hover:bg-slate-200"
                        >
                          <FileDown className="w-4 h-4 mr-1" />
                          导出用户
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => clearCollectedData.mutate({ taskId: targetTaskId!, clearGroups: true, clearUsers: true })}
                        className="text-red-400 hover:text-red-300"
                      >
                        <Trash2 className="w-4 h-4 mr-1" />
                        清空
                      </Button>
                    </div>
                  </div>

                  {/* 子 Tab */}
                  <div className="flex gap-1 mt-3 bg-slate-100 rounded-lg p-1 w-fit">
                    <button
                      onClick={() => setTargetSubTab("groups")}
                      className={`px-3 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                        targetSubTab === "groups" ? "bg-blue-600 text-slate-900" : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      <Globe className="w-3 h-3" />
                      群组 ({collectedStats?.groups || 0})
                    </button>
                    <button
                      onClick={() => setTargetSubTab("channels")}
                      className={`px-3 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                        targetSubTab === "channels" ? "bg-orange-600 text-slate-900" : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      <Radio className="w-3 h-3" />
                      频道 ({collectedStats?.channels || 0})
                    </button>
                    <button
                      onClick={() => setTargetSubTab("users")}
                      className={`px-3 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                        targetSubTab === "users" ? "bg-green-600 text-slate-900" : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      <Users className="w-3 h-3" />
                      用户 ({collectedStats?.users || 0})
                    </button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {/* 群组/频道列表 */}
                  {(targetSubTab === "groups" || targetSubTab === "channels") && (
                    <>
                      {/* 过滤 */}
                      <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-200">
                        <Select
                          value={collectedGroupType}
                          onValueChange={(v: any) => { setCollectedGroupType(v); setCollectedGroupPage(1); }}
                        >
                          <SelectTrigger className="w-32 bg-slate-100 border-slate-200 text-slate-700 h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-white border-slate-200">
                            <SelectItem value="all">全部类型</SelectItem>
                            <SelectItem value="group">群组</SelectItem>
                            <SelectItem value="channel">频道</SelectItem>
                          </SelectContent>
                        </Select>
                        {selectedCollectedGroupIds.size > 0 && (
                          <Button
                            size="sm"
                            onClick={() => setImportCollectedDialog(true)}
                            className="bg-green-700 hover:bg-green-600 text-slate-900 h-7 text-xs"
                          >
                            <Download className="w-3 h-3 mr-1" />
                            导入监控池 ({selectedCollectedGroupIds.size})
                          </Button>
                        )}
                      </div>

                      {collectedGroupsLoading ? (
                        <div className="flex items-center justify-center py-12 text-slate-500">
                          <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载中...
                        </div>
                      ) : collectedGroups.length === 0 ? (
                        <div className="text-center py-12 text-slate-500">
                          <Globe className="w-10 h-10 mx-auto mb-3 opacity-30" />
                          <p>暂无采集到的群组/频道</p>
                          <p className="text-xs mt-1">请先配置目标群组并开始采集</p>
                        </div>
                      ) : (
                        <>
                          <Table>
                            <TableHeader>
                              <TableRow className="border-slate-200">
                                <TableHead className="w-10">
                                  <Checkbox
                                    checked={selectedCollectedGroupIds.size === collectedGroups.length && collectedGroups.length > 0}
                                    onCheckedChange={toggleCollectedGroupSelectAll}
                                    className="border-slate-300"
                                  />
                                </TableHead>
                                <TableHead className="text-slate-500">名称</TableHead>
                                <TableHead className="text-slate-500">用户名</TableHead>
                                <TableHead className="text-slate-500">类型</TableHead>
                                <TableHead className="text-slate-500">成员数</TableHead>
                                <TableHead className="text-slate-500">AI评分</TableHead>
                                <TableHead className="text-slate-500">来源群组</TableHead>
                                <TableHead className="text-slate-500">状态</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {collectedGroups.map((g) => (
                                <TableRow key={g.id} className="border-slate-200 hover:bg-slate-50/80">
                                  <TableCell>
                                    <Checkbox
                                      checked={selectedCollectedGroupIds.has(g.id)}
                                      onCheckedChange={() => toggleCollectedGroupSelect(g.id)}
                                      disabled={g.importStatus !== "pending"}
                                      className="border-slate-300"
                                    />
                                  </TableCell>
                                  <TableCell className="text-slate-900 font-medium max-w-[160px] truncate">
                                    {g.title || g.username || g.tgId || "-"}
                                  </TableCell>
                                  <TableCell className="text-blue-400 text-sm font-mono">
                                    {g.username ? (
                                      <a
                                        href={`https://t.me/${g.username}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="hover:underline"
                                      >
                                        @{g.username}
                                      </a>
                                    ) : (
                                      <span className="text-slate-500">-</span>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                                      g.type === "channel"
                                        ? "bg-orange-900/40 text-orange-300"
                                        : "bg-blue-900/40 text-blue-300"
                                    }`}>
                                      {g.type === "channel" ? "频道" : "群组"}
                                    </span>
                                  </TableCell>
                                  <TableCell className="text-slate-600">
                                    <div className="flex items-center gap-1">
                                      <Users className="w-3 h-3 text-slate-500" />
                                      {(g.memberCount || 0).toLocaleString()}
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <AiScoreBar score={g.aiScore} />
                                  </TableCell>
                                  <TableCell className="text-slate-500 text-xs">
                                    {g.sourceGroupId}
                                  </TableCell>
                                  <TableCell>
                                    <ImportStatusBadge status={g.importStatus} />
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                          {totalCollectedGroupPages > 1 && (
                            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
                              <span className="text-sm text-slate-500">共 {totalCollectedGroups} 条，第 {collectedGroupPage}/{totalCollectedGroupPages} 页</span>
                              <div className="flex gap-2">
                                <Button size="sm" variant="ghost" disabled={collectedGroupPage <= 1} onClick={() => setCollectedGroupPage(p => p - 1)} className="text-slate-500">上一页</Button>
                                <Button size="sm" variant="ghost" disabled={collectedGroupPage >= totalCollectedGroupPages} onClick={() => setCollectedGroupPage(p => p + 1)} className="text-slate-500">下一页</Button>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </>
                  )}

                  {/* 用户列表 */}
                  {targetSubTab === "users" && (
                    <>
                      <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-200">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <Checkbox
                            checked={onlyWithUsername}
                            onCheckedChange={(v) => setOnlyWithUsername(!!v)}
                            className="border-slate-300"
                          />
                          <span className="text-xs text-slate-600">只显示有 @用户名 的用户</span>
                        </label>
                      </div>

                      {collectedUsersLoading ? (
                        <div className="flex items-center justify-center py-12 text-slate-500">
                          <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载中...
                        </div>
                      ) : collectedUsers.length === 0 ? (
                        <div className="text-center py-12 text-slate-500">
                          <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
                          <p>暂无采集到的用户</p>
                          <p className="text-xs mt-1">请勾选「用户成员」类型并开始采集</p>
                        </div>
                      ) : (
                        <>
                          <Table>
                            <TableHeader>
                              <TableRow className="border-slate-200">
                                <TableHead className="text-slate-500">显示名称</TableHead>
                                <TableHead className="text-slate-500">@用户名</TableHead>
                                <TableHead className="text-slate-500">TG ID</TableHead>
                                <TableHead className="text-slate-500">标签</TableHead>
                                <TableHead className="text-slate-500">AI评分</TableHead>
                                <TableHead className="text-slate-500">来源群组</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {collectedUsers.map((u) => (
                                <TableRow key={u.id} className="border-slate-200 hover:bg-slate-50/80">
                                  <TableCell className="text-slate-900 font-medium max-w-[140px] truncate">
                                    {u.displayName || "-"}
                                  </TableCell>
                                  <TableCell className="text-blue-400 text-sm font-mono">
                                    {u.username ? (
                                      <a
                                        href={`https://t.me/${u.username}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="hover:underline"
                                      >
                                        @{u.username}
                                      </a>
                                    ) : (
                                      <span className="text-slate-500">-</span>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-slate-500 text-xs font-mono">
                                    {u.tgId}
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex gap-1">
                                      {u.isBot && (
                                        <span className="text-xs bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                          <Bot className="w-3 h-3" /> Bot
                                        </span>
                                      )}
                                      {u.isPremium && (
                                        <span className="text-xs bg-yellow-900/40 text-yellow-400 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                          <Crown className="w-3 h-3" /> Premium
                                        </span>
                                      )}
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <AiScoreBar score={u.aiScore} />
                                  </TableCell>
                                  <TableCell className="text-slate-500 text-xs">
                                    {u.sourceGroupId}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                          {totalCollectedUserPages > 1 && (
                            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
                              <span className="text-sm text-slate-500">共 {totalCollectedUsers} 条，第 {collectedUserPage}/{totalCollectedUserPages} 页</span>
                              <div className="flex gap-2">
                                <Button size="sm" variant="ghost" disabled={collectedUserPage <= 1} onClick={() => setCollectedUserPage(p => p - 1)} className="text-slate-500">上一页</Button>
                                <Button size="sm" variant="ghost" disabled={collectedUserPage >= totalCollectedUserPages} onClick={() => setCollectedUserPage(p => p + 1)} className="text-slate-500">下一页</Button>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* ── 从群消息提取链接 Tab ── */}
        {activeTab === "extract" && (
          <div className="space-y-4">
            {/* 配置卡片 */}
            <Card className="bg-white border-slate-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-slate-900 text-base flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-orange-400" />
                  从群组历史消息中提取群链接
                </CardTitle>
                <p className="text-xs text-slate-500 mt-1">
                  扫描指定群组的历史消息，自动提取其中的 t.me 群组/频道链接，可批量导入监控池
                </p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  {/* 选择账号 */}
                  <div>
                    <label className="text-sm text-slate-600 block mb-1.5">选择 TG 账号</label>
                    <Select value={extractAccountId} onValueChange={setExtractAccountId}>
                      <SelectTrigger className="bg-slate-100 border-slate-200 text-slate-700">
                        <SelectValue placeholder="请选择账号" />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-slate-200">
                        {(Array.isArray(accounts) ? accounts : []).map((acc: any) => (
                          <SelectItem key={acc.id} value={String(acc.id)}>
                            {acc.phone || acc.tgUsername || `账号 #${acc.id}`}
                            {acc.tgUsername ? ` (@${acc.tgUsername})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-slate-500 mt-1">账号需已加入目标群组</p>
                  </div>

                  {/* 群组链接 */}
                  <div>
                    <label className="text-sm text-slate-600 block mb-1.5">目标群组链接</label>
                    <Input
                      value={extractGroupUrl}
                      onChange={e => setExtractGroupUrl(e.target.value)}
                      placeholder="https://t.me/+xxx 或 @username"
                      className="bg-slate-100 border-slate-200 text-slate-900"
                    />
                    <p className="text-xs text-slate-500 mt-1">支持邀请链接或 @用户名</p>
                  </div>

                  {/* 扫描消息数 */}
                  <div>
                    <label className="text-sm text-slate-600 block mb-1.5">最多扫描消息数</label>
                    <Select value={String(extractLimit)} onValueChange={v => setExtractLimit(parseInt(v))}>
                      <SelectTrigger className="bg-slate-100 border-slate-200 text-slate-700">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-slate-200">
                        <SelectItem value="200">200 条（快速）</SelectItem>
                        <SelectItem value="500">500 条（推荐）</SelectItem>
                        <SelectItem value="1000">1000 条</SelectItem>
                        <SelectItem value="2000">2000 条</SelectItem>
                        <SelectItem value="5000">5000 条（较慢）</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-slate-500 mt-1">消息越多耗时越长</p>
                  </div>
                </div>

                <Button
                  onClick={() => {
                    if (!extractAccountId) { toast.error("请选择 TG 账号"); return; }
                    if (!extractGroupUrl.trim()) { toast.error("请输入目标群组链接"); return; }
                    setExtractedLinks([]);
                    setExtractSelectedUrls(new Set());
                    extractFromGroup.mutate({
                      accountId: parseInt(extractAccountId),
                      groupUrl: extractGroupUrl.trim(),
                      limit: extractLimit,
                    });
                  }}
                  disabled={extractFromGroup.isPending}
                  className="bg-orange-600 hover:bg-orange-700 text-slate-900"
                >
                  {extractFromGroup.isPending ? (
                    <><Loader2 className="w-4 h-4 animate-spin mr-2" />扫描中，请稍候...</>
                  ) : (
                    <><Search className="w-4 h-4 mr-2" />开始扫描提取</>
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* 提取结果 */}
            {extractedLinks.length > 0 && (
              <Card className="bg-white border-slate-200">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-slate-900 text-base flex items-center gap-2">
                      <Link2 className="w-4 h-4 text-orange-400" />
                      提取结果
                      <span className="text-sm font-normal text-slate-500">
                        扫描 {extractScanned} 条消息，找到 {extractedLinks.length} 个群组链接
                      </span>
                    </CardTitle>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const lines = extractedLinks.map(l => l.url).join("\n");
                          const blob = new Blob([lines], { type: "text/plain;charset=utf-8" });
                          const a = document.createElement("a");
                          a.href = URL.createObjectURL(blob);
                          a.download = `tg_group_links_${Date.now()}.txt`;
                          a.click();
                          URL.revokeObjectURL(a.href);
                        }}
                        className="border-slate-300 text-slate-600 hover:text-slate-900 hover:bg-slate-200"
                      >
                        <FileText className="w-4 h-4 mr-1" />
                        导出 TXT
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const header = "url,type";
                          const rows = extractedLinks.map(l => {
                            const t = (l.url.includes("/+") || l.url.includes("/joinchat")) ? "私有邀请链接" : "公开用户名";
                            return `"${l.url}","${t}"`;
                          });
                          const csv = [header, ...rows].join("\n");
                          const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
                          const a = document.createElement("a");
                          a.href = URL.createObjectURL(blob);
                          a.download = `tg_group_links_${Date.now()}.csv`;
                          a.click();
                          URL.revokeObjectURL(a.href);
                        }}
                        className="border-slate-300 text-slate-600 hover:text-slate-900 hover:bg-slate-200"
                      >
                        <FileDown className="w-4 h-4 mr-1" />
                        导出 CSV
                      </Button>
                      {extractSelectedUrls.size > 0 && (
                        <Button
                          size="sm"
                          onClick={() => setExtractImportDialog(true)}
                          className="bg-green-700 hover:bg-green-600 text-slate-900"
                        >
                          <Download className="w-4 h-4 mr-1" />
                          导入选中 ({extractSelectedUrls.size})
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-slate-200">
                        <TableHead className="w-10">
                          <Checkbox
                            checked={extractSelectedUrls.size === extractedLinks.length && extractedLinks.length > 0}
                            onCheckedChange={toggleExtractSelectAll}
                            className="border-slate-300"
                          />
                        </TableHead>
                        <TableHead className="text-slate-500">群组链接</TableHead>
                        <TableHead className="text-slate-500">链接类型</TableHead>
                        <TableHead className="text-slate-500 text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {extractedLinks.map((link) => {
                        const isInvite = link.url.includes("/+") || link.url.includes("/joinchat");
                        return (
                          <TableRow key={link.url} className="border-slate-200 hover:bg-slate-50/80">
                            <TableCell>
                              <Checkbox
                                checked={extractSelectedUrls.has(link.url)}
                                onCheckedChange={() => toggleExtractSelect(link.url)}
                                className="border-slate-300"
                              />
                            </TableCell>
                            <TableCell className="font-mono text-sm">
                              <a
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-400 hover:text-blue-300 hover:underline"
                              >
                                {link.url}
                              </a>
                            </TableCell>
                            <TableCell>
                              <span className={`text-xs px-1.5 py-0.5 rounded ${
                                isInvite
                                  ? "bg-purple-900/40 text-purple-300"
                                  : "bg-slate-100 text-slate-600"
                              }`}>
                                {isInvite ? "私有邀请链接" : "公开用户名"}
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setExtractSelectedUrls(new Set([link.url]));
                                  setExtractImportDialog(true);
                                }}
                                className="text-green-400 hover:text-green-300 hover:bg-green-900/20 text-xs"
                              >
                                <Download className="w-3 h-3 mr-1" />
                                导入
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {/* 无结果提示 */}
            {!extractFromGroup.isPending && extractedLinks.length === 0 && extractScanned > 0 && (
              <div className="text-center py-12 text-slate-500">
                <Link2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p>未在该群组的 {extractScanned} 条消息中找到任何群组链接</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── 新建任务弹窗 ── */}
      <Dialog open={createDialog} onOpenChange={setCreateDialog}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-lg h-[85vh] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle>新建采集任务</DialogTitle>
            <DialogDescription className="text-slate-500">
              配置搜索关键词和过滤条件，引擎将自动搜索并采集符合条件的公开群组
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto min-h-0">
            <TaskForm
              taskName={taskName} setTaskName={setTaskName}
              taskKeywords={taskKeywords} setTaskKeywords={setTaskKeywords}
              taskKeywordInput={taskKeywordInput} setTaskKeywordInput={setTaskKeywordInput}
              taskMinMembers={taskMinMembers} setTaskMinMembers={setTaskMinMembers}
              taskMaxResults={taskMaxResults} setTaskMaxResults={setTaskMaxResults}
              fissionEnabled={fissionEnabled} setFissionEnabled={setFissionEnabled}
              fissionDepth={fissionDepth} setFissionDepth={setFissionDepth}
              fissionMaxPerSeed={fissionMaxPerSeed} setFissionMaxPerSeed={setFissionMaxPerSeed}
            />
          </div>
          <DialogFooter className="shrink-0">
            <Button variant="ghost" onClick={() => setCreateDialog(false)} className="text-slate-500">取消</Button>
            <Button
              onClick={() => createTask.mutate({
                name: taskName || "采集任务",
                keywords: taskKeywords,
                minMemberCount: taskMinMembers,
                maxResults: taskMaxResults,
                fissionEnabled,
                fissionDepth,
                fissionMaxPerSeed,
              })}
              disabled={createTask.isPending || taskKeywords.length === 0}
              className="bg-red-600 hover:bg-red-700 text-slate-900"
            >
              {createTask.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
              创建任务
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 编辑任务弹窗 ── */}
      <Dialog open={editDialog} onOpenChange={v => { setEditDialog(v); if (!v) setEditingTask(null); }}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-lg h-[85vh] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle>编辑采集任务</DialogTitle>
            <DialogDescription className="text-slate-500">
              修改任务配置后保存，下次触发时将使用新配置
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto min-h-0">
            <TaskForm
              taskName={editName} setTaskName={setEditName}
              taskKeywords={editKeywords} setTaskKeywords={setEditKeywords}
              taskKeywordInput={editKeywordInput} setTaskKeywordInput={setEditKeywordInput}
              taskMinMembers={editMinMembers} setTaskMinMembers={setEditMinMembers}
              taskMaxResults={editMaxResults} setTaskMaxResults={setEditMaxResults}
              fissionEnabled={editFissionEnabled} setFissionEnabled={setEditFissionEnabled}
              fissionDepth={editFissionDepth} setFissionDepth={setEditFissionDepth}
              fissionMaxPerSeed={editFissionMaxPerSeed} setFissionMaxPerSeed={setEditFissionMaxPerSeed}
            />
          </div>
          <DialogFooter className="shrink-0">
            <Button variant="ghost" onClick={() => { setEditDialog(false); setEditingTask(null); }} className="text-slate-500">取消</Button>
            <Button
              onClick={() => editingTask && updateTask.mutate({
                id: editingTask.id,
                name: editName || editingTask.name,
                keywords: editKeywords,
                minMemberCount: editMinMembers,
                maxResults: editMaxResults,
                fissionEnabled: editFissionEnabled,
                fissionDepth: editFissionDepth,
                fissionMaxPerSeed: editFissionMaxPerSeed,
              })}
              disabled={updateTask.isPending || editKeywords.length === 0}
              className="bg-blue-600 hover:bg-blue-700 text-slate-900"
            >
              {updateTask.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Pencil className="w-4 h-4 mr-1" />}
              保存修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 删除确认弹窗 ── */}
      <Dialog open={deleteTaskId !== null} onOpenChange={() => setDeleteTaskId(null)}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-sm">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription className="text-slate-500">
              删除任务将同时删除所有采集结果，此操作不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTaskId(null)} className="text-slate-500">取消</Button>
            <Button
              onClick={() => deleteTaskId && deleteTask.mutate({ id: deleteTaskId })}
              disabled={deleteTask.isPending}
              className="bg-red-600 hover:bg-red-700 text-slate-900"
            >
              {deleteTask.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Trash2 className="w-4 h-4 mr-1" />}
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 导入确认弹窗（采集结果）── */}
      <Dialog open={importConfirmDialog} onOpenChange={setImportConfirmDialog}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-sm">
          <DialogHeader>
            <DialogTitle>确认导入</DialogTitle>
            <DialogDescription className="text-slate-500">
              将选中的 <strong className="text-slate-900">{selectedIds.size}</strong> 个群组导入公共监控群组池，引擎将自动加入并开始监控。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setImportConfirmDialog(false)} className="text-slate-500">取消</Button>
            <Button
              onClick={() => importToPool.mutate({ resultIds: Array.from(selectedIds) })}
              disabled={importToPool.isPending}
              className="bg-green-700 hover:bg-green-600 text-slate-900"
            >
              {importToPool.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Download className="w-4 h-4 mr-1" />}
              确认导入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 导入采集群组到监控池弹窗 ── */}
      <Dialog open={importCollectedDialog} onOpenChange={setImportCollectedDialog}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-sm">
          <DialogHeader>
            <DialogTitle>导入到监控池</DialogTitle>
            <DialogDescription className="text-slate-500">
              将选中的 <strong className="text-slate-900">{selectedCollectedGroupIds.size}</strong> 个群组/频道导入公共监控群组池。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setImportCollectedDialog(false)} className="text-slate-500">取消</Button>
            <Button
              onClick={() => importCollectedGroups.mutate({ ids: Array.from(selectedCollectedGroupIds) })}
              disabled={importCollectedGroups.isPending}
              className="bg-green-700 hover:bg-green-600 text-slate-900"
            >
              {importCollectedGroups.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Download className="w-4 h-4 mr-1" />}
              确认导入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 导出用户列表弹窗 ── */}
      <Dialog open={exportUsersDialog} onOpenChange={setExportUsersDialog}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-lg">
          <DialogHeader>
            <DialogTitle>导出用户列表</DialogTitle>
            <DialogDescription className="text-slate-500">
              每行一个 @用户名，可直接复制使用
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              value={exportContent}
              readOnly
              className="bg-slate-100 border-slate-200 text-slate-900 text-sm h-48 font-mono resize-none"
            />
            <p className="text-xs text-slate-500">共 {exportContent.split("\n").filter(Boolean).length} 个用户</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setExportUsersDialog(false)} className="text-slate-500">关闭</Button>
            <Button
              onClick={() => {
                navigator.clipboard.writeText(exportContent);
                toast.success("已复制到剪贴板");
              }}
              className="bg-slate-200 hover:bg-slate-300 text-slate-900"
            >
              复制全部
            </Button>
            <Button
              onClick={downloadExportContent}
              className="bg-blue-600 hover:bg-blue-700 text-slate-900"
            >
              <FileDown className="w-4 h-4 mr-1" />
              下载 TXT
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 导入确认弹窗（提取的链接）── */}
      <Dialog open={extractImportDialog} onOpenChange={setExtractImportDialog}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-sm">
          <DialogHeader>
            <DialogTitle>确认导入群组链接</DialogTitle>
            <DialogDescription className="text-slate-500">
              将选中的 <strong className="text-slate-900">{extractSelectedUrls.size}</strong> 个群组链接导入公共监控群组池。
              <br />
              <span className="text-yellow-400 text-xs mt-1 block">注意：私有邀请链接（t.me/+xxx）需要账号先加入该群才能监控。</span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setExtractImportDialog(false)} className="text-slate-500">取消</Button>
            <Button
              onClick={() => {
                const chats = Array.from(extractSelectedUrls).map(url => {
                  const slug = url.replace(/^https?:\/\/t\.me\//, "").replace(/^@/, "");
                  return {
                    chatId: url,
                    title: url,
                    username: slug,
                    type: "supergroup",
                  };
                });
                importExtractedLinks.mutate({ chats });
              }}
              disabled={importExtractedLinks.isPending}
              className="bg-green-700 hover:bg-green-600 text-slate-900"
            >
              {importExtractedLinks.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Download className="w-4 h-4 mr-1" />}
              确认导入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}