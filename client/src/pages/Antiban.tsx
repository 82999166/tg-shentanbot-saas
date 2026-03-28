import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Shield, ShieldCheck, ShieldAlert, Clock, Zap, Globe, AlertTriangle, Filter } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";

export default function Antiban() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const { data: settings } = trpc.antiban.get.useQuery();
  const updateMut = trpc.antiban.update.useMutation({
    onSuccess: () => { utils.antiban.get.invalidate(); toast.success("防封策略已保存"); },
    onError: (err: any) => toast.error(err.message),
  });

  // 管理员：全局消息过滤配置
  const { data: filterConfigs } = trpc.systemConfig.getAll.useQuery(undefined, { enabled: isAdmin });
  const updateConfigMut = trpc.systemConfig.update.useMutation({
    onSuccess: () => { utils.systemConfig.getAll.invalidate(); },
    onError: (err: any) => toast.error(err.message),
  });

  const [filterForm, setFilterForm] = useState({
    global_filter_ads: false,
    global_filter_bot: true,
    global_max_msg_length: 500,
    global_rate_window: 60,
    global_rate_limit: 5,
  });

  useEffect(() => {
    if (filterConfigs) {
      const get = (key: string) => filterConfigs.find((c: any) => c.key === key)?.value ?? "";
      setFilterForm({
        global_filter_ads: get("global_filter_ads") === "true",
        global_filter_bot: get("global_filter_bot") !== "false",
        global_max_msg_length: parseInt(get("global_max_msg_length") || "500", 10),
        global_rate_window: parseInt(get("global_rate_window") || "60", 10),
        global_rate_limit: parseInt(get("global_rate_limit") || "5", 10),
      });
    }
  }, [filterConfigs]);

  const saveFilterConfig = async () => {
    const entries = [
      { key: "global_filter_ads", value: String(filterForm.global_filter_ads) },
      { key: "global_filter_bot", value: String(filterForm.global_filter_bot) },
      { key: "global_max_msg_length", value: String(filterForm.global_max_msg_length) },
      { key: "global_rate_window", value: String(filterForm.global_rate_window) },
      { key: "global_rate_limit", value: String(filterForm.global_rate_limit) },
    ];
    try {
      for (const entry of entries) {
        await updateConfigMut.mutateAsync(entry);
      }
      toast.success("消息过滤规则已保存");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const [form, setForm] = useState({
    dailyDmLimit: 30,
    minIntervalSeconds: 60,
    maxIntervalSeconds: 180,
    activeHourStart: 9,
    activeHourEnd: 22,
    deduplicateEnabled: true,
    deduplicateWindowHours: 24,
    dmEnabled: false,
    templateRotation: true,
    autoDegrade: true,
  });
  useEffect(() => {
    if (settings) {
      setForm({
        dailyDmLimit: settings.dailyDmLimit ?? 30,
        minIntervalSeconds: settings.minIntervalSeconds ?? 60,
        maxIntervalSeconds: settings.maxIntervalSeconds ?? 180,
        activeHourStart: settings.activeHourStart ?? 9,
        activeHourEnd: settings.activeHourEnd ?? 22,
        deduplicateEnabled: settings.deduplicateEnabled ?? true,
        deduplicateWindowHours: settings.deduplicateWindowHours ?? 24,
        dmEnabled: settings.dmEnabled ?? false,
        templateRotation: settings.templateRotation ?? true,
        autoDegrade: settings.autoDegrade ?? true,
      });
    }
  }, [settings]);
  const riskLevel = form.dailyDmLimit <= 20 ? "low" : form.dailyDmLimit <= 40 ? "medium" : "high";
  const riskConfig = {
    low: { label: "低风险", color: "text-emerald-400", bg: "bg-emerald-900/30 border-emerald-800", icon: ShieldCheck },
    medium: { label: "中等风险", color: "text-amber-400", bg: "bg-amber-900/30 border-amber-800", icon: Shield },
    high: { label: "高风险", color: "text-red-400", bg: "bg-red-900/30 border-red-800", icon: ShieldAlert },
  };
  const risk = riskConfig[riskLevel];
  const RiskIcon = risk.icon;
  return (
    <AppLayout title="防封策略">
      <div className="p-6 space-y-6">

        {/* ── 管理员专属：全局消息过滤规则 ── */}
        {isAdmin && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Filter className="w-4 h-4 text-blue-400" />
              <h2 className="text-sm font-semibold text-blue-400">全局消息过滤规则（管理员统一配置，对所有用户生效）</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 防 Bot 广告 */}
              <Card className="bg-card border-border">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Shield className="w-4 h-4 text-blue-400" /> 防 Bot 广告
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-xs font-medium">过滤 Bot 账号消息</Label>
                      <p className="text-xs text-muted-foreground">自动忽略来自 Bot 账号（is_bot=true）的消息</p>
                    </div>
                    <Switch
                      checked={filterForm.global_filter_bot}
                      onCheckedChange={(v) => setFilterForm({ ...filterForm, global_filter_bot: v })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-xs font-medium">过滤广告内容</Label>
                      <p className="text-xs text-muted-foreground">过滤包含大量链接/表情的广告类消息</p>
                    </div>
                    <Switch
                      checked={filterForm.global_filter_ads}
                      onCheckedChange={(v) => setFilterForm({ ...filterForm, global_filter_ads: v })}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* 防长内容广告 */}
              <Card className="bg-card border-border">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Zap className="w-4 h-4 text-amber-400" /> 防长内容广告
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">消息字符数上限（0=不限制）</Label>
                    <Input
                      type="number"
                      value={filterForm.global_max_msg_length}
                      onChange={(e) => setFilterForm({ ...filterForm, global_max_msg_length: parseInt(e.target.value) || 0 })}
                      className="bg-background border-border mt-1"
                      min={0} max={5000}
                    />
                    <p className="text-xs text-muted-foreground mt-1">超过此字数的消息将被忽略，推荐 500 字</p>
                  </div>
                </CardContent>
              </Card>

              {/* 防刷屏 */}
              <Card className="bg-card border-border md:col-span-2">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Clock className="w-4 h-4 text-red-400" /> 防刷屏
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground mb-3">同一用户在指定时间窗口内发送超过上限条数的消息，后续消息自动忽略（0=不限制）</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">时间窗口（秒）</Label>
                      <Input
                        type="number"
                        value={filterForm.global_rate_window}
                        onChange={(e) => setFilterForm({ ...filterForm, global_rate_window: parseInt(e.target.value) || 0 })}
                        className="bg-background border-border mt-1"
                        min={0} max={3600}
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">窗口内最大消息数</Label>
                      <Input
                        type="number"
                        value={filterForm.global_rate_limit}
                        onChange={(e) => setFilterForm({ ...filterForm, global_rate_limit: parseInt(e.target.value) || 0 })}
                        className="bg-background border-border mt-1"
                        min={0} max={100}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    示例：窗口=60秒，上限=5条，即同一用户 60 秒内发超过 5 条消息时自动忽略
                  </p>
                </CardContent>
              </Card>
            </div>
            <div className="flex justify-end">
              <Button onClick={saveFilterConfig} disabled={updateConfigMut.isPending} variant="outline" className="border-blue-600 text-blue-400 hover:bg-blue-900/20">
                {updateConfigMut.isPending ? "保存中..." : "保存消息过滤规则"}
              </Button>
            </div>
            <hr className="border-border" />
          </div>
        )}

        {/* 风险评估 */}
        <div className={`flex items-center gap-4 p-4 rounded-xl border ${risk.bg}`}>
          <RiskIcon className={`w-8 h-8 ${risk.color}`} />
          <div>
            <p className={`font-semibold ${risk.color}`}>当前配置：{risk.label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {riskLevel === "low" && "当前配置较为保守，账号安全性高，适合长期稳定运营"}
              {riskLevel === "medium" && "当前配置适中，建议配合优质账号和代理使用"}
              {riskLevel === "high" && "当前配置较激进，封号风险较高，请确保账号质量和代理稳定"}
            </p>
          </div>
        </div>
        {/* DM 总开关 */}
        <div className="flex items-center justify-between p-4 bg-card border border-border rounded-xl">
          <div>
            <p className="font-medium text-sm">自动私信功能</p>
            <p className="text-xs text-muted-foreground">关闭后系统将停止向目标用户发送私信</p>
          </div>
          <Switch checked={form.dmEnabled} onCheckedChange={(v) => setForm({ ...form, dmEnabled: v })} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 发送频率控制 */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary" /> 发送频率控制
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <Label className="text-xs text-muted-foreground">每日私信上限（条）</Label>
                <div className="flex items-center gap-3 mt-2">
                  <Slider
                    value={[form.dailyDmLimit]}
                    onValueChange={([v]) => setForm({ ...form, dailyDmLimit: v })}
                    min={0} max={100} step={5}
                    className="flex-1"
                  />
                  <span className="text-sm font-mono w-8 text-right">{form.dailyDmLimit}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">最小间隔（秒）</Label>
                  <Input
                    type="number"
                    value={form.minIntervalSeconds}
                    onChange={(e) => setForm({ ...form, minIntervalSeconds: parseInt(e.target.value) || 60 })}
                    className="bg-background border-border mt-1"
                    min={10} max={300}
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">最大间隔（秒）</Label>
                  <Input
                    type="number"
                    value={form.maxIntervalSeconds}
                    onChange={(e) => setForm({ ...form, maxIntervalSeconds: parseInt(e.target.value) || 180 })}
                    className="bg-background border-border mt-1"
                    min={30} max={600}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
          {/* 活跃时间窗口 */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" /> 活跃时间窗口
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <p className="text-xs text-muted-foreground">只在指定时间段内发送私信，模拟真人操作节奏</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">开始时间（时）</Label>
                  <Input
                    type="number"
                    value={form.activeHourStart}
                    onChange={(e) => setForm({ ...form, activeHourStart: parseInt(e.target.value) || 9 })}
                    className="bg-background border-border mt-1"
                    min={0} max={23}
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">结束时间（时）</Label>
                  <Input
                    type="number"
                    value={form.activeHourEnd}
                    onChange={(e) => setForm({ ...form, activeHourEnd: parseInt(e.target.value) || 22 })}
                    className="bg-background border-border mt-1"
                    min={0} max={23}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                将在 {form.activeHourStart}:00 - {form.activeHourEnd}:00 之间发送私信
              </p>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs font-medium">自动降级</Label>
                  <p className="text-xs text-muted-foreground">账号健康度过低时自动暂停</p>
                </div>
                <Switch checked={form.autoDegrade} onCheckedChange={(v) => setForm({ ...form, autoDegrade: v })} />
              </div>
            </CardContent>
          </Card>
          {/* 去重策略 */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Globe className="w-4 h-4 text-primary" /> 去重策略
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs font-medium">同用户去重</Label>
                  <p className="text-xs text-muted-foreground">同一用户在冷却期内只发送一次</p>
                </div>
                <Switch checked={form.deduplicateEnabled} onCheckedChange={(v) => setForm({ ...form, deduplicateEnabled: v })} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">去重冷却时间（小时）</Label>
                <Input
                  type="number"
                  value={form.deduplicateWindowHours}
                  onChange={(e) => setForm({ ...form, deduplicateWindowHours: parseInt(e.target.value) || 24 })}
                  className="bg-background border-border mt-1"
                  min={1} max={168}
                  disabled={!form.deduplicateEnabled}
                />
                <p className="text-xs text-muted-foreground mt-1">推荐设置 24~72 小时</p>
              </div>
            </CardContent>
          </Card>
          {/* 安全建议 */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" /> 安全建议
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-xs text-muted-foreground">
                {[
                  "使用注册超过 3 个月的成熟账号",
                  "每个账号绑定独立的住宅 IP 代理",
                  "消息模板配置多个变体轮换使用",
                  "首条消息不包含链接或广告词",
                  "新账号先养号 14 天再开启私信",
                  "每日私信量建议控制在 30 条以内",
                  "开启 Telegram Premium 可提升配额",
                  "账号健康度低于 40 分时自动暂停",
                ].map((tip, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-emerald-400 mt-0.5">✓</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
        <div className="flex justify-end">
          <Button onClick={() => updateMut.mutate(form)} disabled={updateMut.isPending}>
            {updateMut.isPending ? "保存中..." : "保存防封策略"}
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}
