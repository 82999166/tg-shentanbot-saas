import AdminLayout from "@/components/AdminLayout";
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
  Activity,
  Ban,
  Trash2,
  RefreshCw,
  Save,
  Plus,
  Info,
  Send,
} from "lucide-react";

// 默认广告过滤规则
const DEFAULT_AD_RULES = [
  { id: "url_count", desc: "消息中含有 3 个以上 URL 链接", enabled: true },
  { id: "channel_link", desc: "消息中含有 @频道 或 t.me/ 链接", enabled: true },
  { id: "promo_keyword", desc: "用户名为空且消息含有促销关键词", enabled: true },
];

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

  // 广告过滤规则管理
  const [adRules, setAdRules] = useState(DEFAULT_AD_RULES);
  const [newRuleDesc, setNewRuleDesc] = useState("");
  const [addRuleDialog, setAddRuleDialog] = useState(false);

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

  function addAdRule() {
    if (!newRuleDesc.trim()) return;
    setAdRules(prev => [...prev, {
      id: `custom_${Date.now()}`,
      desc: newRuleDesc.trim(),
      enabled: true,
    }]);
    setNewRuleDesc("");
    setAddRuleDialog(false);
    toast.success("规则已添加（本地生效）");
  }

  function removeAdRule(id: string) {
    setAdRules(prev => prev.filter(r => r.id !== id));
  }

  function toggleAdRule(id: string) {
    setAdRules(prev => prev.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));
  }

  return (
    <AdminLayout title="推送设置">
    <div className="p-6 space-y-6">
      {/* 页头 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">推送设置</h1>
          <p className="text-muted-foreground text-sm mt-1">
            配置推送开关、广告过滤规则、系统状态推送等选项
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

      {/* 广告过滤规则管理 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-5 w-5 text-blue-500" />
              广告过滤规则
              <Badge variant="secondary">{adRules.filter(r => r.enabled).length} 条启用</Badge>
            </CardTitle>
            <div className="flex items-center gap-2">
              <Switch
                checked={filterAds}
                onCheckedChange={setFilterAds}
              />
              <span className="text-xs text-muted-foreground">{filterAds ? "过滤已开启" : "过滤已关闭"}</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            自动识别并跳过疑似广告账号，减少无效推送。可自定义添加识别规则，每条规则满足任一条件即触发过滤。
          </p>

          {/* 规则列表 */}
          <div className="space-y-2">
            {adRules.map((rule) => (
              <div
                key={rule.id}
                className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                  rule.enabled ? "border-blue-500/30 bg-blue-500/5" : "border-border bg-muted/20 opacity-60"
                }`}
              >
                <Switch
                  checked={rule.enabled}
                  onCheckedChange={() => toggleAdRule(rule.id)}
                  className="shrink-0"
                />
                <span className="flex-1 text-sm">{rule.desc}</span>
                {!rule.id.startsWith("url_count") && !rule.id.startsWith("channel_link") && !rule.id.startsWith("promo_keyword") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                    onClick={() => removeAdRule(rule.id)}
                    title="删除规则"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>

          <Button
            variant="outline"
            size="sm"
            className="w-full border-dashed"
            onClick={() => setAddRuleDialog(true)}
          >
            <Plus className="h-4 w-4 mr-1" />
            添加自定义过滤规则
          </Button>

          <div className="flex items-start gap-2 p-3 bg-muted/20 rounded-lg text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>默认3条规则为系统内置规则，不可删除，仅可启用/禁用。自定义规则为描述性标签，实际过滤逻辑由后端代码实现后生效。</span>
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

      {/* 系统运行状态推送 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-5 w-5 text-green-500" />
            系统运行状态推送
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            配置一个管理员 Telegram 账号，系统将定时推送运行状态报告（TG 账号数量、监控群组数、未监控群组数等）到该账号。
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">推送目标 TG ID 或 @username</label>
              <Input
                placeholder="-100123456789 或 @admin_username"
                value={collaborationGroupId}
                onChange={(e) => setCollaborationGroupId(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">备注名称（可选）</label>
              <Input
                placeholder="管理员频道"
                value={collaborationGroupTitle}
                onChange={(e) => setCollaborationGroupTitle(e.target.value)}
              />
            </div>
          </div>
          {collaborationGroupId && (
            <div className="flex items-center gap-2 p-2 bg-green-500/10 border border-green-500/30 rounded text-xs text-green-400">
              <Send className="h-3.5 w-3.5" />
              状态推送目标：{collaborationGroupTitle || collaborationGroupId}
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
          <div className="bg-muted/20 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">推送内容包含：</p>
            <p>• 当前运行中的 TG 账号数量（活跃 / 总数）</p>
            <p>• 正在监控的群组数量</p>
            <p>• 未加入/未监控的群组数量</p>
            <p>• 今日命中消息数量</p>
            <p>• 推送频率：每天定时推送（可在系统设置中调整频率）</p>
          </div>
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
              刷词用户屏蔽列表
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
          <div className="px-4 py-3 bg-amber-500/10 border-b border-amber-500/20 text-xs text-amber-400 flex items-start gap-2">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              <strong>什么是刷词用户？</strong> 指在群组中频繁发送含有关键词的广告/骚扰消息的账号。
              屏蔽后，该用户的消息将不再触发关键词推送。可在「命中消息」页面点击屏蔽按钮将用户加入此列表。
            </span>
          </div>
          {blockedRows.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <Ban className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p>暂无屏蔽用户</p>
              <p className="text-xs mt-1">在「命中消息」页面点击屏蔽按钮可将刷词用户加入此列表</p>
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

      {/* 添加自定义规则对话框 */}
      <Dialog open={addRuleDialog} onOpenChange={setAddRuleDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加自定义过滤规则</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">规则描述</label>
              <Input
                placeholder="例如：消息中含有「加我」等引流词"
                value={newRuleDesc}
                onChange={(e) => setNewRuleDesc(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addAdRule(); }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              规则描述仅作为标签显示，实际过滤逻辑需在后端代码中实现。添加后可随时启用/禁用。
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddRuleDialog(false)}>取消</Button>
            <Button onClick={addAdRule} disabled={!newRuleDesc.trim()}>添加规则</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
    </AdminLayout>
  );
}
