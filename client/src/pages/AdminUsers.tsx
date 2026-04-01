import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Users, Crown, Loader2, Search, Eye, Key, Hash,
  Calendar, Tag, BarChart2, Activity, ChevronDown, ChevronUp,
  Smartphone, Plus, Trash2, Settings, RefreshCw
} from "lucide-react";
import { useEffect, useState } from "react";
import UserConfigPanel from "@/pages/UserConfigPanel";

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
            {/* 基本信息 */}
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

            {/* 命中统计 */}
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

            {/* 套餐管理 */}
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
                  <div className="flex gap-2">
                    <Button size="sm" className="h-7 text-xs bg-blue-600 hover:bg-blue-700"
                      disabled={updatePlanMut.isPending}
                      onClick={() => updatePlanMut.mutate({
                        userId,
                        planId: editPlan,
                        planExpiresAt: editExpiry ? new Date(editExpiry).toISOString() : null,
                      })}>
                      {updatePlanMut.isPending && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
                      保存
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-slate-400"
                      onClick={() => setPlanEditing(false)}>
                      取消
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* 关键词管理 */}
            <div className="bg-slate-800 rounded-xl p-4">
              <button
                className="flex items-center justify-between w-full mb-3"
                onClick={() => setKwExpanded(v => !v)}
              >
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                  <Key className="w-3.5 h-3.5 text-purple-400" /> 关键词管理（{data.keywords.length}）
                </h3>
                {kwExpanded ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
              </button>
              {kwExpanded && (
                <>
                  <div className="flex gap-2 mb-3">
                    <Input placeholder="新关键词" value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)}
                      className="h-7 text-xs bg-slate-700 border-slate-600 text-white flex-1" />
                    <Select value={newMatchType} onValueChange={(v) => setNewMatchType(v as any)}>
                      <SelectTrigger className="h-7 text-xs bg-slate-700 border-slate-600 text-white w-20">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-800 border-slate-600">
                        {["contains", "exact", "regex"].map((t) => (
                          <SelectItem key={t} value={t} className="text-xs">{matchTypeLabels[t]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" className="h-7 text-xs bg-purple-600 hover:bg-purple-700 px-2"
                      disabled={!newKeyword.trim() || addKwMut.isPending}
                      onClick={() => addKwMut.mutate({ userId, keyword: newKeyword.trim(), matchType: newMatchType })}>
                      <Plus className="w-3 h-3" />
                    </Button>
                  </div>
                  {data.keywords.length === 0 ? (
                    <p className="text-slate-500 text-xs text-center py-3">暂无关键词</p>
                  ) : (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {data.keywords.map((kw: any) => (
                        <div key={kw.id} className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs ${kw.isActive ? "bg-slate-700" : "bg-slate-800/50 opacity-60"}`}>
                          <div className="flex items-center gap-2 min-w-0">
                            <Badge className="text-xs border-0 bg-purple-900/50 text-purple-300 shrink-0">
                              {matchTypeLabels[kw.matchType] ?? kw.matchType}
                            </Badge>
                            <span className="text-white truncate">{kw.keyword}</span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0 ml-2">
                            <button className={`text-xs px-1.5 py-0.5 rounded ${kw.isActive ? "text-green-400 hover:text-slate-400" : "text-slate-500 hover:text-green-400"}`}
                              onClick={() => toggleKwMut.mutate({ keywordId: kw.id, isActive: !kw.isActive })}>
                              {kw.isActive ? "启用" : "停用"}
                            </button>
                            <button className="text-slate-500 hover:text-red-400 p-0.5"
                              onClick={() => deleteKwMut.mutate({ keywordId: kw.id })}>
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* 监控群组 */}
            <div className="bg-slate-800 rounded-xl p-4">
              <button
                className="flex items-center justify-between w-full mb-3"
                onClick={() => setGroupExpanded(v => !v)}
              >
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                  <Hash className="w-3.5 h-3.5 text-cyan-400" /> 监控群组（{data.monitorGroups.length}）
                </h3>
                {groupExpanded ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
              </button>
              {groupExpanded && (
                data.monitorGroups.length === 0 ? (
                  <p className="text-slate-500 text-xs text-center py-3">暂无监控群组，此群组将使用各用户自己的关键词规则</p>
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

            {/* TG 账号 */}
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
export default function AdminUsers() {
  const [userSearch, setUserSearch] = useState("");
  const [userSearchInput, setUserSearchInput] = useState("");
  const [userPage, setUserPage] = useState(1);
  const USER_PAGE_SIZE = 20;
  const [viewUserId, setViewUserId] = useState<number | null>(null);
  const utils = trpc.useUtils();

  const { data: usersData, isLoading: usersLoading, isRefetching: usersRefetching, refetch: refetchUsers } = trpc.admin.users.useQuery({
    page: userPage,
    pageSize: USER_PAGE_SIZE,
    search: userSearch || undefined,
  });
  const users = usersData?.users ?? [];
  const usersTotal = usersData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(usersTotal / USER_PAGE_SIZE));

  const updatePlanMut = trpc.admin.updateUserPlan.useMutation({
    onSuccess: () => { toast.success("套餐已更新"); utils.admin.users.invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });

  const planColors: Record<string, string> = {
    free: "bg-slate-700 text-slate-300",
    basic: "bg-blue-900/50 text-blue-300",
    pro: "bg-purple-900/50 text-purple-300",
    enterprise: "bg-amber-900/50 text-amber-300",
  };

  return (
    <AdminLayout title="客户管理">
      <div className="p-6 space-y-6">
        {/* 页头 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Users className="w-6 h-6 text-blue-400" /> 客户管理
            </h1>
            <p className="text-sm text-slate-400 mt-1">管理所有注册用户的套餐、关键词和监控配置</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetchUsers()} disabled={usersRefetching}
            className="border-slate-600 text-slate-300 hover:bg-slate-700">
            <RefreshCw className={`w-4 h-4 mr-1 ${usersRefetching ? 'animate-spin' : ''}`} /> 刷新
          </Button>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="list" className="space-y-4">
          <TabsList className="bg-slate-800 border border-slate-700">
            <TabsTrigger value="list" className="data-[state=active]:bg-blue-600 text-slate-300 data-[state=active]:text-white">
              <Users className="w-4 h-4 mr-1.5" />
              用户列表
            </TabsTrigger>
            <TabsTrigger value="config" className="data-[state=active]:bg-blue-600 text-slate-300 data-[state=active]:text-white">
              <Settings className="w-4 h-4 mr-1.5" />
              用户参数配置
            </TabsTrigger>
          </TabsList>

          <TabsContent value="list">
        {/* 搜索栏 */}
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <Input
              placeholder="搜索用户名或邮箱..."
              value={userSearchInput}
              onChange={(e) => setUserSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setUserSearch(userSearchInput);
                  setUserPage(1);
                }
              }}
              className="bg-slate-800 border-slate-600 text-white pl-9 placeholder-slate-500"
            />
          </div>
          <Button size="sm" variant="outline" className="border-slate-600 text-slate-300 hover:bg-slate-700"
            onClick={() => { setUserSearch(userSearchInput); setUserPage(1); }}>
            搜索
          </Button>
          {userSearch && (
            <Button size="sm" variant="ghost" className="text-slate-400 hover:text-white"
              onClick={() => { setUserSearch(""); setUserSearchInput(""); setUserPage(1); }}>
              清除
            </Button>
          )}
          <p className="text-sm text-slate-500 ml-auto">共 {usersTotal} 位用户</p>
        </div>

        {/* 用户列表 */}
        {usersLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-blue-400" /></div>
        ) : (
          <Card className="bg-slate-800/60 border-slate-700">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700 text-xs text-slate-400">
                    <th className="text-left px-4 py-3 font-medium">用户</th>
                    <th className="text-left px-4 py-3 font-medium">套餐</th>
                    <th className="text-left px-4 py-3 font-medium">到期日期</th>
                    <th className="text-center px-4 py-3 font-medium">关键词</th>
                    <th className="text-center px-4 py-3 font-medium">今日命中</th>
                    <th className="text-center px-4 py-3 font-medium">总命中</th>
                    <th className="text-left px-4 py-3 font-medium">注册时间</th>
                    <th className="text-left px-4 py-3 font-medium">最后登录</th>
                    <th className="text-right px-4 py-3 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {(users as any[]).map((u: any) => {
                    const isExpired = u.planExpiresAt && new Date(u.planExpiresAt) < new Date();
                    const expiringSoon = u.planExpiresAt && !isExpired &&
                      (new Date(u.planExpiresAt).getTime() - Date.now()) < 7 * 24 * 3600 * 1000;
                    return (
                      <tr key={u.id} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold text-xs shrink-0">
                              {(u.name ?? u.email ?? "?")[0]?.toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1">
                                <span className="font-medium text-white truncate max-w-[120px]">{u.name ?? `用户 #${u.id}`}</span>
                                {u.role === "admin" && <Badge className="text-xs bg-amber-900/50 text-amber-300 border border-amber-700 px-1 py-0">管理员</Badge>}
                              </div>
                              <span className="text-xs text-slate-500 truncate block max-w-[160px]">{u.email}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Select value={u.planId ?? "free"}
                            onValueChange={(v) => updatePlanMut.mutate({ userId: u.id, planId: v as any })}>
                            <SelectTrigger className="w-24 h-7 text-xs bg-slate-700 border-slate-600 text-white">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-slate-800 border-slate-600">
                              {["free", "basic", "pro", "enterprise"].map((p) => (
                                <SelectItem key={p} value={p} className="text-xs capitalize">{p}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-4 py-3">
                          {u.planExpiresAt ? (
                            <span className={`text-xs flex items-center gap-1 ${
                              isExpired ? "text-red-400" : expiringSoon ? "text-amber-400" : "text-slate-300"
                            }`}>
                              <Calendar className="w-3 h-3" />
                              {new Date(u.planExpiresAt).toLocaleDateString()}
                              {isExpired && <span className="text-red-400">(已到期)</span>}
                              {expiringSoon && <span className="text-amber-400">(即将到期)</span>}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-500">永久</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="inline-flex items-center justify-center gap-1 text-purple-300 font-medium">
                            <Key className="w-3 h-3" />{u.keywordCount ?? 0}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`font-bold text-sm ${(u.todayHits ?? 0) > 0 ? "text-green-400" : "text-slate-500"}`}>
                            {u.todayHits ?? 0}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`font-medium text-sm ${(u.totalHits ?? 0) > 0 ? "text-blue-400" : "text-slate-500"}`}>
                            {u.totalHits ?? 0}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs text-slate-400">{new Date(u.createdAt).toLocaleDateString()}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs text-slate-400">{new Date(u.lastSignedIn).toLocaleDateString()}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button size="icon" variant="ghost" className="w-7 h-7 text-slate-400 hover:text-blue-400" title="查看详情"
                            onClick={() => setViewUserId(u.id)}>
                            <Eye className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {(users as any[]).length === 0 && (
                <div className="py-12 text-center">
                  <Users className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                  <p className="text-slate-400">暂无用户</p>
                </div>
              )}
            </div>
            {/* 分页 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-700">
                <p className="text-xs text-slate-500">
                  第 {(userPage - 1) * USER_PAGE_SIZE + 1}–{Math.min(userPage * USER_PAGE_SIZE, usersTotal)} 条，共 {usersTotal} 条
                </p>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="outline" className="h-7 px-2 border-slate-600 text-slate-300 hover:bg-slate-700 disabled:opacity-40"
                    disabled={userPage <= 1} onClick={() => setUserPage(p => p - 1)}>
                    上一页
                  </Button>
                  {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                    const start = Math.max(1, Math.min(userPage - 2, totalPages - 4));
                    const p = start + i;
                    return p <= totalPages ? (
                      <Button key={p} size="sm" variant={p === userPage ? "default" : "outline"}
                        className={`h-7 w-7 p-0 text-xs ${p === userPage ? "bg-blue-600 hover:bg-blue-700 text-white border-blue-600" : "border-slate-600 text-slate-300 hover:bg-slate-700"}`}
                        onClick={() => setUserPage(p)}>
                        {p}
                      </Button>
                    ) : null;
                  })}
                  <Button size="sm" variant="outline" className="h-7 px-2 border-slate-600 text-slate-300 hover:bg-slate-700 disabled:opacity-40"
                    disabled={userPage >= totalPages} onClick={() => setUserPage(p => p + 1)}>
                    下一页
                  </Button>
                </div>
              </div>
            )}
          </Card>
        )}
          </TabsContent>

          {/* Tab 2: 用户参数配置 */}
          <TabsContent value="config">
            <UserConfigPanel />
          </TabsContent>
        </Tabs>
      </div>

      {/* 用户详情弹窗 */}
      {viewUserId !== null && (
        <UserDetailDialog
          userId={viewUserId}
          onClose={() => setViewUserId(null)}
          planColors={planColors}
        />
      )}
    </AdminLayout>
  );
}
