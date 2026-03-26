import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
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
import { Plus, Trash2, RefreshCw, Globe, CheckCircle2, XCircle, Users, Eye, ArrowUpFromLine, Zap } from "lucide-react";

export default function AdminGroups() {
  const [addDialog, setAddDialog] = useState(false);
  const [groupId, setGroupId] = useState("");
  const [groupTitle, setGroupTitle] = useState("");
  const [note, setNote] = useState("");
  const [viewStatusGroupId, setViewStatusGroupId] = useState<number | null>(null);

  const utils = trpc.useUtils();

  const { data: groups = [], isLoading, refetch } = trpc.sysConfig.getPublicGroups.useQuery();

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

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* 页头 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Globe className="w-6 h-6 text-primary" />
              公共群组管理
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              管理平台系统账号监控的公共群组池，所有会员的关键词均在这些群组中生效
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4 mr-1" />
              刷新
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
              {syncPrivate.isPending ? "同步中..." : "一键同步私有群组"}
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
                <p className="text-sm text-muted-foreground mt-1">点击"添加群组"开始配置监控群组池</p>
                <Button className="mt-4" onClick={() => setAddDialog(true)}>
                  <Plus className="w-4 h-4 mr-1" />
                  添加第一个群组
                </Button>
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
                <label className="text-sm font-medium">群组 ID <span className="text-destructive">*</span></label>
                <Input
                  placeholder="例如：-1001234567890 或 @groupusername"
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  数字格式（-1001234567890）或用户名格式（@username）均可
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
                    toast.error("请输入群组 ID");
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
    </DashboardLayout>
  );
}
