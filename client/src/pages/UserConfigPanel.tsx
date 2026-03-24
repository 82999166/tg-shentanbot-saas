/**
 * 用户参数全量配置管理面板
 * 管理员可以查看并修改任意用户的所有参数：
 * - 套餐 & 到期时间
 * - 关键词列表（增删改查）
 * - 监控群组列表（增删启停）
 * - TG 账号状态
 * - 推送设置
 * - 反垃圾配置
 */
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  User, Crown, Key, Hash, Smartphone, Activity, Search,
  Plus, Trash2, Edit2, RefreshCw, CheckCircle2, XCircle,
  Loader2, Eye, ChevronDown, ChevronUp, Settings, Bell,
  Shield, MessageSquare, Calendar, Tag, Globe, BarChart2,
} from "lucide-react";

const PLAN_OPTIONS = ["free", "basic", "pro", "enterprise"] as const;
const PLAN_COLORS: Record<string, string> = {
  free: "border-slate-600 text-slate-400",
  basic: "border-blue-600 text-blue-400",
  pro: "border-purple-600 text-purple-400",
  enterprise: "border-yellow-600 text-yellow-400",
};
const PLAN_LABELS: Record<string, string> = {
  free: "免费版", basic: "基础版", pro: "专业版", enterprise: "企业版",
};
const MATCH_TYPE_LABELS: Record<string, string> = {
  contains: "包含", exact: "精确", regex: "正则", and: "AND", or: "OR", not: "NOT",
};

// ── 用户搜索选择器 ────────────────────────────────────────────────
function UserSelector({ onSelect }: { onSelect: (userId: number, userName: string) => void }) {
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;

  const { data: usersData, isLoading } = trpc.admin.users.useQuery({
    page, pageSize: PAGE_SIZE, search: search || undefined,
  });
  const users = usersData?.users ?? [];
  const total = usersData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          placeholder="搜索用户名、邮箱..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { setSearch(searchInput); setPage(1); } }}
          className="bg-slate-800 border-slate-600 text-white text-sm h-9"
        />
        <Button size="sm" className="h-9 bg-blue-600 hover:bg-blue-700"
          onClick={() => { setSearch(searchInput); setPage(1); }}>
          <Search className="w-3.5 h-3.5" />
        </Button>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
        </div>
      ) : (
        <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
          {users.map((u: any) => (
            <button
              key={u.id}
              className="w-full flex items-center justify-between bg-slate-800 hover:bg-slate-700 rounded-lg px-3 py-2.5 text-left transition-colors"
              onClick={() => onSelect(u.id, u.name ?? u.email ?? `用户 #${u.id}`)}
            >
              <div className="min-w-0">
                <p className="text-white text-sm font-medium truncate">{u.name ?? u.email}</p>
                <p className="text-slate-400 text-xs truncate">{u.email}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <Badge className={`text-xs border ${PLAN_COLORS[u.planId ?? "free"]}`}>
                  {PLAN_LABELS[u.planId ?? "free"]}
                </Badge>
                <Eye className="w-3.5 h-3.5 text-slate-500" />
              </div>
            </button>
          ))}
          {users.length === 0 && (
            <p className="text-center text-slate-500 text-sm py-6">未找到用户</p>
          )}
        </div>
      )}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
          <p className="text-xs text-slate-500">共 {total} 个用户</p>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" className="h-7 px-2 border-slate-600 text-slate-300 hover:bg-slate-700"
              disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</Button>
            <span className="text-xs text-slate-400 self-center px-2">{page}/{totalPages}</span>
            <Button size="sm" variant="outline" className="h-7 px-2 border-slate-600 text-slate-300 hover:bg-slate-700"
              disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一页</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 套餐配置面板 ──────────────────────────────────────────────────
