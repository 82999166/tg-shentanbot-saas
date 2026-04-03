import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
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
import { toast } from "sonner";
import { Plus, Trash2, RefreshCw, Globe, CheckCircle2, XCircle, Users, Eye, ArrowUpFromLine, Zap, Upload, Download, Copy, FileText, File, Smartphone, Search, UserPlus, Loader2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

export default function AdminGroups() {
  const [addDialog, setAddDialog] = useState(false);
  const [batchDialog, setBatchDialog] = useState(false);
  const [exportDialog, setExportDialog] = useState(false);
  const [groupId, setGroupId] = useState("");
  const [groupTitle, setGroupTitle] = useState("");
  const [note, setNote] = useState("");
  const [viewStatusGroupId, setViewStatusGroupId] = useState<number | null>(null);

  // 批量导入状态
  const [batchTab, setBatchTab] = useState<"paste" | "file">("paste");
  const [batchText, setBatchText] = useState("");
  const [batchParsed, setBatchParsed] = useState<string[]>([]);
  const [batchStep, setBatchStep] = useState<"input" | "preview" | "done">("input");
  const [batchResult, setBatchResult] = useState<{ added: number; skipped: number; failed: number } | null>(null);
  const [batchProgress, setBatchProgress] = useState(0);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [fileInfo, setFileInfo] = useState<{ name: string; count: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 从TG账号导入状态
  const [accountImportDialog, setAccountImportDialog] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [accountChats, setAccountChats] = useState<Array<{ chatId: string; title: string; username: string; type: string }>>([]);
  const [accountChatsLoading, setAccountChatsLoading] = useState(false);
  const [selectedChatIds, setSelectedChatIds] = useState<Set<string>>(new Set());
  const [chatSearchText, setChatSearchText] = useState("");
  const [accountImportStep, setAccountImportStep] = useState<"select" | "choose" | "done">("select");
  const [accountImportResult, setAccountImportResult] = useState<{ added: number; skipped: number } | null>(null);

  // 一键加群状态
  const [joinGroupDialog, setJoinGroupDialog] = useState(false);
  const [joinSelectedAccountIds, setJoinSelectedAccountIds] = useState<Set<number>>(new Set());
  const [joinIntervalMin, setJoinIntervalMin] = useState(30);
  const [joinIntervalMax, setJoinIntervalMax] = useState(60);
  const [joinRunning, setJoinRunning] = useState(false);
  const [joinResult, setJoinResult] = useState<{ joined: number; failed: number; skipped: number; results: Array<{ account_id: number; group_id: string; status: string; reason?: string }> } | null>(null);
  const [joinProgress, setJoinProgress] = useState<{ current: number; total: number; currentGroup: string } | null>(null);

  // 导出状态
  const [onlyActive, setOnlyActive] = useState(true);
  const [copied, setCopied] = useState(false);
  // 批量删除状态
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const utils = trpc.useUtils();

  const { data: groups = [], isLoading, isRefetching, refetch } = trpc.sysConfig.getPublicGroups.useQuery();
  const { data: accountsData } = trpc.tgAccounts.list.useQuery();
  const tgAccounts = (Array.isArray(accountsData) ? accountsData : accountsData?.accounts) ?? [];

  const getAccountChatsMut = trpc.tgAccounts.getAccountChats.useMutation();
  const importChatsToPublicMut = trpc.tgAccounts.importChatsToPublic.useMutation();

  const { data: exportData, isLoading: exportLoading, refetch: refetchExport } = trpc.sysConfig.exportPublicGroupLinks.useQuery(
    { onlyActive, format: "links" },
    { enabled: exportDialog, refetchOnWindowFocus: false }
  );

  const { data: joinStatus = [], isLoading: statusLoading } =
    trpc.sysConfig.getPublicGroupJoinStatus.useQuery(
      { publicGroupId: viewStatusGroupId! },
      { enabled: viewStatusGroupId !== null }
    );

  const addGroup = trpc.sysConfig.addPublicGroup.useMutation({
    onSuccess: (res: { isNew: boolean }) => {
      utils.sysConfig.getPublicGroups.invalidate();
      setAddDialog(false);
      setGroupId("");
      setGroupTitle("");
      setNote("");
      toast.success(res.isNew ? "群组已添加到公共池" : "群组已重新激活");
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const addGroupMut = trpc.sysConfig.addPublicGroup.useMutation();

  const batchRemoveGroups = trpc.sysConfig.batchRemovePublicGroups.useMutation({
    onSuccess: (data) => {
      toast.success(`已删除 ${data.deleted} 个群组`);
      setSelectedIds([]);
      refetch();
    },
    onError: (err) => toast.error("批量删除失败: " + err.message),
  });

  const removeGroup = trpc.sysConfig.removePublicGroup.useMutation({
    onSuccess: () => {
      utils.sysConfig.getPublicGroups.invalidate();
      toast.success("群组已从公共池移除");
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const toggleGroup = trpc.sysConfig.updatePublicGroup.useMutation({
    onSuccess: () => {
      utils.sysConfig.getPublicGroups.invalidate();
      toast.success("状态已更新");
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const syncPrivate = trpc.sysConfig.syncPrivateToPublic.useMutation({
    onSuccess: (res: { added: number; skipped: number }) => {
      utils.sysConfig.getPublicGroups.invalidate();
      if (res.added > 0) {
        toast.success(`同步完成：新增 ${res.added} 个群组，跳过 ${res.skipped} 个（已存在）`);
      } else {
        toast.info(`没有新群组需要同步（${res.skipped} 个已存在）`);
      }
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const batchJoinMut = trpc.engine.batchJoinGroups.useMutation();

  async function handleBatchJoin() {
    if (joinSelectedAccountIds.size === 0) { toast.error("请至少选择一个账号"); return; }
    setJoinRunning(true);
    setJoinResult(null);
    setJoinProgress({ current: 0, total: 0, currentGroup: '正在连接引擎，执行加群操作...' });
    try {
      const res = await batchJoinMut.mutateAsync({
        accountIds: Array.from(joinSelectedAccountIds),
        intervalMin: joinIntervalMin,
        intervalMax: joinIntervalMax,
      });
      setJoinProgress(null);
      setJoinResult(res);
      toast.success(`加群完成：成功 ${res.joined}，跳过 ${res.skipped}，失败 ${res.failed}`);
    } catch (e: any) {
      setJoinProgress(null);
      toast.error("加群失败: " + e.message);
    } finally {
      setJoinRunning(false);
    }
  }

  function closeJoinGroupDialog() {
    setJoinGroupDialog(false);
    setJoinSelectedAccountIds(new Set());
    setJoinResult(null);
    setJoinRunning(false);
    setJoinProgress(null);
  }

  const triggerSync = trpc.sysConfig.triggerEngineSync.useMutation({
    onSuccess: () => {
      toast.success("已触发引擎立即同步，新群组将在几秒内开始监控");
    },
    onError: (e: { message: string }) => toast.error(`同步失败: ${e.message}`),
  });

  // 从TG账号导入：加载群组列表
  async function handleLoadAccountChats() {
    if (!selectedAccountId) return;
    setAccountChatsLoading(true);
    setAccountChats([]);
    setSelectedChatIds(new Set());
    try {
      const res = await getAccountChatsMut.mutateAsync({ id: Number(selectedAccountId) });
      setAccountChats(res.chats);
      setAccountImportStep("choose");
    } catch (e: any) {
      toast.error("获取群组列表失败: " + e.message);
    } finally {
      setAccountChatsLoading(false);
    }
  }

  async function handleImportSelectedChats() {
    const selected = accountChats.filter(c => selectedChatIds.has(c.chatId));
    if (selected.length === 0) { toast.error("请至少选择一个群组"); return; }
    try {
      const res = await importChatsToPublicMut.mutateAsync({ chats: selected });
      setAccountImportResult({ added: res.added, skipped: res.skipped });
      setAccountImportStep("done");
      utils.sysConfig.getPublicGroups.invalidate();
      toast.success(res.message);
    } catch (e: any) {
      toast.error("导入失败: " + e.message);
    }
  }

  function closeAccountImportDialog() {
    setAccountImportDialog(false);
    setSelectedAccountId("");
    setAccountChats([]);
    setSelectedChatIds(new Set());
    setChatSearchText("");
    setAccountImportStep("select");
    setAccountImportResult(null);
  }

  const filteredAccountChats = accountChats.filter(c =>
    !chatSearchText || c.title.toLowerCase().includes(chatSearchText.toLowerCase()) || c.username.toLowerCase().includes(chatSearchText.toLowerCase())
  );

  const activeGroups = groups.filter((g: { isActive: boolean }) => g.isActive);
  const inactiveGroups = groups.filter((g: { isActive: boolean }) => !g.isActive);

  // 加入状态筛选 & 搜索
  const [joinFilter, setJoinFilter] = useState<"all" | "joined" | "not_joined" | "failed">("all");
  const [groupSearch, setGroupSearch] = useState("");
  const filteredGroups = groups.filter((g: any) => {
    if (groupSearch) {
      const q = groupSearch.toLowerCase();
      if (!((g.groupId || "").toLowerCase().includes(q) || (g.groupTitle || "").toLowerCase().includes(q) || (g.note || "").toLowerCase().includes(q))) {
        return false;
      }
    }
    const accounts: Array<{ accountId: number; accountName: string; status: string }> = g.joinedAccounts || [];
    const isJoined = (s: string) => s === "joined" || s === "subscribed";
    const isFailed = (s: string) => s === "failed" || s === "not_found";
    if (joinFilter === "joined") return accounts.some((a: any) => isJoined(a.status));
    if (joinFilter === "failed") return accounts.some((a: any) => isFailed(a.status));
    if (joinFilter === "not_joined") return accounts.length === 0 || accounts.every((a: any) => !isJoined(a.status) && !isFailed(a.status));
    return true;
  });

  // 解析批量输入文本
  function parseBatchText(text: string): string[] {
    return text
      .split(/[\n,，;；\s]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .filter(s =>
        s.startsWith("-") ||           // 数字ID: -1001234567890
        s.startsWith("@") ||           // @username
        s.startsWith("https://t.me/") || // t.me 链接
        s.startsWith("http://t.me/") ||
        s.startsWith("t.me/") ||
        /^\d+$/.test(s)               // 纯数字
      );
  }

  // 处理文件上传
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setBatchText(text);
      const count = parseBatchText(text).length;
      setFileInfo({ name: file.name, count });
      toast.success(`已读取文件「${file.name}」，识别到 ${count} 个群组链接`);
    };
    reader.readAsText(file, "utf-8");
  }

  function handleBatchPreview() {
    const parsed = parseBatchText(batchText);
    if (parsed.length === 0) {
      toast.error("未识别到有效的群组链接或 ID，请检查格式");
      return;
    }
    setBatchParsed(parsed);
    setBatchStep("preview");
  }

  async function handleBatchImport() {
    if (batchParsed.length === 0) return;
    setIsBatchRunning(true);
    setBatchProgress(0);
    let added = 0, skipped = 0, failed = 0;
    for (let i = 0; i < batchParsed.length; i++) {
      try {
        const res = await addGroupMut.mutateAsync({ groupId: batchParsed[i] });
        if (res.isNew) added++; else skipped++;
      } catch {
        failed++;
      }
      setBatchProgress(Math.round(((i + 1) / batchParsed.length) * 100));
    }
    utils.sysConfig.getPublicGroups.invalidate();
    setBatchResult({ added, skipped, failed });
    setBatchStep("done");
    setIsBatchRunning(false);
    toast.success(`批量导入完成：新增 ${added}，跳过 ${skipped}，失败 ${failed}`);
  }

  function closeBatchDialog() {
    setBatchDialog(false);
    setBatchText("");
    setBatchParsed([]);
    setBatchStep("input");
    setBatchResult(null);
    setBatchProgress(0);
    setBatchTab("paste");
    setFileInfo(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // 导出功能
  const exportGroups = exportData?.groups ?? [];
  const filteredExportGroups = exportGroups.filter((g: any) => onlyActive ? g.isActive !== false : true);
  const allLinks = filteredExportGroups.map((g: any) => g.link).join("\n");

  const copyLinks = async () => {
    await navigator.clipboard.writeText(allLinks);
    setCopied(true);
    toast.success(`已复制 ${filteredExportGroups.length} 个群组链接`);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadTxt = () => {
    const content = filteredExportGroups
      .map((g: any) => `${g.groupTitle}\t${g.link}`)
      .join("\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `公共群组链接_${new Date().toLocaleDateString("zh-CN").replace(/\//g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("已下载 TXT 文件");
  };

  const downloadCsv = () => {
    const header = "群组名称,链接,类型,备注\n";
    const rows = filteredExportGroups
      .map((g: any) => `"${g.groupTitle}","${g.link}","${g.groupType ?? ""}","${g.note ?? ""}"`)
      .join("\n");
    const blob = new Blob(["\uFEFF" + header + rows], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `公共群组链接_${new Date().toLocaleDateString("zh-CN").replace(/\//g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("已下载 CSV 文件");
  };

  return (
    <AdminLayout>
      <div className="p-6 space-y-6">
        {/* 页头 */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Globe className="w-6 h-6 text-primary" />
              公共群组管理
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              管理平台系统账号监控的公共群组池，所有会员的关键词均在这些群组中生效
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
              <RefreshCw className={`w-4 h-4 mr-1 ${isRefetching ? 'animate-spin' : ''}`} />
              刷新
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExportDialog(true)}
            >
              <Download className="w-4 h-4 mr-1" />
              导出群组链接
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (confirm("将「群组监控」中的所有私有群组一键同步到公共群组池？\n已存在的群组将自动跳过。")) {
                  syncPrivate.mutate();
                }
              }}
              disabled={syncPrivate.isPending}
            >
              <ArrowUpFromLine className="w-4 h-4 mr-1" />
              {syncPrivate.isPending ? "同步中..." : "同步私有群组"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => triggerSync.mutate()}
              disabled={triggerSync.isPending}
              title="通知引擎立即重新解析所有公共群组 ID，添加新群组后使用"
            >
              <Zap className="w-4 h-4 mr-1" />
              {triggerSync.isPending ? "同步中..." : "立即同步引擎"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setBatchDialog(true)}>
              <Upload className="w-4 h-4 mr-1" />
              批量导入
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAccountImportDialog(true)}>
              <Smartphone className="w-4 h-4 mr-1" />
              从TG账号导入
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setJoinGroupDialog(true)}
              className="border-orange-500/50 text-orange-400 hover:bg-orange-500/10"
            >
              <UserPlus className="w-4 h-4 mr-1" />
              一键加群
            </Button>
            <Button size="sm" onClick={() => setAddDialog(true)}>
              <Plus className="w-4 h-4 mr-1" />
              添加群组
            </Button>
          </div>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-500/10 rounded-lg">
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{activeGroups.length}</p>
                  <p className="text-sm text-muted-foreground">活跃监控群组</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-red-500/10 rounded-lg">
                  <XCircle className="w-5 h-5 text-red-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{inactiveGroups.length}</p>
                  <p className="text-sm text-muted-foreground">已禁用群组</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/10 rounded-lg">
                  <Users className="w-5 h-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{groups.length}</p>
                  <p className="text-sm text-muted-foreground">群组总数</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 群组列表 */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <CardTitle className="text-base">公共群组池</CardTitle>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    placeholder="搜索群组..."
                    value={groupSearch}
                    onChange={e => setGroupSearch(e.target.value)}
                    className="pl-8 h-8 w-44 text-sm"
                  />
                </div>
                <Select value={joinFilter} onValueChange={(v: any) => setJoinFilter(v)}>
                  <SelectTrigger className="h-8 w-36 text-sm">
                    <SelectValue placeholder="加入状态" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部</SelectItem>
                    <SelectItem value="joined">已有账号加入</SelectItem>
                    <SelectItem value="not_joined">未加入</SelectItem>
                    <SelectItem value="failed">加入失败</SelectItem>
                  </SelectContent>
                </Select>
                {(groupSearch || joinFilter !== "all") && (
                  <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => { setGroupSearch(""); setJoinFilter("all"); }}>
                    清除筛选
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">加载中...</div>
            ) : groups.length === 0 ? (
              <div className="text-center py-12">
                <Globe className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-muted-foreground">暂无公共群组</p>
                <p className="text-sm text-muted-foreground mt-1">点击"添加群组"或"批量导入"开始配置监控群组池</p>
                <div className="flex gap-2 justify-center mt-4">
                  <Button onClick={() => setAddDialog(true)}>
                    <Plus className="w-4 h-4 mr-1" />
                    添加群组
                  </Button>
                  <Button variant="outline" onClick={() => setBatchDialog(true)}>
                    <Upload className="w-4 h-4 mr-1" />
                    批量导入
                  </Button>
                </div>
              </div>
            ) : (
              <>
              {selectedIds.length > 0 && (
                <div className="flex items-center gap-3 px-4 py-2 mb-2 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                  <span className="text-sm text-blue-400">已选择 <strong>{selectedIds.length}</strong> 个群组</span>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      if (confirm(`确认删除选中的 ${selectedIds.length} 个群组？
此操作不可恢复，关联的关键词配置也将一并删除。`)) {
                        batchRemoveGroups.mutate({ ids: selectedIds });
                      }
                    }}
                    disabled={batchRemoveGroups.isPending}
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    {batchRemoveGroups.isPending ? "删除中..." : "批量删除"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>
                    取消选择
                  </Button>
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={groups.length > 0 && selectedIds.length === groups.length}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedIds(groups.map((g: any) => g.id));
                          } else {
                            setSelectedIds([]);
                          }
                        }}
                      />
                    </TableHead>
                    <TableHead>群组 ID</TableHead>
                    <TableHead>群组名称</TableHead>
                    <TableHead>备注</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>已加入账号</TableHead>
                    <TableHead>添加时间</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredGroups.map((group: any) => (
                    <TableRow key={group.id} className={selectedIds.includes(group.id) ? "bg-blue-500/5" : ""}>
                      <TableCell className="w-10">
                        <Checkbox
                          checked={selectedIds.includes(group.id)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedIds(prev => [...prev, group.id]);
                            } else {
                              setSelectedIds(prev => prev.filter(id => id !== group.id));
                            }
                          }}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {group.groupId}
                      </TableCell>
                      <TableCell>{group.groupTitle || "-"}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {(group as any).note || "-"}
                      </TableCell>
                      <TableCell>
                        {group.isActive ? (
                          <Badge variant="default" className="bg-green-500/20 text-green-400 border-green-500/30">
                            活跃
                          </Badge>
                        ) : (
                          <Badge variant="secondary">已禁用</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const accounts: Array<{ accountId: number; accountName: string; status: string }> = group.joinedAccounts || [];
                          if (accounts.length === 0) return <span className="text-muted-foreground text-xs">-</span>;
                          const MAX_SHOW = 2;
                          const shown = accounts.slice(0, MAX_SHOW);
                          const rest = accounts.length - MAX_SHOW;
                          return (
                            <div className="flex flex-wrap gap-1">
                              {shown.map((a: any) => (
                                <Badge
                                  key={a.accountId}
                                  variant="outline"
                                  className={`text-xs px-1.5 py-0 ${
                                    (a.status === "joined" || a.status === "subscribed")
                                      ? "border-green-500/40 text-green-400 bg-green-500/10"
                                      : (a.status === "failed" || a.status === "not_found")
                                      ? "border-red-500/40 text-red-400 bg-red-500/10"
                                      : "border-yellow-500/40 text-yellow-400 bg-yellow-500/10"
                                  }`}
                                >
                                  {a.accountName}
                                </Badge>
                              ))}
                              {rest > 0 && (
                                <Badge variant="outline" className="text-xs px-1.5 py-0 text-muted-foreground">
                                  +{rest}
                                </Badge>
                              )}
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {group.createdAt ? new Date(group.createdAt).toLocaleDateString("zh-CN") : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setViewStatusGroupId(group.id)}
                            title="查看账号加群状态"
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              toggleGroup.mutate({ id: group.id, isActive: !group.isActive })
                            }
                            title={group.isActive ? "禁用" : "启用"}
                          >
                            {group.isActive ? (
                              <XCircle className="w-4 h-4 text-yellow-500" />
                            ) : (
                              <CheckCircle2 className="w-4 h-4 text-green-500" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (confirm(`确认删除公共群组「${group.groupTitle || group.groupId}」？\n此操作不可恢复，关联的关键词配置也将一并删除。`)) {
                                removeGroup.mutate({ id: group.id });
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </>
            )}
          </CardContent>
        </Card>

        {/* 添加群组对话框 */}
        <Dialog open={addDialog} onOpenChange={setAddDialog}>
          <DialogContent className="max-h-[90vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>添加公共监控群组</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2 overflow-y-auto flex-1">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">群组 ID / 链接 <span className="text-destructive">*</span></label>
                <Input
                  placeholder="例如：-1001234567890 或 @groupusername 或 https://t.me/xxx"
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  支持数字 ID、@用户名、t.me 链接格式
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">群组名称</label>
                <Input
                  placeholder="群组显示名称（可选）"
                  value={groupTitle}
                  onChange={(e) => setGroupTitle(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">备注</label>
                <Input
                  placeholder="内部备注（可选）"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter className="shrink-0">
              <Button variant="outline" onClick={() => setAddDialog(false)}>取消</Button>
              <Button
                onClick={() => {
                  if (!groupId.trim()) {
                    toast.error("请输入群组 ID 或链接");
                    return;
                  }
                  addGroup.mutate({
                    groupId: groupId.trim(),
                    groupTitle: groupTitle.trim() || undefined,
                    note: note.trim() || undefined,
                  });
                }}
                disabled={addGroup.isPending}
              >
                {addGroup.isPending ? "添加中..." : "添加群组"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 从TG账号导入对话框 */}
        <Dialog open={accountImportDialog} onOpenChange={(o) => { if (!o) closeAccountImportDialog(); }}>
          <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
            <DialogHeader className="shrink-0">
              <DialogTitle className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-green-400" />
                从TG账号导入群组
              </DialogTitle>
              <DialogDescription>
                选择一个TG账号，读取该账号已加入的群组，勾选需要监控的群组导入到公共群组池
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto min-h-0 space-y-4">
              {accountImportStep === "select" && (
                <div className="space-y-4 py-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">选择TG账号</label>
                    <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                      <SelectTrigger>
                        <SelectValue placeholder="请选择一个TG账号" />
                      </SelectTrigger>
                      <SelectContent>
                        {tgAccounts.map((acc: any) => (
                          <SelectItem key={acc.id} value={String(acc.id)}>
                            {acc.username ? `@${acc.username}` : acc.phone} {acc.sessionStatus === "active" ? "✓" : "(离线)"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground">
                    <p>选择账号后，系统将从引擎读取该账号已加入的所有群组（超级群组、频道等），您可以从中勾选要加入公共群组池的群组。</p>
                  </div>
                </div>
              )}

              {accountImportStep === "choose" && (
                <div className="space-y-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">共 {accountChats.length} 个群组，已选 {selectedChatIds.size} 个</span>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setSelectedChatIds(new Set(filteredAccountChats.map(c => c.chatId)))}>
                        全选
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setSelectedChatIds(new Set())}>
                        清空
                      </Button>
                    </div>
                  </div>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      className="w-full pl-9 pr-3 py-2 text-sm bg-muted/30 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder="搜索群组名称或用户名..."
                      value={chatSearchText}
                      onChange={e => setChatSearchText(e.target.value)}
                    />
                  </div>
                  <div className="border border-border rounded-lg overflow-hidden">
                    <div className="max-h-80 overflow-y-auto">
                      {filteredAccountChats.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground text-sm">没有找到匹配的群组</div>
                      ) : (
                        <table className="w-full text-sm">
                          <thead className="bg-muted/50 sticky top-0">
                            <tr>
                              <th className="w-10 px-3 py-2"></th>
                              <th className="text-left px-3 py-2">群组名称</th>
                              <th className="text-left px-3 py-2">用户名</th>
                              <th className="text-left px-3 py-2">类型</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredAccountChats.map(chat => (
                              <tr
                                key={chat.chatId}
                                className="border-t border-border hover:bg-muted/20 cursor-pointer"
                                onClick={() => {
                                  const next = new Set(selectedChatIds);
                                  if (next.has(chat.chatId)) next.delete(chat.chatId); else next.add(chat.chatId);
                                  setSelectedChatIds(next);
                                }}
                              >
                                <td className="px-3 py-2">
                                  <Checkbox checked={selectedChatIds.has(chat.chatId)} onCheckedChange={() => {}} />
                                </td>
                                <td className="px-3 py-2 font-medium">{chat.title}</td>
                                <td className="px-3 py-2 text-muted-foreground font-mono text-xs">{chat.username ? `@${chat.username}` : chat.chatId}</td>
                                <td className="px-3 py-2">
                                  <Badge variant="outline" className="text-xs">{chat.type}</Badge>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {accountImportStep === "done" && accountImportResult && (
                <div className="py-8 text-center space-y-3">
                  <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto" />
                  <p className="text-lg font-semibold">导入完成</p>
                  <p className="text-sm text-muted-foreground">
                    新增 <strong className="text-green-400">{accountImportResult.added}</strong> 个群组，
                    跳过 <strong className="text-muted-foreground">{accountImportResult.skipped}</strong> 个（已存在）
                  </p>
                </div>
              )}
            </div>

            <DialogFooter className="shrink-0 border-t border-border pt-4 mt-2">
              {accountImportStep === "select" && (
                <>
                  <Button variant="outline" onClick={closeAccountImportDialog}>取消</Button>
                  <Button onClick={handleLoadAccountChats} disabled={!selectedAccountId || accountChatsLoading}>
                    {accountChatsLoading ? "读取中..." : "读取群组列表"}
                  </Button>
                </>
              )}
              {accountImportStep === "choose" && (
                <>
                  <Button variant="outline" onClick={() => setAccountImportStep("select")}>返回</Button>
                  <Button onClick={handleImportSelectedChats} disabled={selectedChatIds.size === 0 || importChatsToPublicMut.isPending}>
                    {importChatsToPublicMut.isPending ? "导入中..." : `导入选中的 ${selectedChatIds.size} 个群组`}
                  </Button>
                </>
              )}
              {accountImportStep === "done" && (
                <Button onClick={closeAccountImportDialog}>完成</Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 批量导入对话框 */}
        <Dialog open={batchDialog} onOpenChange={(o) => { if (!o) closeBatchDialog(); }}>
          <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
            <DialogHeader className="shrink-0">
              <DialogTitle className="flex items-center gap-2">
                <Upload className="w-5 h-5 text-blue-400" />
                批量导入群组链接
              </DialogTitle>
              <DialogDescription>
                支持群组链接、@用户名、数字 ID，每行一个或逗号分隔，系统自动分配给系统 TG 账号进行加入
              </DialogDescription>
            </DialogHeader>

            {/* 内容区域：可滚动 */}
            <div className="flex-1 overflow-y-auto min-h-0">
              {batchStep === "input" && (
                <div className="space-y-4 pb-2">
                  {/* Tab 切换：粘贴 / 文件 */}
                  <div className="flex border border-border rounded-lg overflow-hidden">
                    <button
                      className={`flex-1 py-2 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors ${batchTab === "paste" ? "bg-primary text-primary-foreground" : "hover:bg-muted/50 text-muted-foreground"}`}
                      onClick={() => { setBatchTab("paste"); setFileInfo(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                    >
                      <FileText className="w-4 h-4" />
                      粘贴链接
                    </button>
                    <button
                      className={`flex-1 py-2 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors ${batchTab === "file" ? "bg-primary text-primary-foreground" : "hover:bg-muted/50 text-muted-foreground"}`}
                      onClick={() => setBatchTab("file")}
                    >
                      <File className="w-4 h-4" />
                      文件导入
                    </button>
                  </div>

                  {batchTab === "paste" ? (
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">群组链接列表</label>
                      <Textarea
                        placeholder={`每行一个，支持以下格式：\nhttps://t.me/groupname\n@groupusername\n-1001234567890\nt.me/groupname`}
                        value={batchText}
                        onChange={(e) => setBatchText(e.target.value)}
                        className="min-h-[180px] max-h-[300px] font-mono text-sm resize-y"
                      />
                      {batchText && (
                        <p className="text-xs text-green-400">
                          已输入 {batchText.split(/[\n,，;；\s]+/).filter(s => s.trim()).length} 行，点击预览查看识别结果
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <label className="text-sm font-medium">选择文件</label>
                      <div
                        className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/20 transition-colors"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <File className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
                        <p className="text-sm font-medium">点击选择文件或拖拽到此处</p>
                        <p className="text-xs text-muted-foreground mt-1">支持 .txt、.csv 格式，每行一个群组链接</p>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".txt,.csv,.text"
                          className="hidden"
                          onChange={handleFileChange}
                        />
                      </div>
                      {fileInfo && (
                        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 flex items-center gap-3">
                          <FileText className="w-5 h-5 text-green-400 shrink-0" />
                          <div>
                            <p className="text-sm font-medium text-green-400">{fileInfo.name}</p>
                            <p className="text-xs text-muted-foreground">识别到 {fileInfo.count} 个有效群组链接</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
                    <p className="font-medium text-foreground">支持的格式：</p>
                    <p>• Telegram 链接：https://t.me/groupname 或 t.me/groupname</p>
                    <p>• 用户名格式：@groupname</p>
                    <p>• 数字 ID：-1001234567890</p>
                    <p>• 分隔符：换行、逗号、分号均可</p>
                  </div>
                </div>
              )}

              {batchStep === "preview" && (
                <div className="space-y-4 pb-2">
                  <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                    <p className="text-sm font-medium text-blue-400">
                      识别到 {batchParsed.length} 个群组，确认后开始批量添加
                    </p>
                  </div>
                  <div className="max-h-60 overflow-y-auto space-y-1 border border-border rounded-lg p-2">
                    {batchParsed.map((id, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm px-2 py-1 rounded hover:bg-muted/30">
                        <span className="text-muted-foreground w-6 text-right shrink-0">{i + 1}.</span>
                        <span className="font-mono">{id}</span>
                      </div>
                    ))}
                  </div>
                  {isBatchRunning && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>正在导入...</span>
                        <span>{batchProgress}%</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div
                          className="bg-blue-500 h-2 rounded-full transition-all"
                          style={{ width: `${batchProgress}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {batchStep === "done" && batchResult && (
                <div className="space-y-4 pb-2">
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3">
                      <p className="text-2xl font-bold text-green-400">{batchResult.added}</p>
                      <p className="text-xs text-muted-foreground mt-1">新增成功</p>
                    </div>
                    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                      <p className="text-2xl font-bold text-yellow-400">{batchResult.skipped}</p>
                      <p className="text-xs text-muted-foreground mt-1">已存在跳过</p>
                    </div>
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                      <p className="text-2xl font-bold text-red-400">{batchResult.failed}</p>
                      <p className="text-xs text-muted-foreground mt-1">导入失败</p>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground text-center">
                    新增的群组已加入公共池，系统 TG 账号将自动申请加入这些群组
                  </p>
                </div>
              )}
            </div>

            {/* Footer 固定在底部，不随内容滚动 */}
            <DialogFooter className="shrink-0 border-t border-border pt-4 mt-2">
              {batchStep === "input" && (
                <>
                  <Button variant="outline" onClick={closeBatchDialog}>取消</Button>
                  <Button onClick={handleBatchPreview} disabled={!batchText.trim()}>
                    预览识别结果
                  </Button>
                </>
              )}
              {batchStep === "preview" && (
                <>
                  <Button variant="outline" onClick={() => setBatchStep("input")} disabled={isBatchRunning}>
                    返回修改
                  </Button>
                  <Button onClick={handleBatchImport} disabled={isBatchRunning}>
                    {isBatchRunning ? `导入中 ${batchProgress}%...` : `确认导入 ${batchParsed.length} 个群组`}
                  </Button>
                </>
              )}
              {batchStep === "done" && (
                <Button onClick={closeBatchDialog}>完成</Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 导出群组链接对话框 */}
        <Dialog open={exportDialog} onOpenChange={setExportDialog}>
          <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
            <DialogHeader className="shrink-0">
              <DialogTitle className="flex items-center gap-2">
                <Download className="w-5 h-5 text-cyan-400" />
                导出公共群组链接
              </DialogTitle>
              <DialogDescription>
                导出系统公共群组池中的所有群组链接，支持复制和下载
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 flex-1 overflow-y-auto min-h-0">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={onlyActive}
                    onChange={(e) => setOnlyActive(e.target.checked)}
                    className="rounded"
                  />
                  仅导出活跃群组
                </label>
                <span className="text-xs text-muted-foreground">
                  共 {exportLoading ? "..." : filteredExportGroups.length} 个群组
                </span>
                <Button variant="ghost" size="sm" onClick={() => refetchExport()}>
                  <RefreshCw className="w-3.5 h-3.5" />
                </Button>
              </div>

              {exportLoading ? (
                <div className="text-center py-8 text-muted-foreground">加载中...</div>
              ) : (
                <>
                  <div className="border border-border rounded-lg overflow-hidden">
                    <div className="max-h-64 overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>群组名称</TableHead>
                            <TableHead>链接</TableHead>
                            <TableHead>状态</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredExportGroups.map((g: any, i: number) => (
                            <TableRow key={i}>
                              <TableCell className="text-sm">{g.groupTitle}</TableCell>
                              <TableCell className="font-mono text-xs text-blue-400">{g.link}</TableCell>
                              <TableCell>
                                <Badge variant="default" className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
                                  活跃
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>

                  <div className="flex gap-2 flex-wrap">
                    <Button variant="outline" size="sm" onClick={copyLinks} disabled={filteredExportGroups.length === 0}>
                      <Copy className="w-4 h-4 mr-1" />
                      {copied ? "已复制！" : `复制 ${filteredExportGroups.length} 个链接`}
                    </Button>
                    <Button variant="outline" size="sm" onClick={downloadTxt} disabled={filteredExportGroups.length === 0}>
                      <FileText className="w-4 h-4 mr-1" />
                      下载 TXT
                    </Button>
                    <Button variant="outline" size="sm" onClick={downloadCsv} disabled={filteredExportGroups.length === 0}>
                      <Download className="w-4 h-4 mr-1" />
                      下载 CSV
                    </Button>
                  </div>
                </>
              )}
            </div>
            <DialogFooter className="shrink-0">
              <Button variant="outline" onClick={() => setExportDialog(false)}>关闭</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 账号加群状态对话框 */}
        <Dialog open={viewStatusGroupId !== null} onOpenChange={() => setViewStatusGroupId(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
            <DialogHeader className="shrink-0">
              <DialogTitle>账号加群状态</DialogTitle>
            </DialogHeader>
            <div className="py-2 flex-1 overflow-y-auto min-h-0">
              {statusLoading ? (
                <div className="text-center py-6 text-muted-foreground">加载中...</div>
              ) : joinStatus.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">暂无监控账号</div>
              ) : (
<Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>账号</TableHead>
                      <TableHead>Session</TableHead>
                      <TableHead>加群状态</TableHead>
                      <TableHead>加入时间</TableHead>
                      <TableHead>最新日志</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {joinStatus.map((s: any) => (
                      <TableRow key={s.accountId}>
                        <TableCell className="font-medium">
                          <div>{s.tgUsername ? `@${s.tgUsername}` : s.phone || `ID:${s.accountId}`}</div>
                          {s.assignedAccountId === s.accountId && (
                            <div className="text-xs text-orange-400 mt-0.5">已分配</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={s.sessionStatus === "active" ? "default" : "secondary"} className="text-xs">
                            {s.sessionStatus || "未知"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {s.joinStatus === "subscribed" || s.joinStatus === "joined" ? (
                            <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">已加入</Badge>
                          ) : s.joinStatus === "failed" ? (
                            <div>
                              <Badge variant="destructive" className="text-xs">失败</Badge>
                              {s.errorMsg && <div className="text-xs text-red-400 mt-0.5 max-w-[120px] truncate" title={s.errorMsg}>{s.errorMsg}</div>}
                            </div>
                          ) : s.joinStatus === "joining" ? (
                            <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">加入中</Badge>
                          ) : s.joinStatus === "skipped" ? (
                            <Badge variant="outline" className="text-xs">已跳过</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">待加入</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {s.joinedAt ? new Date(s.joinedAt).toLocaleString("zh-CN") : "-"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[160px]">
                          {s.joinLog && s.joinLog.length > 0 ? (
                            <div className="space-y-0.5">
                              {s.joinLog.slice(-2).map((log: any, i: number) => (
                                <div key={i} className="truncate" title={`${log.time ? new Date(log.time).toLocaleString('zh-CN') : ''}: ${log.msg}`}>
                                  <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${
                                    log.status === 'subscribed' || log.status === 'joined' ? 'bg-green-400' :
                                    log.status === 'failed' ? 'bg-red-400' :
                                    log.status === 'joining' ? 'bg-blue-400' : 'bg-gray-400'
                                  }`} />
                                  {log.msg}
                                </div>
                              ))}
                            </div>
                          ) : "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
            <DialogFooter className="shrink-0">
              <Button variant="outline" onClick={() => setViewStatusGroupId(null)}>关闭</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      {/* 一键加群 Dialog */}
      <Dialog open={joinGroupDialog} onOpenChange={(open) => { if (!open) closeJoinGroupDialog(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-orange-400" />
              一键加群
            </DialogTitle>
            <DialogDescription>
              选择要执行加群的 TG 账号，系统将自动让这些账号加入所有尚未加入的公共群组。
              加群间隔遵循防封配置，请耐心等待。
            </DialogDescription>
          </DialogHeader>

          {/* 加群中进度显示 */}
          {joinRunning && (
            <div className="bg-muted/30 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 animate-spin text-orange-400 shrink-0" />
                <div>
                  <p className="text-sm font-medium">{joinProgress?.currentGroup || '正在执行加群操作...'}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">引擎正在处理，请耐心等待（每次加群间隔 {joinIntervalMin}–{joinIntervalMax} 秒）</p>
                </div>
              </div>
              {/* 连续动画进度条 */}
              <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                <div className="bg-orange-500 h-1.5 rounded-full animate-[progress-indeterminate_1.5s_ease-in-out_infinite]" style={{ width: '40%', animation: 'indeterminate 1.5s ease-in-out infinite' }} />
              </div>
              <style>{`@keyframes indeterminate { 0% { transform: translateX(-100%); width: 40%; } 50% { width: 60%; } 100% { transform: translateX(300%); width: 40%; } }`}</style>
            </div>
          )}

          {!joinResult ? (
            <div className="space-y-4">
              {/* 账号选择 */}
              <div>
                <p className="text-sm font-medium mb-2">选择执行账号（可多选）</p>
                <div className="max-h-48 overflow-y-auto border border-border rounded-lg divide-y divide-border">
                  {tgAccounts.length === 0 ? (
                    <div className="text-center py-4 text-sm text-muted-foreground">暂无可用账号</div>
                  ) : (
                    tgAccounts.map((acc: any) => (
                      <label key={acc.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/50">
                        <Checkbox
                          checked={joinSelectedAccountIds.has(acc.id)}
                          onCheckedChange={(checked) => {
                            const next = new Set(joinSelectedAccountIds);
                            if (checked) next.add(acc.id); else next.delete(acc.id);
                            setJoinSelectedAccountIds(next);
                          }}
                          disabled={joinRunning}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{acc.phone || acc.tgUsername || `ID:${acc.id}`}</p>
                          {acc.tgUsername && <p className="text-xs text-muted-foreground">@{acc.tgUsername}</p>}
                        </div>
                        <Badge variant={acc.sessionStatus === 'active' ? 'default' : 'secondary'} className="text-xs shrink-0">
                          {acc.sessionStatus === 'active' ? '在线' : '离线'}
                        </Badge>
                      </label>
                    ))
                  )}
                </div>
                <div className="flex gap-2 mt-1">
                  <Button variant="ghost" size="sm" className="text-xs h-6" onClick={() => setJoinSelectedAccountIds(new Set(tgAccounts.map((a: any) => a.id)))} disabled={joinRunning}>全选</Button>
                  <Button variant="ghost" size="sm" className="text-xs h-6" onClick={() => setJoinSelectedAccountIds(new Set())} disabled={joinRunning}>取消全选</Button>
                  <span className="text-xs text-muted-foreground ml-auto self-center">已选 {joinSelectedAccountIds.size} 个账号</span>
                </div>
              </div>

              {/* 加群间隔 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">最小间隔（秒）</p>
                  <input
                    type="number"
                    min={5}
                    max={300}
                    value={joinIntervalMin}
                    onChange={(e) => setJoinIntervalMin(Number(e.target.value))}
                    disabled={joinRunning}
                    className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                  />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">最大间隔（秒）</p>
                  <input
                    type="number"
                    min={5}
                    max={600}
                    value={joinIntervalMax}
                    onChange={(e) => setJoinIntervalMax(Number(e.target.value))}
                    disabled={joinRunning}
                    className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                  />
                </div>
              </div>

              <div className="text-xs text-muted-foreground bg-muted/30 rounded-lg p-3">
                <p>⚠️ 注意事项：</p>
                <ul className="mt-1 space-y-1 list-disc list-inside">
                  <li>已加入的群组将自动跳过，不会重复加入</li>
                  <li>私密群（邀请链接）需要有效的邀请链接才能加入</li>
                  <li>加群间隔建议设置 30-60 秒，避免账号被限制</li>
                  <li>群组数量较多时，此操作可能需要较长时间</li>
                </ul>
              </div>
            </div>
          ) : (
            /* 结果展示 */
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center p-3 bg-green-500/10 rounded-lg">
                  <p className="text-2xl font-bold text-green-400">{joinResult.joined}</p>
                  <p className="text-xs text-muted-foreground mt-1">成功加入</p>
                </div>
                <div className="text-center p-3 bg-yellow-500/10 rounded-lg">
                  <p className="text-2xl font-bold text-yellow-400">{joinResult.skipped}</p>
                  <p className="text-xs text-muted-foreground mt-1">已跳过</p>
                </div>
                <div className="text-center p-3 bg-red-500/10 rounded-lg">
                  <p className="text-2xl font-bold text-red-400">{joinResult.failed}</p>
                  <p className="text-xs text-muted-foreground mt-1">失败</p>
                </div>
              </div>
              {joinResult.results.length > 0 && (
                <div className="max-h-48 overflow-y-auto border border-border rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2">账号</th>
                        <th className="text-left px-3 py-2">群组</th>
                        <th className="text-left px-3 py-2">结果</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {joinResult.results.map((r, i) => (
                        <tr key={i}>
                          <td className="px-3 py-1.5 text-muted-foreground">
                            {tgAccounts.find((a: any) => a.id === r.account_id)?.phone || `ID:${r.account_id}`}
                          </td>
                          <td className="px-3 py-1.5 font-mono truncate max-w-[120px]">{r.group_id}</td>
                          <td className="px-3 py-1.5">
                            {r.status === 'joined' ? (
                              <span className="text-green-400">✓ 已加入</span>
                            ) : r.status === 'skipped' ? (
                              <span className="text-yellow-400">→ 跳过</span>
                            ) : (
                              <span className="text-red-400" title={r.reason}>✗ 失败</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            {!joinResult ? (
              <>
                <Button variant="outline" onClick={closeJoinGroupDialog}>{joinRunning ? '关闭（后台继续）' : '取消'}</Button>
                <Button
                  onClick={handleBatchJoin}
                  disabled={joinRunning || joinSelectedAccountIds.size === 0}
                  className="bg-orange-500 hover:bg-orange-600 text-white"
                >
                  {joinRunning ? (
                    <><Loader2 className="w-4 h-4 mr-1 animate-spin" />加群中...</>
                  ) : (
                    <><UserPlus className="w-4 h-4 mr-1" />开始加群</>
                  )}
                </Button>
              </>
            ) : (
              <Button onClick={closeJoinGroupDialog}>关闭</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      </div>
    </AdminLayout>
  );
}
