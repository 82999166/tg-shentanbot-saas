import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Bell,
  BellOff,
  Shield,
  Users,
  Ban,
  Trash2,
  RefreshCw,
  Save,
} from "lucide-react";

export default function PushSettings() {
  const utils = trpc.useUtils();

  const { data: settings, isLoading } = trpc.hitMessages.getPushSettings.useQuery();
  const { data: blocked, refetch: refetchBlocked } = trpc.hitMessages.blockedList.useQuery();

  const [pushEnabled, setPushEnabled] = useState(true);
  const [filterAds, setFilterAds] = useState(true);
  const [collaborationGroupId, setCollaborationGroupId] = useState("");
  const [collaborationGroupTitle, setCollaborationGroupTitle] = useState("");
  const [pushFormat, setPushFormat] = useState<"simple" | "standard" | "detailed">("standard");
  const [unblockDialog, setUnblockDialog] = useState<number | null>(null);

  // 加载已有设置
  useEffect(() => {
    if (settings) {
      setPushEnabled(settings.pushEnabled ?? true);
      setFilterAds(settings.filterAds ?? true);
      setCollaborationGroupId(settings.collaborationGroupId ?? "");
      setCollaborationGroupTitle(settings.collaborationGroupTitle ?? "");
      setPushFormat((settings.pushFormat as "simple" | "standard" | "detailed") ?? "standard");
    }
  }, [settings]);

  const saveSettings = trpc.hitMessages.savePushSettings.useMutation({
    onSuccess: () => {
      utils.hitMessages.getPushSettings.invalidate();
      toast.success("推送设置已保存");
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const unblockSender = trpc.hitMessages.unblockSender.useMutation({
    onSuccess: () => {
      utils.hitMessages.blockedList.invalidate();
      setUnblockDialog(null);
      toast.success("已解除屏蔽");
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });
  const getUnblockTarget = (id: number) => blockedRows.find(r => r.id === id)?.targetTgId ?? "";

  const blockedRows = (blocked ?? []) as Array<{
    id: number;
    targetTgId: string | null;
    targetUsername: string | null;
    reason: string | null;
    createdAt: Date;
  }>;

  return (
    <div className="p-6 space-y-6">
      {/* 页头 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">推送设置</h1>
          <p className="text-muted-foreground text-sm mt-1">
            配置推送开关、广告过滤、多人协作群组等选项
          </p>
        </div>
      </div>

      {/* 推送开关 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            {pushEnabled ? (
              <Bell className="h-5 w-5 text-green-500" />
            ) : (
              <BellOff className="h-5 w-5 text-muted-foreground" />
            )}
            推送开关
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
            <div>
              <div className="font-medium text-sm">启用关键词推送</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                关闭后，关键词命中时不会发送私信，但仍会记录命中消息
              </div>
            </div>
            <Switch
              checked={pushEnabled}
              onCheckedChange={setPushEnabled}
            />
          </div>

          {!pushEnabled && (
            <div className="flex items-center gap-2 p-3 bg-orange-50 border border-orange-200 rounded-lg text-sm text-orange-700">
              <BellOff className="h-4 w-4 flex-shrink-0" />
              推送已暂停。关键词命中的消息将只记录，不发送私信。
            </div>
          )}
        </CardContent>
      </Card>

      {/* 广告过滤 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-500" />
            广告过滤
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
            <div>
              <div className="font-medium text-sm">自动过滤广告账号</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                自动识别并跳过疑似广告账号（无用户名、消息含大量链接等特征），减少无效推送
              </div>
            </div>
            <Switch
              checked={filterAds}
              onCheckedChange={setFilterAds}
            />
          </div>
          <div className="text-xs text-muted-foreground bg-muted/20 p-3 rounded-lg">
            <strong>广告账号识别规则：</strong>
            <ul className="mt-1 space-y-0.5 list-disc list-inside">
              <li>消息中含有 3 个以上 URL 链接</li>
              <li>消息中含有 @频道 或 t.me/ 链接</li>
              <li>用户名为空且消息含有促销关键词</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* 推送格式 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">推送消息格式</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={pushFormat} onValueChange={(v) => setPushFormat(v as typeof pushFormat)}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="simple">简洁模式（仅用户名+消息）</SelectItem>
              <SelectItem value="standard">标准模式（含群组信息）</SelectItem>
              <SelectItem value="detailed">详细模式（含所有元数据）</SelectItem>
            </SelectContent>
          </Select>
          <div className="mt-3 text-xs text-muted-foreground">
            {pushFormat === "simple" && "Bot 推送格式：@用户名 在 [群组] 发送了消息：[内容]"}
            {pushFormat === "standard" && "Bot 推送格式：[群组名] | @用户名 | 关键词: [词] | 消息: [内容]"}
            {pushFormat === "detailed" && "Bot 推送格式：完整信息，包含 TG ID、发送时间、消息链接等"}
          </div>
        </CardContent>
      </Card>

      {/* 多人协作 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-5 w-5 text-purple-500" />
            多人协作推送群
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            配置一个 Telegram 群组，关键词命中时同时推送到该群组，方便团队成员协作处理线索。
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">群组 ID 或 @username</label>
              <Input
                placeholder="-100123456789 或 @myteam"
                value={collaborationGroupId}
                onChange={(e) => setCollaborationGroupId(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">群组显示名称（可选）</label>
              <Input
                placeholder="我的团队群"
                value={collaborationGroupTitle}
                onChange={(e) => setCollaborationGroupTitle(e.target.value)}
              />
            </div>
          </div>
          {collaborationGroupId && (
            <div className="flex items-center gap-2 p-2 bg-purple-50 border border-purple-200 rounded text-xs text-purple-700">
              <Users className="h-3.5 w-3.5" />
              已配置协作群：{collaborationGroupTitle || collaborationGroupId}
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1 text-xs ml-auto text-red-500"
                onClick={() => { setCollaborationGroupId(""); setCollaborationGroupTitle(""); }}
              >
                清除
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 保存按钮 */}
      <div className="flex justify-end">
        <Button
          onClick={() =>
            saveSettings.mutate({
              pushEnabled,
              filterAds,
              collaborationGroupId: collaborationGroupId || undefined,
              collaborationGroupTitle: collaborationGroupTitle || undefined,
              pushFormat,
            })
          }
          disabled={saveSettings.isPending || isLoading}
        >
          <Save className="h-4 w-4 mr-2" />
          保存设置
        </Button>
      </div>

      {/* 屏蔽列表 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Ban className="h-5 w-5 text-red-500" />
              屏蔽列表
              {blockedRows.length > 0 && (
                <Badge variant="secondary">{blockedRows.length} 人</Badge>
              )}
            </CardTitle>
            <Button variant="outline" size="sm" onClick={() => refetchBlocked()}>
              <RefreshCw className="h-4 w-4 mr-2" />刷新
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {blockedRows.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <Ban className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p>暂无屏蔽用户</p>
              <p className="text-xs mt-1">在「命中消息」页面点击屏蔽按钮可添加</p>
            </div>
          ) : (
            <div className="divide-y">
              <div className="flex items-center gap-3 px-4 py-2 bg-muted/30 text-xs text-muted-foreground">
                <span className="w-32">用户</span>
                <span className="flex-1">TG ID</span>
                <span className="flex-1">屏蔽原因</span>
                <span className="w-32">屏蔽时间</span>
                <span className="w-16">操作</span>
              </div>
              {blockedRows.map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-2 hover:bg-muted/20">
                  <div className="w-32 min-w-0">
                    <div className="font-medium text-sm truncate">
                      {r.targetUsername ? `@${r.targetUsername}` : r.targetTgId}
                    </div>
                  </div>
                  <div className="flex-1 text-xs text-muted-foreground">{r.targetTgId ?? "—"}</div>
                  <div className="flex-1 text-xs text-muted-foreground">
                    {r.reason ?? "—"}
                  </div>
                  <div className="w-32 text-xs text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString("zh-CN", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                  <div className="w-16">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-red-500"
                      onClick={() => setUnblockDialog(r.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" />解除
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 解除屏蔽确认 */}
      <Dialog open={!!unblockDialog} onOpenChange={() => setUnblockDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认解除屏蔽？</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            解除屏蔽后，该用户的消息将重新触发关键词推送。
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnblockDialog(null)}>取消</Button>
            <Button
              onClick={() => unblockDialog && unblockSender.mutate({ targetTgId: getUnblockTarget(unblockDialog) })}
              disabled={unblockSender.isPending}
            >
              确认解除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
