import { useState } from "react";
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
import { Plus, Trash2, RefreshCw, Globe, CheckCircle2, XCircle, Users, Eye, ArrowUpFromLine, Zap, Upload, Download, Copy, FileText } from "lucide-react";

export default function AdminGroups() {
  const [addDialog, setAddDialog] = useState(false);
  const [batchDialog, setBatchDialog] = useState(false);
  const [exportDialog, setExportDialog] = useState(false);
  const [groupId, setGroupId] = useState("");
  const [groupTitle, setGroupTitle] = useState("");
  const [note, setNote] = useState("");
  const [viewStatusGroupId, setViewStatusGroupId] = useState<number | null>(null);

  // 批量导入状态
  const [batchText, setBatchText] = useState("");
  const [batchParsed, setBatchParsed] = useState<string[]>([]);
  const [batchStep, setBatchStep] = useState<"input" | "preview" | "done">("input");
  const [batchResult, setBatchResult] = useState<{ added: number; skipped: number; failed: number } | null>(null);
  const [batchProgress, setBatchProgress] = useState(0);
  const [isBatchRunning, setIsBatchRunning] = useState(false);

  // 导出状态
  const [onlyActive, setOnlyActive] = useState(true);
  const [copied, setCopied] = useState(false);

  const utils = trpc.useUtils();

  const { data: groups = [], isLoading, refetch } = trpc.sysConfig.getPublicGroups.useQuery();

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

  const triggerSync = trpc.sysConfig.triggerEngineSync.useMutation({
    onSuccess: () => {
      toast.success("已触发引擎立即同步，新群组将在几秒内开始监控");
    },
    onError: (e: { message: string }) => toast.error(`同步失败: ${e.message}`),
  });

  const activeGroups = groups.filter((g: { isActive: boolean }) => g.isActive);
  const inactiveGroups = groups.filter((g: { isActive: boolean }) => !g.isActive);

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
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4 mr-1" />
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
            <CardTitle className="text-base">公共群组池</CardTitle>
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>群组 ID</TableHead>
                    <TableHead>群组名称</TableHead>
                    <TableHead>备注</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>添加时间</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((group: any) => (
                    <TableRow key={group.id}>
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
            )}
          </CardContent>
        </Card>

        {/* 添加群组对话框 */}
        <Dialog open={addDialog} onOpenChange={setAddDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>添加公共监控群组</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
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
            <DialogFooter>
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

        {/* 批量导入对话框 */}
        <Dialog open={batchDialog} onOpenChange={(o) => { if (!o) closeBatchDialog(); }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Upload className="w-5 h-5 text-blue-400" />
                批量导入群组链接
              </DialogTitle>
              <DialogDescription>
                支持群组链接、@用户名、数字 ID，每行一个或逗号分隔，系统自动分配给系统 TG 账号进行加入
              </DialogDescription>
            </DialogHeader>

            {batchStep === "input" && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">群组链接列表</label>
                  <Textarea
                    placeholder={`每行一个，支持以下格式：\nhttps://t.me/groupname\n@groupusername\n-1001234567890\nt.me/groupname`}
                    value={batchText}
                    onChange={(e) => setBatchText(e.target.value)}
                    className="min-h-[200px] font-mono text-sm"
                  />
                  {batchText && (
                    <p className="text-xs text-green-400">
                      已输入 {batchText.split(/[\n,，;；\s]+/).filter(s => s.trim()).length} 行，点击预览查看识别结果
                    </p>
                  )}
                </div>
                <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground">支持的格式：</p>
                  <p>• Telegram 链接：https://t.me/groupname 或 t.me/groupname</p>
                  <p>• 用户名格式：@groupname</p>
                  <p>• 数字 ID：-1001234567890</p>
                  <p>• 分隔符：换行、逗号、分号均可</p>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={closeBatchDialog}>取消</Button>
                  <Button onClick={handleBatchPreview} disabled={!batchText.trim()}>
                    预览识别结果
                  </Button>
                </DialogFooter>
              </div>
            )}

            {batchStep === "preview" && (
              <div className="space-y-4">
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
                <DialogFooter>
                  <Button variant="outline" onClick={() => setBatchStep("input")} disabled={isBatchRunning}>
                    返回修改
                  </Button>
                  <Button onClick={handleBatchImport} disabled={isBatchRunning}>
                    {isBatchRunning ? `导入中 ${batchProgress}%...` : `确认导入 ${batchParsed.length} 个群组`}
                  </Button>
                </DialogFooter>
              </div>
            )}

            {batchStep === "done" && batchResult && (
              <div className="space-y-4">
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
                <DialogFooter>
                  <Button onClick={closeBatchDialog}>完成</Button>
                </DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* 导出群组链接对话框 */}
        <Dialog open={exportDialog} onOpenChange={setExportDialog}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Download className="w-5 h-5 text-cyan-400" />
                导出公共群组链接
              </DialogTitle>
              <DialogDescription>
                导出系统公共群组池中的所有群组链接，支持复制和下载
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
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
            <DialogFooter>
              <Button variant="outline" onClick={() => setExportDialog(false)}>关闭</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 账号加群状态对话框 */}
        <Dialog open={viewStatusGroupId !== null} onOpenChange={() => setViewStatusGroupId(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>账号加群状态</DialogTitle>
            </DialogHeader>
            <div className="py-2">
              {statusLoading ? (
                <div className="text-center py-6 text-muted-foreground">加载中...</div>
              ) : joinStatus.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">暂无监控账号</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>账号</TableHead>
                      <TableHead>Session 状态</TableHead>
                      <TableHead>加群状态</TableHead>
                      <TableHead>加入时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {joinStatus.map((s: any) => (
                      <TableRow key={s.accountId}>
                        <TableCell>
                          {s.tgUsername ? `@${s.tgUsername}` : s.phone || `ID:${s.accountId}`}
                        </TableCell>
                        <TableCell>
                          <Badge variant={s.sessionStatus === "active" ? "default" : "secondary"}>
                            {s.sessionStatus || "未知"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {s.joinStatus === "joined" ? (
                            <Badge className="bg-green-500/20 text-green-400 border-green-500/30">已加入</Badge>
                          ) : s.joinStatus === "failed" ? (
                            <Badge variant="destructive">失败</Badge>
                          ) : (
                            <Badge variant="secondary">待加入</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {s.joinedAt ? new Date(s.joinedAt).toLocaleString("zh-CN") : "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setViewStatusGroupId(null)}>关闭</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
