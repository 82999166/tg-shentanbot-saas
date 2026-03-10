import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Crown, Zap, Star, Building2 } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

const PLAN_ICONS: Record<string, React.ElementType> = {
  free: Zap, basic: Star, pro: Crown, enterprise: Building2,
};
const PLAN_COLORS: Record<string, string> = {
  free: "border-slate-700",
  basic: "border-blue-700",
  pro: "border-purple-700 ring-1 ring-purple-700",
  enterprise: "border-amber-700",
};
const PLAN_BADGE_COLORS: Record<string, string> = {
  free: "bg-slate-700 text-slate-300",
  basic: "bg-blue-900 text-blue-300",
  pro: "bg-purple-900 text-purple-300",
  enterprise: "bg-amber-900 text-amber-300",
};

export default function Plans() {
  const { data: plans } = trpc.plans.list.useQuery();
  const { data: myPlanData } = trpc.plans.myPlan.useQuery();
  const [cardCode, setCardCode] = useState("");

  const cp = myPlanData?.currentPlan;
  const currentPlanId = myPlanData?.planId ?? "free";

  const handleUpgrade = (planId: string) => {
    toast.info(`请联系管理员升级到 ${planId} 套餐，或通过卡密激活`);
  };

  return (
    <AppLayout title="套餐管理">
      <div className="p-6 space-y-6">
        {/* 当前套餐 */}
        {cp && (
          <div className="p-4 bg-card border border-primary/30 rounded-xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">当前套餐</p>
                <p className="text-lg font-bold mt-0.5">{cp.name}</p>
              </div>
              <Badge className={`${PLAN_BADGE_COLORS[cp.id] ?? "bg-slate-700 text-slate-300"} border-0`}>
                {cp.id.toUpperCase()}
              </Badge>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
              {[
                { label: "监控群组", value: cp.maxMonitorGroups === -1 ? "无限" : cp.maxMonitorGroups },
                { label: "关键词数", value: cp.maxKeywords === -1 ? "无限" : cp.maxKeywords },
                { label: "每日私信", value: cp.maxDailyDm === -1 ? "无限" : cp.maxDailyDm },
                { label: "TG 账号", value: cp.maxTgAccounts === -1 ? "无限" : cp.maxTgAccounts },
              ].map((q, i) => (
                <div key={i} className="text-center p-2 bg-background/50 rounded-lg">
                  <p className="text-lg font-bold text-primary">{q.value}</p>
                  <p className="text-xs text-muted-foreground">{q.label}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 套餐列表 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {plans?.map((plan) => {
            const PlanIcon = PLAN_ICONS[plan.id] ?? Zap;
            const isCurrent = currentPlanId === plan.id;
            const features = Array.isArray(plan.features) ? plan.features as string[] : [];
            return (
              <Card key={plan.id} className={`bg-card ${PLAN_COLORS[plan.id] ?? "border-border"} relative`}>
                {plan.id === "pro" && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-purple-600 text-white border-0 text-xs">推荐</Badge>
                  </div>
                )}
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <PlanIcon className="w-5 h-5 text-primary" />
                    <CardTitle className="text-sm">{plan.name}</CardTitle>
                  </div>
                  <div className="mt-2">
                    <span className="text-2xl font-bold">
                      {parseFloat(plan.price) === 0 ? "免费" : `$${plan.price}`}
                    </span>
                    {parseFloat(plan.price) > 0 && <span className="text-xs text-muted-foreground">/月</span>}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <ul className="space-y-1.5 text-xs text-muted-foreground">
                    {[
                      `${plan.maxMonitorGroups === -1 ? "无限" : plan.maxMonitorGroups} 个监控群组`,
                      `${plan.maxKeywords === -1 ? "无限" : plan.maxKeywords} 个关键词`,
                      `每日 ${plan.maxDailyDm === -1 ? "无限" : plan.maxDailyDm} 条私信`,
                      `${plan.maxTgAccounts === -1 ? "无限" : plan.maxTgAccounts} 个 TG 账号`,
                      `${plan.maxTemplates === -1 ? "无限" : plan.maxTemplates} 个消息模板`,
                      ...features,
                    ].map((f, i) => (
                      <li key={i} className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="w-full text-xs"
                    variant={isCurrent ? "outline" : "default"}
                    disabled={isCurrent}
                    onClick={() => handleUpgrade(plan.id)}
                  >
                    {isCurrent ? "当前套餐" : "升级到此套餐"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* 卡密激活 */}
        <div className="p-4 bg-card border border-border rounded-xl">
          <p className="text-sm font-medium mb-2">卡密激活</p>
          <p className="text-xs text-muted-foreground mb-3">如果您已购买卡密，请在下方输入激活码</p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="输入激活码..."
              value={cardCode}
              onChange={(e) => setCardCode(e.target.value)}
              className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <Button size="sm" onClick={() => toast.info("卡密激活功能即将上线")}>激活</Button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
