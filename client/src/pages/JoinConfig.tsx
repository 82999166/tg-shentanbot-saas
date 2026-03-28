import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Settings2, Loader2, Info, Clock, Users, Zap } from "lucide-react";

export default function JoinConfig() {
  const [joinIntervalMin, setJoinIntervalMin] = useState(30);
  const [joinIntervalMax, setJoinIntervalMax] = useState(60);
  const [maxGroupsPerAccount, setMaxGroupsPerAccount] = useState(100);
  const [joinEnabled, setJoinEnabled] = useState(true);

  const { data: joinConfig, isLoading } = trpc.sysConfig.getJoinConfig.useQuery(undefined, {
    onSuccess: (data) => {
      if (data) {
        setJoinIntervalMin(data.joinIntervalMin);
        setJoinIntervalMax(data.joinIntervalMax);
        setMaxGroupsPerAccount(data.maxGroupsPerAccount);
        setJoinEnabled(data.joinEnabled);
      }
    },
  });

  const { data: groupStats } = trpc.sysConfig.getPublicGroups.useQuery();
  const totalCount = groupStats?.length ?? 0;
  const activeCount = groupStats?.filter((g: any) => g.isActive !== false).length ?? 0;

  const updateJoinConfig = trpc.sysConfig.updateJoinConfig.useMutation({
    onSuccess: () => {
      toast.success("自动加群配置已保存");
    },
    onError: (err) => {
      toast.error("保存失败：" + err.message);
    },
  });

  return (
    <DashboardLayout title="自动加群配置">
      <div className="p-6 max-w-2xl mx-auto space-y-6">
        {/* 说明卡片 */}
        <Card className="border-blue-200 bg-blue-50/50 dark:bg-blue-950/20 dark:border-blue-800">
          <CardContent className="pt-4 pb-4">
            <div className="flex gap-3">
              <Info className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
              <div className="space-y-1 text-sm text-blue-700 dark:text-blue-300">
                <p className="font-medium">功能说明</p>
                <p>引擎启动后，监控账号会自动加入公共群组列表中的所有群组，以便实时监控消息。</p>
                <p>建议设置合理的加群间隔（30-120 秒），避免账号因频繁操作被 Telegram 限制。</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 当前状态 */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4 pb-4 text-center">
              <div className="text-2xl font-bold text-foreground">{totalCount}</div>
              <div className="text-xs text-muted-foreground mt-1">公共群组总数</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 text-center">
              <div className="text-2xl font-bold text-green-500">{activeCount}</div>
              <div className="text-xs text-muted-foreground mt-1">活跃群组数</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 text-center">
              <div className="text-2xl font-bold text-foreground">
                {joinConfig ? `${joinConfig.joinIntervalMin}-${joinConfig.joinIntervalMax}s` : "30-60s"}
              </div>
              <div className="text-xs text-muted-foreground mt-1">当前加群间隔</div>
            </CardContent>
          </Card>
        </div>

        {/* 配置表单 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Settings2 className="h-5 w-5" /> 加群参数配置
            </CardTitle>
            <CardDescription>配置监控账号自动加入群组的行为规则</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* 启用开关 */}
            <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
              <div className="flex items-center gap-3">
                <Zap className="h-5 w-5 text-yellow-500" />
                <div>
                  <Label className="text-sm font-medium">启用自动加群</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">引擎启动时自动让监控账号加入所有公共群组</p>
                </div>
              </div>
              <Switch checked={joinEnabled} onCheckedChange={setJoinEnabled} />
            </div>

            {/* 加群间隔 */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <Label className="text-sm font-medium">加群间隔（秒）</Label>
              </div>
              <p className="text-xs text-muted-foreground">每次加群之间的随机等待时间，建议 30-120 秒防封号</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">最小间隔（秒）</Label>
                  <Input
                    type="number"
                    min={5}
                    max={3600}
                    value={joinIntervalMin}
                    onChange={(e) => setJoinIntervalMin(parseInt(e.target.value) || 30)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">最大间隔（秒）</Label>
                  <Input
                    type="number"
                    min={5}
                    max={3600}
                    value={joinIntervalMax}
                    onChange={(e) => setJoinIntervalMax(parseInt(e.target.value) || 60)}
                  />
                </div>
              </div>
            </div>

            {/* 每账号上限 */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <Label className="text-sm font-medium">每账号最多加入群组数</Label>
              </div>
              <p className="text-xs text-muted-foreground">单个监控账号最多加入的群组数量，超出部分由其他账号负责</p>
              <Input
                type="number"
                min={1}
                max={500}
                value={maxGroupsPerAccount}
                onChange={(e) => setMaxGroupsPerAccount(parseInt(e.target.value) || 100)}
              />
              <p className="text-xs text-muted-foreground">
                当前共 {totalCount} 个群组，建议每账号不超过 200 个
              </p>
            </div>

            {/* 保存按钮 */}
            <div className="pt-2">
              <Button
                className="w-full"
                onClick={() => updateJoinConfig.mutate({
                  joinIntervalMin,
                  joinIntervalMax,
                  maxGroupsPerAccount,
                  joinEnabled,
                })}
                disabled={updateJoinConfig.isPending}
              >
                {updateJoinConfig.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Settings2 className="h-4 w-4 mr-2" />}
                保存配置
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 操作提示 */}
        <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-800">
          <CardContent className="pt-4 pb-4">
            <div className="flex gap-3">
              <Info className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="space-y-1 text-sm text-amber-700 dark:text-amber-300">
                <p className="font-medium">操作提醒</p>
                <ul className="space-y-1 list-disc list-inside text-xs">
                  <li>修改配置后，引擎将在下次同步（约 30 秒）时自动应用新设置</li>
                  <li>如需立即生效，可在 TDLib 引擎管理页面手动重启引擎</li>
                  <li>Telegram 对频繁加群有限制，建议最小间隔不低于 30 秒</li>
                  <li>每账号加群数量建议不超过 200 个，避免账号被封</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
