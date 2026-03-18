import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Users, Activity, Crown, Shield, Smartphone, RefreshCw,
  Trash2, CheckCircle2, XCircle, Zap, Loader2, Phone,
  TrendingUp, WifiOff, Wifi, Search, Eye, Key, Hash,
  Calendar, Plus, Tag, BarChart2, ChevronDown, ChevronUp
} from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import { useEffect, useState } from "react";

// ─── 用户详情弹窗 ───────────────────────────────────────────────────────────────
function UserDetailDialog({ userId, onClose, planColors }: {
  userId: number;
  onClose: () => void;
  planColors: Record<string, string>;
}) {
  const utils = trpc.useUtils();
  const [newKeyword, setNewKeyword] = useState("");
  const [newMatchType, setNewMatchType] = useState<"contains" | "exact" | "regex">("contains");
  const [editPlan, setEditPlan] = useState<"free" | "basic" | "pro" | "enterprise">("free");
  const [editExpiry, setEditExpiry] = useState<string>("");
  const [planEditing, setPlanEditing] = useState(false);
  const [kwExpanded, setKwExpanded] = useState(true);
  const [groupExpanded, setGroupExpanded] = useState(false);

  const { data, isLoading, refetch } = trpc.admin.userDetail.useQuery({ userId });

  // 初始化套餐编辑状态
  useEffect(() => {
    if (data?.user) {
      setEditPlan((data.user.planId as any) ?? "free");
      setEditExpiry(data.user.planExpiresAt ? new Date(data.user.planExpiresAt).toISOString().slice(0, 10) : "");
    }
  }, [data?.user]);

  const updatePlanMut = trpc.admin.updateUserPlanExpiry.useMutation({
    onSuccess: () => {
      toast.success("套餐已更新");
      setPlanEditing(false);
      refetch();
      utils.admin.users.invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const addKwMut = trpc.admin.addKeyword.useMutation({
    onSuccess: () => { toast.success("关键词已添加"); setNewKeyword(""); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteKwMut = trpc.admin.deleteKeyword.useMutation({
    onSuccess: () => { toast.success("关键词已删除"); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleKwMut = trpc.admin.toggleKeyword.useMutation({
    onSuccess: () => refetch(),
    onError: (e: any) => toast.error(e.message),
  });

  const matchTypeLabels: Record<string, string> = {
    contains: "包含", exact: "精确", regex: "正则", and: "AND", or: "OR", not: "NOT"
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="w-5 h-5 text-blue-400" /> 用户详情
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-blue-400" /></div>
        ) : !data ? (
          <p className="text-slate-400 text-center py-8">加载失败</p>
        ) : (
          <div className="space-y-5">
            {/* ── 基本信息 ── */}
            <div className="bg-slate-800 rounded-xl p-4 space-y-2 text-sm">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">基本信息</h3>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex justify-between col-span-2 sm:col-span-1">
                  <span className="text-slate-400">用户名</span>
                  <span className="text-white font-medium">{data.user.name ?? "—"}</span>
                </div>
                <div className="flex justify-between col-span-2 sm:col-span-1">
                  <span className="text-slate-400">邮箱</span>
                  <span className="text-white">{data.user.email ?? "—"}</span>
                </div>
                <div className="flex justify-between col-span-2 sm:col-span-1">
                  <span className="text-slate-400">TG ID</span>
                  <span className="text-white font-mono text-xs">{data.user.tgUserId ?? "未绑定"}</span>
                </div>
                <div className="flex justify-between col-span-2 sm:col-span-1">
                  <span className="text-slate-400">角色</span>
                  <span className="text-white capitalize">{data.user.role}</span>
                </div>
                <div className="flex justify-between col-span-2 sm:col-span-1">
                  <span className="text-slate-400">注册时间</span>
                  <span className="text-white">{new Date(data.user.createdAt).toLocaleString()}</span>
                </div>
                <div className="flex justify-between col-span-2 sm:col-span-1">
                  <span className="text-slate-400">最后登录</span>
                  <span className="text-white">{new Date(data.user.lastSignedIn).toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* ── 命中统计 ── */}
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: "今日命中", value: data.stats.todayHits, color: "text-green-400", icon: Activity },
                { label: "总命中", value: data.stats.totalHits, color: "text-blue-400", icon: BarChart2 },
                { label: "关键词", value: `${data.stats.activeKeywordCount}/${data.stats.keywordCount}`, color: "text-purple-400", icon: Tag },
                { label: "监控群组", value: `${data.stats.activeGroupCount}/${data.stats.groupCount}`, color: "text-cyan-400", icon: Hash },
              ].map((s) => (
                <div key={s.label} className="bg-slate-800 rounded-lg p-3 text-center">
                  <s.icon className={`w-4 h-4 mx-auto mb-1 ${s.color}`} />
                  <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-slate-500">{s.label}</p>
                </div>
              ))}
            </div>

            {/* ── 套餐管理 ── */}
            <div className="bg-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                  <Crown className="w-3.5 h-3.5 text-amber-400" /> 套餐管理
                </h3>
                {!planEditing && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-blue-400 hover:text-blue-300"
                    onClick={() => setPlanEditing(true)}>
                    修改
                  </Button>
                )}
              </div>
              {!planEditing ? (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">当前套餐</span>
                    <Badge className={`text-xs border-0 ${planColors[data.user.planId ?? "free"] ?? planColors.free}`}>
                      {data.user.planId ?? "free"}
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">到期日期</span>
                    <span className="text-white flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-slate-500" />
                      {data.user.planExpiresAt ? new Date(data.user.planExpiresAt).toLocaleDateString() : "永久 / 未设置"}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">套餐类型</label>
                      <Select value={editPlan} onValueChange={(v) => setEditPlan(v as any)}>
                        <SelectTrigger className="h-8 text-xs bg-slate-700 border-slate-600 text-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-slate-800 border-slate-600">
                          {["free", "basic", "pro", "enterprise"].map((p) => (
                            <SelectItem key={p} value={p} className="text-xs capitalize">{p}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">到期日期（留空=永久）</label>
                      <Input type="date" value={editExpiry} onChange={(e) => setEditExpiry(e.target.value)}
                        className="h-8 text-xs bg-slate-700 border-slate-600 text-white" />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-slate-400"
                      onClick={() => setPlanEditing(false)}>取消</Button>
                    <Button size="sm" className="h-7 text-xs bg-blue-600 hover:bg-blue-700"
                      disabled={updatePlanMut.isPending}
                      onClick={() => updatePlanMut.mutate({
                        userId,
                        planId: editPlan,
                        planExpiresAt: editExpiry || null,
                      })}>
                      {updatePlanMut.isPending && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
                      保存
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* ── 关键词管理 ── */}
            <div className="bg-slate-800 rounded-xl p-4">
              <button className="w-full flex items-center justify-between mb-3"
                onClick={() => setKwExpanded(!kwExpanded)}>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                  <Key className="w-3.5 h-3.5 text-purple-400" /> 关键词管理
                  <Badge className="text-xs bg-purple-900/50 text-purple-300 border-0">
                    {data.stats.activeKeywordCount} 个启用
                  </Badge>
                </h3>
                {kwExpanded ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
              </button>

              {kwExpanded && (
                <div className="space-y-3">
                  {/* 添加关键词 */}
                  <div className="flex gap-2">
                    <Input
                      placeholder="输入关键词..."
                      value={newKeyword}
                      onChange={(e) => setNewKeyword(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newKeyword.trim()) {
                          addKwMut.mutate({ userId, keyword: newKeyword.trim(), matchType: newMatchType });
                        }
                      }}
                      className="h-8 text-xs bg-slate-700 border-slate-600 text-white placeholder-slate-500 flex-1"
                    />
                    <Select value={newMatchType} onValueChange={(v) => setNewMatchType(v as any)}>
                      <SelectTrigger className="h-8 w-20 text-xs bg-slate-700 border-slate-600 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-800 border-slate-600">
                        {["contains", "exact", "regex"].map((t) => (
                          <SelectItem key={t} value={t} className="text-xs">{matchTypeLabels[t]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" className="h-8 w-8 p-0 bg-purple-600 hover:bg-purple-700"
                      disabled={!newKeyword.trim() || addKwMut.isPending}
                      onClick={() => addKwMut.mutate({ userId, keyword: newKeyword.trim(), matchType: newMatchType })}>
                      {addKwMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                    </Button>
                  </div>

                  {/* 关键词列表 */}
                  {data.keywords.length === 0 ? (
                    <p className="text-slate-500 text-xs text-center py-3">暂无关键词</p>
                  ) : (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {data.keywords.map((kw: any) => (
                        <div key={kw.id} className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs transition-colors ${kw.isActive ? "bg-slate-700" : "bg-slate-800/50 opacity-60"}`}>
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`font-medium truncate ${kw.isActive ? "text-white" : "text-slate-500"}`}>{kw.keyword}</span>
                            <Badge className="text-xs bg-slate-600 text-slate-300 border-0 shrink-0">
                              {matchTypeLabels[kw.matchType] ?? kw.matchType}
                            </Badge>
                            {kw.hitCount > 0 && (
                              <span className="text-green-400 shrink-0">命中 {kw.hitCount}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0 ml-2">
                            <Button size="icon" variant="ghost"
                              className={`w-6 h-6 ${kw.isActive ? "text-green-400 hover:text-slate-400" : "text-slate-500 hover:text-green-400"}`}
                              onClick={() => toggleKwMut.mutate({ keywordId: kw.id, userId, isActive: !kw.isActive })}>
                              {kw.isActive ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                            </Button>
                            <Button size="icon" variant="ghost"
                              className="w-6 h-6 text-slate-500 hover:text-red-400"
                              onClick={() => deleteKwMut.mutate({ keywordId: kw.id, userId })}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── 监控群组 ── */}
            <div className="bg-slate-800 rounded-xl p-4">
              <button className="w-full flex items-center justify-between mb-3"
                onClick={() => setGroupExpanded(!groupExpanded)}>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                  <Hash className="w-3.5 h-3.5 text-cyan-400" /> 监控群组
                  <Badge className="text-xs bg-cyan-900/50 text-cyan-300 border-0">
                    {data.stats.activeGroupCount} 个启用
                  </Badge>
                </h3>
                {groupExpanded ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
              </button>

              {groupExpanded && (
                data.monitorGroups.length === 0 ? (
                  <p className="text-slate-500 text-xs text-center py-3">暂无监控群组</p>
                ) : (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {data.monitorGroups.map((g: any) => (
                      <div key={g.id} className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs ${g.isActive ? "bg-slate-700" : "bg-slate-800/50 opacity-60"}`}>
                        <div className="min-w-0">
                          <span className="text-white font-medium truncate block">{g.groupTitle ?? g.groupId}</span>
                          <span className="text-slate-500 font-mono">{g.groupId}</span>
                        </div>
                        <Badge className={`text-xs border shrink-0 ml-2 ${g.isActive ? "border-green-700 text-green-300" : "border-slate-600 text-slate-400"}`}>
                          {g.isActive ? "监控中" : "已停用"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>

            {/* ── TG 账号 ── */}
            {data.tgAccounts.length > 0 && (
              <div className="bg-slate-800 rounded-xl p-4">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Smartphone className="w-3.5 h-3.5 text-blue-400" /> 绑定 TG 账号（{data.tgAccounts.length} 个）
                </h3>
                <div className="space-y-1.5">
                  {data.tgAccounts.map((a: any) => (
                    <div key={a.id} className="flex items-center justify-between bg-slate-700 rounded-lg px-3 py-2 text-xs">
                      <span className="text-white">{a.tgFirstName ?? a.phone ?? `账号 #${a.id}`}</span>
                      <Badge className={`border text-xs ${a.sessionStatus === "active" ? "border-green-700 text-green-300" : "border-slate-600 text-slate-400"}`}>
                        {a.sessionStatus ?? "pending"}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-slate-400">关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── 主页面 ─────────────────────────────────────────────────────────────────────
export default function AdminPanel() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [userSearch, setUserSearch] = useState("");
  const [viewUserId, setViewUserId] = useState<number | null>(null);
  const [deleteAccountId, setDeleteAccountId] = useState<number | null>(null);

  useEffect(() => {
    if (user && user.role !== "admin") navigate("/");
  }, [user]);

  const utils = trpc.useUtils();
  const { data: stats, isLoading: statsLoading } = trpc.admin.stats.useQuery();
  const { data: users = [], isLoading: usersLoading } = trpc.admin.users.useQuery({ limit: 50 });
  const { data: allAccounts = [], isLoading: accountsLoading } = trpc.admin.allTgAccounts.useQuery();

  const updatePlanMut = trpc.admin.updateUserPlan.useMutation({
    onSuccess: () => { toast.success("套餐已更新"); utils.admin.users.invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });
  const deleteAccountMut = trpc.tgAccounts.delete.useMutation({
    onSuccess: () => { toast.success("账号已删除"); utils.admin.allTgAccounts.invalidate(); setDeleteAccountId(null); },
    onError: (e: any) => toast.error(e.message),
  });
  const testConnMut = trpc.tgAccounts.testConnection.useMutation({
    onSuccess: (r) => { toast[r.success ? "success" : "error"](r.message); utils.admin.allTgAccounts.invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });
  const toggleActiveMut = trpc.tgAccounts.toggleActive.useMutation({
    onSuccess: () => { utils.admin.allTgAccounts.invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });

  const filteredUsers = (users as any[]).filter((u) =>
    !userSearch || u.name?.toLowerCase().includes(userSearch.toLowerCase()) || u.email?.toLowerCase().includes(userSearch.toLowerCase())
  );

  const healthColor = (score: number) => {
    if (score >= 80) return "text-green-400";
    if (score >= 60) return "text-yellow-400";
    if (score >= 40) return "text-orange-400";
    return "text-red-400";
  };

  const planColors: Record<string, string> = {
    free: "bg-slate-700 text-slate-300",
    basic: "bg-blue-900/50 text-blue-300",
    pro: "bg-purple-900/50 text-purple-300",
    enterprise: "bg-amber-900/50 text-amber-300",
  };

  if (user?.role !== "admin") {
    return (
      <AppLayout>
        <div className="p-6 text-center">
          <Shield className="w-12 h-12 mx-auto mb-4 text-slate-600" />
          <p className="text-slate-400">无权访问此页面</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* 页头 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Shield className="w-6 h-6 text-amber-400" /> 管理后台
            </h1>
            <p className="text-sm text-slate-400 mt-1">平台全局管理，仅管理员可见</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => { utils.admin.stats.invalidate(); utils.admin.users.invalidate(); utils.admin.allTgAccounts.invalidate(); }}
            className="border-slate-600 text-slate-300 hover:bg-slate-700">
            <RefreshCw className="w-4 h-4 mr-1" /> 刷新
          </Button>
        </div>

        {/* 平台统计卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "注册用户", value: stats?.totalUsers ?? 0, icon: Users, color: "text-blue-400", bg: "from-blue-500/10 to-blue-600/5" },
            { label: "付费用户", value: stats ? Object.entries(stats.planCounts as Record<string, number>).filter(([k]) => k !== "free").reduce((a, [, v]) => a + v, 0) : 0, icon: Crown, color: "text-amber-400", bg: "from-amber-500/10 to-amber-600/5" },
            { label: "监控账号", value: (allAccounts as any[]).length, icon: Smartphone, color: "text-cyan-400", bg: "from-cyan-500/10 to-cyan-600/5" },
            { label: "活跃账号", value: (allAccounts as any[]).filter((a: any) => a.sessionStatus === "active").length, icon: Wifi, color: "text-green-400", bg: "from-green-500/10 to-green-600/5" },
          ].map((item) => (
            <Card key={item.label} className={`bg-gradient-to-br ${item.bg} border-slate-700`}>
              <CardContent className="p-4 flex items-center gap-3">
                <item.icon className={`w-8 h-8 ${item.color}`} />
                <div>
                  <p className="text-2xl font-bold text-white">{item.value}</p>
                  <p className="text-xs text-slate-400">{item.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* 套餐分布 */}
        {stats && (
          <Card className="bg-slate-800/60 border-slate-700">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-purple-400" /> 套餐分布
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Object.entries(stats.planCounts as Record<string, number>).map(([plan, count]) => {
                  const total = stats.totalUsers || 1;
                  const pct = Math.round((count / total) * 100);
                  return (
                    <div key={plan} className="space-y-2">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-300 capitalize">{plan}</span>
                        <span className="text-slate-400">{count} ({pct}%)</span>
                      </div>
                      <Progress value={pct} className="h-2" />
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* 主内容 Tabs */}
        <Tabs defaultValue="accounts" className="space-y-4">
          <TabsList className="bg-slate-800 border border-slate-700">
            <TabsTrigger value="accounts" className="data-[state=active]:bg-slate-700 text-slate-300">
              <Smartphone className="w-4 h-4 mr-2" /> 监控账号管理
            </TabsTrigger>
            <TabsTrigger value="users" className="data-[state=active]:bg-slate-700 text-slate-300">
              <Users className="w-4 h-4 mr-2" /> 用户管理
            </TabsTrigger>
          </TabsList>

          {/* ── Tab 1: 监控账号管理 ── */}
          <TabsContent value="accounts" className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-400">管理所有用户的 Telegram 监控账号</p>
              <div className="flex gap-2 text-xs text-slate-500">
                <span className="flex items-center gap-1"><Wifi className="w-3 h-3 text-green-400" /> 运行中: {(allAccounts as any[]).filter((a: any) => a.sessionStatus === "active").length}</span>
                <span className="flex items-center gap-1"><WifiOff className="w-3 h-3 text-red-400" /> 封禁: {(allAccounts as any[]).filter((a: any) => a.sessionStatus === "banned").length}</span>
              </div>
            </div>

            {accountsLoading ? (
              <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-blue-400" /></div>
            ) : (allAccounts as any[]).length === 0 ? (
              <Card className="bg-slate-800/60 border-slate-700 border-dashed">
                <CardContent className="py-12 text-center">
                  <Smartphone className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                  <p className="text-slate-400">暂无监控账号</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {(allAccounts as any[]).map((account: any) => {
                  const score = account.healthScore ?? 0;
                  const statusMap: Record<string, { label: string; cls: string }> = {
                    active: { label: "运行中", cls: "bg-green-900/50 text-green-300 border-green-700" },
                    pending: { label: "待激活", cls: "bg-slate-700 text-slate-300 border-slate-600" },
                    expired: { label: "已过期", cls: "bg-amber-900/50 text-amber-300 border-amber-700" },
                    banned: { label: "已封禁", cls: "bg-red-900/50 text-red-300 border-red-700" },
                  };
                  const roleMap: Record<string, string> = { monitor: "监控", sender: "发信", both: "监控+发信" };
                  const st = statusMap[account.sessionStatus ?? "pending"] ?? statusMap.pending;
                  return (
                    <Card key={account.id} className="bg-slate-800/60 border-slate-700 hover:border-slate-500 transition-colors">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white font-bold shrink-0">
                              {(account.tgFirstName ?? account.phone ?? "?")[0]?.toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-white text-sm truncate">
                                  {account.tgFirstName ? `${account.tgFirstName} ${account.tgLastName ?? ""}`.trim() : account.phone ?? `账号 #${account.id}`}
                                </span>
                                {account.tgUsername && <span className="text-slate-500 text-xs">@{account.tgUsername}</span>}
                                <Badge className={`text-xs border ${st.cls}`}>{st.label}</Badge>
                                <Badge variant="outline" className="text-xs border-slate-600 text-slate-400">{roleMap[account.accountRole ?? "both"]}</Badge>
                              </div>
                              <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 flex-wrap">
                                {account.phone && <span><Phone className="w-3 h-3 inline mr-1" />{account.phone}</span>}
                                <span>所属用户: {account.userName ?? `#${account.userId}`}</span>
                                <span>今日发信: {account.dailyDmSent ?? 0}</span>
                                <span className={`font-medium ${healthColor(score)}`}>健康度: {score}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button size="icon" variant="ghost" className="w-8 h-8 text-slate-400 hover:text-blue-400" title="测试连接"
                              onClick={() => testConnMut.mutate({ id: account.id })}>
                              {testConnMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                            </Button>
                            <Button size="icon" variant="ghost"
                              className={`w-8 h-8 ${account.isActive ? "text-green-400 hover:text-slate-400" : "text-slate-500 hover:text-green-400"}`}
                              title={account.isActive ? "停用" : "启用"}
                              onClick={async () => { await toggleActiveMut.mutateAsync({ id: account.id, isActive: !account.isActive }); toast.success(account.isActive ? "账号已停用" : "账号已启用"); }}>
                              {account.isActive ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                            </Button>
                            <Button size="icon" variant="ghost" className="w-8 h-8 text-slate-400 hover:text-red-400" title="删除"
                              onClick={() => setDeleteAccountId(account.id)}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* ── Tab 2: 用户管理 ── */}
          <TabsContent value="users" className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <Input placeholder="搜索用户名或邮箱..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)}
                  className="bg-slate-800 border-slate-600 text-white pl-9 placeholder-slate-500" />
              </div>
              <p className="text-sm text-slate-500">{filteredUsers.length} 位用户</p>
            </div>

            {usersLoading ? (
              <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-blue-400" /></div>
            ) : (
              <div className="space-y-2">
                {filteredUsers.map((u: any) => (
                  <Card key={u.id} className="bg-slate-800/60 border-slate-700 hover:border-slate-500 transition-colors">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-4">
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold text-sm shrink-0">
                          {(u.name ?? u.email ?? "?")[0]?.toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-white text-sm">{u.name ?? `用户 #${u.id}`}</span>
                            {u.role === "admin" && <Badge className="text-xs bg-amber-900/50 text-amber-300 border border-amber-700">管理员</Badge>}
                            <Badge className={`text-xs border-0 ${planColors[u.planId] ?? planColors.free}`}>{u.planId ?? "free"}</Badge>
                            {u.planExpiresAt && (
                              <span className="text-xs text-slate-500 flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                到期: {new Date(u.planExpiresAt).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 flex-wrap">
                            {u.email && <span>{u.email}</span>}
                            <span>注册: {new Date(u.createdAt).toLocaleDateString()}</span>
                            <span>最后登录: {new Date(u.lastSignedIn).toLocaleDateString()}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Select value={u.planId ?? "free"}
                            onValueChange={(v) => updatePlanMut.mutate({ userId: u.id, planId: v as any })}>
                            <SelectTrigger className="w-28 h-8 text-xs bg-slate-700 border-slate-600 text-white">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-slate-800 border-slate-600">
                              {["free", "basic", "pro", "enterprise"].map((p) => (
                                <SelectItem key={p} value={p} className="text-xs capitalize">{p}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button size="icon" variant="ghost" className="w-8 h-8 text-slate-400 hover:text-blue-400" title="查看详情"
                            onClick={() => setViewUserId(u.id)}>
                            <Eye className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* 删除账号确认 */}
      <Dialog open={deleteAccountId !== null} onOpenChange={(o) => { if (!o) setDeleteAccountId(null); }}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400"><Trash2 className="w-5 h-5" /> 确认删除账号</DialogTitle>
            <DialogDescription className="text-slate-400">删除后该账号的 Session 将被清除，所有监控任务将停止。此操作不可撤销。</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setDeleteAccountId(null)} className="text-slate-400">取消</Button>
            <Button variant="destructive" disabled={deleteAccountMut.isPending}
              onClick={() => deleteAccountId !== null && deleteAccountMut.mutate({ id: deleteAccountId })}>
              {deleteAccountMut.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />} 确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 用户详情弹窗 */}
      {viewUserId !== null && (
        <UserDetailDialog
          userId={viewUserId}
          onClose={() => setViewUserId(null)}
          planColors={planColors}
        />
      )}
    </AppLayout>
  );
}
