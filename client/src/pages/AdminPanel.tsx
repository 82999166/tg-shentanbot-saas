import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Users, Activity, Crown, Shield } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import { useEffect } from "react";

export default function AdminPanel() {
  const { user } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (user && user.role !== "admin") {
      navigate("/");
    }
  }, [user]);

  const { data: stats } = trpc.admin.stats.useQuery();
  const { data: users } = trpc.admin.users.useQuery({ limit: 20 });
  const updatePlanMut = trpc.admin.updateUserPlan.useMutation({
    onSuccess: () => { toast.success("套餐已更新"); },
    onError: (e: any) => toast.error(e.message),
  });

  if (user?.role !== "admin") {
    return (
      <AppLayout title="管理后台">
        <div className="p-6 text-center text-muted-foreground">
          <Shield className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p>无权访问此页面</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="管理后台">
      <div className="p-6 space-y-6">
        {/* 平台统计 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "总用户数", value: stats?.totalUsers ?? 0, icon: Users, color: "text-blue-400" },
            { label: "免费用户", value: stats?.planCounts?.free ?? 0, icon: Activity, color: "text-emerald-400" },
            { label: "付费用户", value: stats ? Object.entries(stats.planCounts).filter(([k]) => k !== 'free').reduce((a, [,v]) => a + v, 0) : 0, icon: Activity, color: "text-purple-400" },
            { label: "近期注册", value: stats?.recentUsers?.length ?? 0, icon: Crown, color: "text-amber-400" },
          ].map((s, i) => {
            const Icon = s.icon;
            return (
              <Card key={i} className="bg-card border-border">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className={`w-4 h-4 ${s.color}`} />
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                  </div>
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* 用户列表 */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">用户管理</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(users ?? []).map((u: any) => (
                <div key={u.id} className="flex items-center gap-4 p-3 bg-background/50 rounded-lg border border-border/50">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{u.name ?? u.email ?? `用户 #${u.id}`}</span>
                      {u.role === "admin" && <Badge className="text-xs bg-amber-900 text-amber-300 border-0">管理员</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </div>
                  <Select
                    value={u.planId}
                    onValueChange={(v) => updatePlanMut.mutate({ userId: u.id, planId: v as any })}
                  >
                    <SelectTrigger className="w-32 h-8 text-xs bg-background border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      {["free", "basic", "pro", "enterprise"].map((p) => (
                        <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