function PlanConfigPanel({ userId, userData, onRefresh }: { userId: number; userData: any; onRefresh: () => void }) {
  const [editPlan, setEditPlan] = useState<string>(userData?.user?.planId ?? "free");
  const [editExpiry, setEditExpiry] = useState<string>(
    userData?.user?.planExpiresAt ? new Date(userData.user.planExpiresAt).toISOString().slice(0, 10) : ""
  );
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (userData?.user) {
      setEditPlan(userData.user.planId ?? "free");
      setEditExpiry(userData.user.planExpiresAt ? new Date(userData.user.planExpiresAt).toISOString().slice(0, 10) : "");
    }
  }, [userData?.user]);

  const updateMut = trpc.admin.updateUserPlanExpiry.useMutation({
    onSuccess: () => { toast.success("套餐已更新"); setEditing(false); onRefresh(); },
    onError: (e: any) => toast.error(e.message),
  });

  const user = userData?.user;
  const stats = userData?.stats;

  return (
    <div className="space-y-4">
      {/* 用户基本信息 */}
      <div className="bg-slate-800 rounded-xl p-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-blue-600/30 border border-blue-600/50 flex items-center justify-center">
            <User className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <p className="text-white font-semibold">{user?.name ?? user?.email ?? `用户 #${userId}`}</p>
            <p className="text-slate-400 text-xs">{user?.email}</p>
          </div>
          <Badge className={`ml-auto border ${PLAN_COLORS[user?.planId ?? "free"]}`}>
            {PLAN_LABELS[user?.planId ?? "free"]}
          </Badge>
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-slate-700/50 rounded-lg p-2.5">
            <p className="text-blue-400 font-bold text-lg">{stats?.totalHits ?? 0}</p>
            <p className="text-slate-400 text-xs">总命中</p>
          </div>
          <div className="bg-slate-700/50 rounded-lg p-2.5">
            <p className="text-green-400 font-bold text-lg">{stats?.keywordCount ?? 0}</p>
            <p className="text-slate-400 text-xs">关键词</p>
          </div>
          <div className="bg-slate-700/50 rounded-lg p-2.5">
            <p className="text-purple-400 font-bold text-lg">{stats?.groupCount ?? 0}</p>
            <p className="text-slate-400 text-xs">监控群组</p>
          </div>
        </div>
      </div>

      {/* 套餐编辑 */}
      <div className="bg-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-slate-300 text-sm font-semibold flex items-center gap-2">
            <Crown className="w-4 h-4 text-yellow-400" /> 套餐配置
          </h3>
          {!editing && (
            <Button size="sm" variant="ghost" className="h-7 text-slate-400 hover:text-blue-400"
              onClick={() => setEditing(true)}>
              <Edit2 className="w-3.5 h-3.5 mr-1" /> 编辑
            </Button>
          )}
        </div>
        {editing ? (
          <div className="space-y-3">
            <div>
              <Label className="text-slate-400 text-xs mb-1.5 block">套餐类型</Label>
              <Select value={editPlan} onValueChange={setEditPlan}>
                <SelectTrigger className="bg-slate-700 border-slate-600 text-white h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-600">
                  {PLAN_OPTIONS.map(p => (
                    <SelectItem key={p} value={p} className="text-slate-300">{PLAN_LABELS[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-slate-400 text-xs mb-1.5 block">到期时间（留空=永久）</Label>
              <Input
                type="date"
                value={editExpiry}
                onChange={(e) => setEditExpiry(e.target.value)}
                className="bg-slate-700 border-slate-600 text-white h-9"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700 h-8"
                disabled={updateMut.isPending}
                onClick={() => updateMut.mutate({ userId, planId: editPlan as any, planExpiresAt: editExpiry || null })}>
                {updateMut.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
                保存
              </Button>
              <Button size="sm" variant="ghost" className="h-8 text-slate-400"
                onClick={() => setEditing(false)}>取消</Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="bg-slate-700/50 rounded-lg p-2.5">
              <p className="text-slate-400 text-xs mb-0.5">当前套餐</p>
              <p className="text-white font-medium">{PLAN_LABELS[user?.planId ?? "free"]}</p>
            </div>
            <div className="bg-slate-700/50 rounded-lg p-2.5">
              <p className="text-slate-400 text-xs mb-0.5">到期时间</p>
              <p className="text-white font-medium">
                {user?.planExpiresAt
                  ? new Date(user.planExpiresAt).toLocaleDateString()
                  : "永久"}
              </p>
            </div>
            <div className="bg-slate-700/50 rounded-lg p-2.5">
              <p className="text-slate-400 text-xs mb-0.5">注册时间</p>
              <p className="text-slate-300 text-xs">{user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : "—"}</p>
            </div>
            <div className="bg-slate-700/50 rounded-lg p-2.5">
              <p className="text-slate-400 text-xs mb-0.5">最后登录</p>
              <p className="text-slate-300 text-xs">{user?.lastSignedIn ? new Date(user.lastSignedIn).toLocaleDateString() : "—"}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 关键词配置面板 ────────────────────────────────────────────────
function KeywordsConfigPanel({ userId, userData, onRefresh }: { userId: number; userData: any; onRefresh: () => void }) {
  const [newKw, setNewKw] = useState("");
  const [newMatchType, setNewMatchType] = useState<"contains" | "exact" | "regex">("contains");

  const addMut = trpc.admin.addKeyword.useMutation({
    onSuccess: () => { toast.success("关键词已添加"); setNewKw(""); onRefresh(); },
    onError: (e: any) => toast.error(e.message),
  });
  const deleteMut = trpc.admin.deleteKeyword.useMutation({
    onSuccess: () => { toast.success("已删除"); onRefresh(); },
    onError: (e: any) => toast.error(e.message),
  });
  const toggleMut = trpc.admin.toggleKeyword.useMutation({
    onSuccess: () => onRefresh(),
    onError: (e: any) => toast.error(e.message),
  });

  const keywords = userData?.keywords ?? [];

  return (
    <div className="space-y-3">
      <div className="bg-slate-800 rounded-xl p-4 space-y-3">
        <h3 className="text-slate-300 text-sm font-semibold flex items-center gap-2">
          <Hash className="w-4 h-4 text-blue-400" />
          关键词管理
          <Badge className="bg-slate-700 text-slate-300 text-xs ml-1">{keywords.length} 个</Badge>
        </h3>
        {/* 添加关键词 */}
        <div className="flex gap-2">
          <Input
            placeholder="输入关键词..."
            value={newKw}
            onChange={(e) => setNewKw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newKw.trim()) {
                addMut.mutate({ userId, keyword: newKw.trim(), matchType: newMatchType });
              }
            }}
            className="bg-slate-700 border-slate-600 text-white text-sm h-9 flex-1"
          />
          <Select value={newMatchType} onValueChange={(v) => setNewMatchType(v as any)}>
            <SelectTrigger className="bg-slate-700 border-slate-600 text-slate-300 text-xs h-9 w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-600">
              {(["contains", "exact", "regex"] as const).map(t => (
                <SelectItem key={t} value={t} className="text-slate-300 text-xs">{MATCH_TYPE_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" className="h-9 bg-blue-600 hover:bg-blue-700"
            disabled={!newKw.trim() || addMut.isPending}
            onClick={() => { if (newKw.trim()) addMut.mutate({ userId, keyword: newKw.trim(), matchType: newMatchType }); }}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        {/* 关键词列表 */}
        <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
          {keywords.length === 0 ? (
            <p className="text-slate-500 text-xs text-center py-4">暂无关键词</p>
          ) : (
            keywords.map((kw: any) => (
              <div key={kw.id} className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs ${kw.isActive ? "bg-slate-700" : "bg-slate-800/60 opacity-60"}`}>
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Switch
                    checked={kw.isActive}
                    onCheckedChange={(v) => toggleMut.mutate({ keywordId: kw.id, userId, isActive: v })}
                    className="scale-75"
                  />
                  <span className="text-white font-medium truncate">{kw.keyword}</span>
                  <Badge className="border border-slate-600 text-slate-400 text-xs shrink-0">
                    {MATCH_TYPE_LABELS[kw.matchType ?? "contains"]}
                  </Badge>
                </div>
                <Button size="icon" variant="ghost" className="w-6 h-6 text-slate-500 hover:text-red-400 shrink-0"
                  onClick={() => deleteMut.mutate({ keywordId: kw.id, userId })}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── 监控群组配置面板 ──────────────────────────────────────────────
function GroupsConfigPanel({ userId, userData }: { userId: number; userData: any }) {
  const groups = userData?.monitorGroups ?? [];

  return (
    <div className="space-y-3">
      <div className="bg-slate-800 rounded-xl p-4 space-y-3">
        <h3 className="text-slate-300 text-sm font-semibold flex items-center gap-2">
          <Globe className="w-4 h-4 text-green-400" />
          监控群组
          <Badge className="bg-slate-700 text-slate-300 text-xs ml-1">{groups.length} 个</Badge>
          <Badge className="bg-green-900/50 text-green-300 text-xs ml-1 border border-green-700">
            {groups.filter((g: any) => g.isActive).length} 启用
          </Badge>
        </h3>
        <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
          {groups.length === 0 ? (
            <p className="text-slate-500 text-xs text-center py-4">暂无监控群组</p>
          ) : (
            groups.map((g: any) => (
              <div key={g.id} className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-xs ${g.isActive ? "bg-slate-700" : "bg-slate-800/60 opacity-60"}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-white font-medium truncate">{g.groupTitle ?? g.groupId}</p>
                  <p className="text-slate-400 font-mono text-xs">{g.groupId}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <Badge className={`text-xs border ${g.isActive ? "border-green-700 text-green-300" : "border-slate-600 text-slate-400"}`}>
                    {g.isActive ? "监控中" : "已停用"}
                  </Badge>
                  <Badge className={`text-xs border ${g.monitorStatus === "active" ? "border-blue-700 text-blue-300" : "border-slate-600 text-slate-400"}`}>
                    {g.monitorStatus ?? "pending"}
                  </Badge>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── TG 账号配置面板 ───────────────────────────────────────────────
function AccountsConfigPanel({ userId, userData }: { userId: number; userData: any }) {
  const accounts = userData?.tgAccounts ?? [];

  const healthColor = (score: number) => {
    if (score >= 80) return "text-green-400";
    if (score >= 60) return "text-yellow-400";
    if (score >= 40) return "text-orange-400";
    return "text-red-400";
  };

  return (
    <div className="space-y-3">
      <div className="bg-slate-800 rounded-xl p-4 space-y-3">
        <h3 className="text-slate-300 text-sm font-semibold flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-blue-400" />
          TG 账号
          <Badge className="bg-slate-700 text-slate-300 text-xs ml-1">{accounts.length} 个</Badge>
        </h3>
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {accounts.length === 0 ? (
            <p className="text-slate-500 text-xs text-center py-4">暂无绑定账号</p>
          ) : (
            accounts.map((a: any) => {
              const score = a.healthScore ?? 80;
              return (
                <div key={a.id} className="bg-slate-700/50 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-white text-sm font-medium truncate">
                        {a.tgFirstName ?? a.phone ?? `账号 #${a.id}`}
                      </p>
                      <p className="text-slate-400 text-xs font-mono">
                        {a.phone ?? (a.tgUsername ? `@${a.tgUsername}` : `ID: ${a.id}`)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className={`font-bold text-sm ${healthColor(score)}`}>{score}</span>
                      <Badge className={`text-xs border ${
                        a.sessionStatus === "active" ? "border-green-700 text-green-300"
                        : a.sessionStatus === "banned" ? "border-red-700 text-red-300"
                        : "border-slate-600 text-slate-400"
                      }`}>
                        {a.sessionStatus ?? "pending"}
                      </Badge>
                    </div>
                  </div>
                  <Progress value={score} className="h-1.5" />
                  <div className="grid grid-cols-3 gap-1.5 text-xs">
                    <div className="bg-slate-800/60 rounded p-1.5 text-center">
                      <p className="text-slate-400">今日发信</p>
                      <p className="text-white font-medium">{a.dailyDmSent ?? 0}</p>
                    </div>
                    <div className="bg-slate-800/60 rounded p-1.5 text-center">
                      <p className="text-slate-400">引擎类型</p>
                      <p className="text-white font-medium font-mono text-xs">
                        {a.engineType ?? "tdlib"}
                      </p>
                    </div>
                    <div className="bg-slate-800/60 rounded p-1.5 text-center">
                      <p className="text-slate-400">启用状态</p>
                      <p className={`font-medium ${a.isActive ? "text-green-400" : "text-slate-400"}`}>
                        {a.isActive ? "启用" : "停用"}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────
export default function UserConfigPanel() {
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [selectedUserName, setSelectedUserName] = useState<string>("");
  const [showSelector, setShowSelector] = useState(true);

  const { data: userData, isLoading, refetch } = trpc.admin.userDetail.useQuery(
    { userId: selectedUserId! },
    { enabled: selectedUserId !== null }
  );

  const handleSelectUser = (userId: number, userName: string) => {
    setSelectedUserId(userId);
    setSelectedUserName(userName);
    setShowSelector(false);
  };

  return (
    <div className="space-y-4">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-white font-semibold text-base flex items-center gap-2">
            <Settings className="w-5 h-5 text-blue-400" />
            用户参数全量配置
          </h2>
          <p className="text-slate-400 text-xs mt-0.5">
            选择用户后可查看并修改其所有参数配置
          </p>
        </div>
        {selectedUserId && (
          <Button size="sm" variant="outline" className="border-slate-600 text-slate-300 hover:bg-slate-700 h-8"
            onClick={() => { setShowSelector(true); setSelectedUserId(null); }}>
            <Search className="w-3.5 h-3.5 mr-1.5" />
            重新选择
          </Button>
        )}
      </div>

      {/* 用户选择器 */}
      {showSelector && (
        <Card className="bg-slate-800 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
              <User className="w-4 h-4 text-blue-400" />
              选择用户
            </CardTitle>
          </CardHeader>
          <CardContent>
            <UserSelector onSelect={handleSelectUser} />
          </CardContent>
        </Card>
      )}

      {/* 用户配置详情 */}
      {selectedUserId && !showSelector && (
        <>
          {/* 当前用户标识 */}
          <div className="flex items-center gap-2 bg-blue-950/30 border border-blue-800 rounded-lg px-3 py-2">
            <User className="w-4 h-4 text-blue-400 shrink-0" />
            <span className="text-blue-300 text-sm font-medium">
              正在配置：{selectedUserName}
            </span>
            <Button size="sm" variant="ghost" className="ml-auto h-6 text-slate-400 hover:text-white"
              onClick={() => refetch()}>
              <RefreshCw className="w-3 h-3" />
            </Button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
          ) : (
            <Tabs defaultValue="plan" className="space-y-3">
              <TabsList className="bg-slate-800 border border-slate-700 flex-wrap h-auto gap-1">
                <TabsTrigger value="plan" className="data-[state=active]:bg-blue-600 text-slate-300 data-[state=active]:text-white text-xs">
                  <Crown className="w-3.5 h-3.5 mr-1" /> 套餐
                </TabsTrigger>
                <TabsTrigger value="keywords" className="data-[state=active]:bg-blue-600 text-slate-300 data-[state=active]:text-white text-xs">
                  <Hash className="w-3.5 h-3.5 mr-1" /> 关键词
                  <Badge className="ml-1 bg-slate-700 text-slate-300 text-xs">{userData?.keywords?.length ?? 0}</Badge>
                </TabsTrigger>
                <TabsTrigger value="groups" className="data-[state=active]:bg-blue-600 text-slate-300 data-[state=active]:text-white text-xs">
                  <Globe className="w-3.5 h-3.5 mr-1" /> 群组
                  <Badge className="ml-1 bg-slate-700 text-slate-300 text-xs">{userData?.monitorGroups?.length ?? 0}</Badge>
                </TabsTrigger>
                <TabsTrigger value="accounts" className="data-[state=active]:bg-blue-600 text-slate-300 data-[state=active]:text-white text-xs">
                  <Smartphone className="w-3.5 h-3.5 mr-1" /> 账号
                  <Badge className="ml-1 bg-slate-700 text-slate-300 text-xs">{userData?.tgAccounts?.length ?? 0}</Badge>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="plan">
                <PlanConfigPanel userId={selectedUserId} userData={userData} onRefresh={refetch} />
              </TabsContent>
              <TabsContent value="keywords">
                <KeywordsConfigPanel userId={selectedUserId} userData={userData} onRefresh={refetch} />
              </TabsContent>
              <TabsContent value="groups">
                <GroupsConfigPanel userId={selectedUserId} userData={userData} />
              </TabsContent>
              <TabsContent value="accounts">
                <AccountsConfigPanel userId={selectedUserId} userData={userData} />
              </TabsContent>
            </Tabs>
          )}
        </>
      )}
    </div>
  );
}
