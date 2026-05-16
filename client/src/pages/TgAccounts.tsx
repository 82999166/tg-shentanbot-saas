import AdminLayout from "@/components/AdminLayout";
import { useAuth } from "@/_core/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Download,
  Edit2,
  Eye,
  EyeOff,
  Loader2,
  MessageSquare,
  Phone,
  RefreshCw,
  Shield,
  ShieldCheck,
  Smartphone,
  Trash2,
  Upload,
  Wifi,
  WifiOff,
  XCircle,
  Zap,
  Server,
  ServerOff,
  PackagePlus,
  FolderInput,
  Activity,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";
import React, { useState, useRef, useEffect } from "react";

type AddMode = "phone" | "session_bulk" | null;
type PhoneStep = "phone" | "code" | "twofa" | "done";

interface ParsedSession {
  phone?: string;
  sessionString: string;
  accountRole: "monitor" | "sender" | "both";
}

const healthColor = (score: number) => {
  if (score >= 80) return "text-green-400";
  if (score >= 60) return "text-yellow-400";
  if (score >= 40) return "text-orange-400";
  return "text-red-400";
};

export default function TgAccounts() {
  const { user } = useAuth();
  const Layout = user?.role === "admin" ? AdminLayout : AppLayout;
  const utils = trpc.useUtils();
  const { data: accounts = [], isLoading, isRefetching, refetch } = trpc.tgAccounts.list.useQuery();

  const [addMode, setAddMode] = useState<AddMode>(null);
  const [filterKeyword, setFilterKeyword] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterRole, setFilterRole] = useState("all");
  const [filterOwner, setFilterOwner] = useState("all");
  const filteredAccounts = accounts.filter((a) => {
    const kw = filterKeyword.toLowerCase();
    if (kw && !((a.tgFirstName ?? "").toLowerCase().includes(kw) || (a.phone ?? "").includes(kw) || (a.tgUsername ?? "").toLowerCase().includes(kw))) return false;
    if (filterStatus !== "all" && a.sessionStatus !== filterStatus) return false;
    if (filterRole !== "all" && (a.accountRole ?? "both") !== filterRole) return false;
    if (filterOwner !== "all" && (a as any).ownerEmail !== filterOwner) return false;
    return true;
  });
  const [deleteId, setDeleteId] = useState<number | null>(null);

  // 编辑账号状态
  const [editAccount, setEditAccount] = useState<{ id: number; accountRole: string; notes: string; maxGroupsLimit: number | null } | null>(null);
  const updateAccount = trpc.tgAccounts.update.useMutation();

  // 加群配置（全局）
  const { data: joinConfig } = trpc.sysConfig.getJoinConfig.useQuery();
  const [joinCfgMin, setJoinCfgMin] = useState(30);
  const [joinCfgMax, setJoinCfgMax] = useState(60);
  const [joinCfgMax2, setJoinCfgMax2] = useState(300);
  const [joinCfgEnabled, setJoinCfgEnabled] = useState(true);
  const [joinCfgDistributeCount, setJoinCfgDistributeCount] = useState(0);
  const [joinCfgLoaded, setJoinCfgLoaded] = useState(false);
  const updateJoinConfig = trpc.sysConfig.updateJoinConfig.useMutation({
    onSuccess: () => toast.success('加群配置已保存'),
    onError: (e: any) => toast.error('保存失败: ' + e.message),
  });

  // 手机号登录状态
  const [phoneStep, setPhoneStep] = useState<PhoneStep>("phone");
  const [phoneForm, setPhoneForm] = useState({ phone: "", code: "", password: "", role: "both" as "monitor" | "sender" | "both" });
  const [phoneCodeHash, setPhoneCodeHash] = useState("");
  const [show2faPassword, setShow2faPassword] = useState(false);

  // 批量导入状态
  const [bulkText, setBulkText] = useState("");
  const [bulkFormat, setBulkFormat] = useState<"auto" | "one_per_line" | "json">("auto");
  const [parsedSessions, setParsedSessions] = useState<ParsedSession[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [importStep, setImportStep] = useState<"input" | "preview" | "done">("input");
  const [importResult, setImportResult] = useState<{ imported: number; failed: number; skipped: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sendCode = trpc.tgAccounts.sendCode.useMutation();
  const verifyCode = trpc.tgAccounts.verifyCode.useMutation();
  const verify2FA = trpc.tgAccounts.verify2FA.useMutation();
  const parseSessionText = trpc.tgAccounts.parseSessionText.useMutation();
  const importSessions = trpc.tgAccounts.importSessions.useMutation();
  const deleteMut = trpc.tgAccounts.delete.useMutation();
  const testConn = trpc.tgAccounts.testConnection.useMutation();
  const toggleActive = trpc.tgAccounts.toggleActive.useMutation();
  // 多选状态
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const toggleSelect = (id: number) => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const selectAll = () => setSelectedIds(filteredAccounts.map(a => a.id));
  const clearSelect = () => setSelectedIds([]);
  const setInEngine = trpc.tgAccounts.setInEngine.useMutation({
    onSuccess: (r: any) => { toast.success(`已更新 ${r.count} 个账号`); refresh(); clearSelect(); },
    onError: (e: any) => toast.error(e.message),
  });
  const syncGroups = trpc.tgAccounts.syncGroups.useMutation({
    onSuccess: (r) => { toast.success(r.message); refresh(); },
    onError: (e: any) => toast.error(e.message),
  });

  // 导入群组到公共群组池
  const [importChatsAccountId, setImportChatsAccountId] = useState<number | null>(null);
  const [importChatsLoading, setImportChatsLoading] = useState(false);
  const [importChatsList, setImportChatsList] = useState<Array<{ chatId: string; title: string; username: string; type: string }>>([]);
  const [importChatsSelected, setImportChatsSelected] = useState<Set<string>>(new Set());
  const [importChatsStep, setImportChatsStep] = useState<'loading' | 'select' | 'done' | 'error'>('loading');
  const [importChatsError, setImportChatsError] = useState<string>('');
  const getAccountChats = trpc.tgAccounts.getAccountChats.useMutation();
  const importChatsToPublic = trpc.tgAccounts.importChatsToPublic.useMutation();

  // 频道健康检测状态
  const [healthCheckAccountId, setHealthCheckAccountId] = useState<number | null>(null);
  const [healthCheckLoading, setHealthCheckLoading] = useState(false);
  const [healthCheckResult, setHealthCheckResult] = useState<{
    total: number;
    normalCount: number;
    abnormalCount: number;
    normalGroups: Array<{ groupId: string; title: string; username: string; memberCount: number; status: string; reason: string }>;
    abnormalGroups: Array<{ groupId: string; title: string; username: string; memberCount: number; status: string; reason: string }>;
  } | null>(null);
  const [healthCheckError, setHealthCheckError] = useState<string>('');
  const [healthCheckStep, setHealthCheckStep] = useState<'loading' | 'result' | 'error'>('loading');
  const [healthCheckSelected, setHealthCheckSelected] = useState<Set<string>>(new Set());
  const checkGroupHealth = trpc.tgAccounts.checkGroupHealth.useMutation();
  const deleteAbnormalGroups = trpc.tgAccounts.deleteAbnormalPublicGroups.useMutation();

  const openHealthCheck = async (accountId: number) => {
    setHealthCheckAccountId(accountId);
    setHealthCheckStep('loading');
    setHealthCheckResult(null);
    setHealthCheckError('');
    setHealthCheckSelected(new Set());
    setHealthCheckLoading(true);
    try {
      // 先获取公共群组池的所有群组 ID
      const chatsRes = await getAccountChats.mutateAsync({ id: accountId });
      const groupIds = chatsRes.chats.map((c: any) => c.chatId);
      if (!groupIds.length) {
        setHealthCheckError('该账号没有已加入的群组，无法检测');
        setHealthCheckStep('error');
        setHealthCheckLoading(false);
        return;
      }
      // 调用健康检测
      const res = await checkGroupHealth.mutateAsync({ accountId, groupIds });
      setHealthCheckResult(res);
      // 默认选中所有异常群组
      setHealthCheckSelected(new Set(res.abnormalGroups.map((g: any) => g.groupId)));
      setHealthCheckStep('result');
    } catch (e: any) {
      setHealthCheckError(e.message ?? '检测失败');
      setHealthCheckStep('error');
    } finally {
      setHealthCheckLoading(false);
    }
  };

  const handleDeleteAbnormal = async () => {
    const toDelete = Array.from(healthCheckSelected);
    if (!toDelete.length) return toast.error('请至少选择一个异常群组');
    try {
      const res = await deleteAbnormalGroups.mutateAsync({ groupIds: toDelete });
      toast.success(`已从公共群组池删除 ${res.deletedCount} 个异常群组`);
      setHealthCheckAccountId(null);
      refresh();
    } catch (e: any) { toast.error(e.message ?? '删除失败'); }
  };



  const openImportChats = async (accountId: number) => {
    setImportChatsAccountId(accountId);
    setImportChatsStep('loading');
    setImportChatsList([]);
    setImportChatsSelected(new Set());
    setImportChatsError('');
    setImportChatsLoading(true);
    try {
      const res = await getAccountChats.mutateAsync({ id: accountId });
      setImportChatsList(res.chats);
      setImportChatsSelected(new Set(res.chats.map(c => c.chatId)));
      setImportChatsStep('select');
    } catch (e: any) {
      // 错误时不关闭弹窗，改为显示错误状态，方便用户查看原因
      setImportChatsError(e.message ?? '获取群组列表失败');
      setImportChatsStep('error');
    } finally {
      setImportChatsLoading(false);
    }
  };

  const handleImportChats = async () => {
    const selected = importChatsList.filter(c => importChatsSelected.has(c.chatId));
    if (!selected.length) return toast.error('请至少选择一个群组');
    try {
      const res = await importChatsToPublic.mutateAsync({ chats: selected });
      toast.success(res.message);
      setImportChatsStep('done');
      refresh();
    } catch (e: any) { toast.error(e.message ?? '导入失败'); }
  };

  const refresh = () => refetch();

  const handleSendCode = async () => {
    if (!phoneForm.phone.trim()) return toast.error("请输入手机号");
    try {
      const res = await sendCode.mutateAsync({ phone: phoneForm.phone });
      setPhoneCodeHash(res.phoneCodeHash);
      setPhoneStep("code");
      toast.success(res.message);
    } catch (e: any) { toast.error(e.message ?? "发送失败"); }
  };

  const handleVerifyCode = async () => {
    if (!phoneForm.code.trim()) return toast.error("请输入验证码");
    try {
      const res = await verifyCode.mutateAsync({ phone: phoneForm.phone, phoneCodeHash, code: phoneForm.code });
      if (res.needs2FA) { setPhoneStep("twofa"); toast.info(res.message); }
      else { setPhoneStep("done"); toast.success(res.message); refresh(); }
    } catch (e: any) { toast.error(e.message ?? "验证失败"); }
  };

  const handleVerify2FA = async () => {
    if (!phoneForm.password.trim()) return toast.error("请输入二步验证密码");
    try {
      const res = await verify2FA.mutateAsync({ phone: phoneForm.phone, password: phoneForm.password });
      setPhoneStep("done"); toast.success(res.message); refresh();
    } catch (e: any) { toast.error(e.message ?? "密码错误"); }
  };

  const resetPhoneForm = () => {
    setPhoneStep("phone");
    setPhoneForm({ phone: "", code: "", password: "", role: "both" });
    setPhoneCodeHash(""); setShow2faPassword(false);
  };

  const handleParseText = async () => {
    if (!bulkText.trim()) return toast.error("请输入 Session 内容");
    try {
      const res = await parseSessionText.mutateAsync({ text: bulkText, format: bulkFormat });
      setParsedSessions(res.parsed as ParsedSession[]);
      setParseErrors(res.errors);
      setImportStep("preview");
      if (res.count === 0) toast.warning("未解析到有效 Session");
      else toast.success(`解析到 ${res.count} 个有效 Session`);
    } catch (e: any) { toast.error(e.message ?? "解析失败"); }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { setBulkText(ev.target?.result as string ?? ""); toast.success(`已读取：${file.name}`); };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (parsedSessions.length === 0) return;
    try {
      const res = await importSessions.mutateAsync({ sessions: parsedSessions });
      setImportResult({ imported: res.imported, failed: res.failed, skipped: res.skipped });
      setImportStep("done"); toast.success(res.message); refresh();
    } catch (e: any) { toast.error(e.message ?? "导入失败"); }
  };

  const resetBulkForm = () => {
    setBulkText(""); setParsedSessions([]); setParseErrors([]);
    setImportStep("input"); setImportResult(null);
  };

  const closeDialog = () => {
    setAddMode(null); resetPhoneForm(); resetBulkForm();
  };

  const PHONE_STEPS: PhoneStep[] = ["phone", "code", "twofa", "done"];
  const STEP_LABELS = ["输入手机号", "验证码", "二步验证", "完成"];

  return (
    <Layout>
      <div className="p-6 space-y-6">
        {/* 页头 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">TG 账号管理</h1>
            <p className="text-sm text-slate-500 mt-1">管理用于监控和发信的 Telegram 账号</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={refresh} disabled={isRefetching} className="border-slate-300 text-slate-600 hover:bg-slate-200">
              <RefreshCw className={`w-4 h-4 mr-1 ${isRefetching ? 'animate-spin' : ''}`} /> 刷新
            </Button>
            <Button size="sm" onClick={() => setAddMode("phone")} className="bg-blue-600 hover:bg-blue-700">
              <Phone className="w-4 h-4 mr-1" /> 手机号登录
            </Button>
            <Button size="sm" onClick={() => setAddMode("session_bulk")} className="bg-cyan-600 hover:bg-cyan-700">
              <Upload className="w-4 h-4 mr-1" /> 导入 Session
            </Button>
          </div>
        </div>
        {/* 统计卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "账号总数", value: accounts.length, icon: Smartphone, color: "text-blue-400" },
            { label: "运行中", value: accounts.filter((a) => a.sessionStatus === "active").length, icon: Wifi, color: "text-green-400" },
            { label: "已封禁", value: accounts.filter((a) => a.sessionStatus === "banned").length, icon: WifiOff, color: "text-red-400" },
            {
              label: "平均健康度",
              value: accounts.length ? Math.round(accounts.reduce((s, a) => s + (a.healthScore ?? 0), 0) / accounts.length) + "%" : "—",
              icon: ShieldCheck, color: "text-cyan-400"
            },
          ].map((item) => (
            <Card key={item.label} className="bg-slate-100/80 border-slate-200">
              <CardContent className="p-4 flex items-center gap-3">
                <item.icon className={`w-8 h-8 ${item.color}`} />
                <div>
                  <p className="text-2xl font-bold text-slate-800">{item.value}</p>
                  <p className="text-xs text-slate-500">{item.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        {/* 条件筛选栏 */}
        <div className="flex flex-wrap gap-3 items-center bg-slate-100/60 border border-slate-200 rounded-lg p-3">
          <Input
            placeholder="搜索账号名/手机号/@用户名..."
            value={filterKeyword}
            onChange={(e) => setFilterKeyword(e.target.value)}
            className="bg-slate-100 border-slate-300 text-slate-800 placeholder-slate-500 w-56 h-8 text-sm"
          />
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="bg-slate-100 border-slate-300 text-slate-800 h-8 text-sm w-32"><SelectValue placeholder="状态" /></SelectTrigger>
            <SelectContent className="bg-slate-100 border-slate-300">
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="active">运行中</SelectItem>
              <SelectItem value="inactive">未激活</SelectItem>
              <SelectItem value="banned">已封禁</SelectItem>
              <SelectItem value="error">异常</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterRole} onValueChange={setFilterRole}>
            <SelectTrigger className="bg-slate-100 border-slate-300 text-slate-800 h-8 text-sm w-36"><SelectValue placeholder="账号角色" /></SelectTrigger>
            <SelectContent className="bg-slate-100 border-slate-300">
              <SelectItem value="all">全部角色</SelectItem>
              <SelectItem value="monitor">仅监控</SelectItem>
              <SelectItem value="sender">仅发信</SelectItem>
              <SelectItem value="both">监控+发信</SelectItem>
            </SelectContent>
          </Select>
          {user?.role === "admin" && (
            <Select value={filterOwner} onValueChange={setFilterOwner}>
              <SelectTrigger className="bg-slate-100 border-slate-300 text-slate-800 h-8 text-sm w-36"><SelectValue placeholder="归属用户" /></SelectTrigger>
              <SelectContent className="bg-slate-100 border-slate-300">
                <SelectItem value="all">全部用户</SelectItem>
                {Array.from(new Set(accounts.map((a) => (a as any).ownerEmail).filter(Boolean))).map((email) => (
                  <SelectItem key={email as string} value={email as string}>{email as string}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <span className="text-xs text-slate-500 ml-auto">共 {filteredAccounts.length} 条</span>
          {(filterKeyword || filterStatus !== "all" || filterRole !== "all" || filterOwner !== "all") && (
            <Button variant="ghost" size="sm" className="text-slate-500 hover:text-slate-800 h-8 text-xs"
              onClick={() => { setFilterKeyword(""); setFilterStatus("all"); setFilterRole("all"); setFilterOwner("all"); }}>
              清除筛选
            </Button>
          )}
        </div>
        {/* 账号表格 */}
        {isLoading ? (
          <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-blue-400" /></div>
        ) : filteredAccounts.length === 0 ? (
          <Card className="bg-slate-100/80 border-slate-200 border-dashed">
            <CardContent className="py-16 text-center">
              <Smartphone className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-500 mb-2">{accounts.length === 0 ? "还没有添加任何 TG 账号" : "没有符合筛选条件的账号"}</p>
            </CardContent>
          </Card>
        ) : (
          <>
          {/* 批量操作栏 */}
          {selectedIds.length > 0 && (
            <div className="flex items-center gap-3 px-4 py-2 bg-blue-50 border border-blue-200 rounded-lg mb-3">
              <span className="text-sm text-blue-600">已选 {selectedIds.length} 个账号</span>
              <Button size="sm" variant="outline" className="h-7 text-xs border-green-600 text-green-400 hover:bg-green-900/30"
                onClick={() => setInEngine.mutate({ ids: selectedIds, inEngine: true })}>
                <Server className="w-3 h-3 mr-1" /> 加入监控引擎
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs border-slate-300 text-slate-500 hover:bg-slate-200/30"
                onClick={() => setInEngine.mutate({ ids: selectedIds, inEngine: false })}>
                <ServerOff className="w-3 h-3 mr-1" /> 移出引擎（备用）
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs text-slate-500" onClick={clearSelect}>取消选择</Button>
            </div>
          )}
          <div className="bg-slate-100/80 border border-slate-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-100/80">
                    <th className="px-3 py-3 w-8">
                      <input type="checkbox" className="rounded border-slate-300 bg-slate-200 cursor-pointer"
                        title="全选/取消全选"
                        checked={selectedIds.length === filteredAccounts.length && filteredAccounts.length > 0}
                        onChange={(e) => e.target.checked ? selectAll() : clearSelect()} />
                    </th>{/* th-checkbox-col */}
                    <th className="text-left px-4 py-3 text-slate-500 font-medium">账号信息</th>
                    {user?.role === "admin" && <th className="text-left px-4 py-3 text-slate-500 font-medium">归属用户</th>}
                    <th className="text-left px-4 py-3 text-slate-500 font-medium">状态</th>
                    <th className="text-left px-4 py-3 text-slate-500 font-medium">角色</th>
                    <th className="text-center px-4 py-3 text-slate-500 font-medium"><span title="该账号监控的私有群组数">私有群组</span></th>
                    <th className="text-center px-4 py-3 text-slate-500 font-medium"><span title="已加入的公共群组数（subscribed 状态）">已加入</span></th>
                    <th className="text-center px-4 py-3 text-slate-500 font-medium"><span title="已分配给该账号的公共群组总数（包含已加入和待加入）">已分配</span></th>
                    <th className="text-center px-4 py-3 text-slate-500 font-medium"><span title="已分配但尚未加入的群组数（pending/joining/failed，不含已解散群组）">待加入</span></th>
                    <th className="text-center px-4 py-3 text-slate-500 font-medium"><span title="群组已解散或不存在（not_found）">无效</span></th>
                    <th className="text-center px-4 py-3 text-slate-500 font-medium">健康度</th>
                    <th className="text-center px-4 py-3 text-slate-500 font-medium">今日发信</th>
                    <th className="text-center px-4 py-3 text-slate-500 font-medium" title="是否加入监控引擎">引擎</th>
                    <th className="text-right px-4 py-3 text-slate-500 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAccounts.map((account, idx) => {
                    const score = account.healthScore ?? 0;
                    const statusMap: Record<string, { label: string; cls: string }> = {
                      active: { label: "运行中", cls: "bg-green-900/40 text-green-400 border-green-700/50" },
                      inactive: { label: "未激活", cls: "bg-slate-200/40 text-slate-500 border-slate-300/50" },
                      banned: { label: "已封禁", cls: "bg-red-900/40 text-red-400 border-red-700/50" },
                      error: { label: "异常", cls: "bg-orange-900/40 text-orange-400 border-orange-700/50" },
                    };
                    const roleMap: Record<string, string> = { monitor: "仅监控", sender: "仅发信", both: "监控+发信" };
                    const st = statusMap[account.sessionStatus ?? "inactive"] ?? statusMap.inactive;
                    const privateCount = (account as any).privateGroupCount ?? 0;
                    const publicCount = (account as any).publicGroupCount ?? 0;
                    const totalCount = (account as any).totalGroupCount ?? 0;
                    const joinedCount = (account as any).joinedGroupCount;
                    const assignedCount = (account as any).assignedGroupCount ?? 0;
                    const pendingCount = (account as any).pendingGroupCount ?? 0;
                    const notFoundCount = (account as any).notFoundGroupCount ?? 0;
                    return (
                      <tr key={account.id} className={`border-b border-slate-200/50 hover:bg-slate-200/20 transition-colors ${idx % 2 === 0 ? "" : "bg-slate-100/20"}`}>
                        {/* 复选框 */}
                        <td className="px-3 py-3 w-8">{/* td-checkbox-col */}
                          <input type="checkbox" className="rounded border-slate-300 bg-slate-200 cursor-pointer"
                            checked={selectedIds.includes(account.id)}
                            onChange={() => toggleSelect(account.id)} />
                        </td>
                        {/* 账号信息 */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white font-bold text-sm shrink-0">
                              {(account.tgFirstName ?? account.phone ?? "?")[0]?.toUpperCase()}
                            </div>
                            <div>
                              <p className="font-medium text-slate-800">
                                {account.tgFirstName ? `${account.tgFirstName} ${account.tgLastName ?? ""}`.trim() : `账号 #${account.id}`}
                              </p>
                              <p className="text-xs text-slate-500">
                                {account.phone && <span className="mr-2">{account.phone}</span>}
                                {account.tgUsername && <span className="text-blue-400">@{account.tgUsername}</span>}
                              </p>
                            </div>
                          </div>
                        </td>
                        {/* 归属用户（仅管理员） */}
                        {user?.role === "admin" && (
                          <td className="px-4 py-3">
                            <span className="text-xs px-2 py-1 rounded bg-purple-100 text-purple-700 border border-purple-700/40">
                              {(account as any).ownerName || (account as any).ownerEmail || `用户#${account.userId}`}
                            </span>
                          </td>
                        )}
                        {/* 状态 */}
                        <td className="px-4 py-3">
                          <Badge className={`text-xs border ${st.cls}`}>{st.label}</Badge>
                        </td>
                        {/* 角色 */}
                        <td className="px-4 py-3">
                          <span className="text-xs text-slate-500">{roleMap[account.accountRole ?? "both"]}</span>
                        </td>
                        {/* 私有群组数 */}
                        <td className="px-4 py-3 text-center">
                          <span className={`text-sm font-bold ${privateCount > 0 ? "text-blue-400" : "text-slate-600"}`}>{privateCount}</span>
                        </td>
                        {/* 已加入公共群组数 */}
                        <td className="px-4 py-3 text-center">
                          <span className={`text-sm font-bold ${publicCount > 0 ? "text-green-400" : "text-slate-600"}`}>{publicCount}</span>
                        </td>
                        {/* 已分配公共群组数 */}
                        <td className="px-4 py-3 text-center">
                          <span className={`text-sm font-bold ${assignedCount > 0 ? "text-cyan-400" : "text-slate-600"}`}>{assignedCount}</span>
                        </td>
                        {/* 待加入群组数 */}
                        <td className="px-4 py-3 text-center">
                          <span className={`text-sm font-bold ${pendingCount > 0 ? "text-yellow-400" : "text-slate-600"}`}>{pendingCount}</span>
                        </td>
                        {/* 无效群组数（not_found） */}
                        <td className="px-4 py-3 text-center">
                          <span className={`text-sm font-bold ${notFoundCount > 0 ? "text-red-400" : "text-slate-600"}`}>{notFoundCount}</span>
                        </td>
                        {/* 健康度 */}
                        <td className="px-4 py-3 text-center">
                          <div className="flex flex-col items-center gap-1">
                            <span className={`text-sm font-bold ${healthColor(score)}`}>{score}</span>
                            <Progress value={score} className="w-16 h-1.5" />
                          </div>
                        </td>
                        {/* 今日发信 */}
                        <td className="px-4 py-3 text-center">
                          <span className="text-sm text-slate-500">{account.dailyDmSent ?? 0}</span>
                        </td>
                        {/* 引擎状态 */}
                        <td className="px-4 py-3 text-center">
                          {(account as any).inEngine ? (
                            <span title="已加入监控引擎" className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-900/40 text-green-400">
                              <Server className="w-3 h-3" />
                            </span>
                          ) : (
                            <span title="备用账号（未加入引擎）" className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-200/40 text-slate-500">
                              <ServerOff className="w-3 h-3" />
                            </span>
                          )}
                        </td>
                        {/* 操作 */}
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="icon" variant="ghost" className="w-7 h-7 text-slate-500 hover:text-purple-400" title="从TG账号导入群组到公共群组池"
                              onClick={() => openImportChats(account.id)}>
                              {importChatsLoading && importChatsAccountId === account.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <FolderInput className="w-3 h-3" />}
                            </Button>

                            <Button size="icon" variant="ghost" className="w-7 h-7 text-slate-500 hover:text-green-400" title="测试连接"
                              onClick={async () => { const r = await testConn.mutateAsync({ id: account.id }); if (r.success) { toast.success(r.message); refresh(); } else toast.error(r.message); }}>
                              {testConn.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                            </Button>
                            <Button size="icon" variant="ghost"
                              className={`w-7 h-7 ${account.isActive ? "text-green-400 hover:text-slate-500" : "text-slate-500 hover:text-green-400"}`}
                              title={account.isActive ? "停用" : "启用"}
                              onClick={async () => { await toggleActive.mutateAsync({ id: account.id, isActive: !account.isActive }); refresh(); toast.success(account.isActive ? "账号已停用" : "账号已启用"); }}>
                              {account.isActive ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                            </Button>
                            <Button size="icon" variant="ghost" className="w-7 h-7 text-slate-500 hover:text-blue-400" title="编辑"
                              onClick={() => setEditAccount({ id: account.id, accountRole: account.accountRole ?? "both", notes: account.notes ?? "", maxGroupsLimit: (account as any).maxGroupsLimit ?? null })}>  
                              <Edit2 className="w-3 h-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="w-7 h-7 text-slate-500 hover:text-red-400" title="删除" onClick={() => setDeleteId(account.id)}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          </>
        )}
      </div>
            {/* ─── 手机号登录 Dialog ─────────────────────────────────────────────── */}
      <Dialog open={addMode === "phone"} onOpenChange={(o) => { if (!o) closeDialog(); }}>
        <DialogContent className="bg-white border-slate-200 text-slate-800 max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Phone className="w-5 h-5 text-blue-400" /> 手机号登录 Telegram
            </DialogTitle>
            <DialogDescription className="text-slate-500">使用手机号和验证码安全接入您的 Telegram 账号</DialogDescription>
          </DialogHeader>

          {/* 步骤指示器 */}
          <div className="flex items-center gap-1 text-xs mb-2 flex-wrap">
            {PHONE_STEPS.map((step, i) => {
              const currentIdx = PHONE_STEPS.indexOf(phoneStep);
              const isActive = step === phoneStep;
              const isDone = PHONE_STEPS.indexOf(step) < currentIdx;
              return (
                <div key={step} className="flex items-center gap-1">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold
                    ${isDone ? "bg-green-500 text-white" : isActive ? "bg-blue-500 text-white" : "bg-slate-200 text-slate-500"}`}>
                    {isDone ? "✓" : i + 1}
                  </div>
                  <span className={isActive ? "text-slate-800" : "text-slate-500"}>{STEP_LABELS[i]}</span>
                  {i < 3 && <ChevronRight className="w-3 h-3 text-slate-600" />}
                </div>
              );
            })}
          </div>

          {phoneStep === "phone" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-slate-600">手机号（含国际区号）</Label>
                <Input placeholder="+8613800000000" value={phoneForm.phone}
                  onChange={(e) => setPhoneForm((f) => ({ ...f, phone: e.target.value }))}
                  className="bg-slate-100 border-slate-300 text-slate-800 placeholder-slate-500"
                  onKeyDown={(e) => e.key === "Enter" && handleSendCode()} />
                <p className="text-xs text-slate-500">示例：+8613800000000（中国）、+6591234567（新加坡）</p>
              </div>
              <div className="space-y-2">
                <Label className="text-slate-600">账号角色</Label>
                <Select value={phoneForm.role} onValueChange={(v) => setPhoneForm((f) => ({ ...f, role: v as any }))}>
                  <SelectTrigger className="bg-slate-100 border-slate-300 text-slate-800"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-slate-100 border-slate-300">
                    <SelectItem value="both">监控 + 发信（推荐）</SelectItem>
                    <SelectItem value="monitor">仅监控</SelectItem>
                    <SelectItem value="sender">仅发信</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-600 space-y-1">
                <p className="font-medium flex items-center gap-1"><Shield className="w-3 h-3" /> 安全提示</p>
                <p>• 验证码将发送到您的 Telegram 账号（非 SMS）</p>
                <p>• 建议使用专用账号，避免使用主账号</p>
                <p>• Session 将加密存储在服务器</p>
              </div>
            </div>
          )}

          {phoneStep === "code" && (
            <div className="space-y-4">
              <div className="bg-slate-100 rounded-lg p-3 text-sm text-slate-600 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-blue-400 shrink-0" />
                验证码已发送至 <span className="text-slate-800 font-medium">{phoneForm.phone}</span> 的 Telegram
              </div>
              <div className="space-y-2">
                <Label className="text-slate-600">验证码</Label>
                <Input placeholder="请输入验证码" value={phoneForm.code}
                  onChange={(e) => setPhoneForm((f) => ({ ...f, code: e.target.value.replace(/\D/g, "").slice(0, 8) }))}
                  className="bg-slate-100 border-slate-300 text-slate-800 text-center text-xl tracking-widest"
                  maxLength={8} onKeyDown={(e) => e.key === "Enter" && handleVerifyCode()} />
              </div>
              <div className="flex justify-between text-xs text-slate-500">
                <button onClick={() => setPhoneStep("phone")} className="hover:text-slate-600 underline">← 修改手机号</button>
                <button onClick={handleSendCode} className="hover:text-slate-600 underline">重新发送</button>
              </div>
            </div>
          )}

          {phoneStep === "twofa" && (
            <div className="space-y-4">
              <div className="bg-amber-950/40 border border-amber-700/40 rounded-lg p-3 text-sm text-amber-300 flex items-center gap-2">
                <Shield className="w-4 h-4 shrink-0" /> 该账号已开启二步验证，请输入您设置的密码
              </div>
              <div className="space-y-2">
                <Label className="text-slate-600">二步验证密码</Label>
                <div className="relative">
                  <Input type={show2faPassword ? "text" : "password"} placeholder="请输入二步验证密码"
                    value={phoneForm.password}
                    onChange={(e) => setPhoneForm((f) => ({ ...f, password: e.target.value }))}
                    className="bg-slate-100 border-slate-300 text-slate-800 pr-10"
                    onKeyDown={(e) => e.key === "Enter" && handleVerify2FA()} />
                  <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800"
                    onClick={() => setShow2faPassword((v) => !v)}>
                    {show2faPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
          )}

          {phoneStep === "done" && (
            <div className="text-center py-6 space-y-3">
              <CheckCircle2 className="w-16 h-16 text-green-400 mx-auto" />
              <p className="text-lg font-semibold text-slate-800">账号添加成功！</p>
              <p className="text-sm text-slate-500">账号已成功登录并添加到账号列表</p>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={closeDialog} className="text-slate-500 hover:text-slate-800">
              {phoneStep === "done" ? "关闭" : "取消"}
            </Button>
            {phoneStep === "phone" && (
              <Button onClick={handleSendCode} disabled={sendCode.isPending} className="bg-blue-600 hover:bg-blue-700">
                {sendCode.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />} 发送验证码
              </Button>
            )}
            {phoneStep === "code" && (
              <Button onClick={handleVerifyCode} disabled={verifyCode.isPending} className="bg-blue-600 hover:bg-blue-700">
                {verifyCode.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />} 验证并登录
              </Button>
            )}
            {phoneStep === "twofa" && (
              <Button onClick={handleVerify2FA} disabled={verify2FA.isPending} className="bg-amber-600 hover:bg-amber-700">
                {verify2FA.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />} 确认密码
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── 批量导入 Session Dialog ────────────────────────────────────────── */}
      <Dialog open={addMode === "session_bulk"} onOpenChange={(o) => { if (!o) closeDialog(); }}>
        <DialogContent className="bg-white border-slate-200 text-slate-800 max-w-2xl h-[85vh] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5 text-cyan-400" /> 批量导入 Session
            </DialogTitle>
            <DialogDescription className="text-slate-500">支持文本粘贴或文件上传，单次最多导入 100 个账号</DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto min-h-0">
          {importStep === "input" && (
            <div className="space-y-4">
              <Tabs defaultValue="text" className="w-full">
                <TabsList className="bg-slate-100 border border-slate-200">
                  <TabsTrigger value="text" className="data-[state=active]:bg-slate-200">文本粘贴</TabsTrigger>
                  <TabsTrigger value="file" className="data-[state=active]:bg-slate-200">文件上传</TabsTrigger>
                  <TabsTrigger value="format" className="data-[state=active]:bg-slate-200">格式说明</TabsTrigger>
                </TabsList>

                <TabsContent value="text" className="space-y-3 mt-3">
                  <div className="flex items-center gap-3">
                    <Label className="text-slate-600 shrink-0">解析格式</Label>
                    <Select value={bulkFormat} onValueChange={(v) => setBulkFormat(v as any)}>
                      <SelectTrigger className="bg-slate-100 border-slate-300 text-slate-800 w-44"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-slate-100 border-slate-300">
                        <SelectItem value="auto">自动识别</SelectItem>
                        <SelectItem value="one_per_line">每行一个 Session</SelectItem>
                        <SelectItem value="json">JSON 数组</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Textarea
                    placeholder={"每行一个 Session 字符串，或 JSON 数组格式\n\n示例（每行）：\n1BVtsOK8Buxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n\n示例（带手机号）：\n+8613800000000|1BVtsOK8Buxxxxxxxx..."}
                    value={bulkText} onChange={(e) => setBulkText(e.target.value)}
                    className="bg-slate-100 border-slate-300 text-slate-800 placeholder-slate-600 font-mono text-xs min-h-[160px]" />
                </TabsContent>

                <TabsContent value="file" className="mt-3">
                  <div className="border-2 border-dashed border-slate-300 rounded-lg p-10 text-center cursor-pointer hover:border-cyan-500 transition-colors"
                    onClick={() => fileInputRef.current?.click()}>
                    <Download className="w-10 h-10 text-slate-500 mx-auto mb-3" />
                    <p className="text-slate-600 font-medium">点击选择文件</p>
                    <p className="text-slate-500 text-sm mt-1">支持 .txt、.json 格式</p>
                    {bulkText && <p className="text-green-400 text-sm mt-3">✓ 已读取 {bulkText.split("\n").filter(Boolean).length} 行</p>}
                  </div>
                  <input ref={fileInputRef} type="file" accept=".txt,.json" className="hidden" onChange={handleFileUpload} />
                </TabsContent>

                <TabsContent value="format" className="mt-3">
                  <div className="bg-slate-100 rounded-lg p-4 space-y-4 text-sm">
                    <div>
                      <p className="text-cyan-400 font-medium mb-2">格式一：每行一个 Session</p>
                      <pre className="text-slate-600 text-xs bg-white p-3 rounded overflow-x-auto whitespace-pre-wrap">{`1BVtsOK8BuXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX\n1BVtsOK8BuYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY`}</pre>
                    </div>
                    <div>
                      <p className="text-cyan-400 font-medium mb-2">格式二：手机号|Session（竖线分隔）</p>
                      <pre className="text-slate-600 text-xs bg-white p-3 rounded overflow-x-auto whitespace-pre-wrap">{`+8613800000001|1BVtsOK8BuXXXXXXXXXXXXXXXXXXXXXXXXXX\n+6591234567|1BVtsOK8BuYYYYYYYYYYYYYYYYYYYYYYYYYYYY`}</pre>
                    </div>
                    <div>
                      <p className="text-cyan-400 font-medium mb-2">格式三：JSON 数组</p>
                      <pre className="text-slate-600 text-xs bg-white p-3 rounded overflow-x-auto whitespace-pre-wrap">{`[\n  {"phone": "+8613800000001", "session": "1BVtsOK8Bu..."},\n  {"phone": "+6591234567", "session": "1BVtsOK8Bu..."}\n]`}</pre>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}

          {importStep === "preview" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-slate-600 font-medium">解析结果预览</p>
                <Badge variant="outline" className="border-cyan-600 text-cyan-400">{parsedSessions.length} 个有效 Session</Badge>
              </div>
              {parseErrors.length > 0 && (
                <div className="bg-red-950/40 border border-red-800/40 rounded-lg p-3 space-y-1">
                  <p className="text-red-400 text-xs font-medium flex items-center gap-1"><AlertCircle className="w-3 h-3" /> 解析警告（{parseErrors.length} 条）</p>
                  {parseErrors.slice(0, 5).map((e, i) => <p key={i} className="text-red-300 text-xs">• {e}</p>)}
                  {parseErrors.length > 5 && <p className="text-red-400 text-xs">...还有 {parseErrors.length - 5} 条</p>}
                </div>
              )}
              <div className="max-h-56 overflow-y-auto space-y-2">
                {parsedSessions.map((s, i) => (
                  <div key={i} className="bg-slate-100 rounded-lg p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-slate-800 text-sm font-medium">{s.phone ?? `Session #${i + 1}`}</p>
                      <p className="text-slate-500 text-xs font-mono truncate">{s.sessionString.slice(0, 40)}...</p>
                    </div>
                    <Select value={s.accountRole}
                      onValueChange={(v) => { const u = [...parsedSessions]; u[i] = { ...s, accountRole: v as any }; setParsedSessions(u); }}>
                      <SelectTrigger className="bg-slate-200 border-slate-300 text-slate-800 w-28 h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-slate-100 border-slate-300">
                        <SelectItem value="both">监控+发信</SelectItem>
                        <SelectItem value="monitor">仅监控</SelectItem>
                        <SelectItem value="sender">仅发信</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {importStep === "done" && importResult && (
            <div className="text-center py-6 space-y-4">
              <CheckCircle2 className="w-16 h-16 text-green-400 mx-auto" />
              <p className="text-lg font-semibold text-slate-800">导入完成</p>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-green-950/40 border border-green-800/40 rounded-lg p-3">
                  <p className="text-2xl font-bold text-green-400">{importResult.imported}</p>
                  <p className="text-xs text-slate-500">成功导入</p>
                </div>
                <div className="bg-red-950/40 border border-red-800/40 rounded-lg p-3">
                  <p className="text-2xl font-bold text-red-400">{importResult.failed}</p>
                  <p className="text-xs text-slate-500">导入失败</p>
                </div>
                <div className="bg-amber-950/40 border border-amber-800/40 rounded-lg p-3">
                  <p className="text-2xl font-bold text-amber-400">{importResult.skipped}</p>
                  <p className="text-xs text-slate-500">配额不足跳过</p>
                </div>
              </div>
            </div>
          )}

          </div>
          <DialogFooter className="gap-2 shrink-0">
            <Button variant="ghost" onClick={closeDialog} className="text-slate-500 hover:text-slate-800">
              {importStep === "done" ? "关闭" : "取消"}
            </Button>
            {importStep === "input" && (
              <Button onClick={handleParseText} disabled={parseSessionText.isPending || !bulkText.trim()} className="bg-cyan-600 hover:bg-cyan-700">
                {parseSessionText.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />} 解析预览
              </Button>
            )}
            {importStep === "preview" && (
              <>
                <Button variant="outline" onClick={() => setImportStep("input")} className="border-slate-300 text-slate-600">返回修改</Button>
                <Button onClick={handleImport} disabled={importSessions.isPending || parsedSessions.length === 0} className="bg-cyan-600 hover:bg-cyan-700">
                  {importSessions.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />} 确认导入 {parsedSessions.length} 个
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

        {/* ─── 编辑账号 Dialog ────────────────────────────────────────────────── */}
      <Dialog open={editAccount !== null} onOpenChange={(o) => { if (!o) setEditAccount(null); }}>
        <DialogContent className="bg-white border-slate-200 text-slate-800 max-w-2xl h-[85vh] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2"><Edit2 className="w-5 h-5 text-blue-400" /> 编辑账号</DialogTitle>
            <DialogDescription className="text-slate-500">修改账号信息，或查看该账号已加入的群组</DialogDescription>
          </DialogHeader>
          {editAccount && (
            <Tabs defaultValue="info" className="flex-1 flex flex-col min-h-0">
              <TabsList className="bg-slate-100 border border-slate-200 shrink-0">
                <TabsTrigger value="info" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white">基本信息</TabsTrigger>
                <TabsTrigger value="monitor" className="data-[state=active]:bg-green-600 data-[state=active]:text-white">添加/导入群组</TabsTrigger>
                <TabsTrigger value="groups" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white">已加入群组</TabsTrigger>
                <TabsTrigger value="pending" className="data-[state=active]:bg-yellow-600 data-[state=active]:text-white">待加入群组</TabsTrigger>
                <TabsTrigger value="joinconfig" className="data-[state=active]:bg-purple-600 data-[state=active]:text-white" onClick={() => {
                  if (!joinCfgLoaded && joinConfig) {
                    setJoinCfgMin(joinConfig.joinIntervalMin);
                    setJoinCfgMax(joinConfig.joinIntervalMax);
                    setJoinCfgMax2(joinConfig.maxGroupsPerAccount);
                    setJoinCfgEnabled(joinConfig.joinEnabled);
                    setJoinCfgDistributeCount(joinConfig.distributeCount ?? 0);
                    setJoinCfgLoaded(true);
                  }
                }}>加群配置</TabsTrigger>
              </TabsList>

              {/* ── 基本信息 Tab ── */}
              <TabsContent value="info" className="flex-1 overflow-y-auto">
                <div className="space-y-4 py-2">
                  <div className="space-y-2">
                    <Label className="text-slate-600">账号角色</Label>
                    <Select value={editAccount.accountRole} onValueChange={(v) => setEditAccount((a) => a ? { ...a, accountRole: v } : a)}>
                      <SelectTrigger className="bg-slate-100 border-slate-300 text-slate-800"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-slate-100 border-slate-300">
                        <SelectItem value="both">监控 + 发信（推荐）</SelectItem>
                        <SelectItem value="monitor">仅监控</SelectItem>
                        <SelectItem value="sender">仅发信</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-slate-600">加群上限（留空使用全局设置）</Label>
                    <Input
                      type="number"
                      placeholder={`全局默认（如 300）`}
                      value={editAccount.maxGroupsLimit ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setEditAccount((a) => a ? { ...a, maxGroupsLimit: v === "" ? null : parseInt(v) || null } : a);
                      }}
                      min={1}
                      max={10000}
                      className="bg-slate-100 border-slate-300 text-slate-800 placeholder-slate-500"
                    />
                    <p className="text-xs text-slate-500">设置后此账号最多加入该数量的群组，覆盖全局上限</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-slate-600">备注（可选）</Label>
                    <Input
                      placeholder="输入备注信息..."
                      value={editAccount.notes}
                      onChange={(e) => setEditAccount((a) => a ? { ...a, notes: e.target.value } : a)}
                      className="bg-slate-100 border-slate-300 text-slate-800 placeholder-slate-500"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="ghost" onClick={() => setEditAccount(null)} className="text-slate-500 hover:text-slate-800">取消</Button>
                  <Button
                    onClick={async () => {
                      if (!editAccount) return;
                      try {
                        await updateAccount.mutateAsync({
                          id: editAccount.id,
                          accountRole: editAccount.accountRole as "monitor" | "sender" | "both",
                          notes: editAccount.notes || undefined,
                          maxGroupsLimit: editAccount.maxGroupsLimit,
                        });
                        setEditAccount(null);
                        refresh();
                        toast.success("账号信息已更新");
                      } catch (e: any) { toast.error(e.message ?? "更新失败"); }
                    }}
                    disabled={updateAccount.isPending}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {updateAccount.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />} 保存修改
                  </Button>
                </div>
              </TabsContent>

              {/* ── 添加/导入群组 Tab ── */}
              <TabsContent value="monitor" className="flex-1 flex flex-col min-h-0">
                <AccountMonitorGroupsTab accountId={editAccount.id} />
              </TabsContent>

              {/* ── 已加入群组 Tab ── */}
              <TabsContent value="groups" className="flex-1 flex flex-col min-h-0">
                <AccountJoinedGroupsTab accountId={editAccount.id} />
              </TabsContent>

              {/* ── 待加入群组 Tab ── */}
              <TabsContent value="pending" className="flex-1 flex flex-col min-h-0">
                <AccountPendingGroupsTab accountId={editAccount.id} />
              </TabsContent>

              {/* ── 加群配置 Tab ── */}
              <TabsContent value="joinconfig" className="flex-1 overflow-y-auto">
                <div className="space-y-4 py-2">
                  <div className="p-3 bg-purple-900/20 border border-purple-700/40 rounded-lg text-xs text-purple-600">
                    以下为全局加群参数，影响所有系统账号。账号级别的加群上限可在「基本信息」tab 中单独设置。
                  </div>
                  {/* 启用自动加群 */}
                  <div className="flex items-center justify-between p-3 bg-slate-100/70 rounded-lg border border-slate-200/50">
                    <div>
                      <p className="text-sm font-medium text-slate-800">启用自动加群</p>
                      <p className="text-xs text-slate-500">引擎启动时自动让监控账号加入所有公共群组</p>
                    </div>
                    <button
                      onClick={() => setJoinCfgEnabled(v => !v)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        joinCfgEnabled ? 'bg-yellow-500' : 'bg-slate-600'
                      }`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        joinCfgEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`} />
                    </button>
                  </div>
                  {/* 加群间隔 */}
                  <div className="space-y-2">
                    <Label className="text-slate-600 text-sm">加群间隔（秒）</Label>
                    <p className="text-xs text-slate-500">每次加群之间的随机等待时间，建议 30-120 秒防封号</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-500">最小间隔（秒）</Label>
                        <Input
                          type="number" min={5} max={3600}
                          value={joinCfgLoaded ? joinCfgMin : (joinConfig?.joinIntervalMin ?? 30)}
                          onChange={(e) => { setJoinCfgLoaded(true); setJoinCfgMin(Number(e.target.value)); }}
                          className="bg-slate-100 border-slate-300 text-slate-800"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-500">最大间隔（秒）</Label>
                        <Input
                          type="number" min={5} max={3600}
                          value={joinCfgLoaded ? joinCfgMax : (joinConfig?.joinIntervalMax ?? 60)}
                          onChange={(e) => { setJoinCfgLoaded(true); setJoinCfgMax(Number(e.target.value)); }}
                          className="bg-slate-100 border-slate-300 text-slate-800"
                        />
                      </div>
                    </div>
                  </div>
                  {/* 每账号最多加入群组数 */}
                  <div className="space-y-2">
                    <Label className="text-slate-600 text-sm">全局每账号最多加入群组数</Label>
                    <p className="text-xs text-slate-500">单个监控账号最多加入的群组数量，超出部分由其他账号负责</p>
                    <Input
                      type="number" min={1} max={2000}
                      value={joinCfgLoaded ? joinCfgMax2 : (joinConfig?.maxGroupsPerAccount ?? 300)}
                      onChange={(e) => { setJoinCfgLoaded(true); setJoinCfgMax2(Number(e.target.value)); }}
                      className="bg-slate-100 border-slate-300 text-slate-800"
                    />
                  </div>
                  {/* 每次分配数量 */}
                  <div className="space-y-2">
                    <Label className="text-slate-600 text-sm">每次分配数量（0 = 按配额全量分配）</Label>
                    <p className="text-xs text-slate-500">点击「按配额分配」时，每个账号本次最多分配的群组数量。设为 0 则按剩余配额全量分配</p>
                    <Input
                      type="number" min={0} max={10000}
                      value={joinCfgLoaded ? joinCfgDistributeCount : (joinConfig?.distributeCount ?? 0)}
                      onChange={(e) => { setJoinCfgLoaded(true); setJoinCfgDistributeCount(Number(e.target.value)); }}
                      className="bg-slate-100 border-slate-300 text-slate-800"
                    />
                  </div>
                  <Button
                    onClick={() => updateJoinConfig.mutate({
                      joinIntervalMin: joinCfgLoaded ? joinCfgMin : (joinConfig?.joinIntervalMin ?? 30),
                      joinIntervalMax: joinCfgLoaded ? joinCfgMax : (joinConfig?.joinIntervalMax ?? 60),
                      maxGroupsPerAccount: joinCfgLoaded ? joinCfgMax2 : (joinConfig?.maxGroupsPerAccount ?? 300),
                      joinEnabled: joinCfgLoaded ? joinCfgEnabled : (joinConfig?.joinEnabled ?? true),
                      distributeCount: joinCfgLoaded ? joinCfgDistributeCount : (joinConfig?.distributeCount ?? 0),
                    })}
                    disabled={updateJoinConfig.isPending}
                    className="w-full bg-purple-600 hover:bg-purple-700"
                  >
                    {updateJoinConfig.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                    保存加群配置
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

       {/* ─── 导入群组到公共群组池 Dialog ─────────────────────────────────── */}
      <Dialog open={importChatsAccountId !== null} onOpenChange={(o) => { if (!o) { setImportChatsAccountId(null); setImportChatsList([]); setImportChatsSelected(new Set()); setImportChatsStep('loading'); setImportChatsError(''); } }}>
        <DialogContent className="bg-white border-slate-200 text-slate-800 max-w-2xl h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderInput className="w-5 h-5 text-purple-400" /> 从TG账号导入群组到公共群组池
            </DialogTitle>
            <DialogDescription className="text-slate-500">
              读取该TG账号已加入的群组，选择后批量导入到公共群组池，引擎将自动订阅监控这些群组的消息
            </DialogDescription>
          </DialogHeader>

          {importChatsStep === 'loading' && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
              <p className="text-slate-500 text-sm">正在从引擎读取群组列表，请稍候...</p>
            </div>
          )}

          {importChatsStep === 'select' && (
            <>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-500">共找到 <span className="text-slate-800 font-bold">{importChatsList.length}</span> 个群组，已选 <span className="text-purple-400 font-bold">{importChatsSelected.size}</span> 个</span>
                <div className="flex gap-2">
                  <button className="text-xs text-slate-500 hover:text-slate-800 underline" onClick={() => setImportChatsSelected(new Set(importChatsList.map(c => c.chatId)))}>全选</button>
                  <button className="text-xs text-slate-500 hover:text-slate-800 underline" onClick={() => setImportChatsSelected(new Set())}>全不选</button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto space-y-1 max-h-96 pr-1">
                {importChatsList.length === 0 ? (
                  <div className="text-center py-8 text-slate-500">
                    <PackagePlus className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    <p>该账号暂无已加入的群组（可能 session 已失效）</p>
                  </div>
                ) : importChatsList.map(chat => (
                  <label key={chat.chatId} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-100 cursor-pointer">
                    <input type="checkbox"
                      className="rounded border-slate-300 bg-slate-200 cursor-pointer"
                      checked={importChatsSelected.has(chat.chatId)}
                      onChange={(e) => {
                        const next = new Set(importChatsSelected);
                        if (e.target.checked) next.add(chat.chatId); else next.delete(chat.chatId);
                        setImportChatsSelected(next);
                      }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-800 truncate">{chat.title || chat.chatId}</p>
                      <p className="text-xs text-slate-500">{chat.username ? `@${chat.username}` : `ID: ${chat.chatId}`} &middot; {chat.type === 'supergroup' ? '超级群组' : '普通群组'}</p>
                    </div>
                  </label>
                ))}
              </div>
              <DialogFooter className="gap-2 pt-2">
                <Button variant="ghost" onClick={() => setImportChatsAccountId(null)} className="text-slate-500 hover:text-slate-800">取消</Button>
                <Button
                  onClick={handleImportChats}
                  disabled={importChatsToPublic.isPending || importChatsSelected.size === 0}
                  className="bg-purple-600 hover:bg-purple-700">
                  {importChatsToPublic.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                  导入选中的 {importChatsSelected.size} 个群组
                </Button>
              </DialogFooter>
            </>
          )}

          {importChatsStep === 'done' && (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <CheckCircle2 className="w-12 h-12 text-green-400" />
              <p className="text-slate-800 font-medium">导入完成！</p>
              <p className="text-slate-500 text-sm">公共群组池已更新，引擎将在下次轮询时自动订阅监控这些群组的消息</p>
              <Button onClick={() => setImportChatsAccountId(null)} className="bg-slate-200 hover:bg-slate-600">关闭</Button>
            </div>
          )}

          {importChatsStep === 'error' && (
            <div className="flex flex-col items-center justify-center py-10 gap-4">
              <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
                <span className="text-red-400 text-2xl">⚠</span>
              </div>
              <p className="text-slate-800 font-medium">获取群组列表失败</p>
              <p className="text-slate-500 text-sm text-center max-w-sm">{importChatsError}</p>
              <div className="text-xs text-slate-500 bg-slate-100 rounded-lg p-3 max-w-sm w-full">
                <p className="font-medium text-slate-500 mb-1">常见原因：</p>
                <p>• 账号 session 已失效，需要重新登录</p>
                <p>• 账号未在引擎中运行，请先启用账号</p>
                <p>• 引擎初始化中，请等待 30 秒后重试</p>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setImportChatsAccountId(null)} className="text-slate-500 hover:text-slate-800">关闭</Button>
                <Button onClick={() => importChatsAccountId && openImportChats(importChatsAccountId)} className="bg-purple-600 hover:bg-purple-700">
                  <RefreshCw className="w-4 h-4 mr-2" />重试
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ─── 删除确认 ─────────────────────────────────────────────────── */}
      <Dialog open={deleteId !== null} onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
        <DialogContent className="bg-white border-slate-200 text-slate-800 max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400"><Trash2 className="w-5 h-5" /> 确认删除</DialogTitle>
            <DialogDescription className="text-slate-500">删除后该账号的 Session 将被清除，监控任务将停止。此操作不可撤销。</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setDeleteId(null)} className="text-slate-500">取消</Button>
            <Button variant="destructive"
              onClick={async () => {
                if (deleteId === null) return;
                await deleteMut.mutateAsync({ id: deleteId });
                setDeleteId(null); refresh(); toast.success("账号已删除");
              }} disabled={deleteMut.isPending}>
              {deleteMut.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />} 确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 频道检测已移至「已加入群组」Tab 内 */}


    </Layout>
  );
}

// ─── 已加入群组 Tab 子组件 ─────────────────────────────────────────────────────
function AccountJoinedGroupsTab({ accountId }: { accountId: number }) {
  // 频道检测状态
  const [detectMode, setDetectMode] = useState<'idle' | 'detecting' | 'done' | 'error'>('idle');
  const [detectProgress, setDetectProgress] = useState(0);
  const [detectTotal, setDetectTotal] = useState(0);
  const [detectNormal, setDetectNormal] = useState<any[]>([]);
  const [detectAbnormal, setDetectAbnormal] = useState<any[]>([]);
  const [detectError, setDetectError] = useState('');
  const [detectSelected, setDetectSelected] = useState<Set<string>>(new Set());
  const [detectView, setDetectView] = useState<'abnormal' | 'normal'>('abnormal');
  const checkGroupHealth = trpc.tgAccounts.checkGroupHealth.useMutation();
  const deleteAbnormalGroups = trpc.tgAccounts.deleteAbnormalPublicGroups.useMutation();
  // 直接从数据库查询已加入群组（毫秒级响应）
  const { data: dbData, isLoading: dbLoading, refetch: refetchDb } = trpc.tgAccounts.getAccountJoinedGroups.useQuery({ accountId });
  const data = dbData ? { total: dbData.total, groups: dbData.groups } : null;
  const isLoading = dbLoading;
  const [search, setSearch] = useState("");

  const filtered = (data?.groups ?? []).filter(g => {
    const kw = search.toLowerCase();
    return !kw || g.groupTitle.toLowerCase().includes(kw) || g.groupId.toLowerCase().includes(kw);
  });

  // 导出为 CSV
  const handleExport = () => {
    if (!data?.groups?.length) return;
    const header = "群组ID,群组名称,类型,TG链接,加入时间";
    const rows = data.groups.map(g =>
      [g.groupId, g.groupTitle, g.groupType, g.link, g.joinedAt ? new Date(g.joinedAt).toLocaleString("zh-CN") : ""].join(",")
    );
    const csv = "\uFEFF" + [header, ...rows].join("\n"); // BOM for Excel
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `account_${accountId}_groups_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 开始频道检测
  const handleStartDetect = async () => {
    if (!data?.groups?.length) return;
    setDetectMode('detecting');
    setDetectProgress(0);
    setDetectNormal([]);
    setDetectAbnormal([]);
    setDetectError('');
    const groupIds = data.groups.map((g: any) => g.groupId);
    setDetectTotal(groupIds.length);
    try {
      const res = await checkGroupHealth.mutateAsync({ accountId, groupIds });
      setDetectNormal(res.normalGroups ?? []);
      setDetectAbnormal(res.abnormalGroups ?? []);
      setDetectSelected(new Set((res.abnormalGroups ?? []).map((g: any) => g.groupId)));
      setDetectProgress(groupIds.length);
      setDetectMode('done');
    } catch (e: any) {
      setDetectError(e.message ?? '检测失败');
      setDetectMode('error');
    }
  };

  // 删除异常群组
  const handleDeleteAbnormal = async () => {
    const toDelete = Array.from(detectSelected);
    if (!toDelete.length) return;
    try {
      await deleteAbnormalGroups.mutateAsync({ groupIds: toDelete });
      toast.success(`已删除 ${toDelete.length} 个异常群组`);
      setDetectAbnormal(prev => prev.filter(g => !detectSelected.has(g.groupId)));
      setDetectSelected(new Set());
    } catch (e: any) {
      toast.error(e.message ?? '删除失败');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-blue-400 mr-2" />
        <span className="text-slate-500 text-sm">加载中...</span>
      </div>
    );
  }

  // 检测结果视图
  if (detectMode === 'done' || detectMode === 'detecting' || detectMode === 'error') {
    return (
      <div className="flex flex-col gap-3 py-2 h-full">
        <div className="flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-orange-500" />
            <span className="text-sm font-medium text-slate-700">频道健康检测</span>
            {detectMode === 'detecting' && <Loader2 className="w-4 h-4 animate-spin text-orange-400" />}
            {detectMode === 'done' && <CheckCircle className="w-4 h-4 text-green-500" />}
          </div>
          <Button size="sm" variant="outline" className="border-slate-300 text-slate-600 h-7 text-xs" onClick={() => setDetectMode('idle')}>
            返回列表
          </Button>
        </div>
        {detectMode === 'detecting' && (
          <div className="shrink-0">
            <div className="flex justify-between text-xs text-slate-500 mb-1">
              <span>正在检测...</span>
              <span>{detectProgress} / {detectTotal}</span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-2">
              <div className="bg-orange-500 h-2 rounded-full transition-all" style={{ width: `${detectTotal > 0 ? (detectProgress / detectTotal) * 100 : 0}%` }} />
            </div>
          </div>
        )}
        {detectMode === 'error' && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600 shrink-0">
            <AlertTriangle className="w-4 h-4 inline mr-1" /> {detectError}
            <Button size="sm" className="ml-3 h-6 text-xs bg-red-600 hover:bg-red-700" onClick={handleStartDetect}>重新检测</Button>
          </div>
        )}
        {detectMode === 'done' && (
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle className="w-3.5 h-3.5 text-green-500" />
              <span className="text-xs text-slate-600">正常</span>
              <span className="font-bold text-green-600">{detectNormal.length}</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg">
              <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
              <span className="text-xs text-slate-600">异常</span>
              <span className="font-bold text-red-600">{detectAbnormal.length}</span>
            </div>
            <div className="flex gap-1 ml-auto">
              <Button size="sm" variant={detectView === 'abnormal' ? 'default' : 'outline'} className={`h-6 text-xs ${detectView === 'abnormal' ? 'bg-red-600 hover:bg-red-700' : 'border-slate-300'}`} onClick={() => setDetectView('abnormal')}>
                异常群组
              </Button>
              <Button size="sm" variant={detectView === 'normal' ? 'default' : 'outline'} className={`h-6 text-xs ${detectView === 'normal' ? 'bg-green-600 hover:bg-green-700' : 'border-slate-300'}`} onClick={() => setDetectView('normal')}>
                正常群组
              </Button>
            </div>
          </div>
        )}
        {detectMode === 'done' && (
          <div className="flex-1 overflow-y-auto min-h-0 rounded border border-slate-200">
            {detectView === 'abnormal' ? (
              detectAbnormal.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-slate-500">
                  <CheckCircle className="w-10 h-10 text-green-400 mb-2" />
                  <p className="text-sm">太棒了！没有发现异常群组</p>
                </div>
              ) : (
                <div className="space-y-1 p-2">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-slate-500">选中 {detectSelected.size} 个，将从公共群组池删除</p>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="h-6 text-xs border-slate-300" onClick={() => setDetectSelected(new Set(detectAbnormal.map(g => g.groupId)))}>全选</Button>
                      <Button size="sm" variant="outline" className="h-6 text-xs border-slate-300" onClick={() => setDetectSelected(new Set())}>取消</Button>
                    </div>
                  </div>
                  {detectAbnormal.map((g) => (
                    <div key={g.groupId} className={`flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-colors ${detectSelected.has(g.groupId) ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200 opacity-60'}`}
                      onClick={() => setDetectSelected(prev => { const s = new Set(prev); s.has(g.groupId) ? s.delete(g.groupId) : s.add(g.groupId); return s; })}>
                      <input type="checkbox" checked={detectSelected.has(g.groupId)} onChange={() => {}} className="w-4 h-4 accent-red-500" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-800 text-sm truncate">{g.title || g.groupId}</span>
                          {g.username && <span className="text-slate-400 text-xs">@{g.username}</span>}
                          {g.memberCount > 0 && <span className="text-slate-400 text-xs">{g.memberCount.toLocaleString()} 人</span>}
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0" />
                          <span className="text-red-500 text-xs">{g.reason}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <div className="space-y-1 p-2">
                {detectNormal.map((g) => (
                  <div key={g.groupId} className="flex items-center gap-3 p-2 rounded-lg border bg-slate-50 border-slate-200">
                    <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-800 text-sm truncate">{g.title || g.groupId}</span>
                        {g.username && <span className="text-slate-400 text-xs">@{g.username}</span>}
                        {g.memberCount > 0 && <span className="text-slate-400 text-xs">{g.memberCount.toLocaleString()} 人</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {detectMode === 'done' && detectAbnormal.length > 0 && detectView === 'abnormal' && (
          <div className="shrink-0">
            <Button
              className="w-full bg-red-600 hover:bg-red-700"
              disabled={detectSelected.size === 0 || deleteAbnormalGroups.isPending}
              onClick={handleDeleteAbnormal}
            >
              {deleteAbnormalGroups.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1" />}
              删除选中的 {detectSelected.size} 个异常群组
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 py-2 h-full">
      {/* 顶部统计 + 操作栏 */}
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">
            共已加入 <span className="text-slate-800 font-bold">{data?.total ?? 0}</span> 个群组
          </span>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-slate-500 hover:text-slate-700" onClick={() => refetchDb()}>
            <RefreshCw className="w-3 h-3 mr-1" /> 刷新
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="border-orange-300 text-orange-600 hover:text-orange-700 hover:bg-orange-50 gap-1"
            onClick={handleStartDetect}
            disabled={!data?.groups?.length || checkGroupHealth.isPending}
          >
            <Activity className="w-3.5 h-3.5" /> 频道检测
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-slate-300 text-slate-600 hover:text-slate-800 hover:bg-slate-200 gap-1"
            onClick={handleExport}
            disabled={!data?.groups?.length}
          >
            <Download className="w-3.5 h-3.5" /> 导出 CSV
          </Button>
        </div>
      </div>

      {/* 搜索框 */}
      <Input
        placeholder="搜索群组名称或 ID..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="bg-slate-100 border-slate-300 text-slate-800 placeholder-slate-500 h-8 text-sm shrink-0"
      />

      {/* 群组列表 */}
      <div className="flex-1 overflow-y-auto min-h-0 rounded border border-slate-200">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-slate-500 text-sm">
            <Shield className="w-8 h-8 mb-2 opacity-40" />
            {search ? "没有匹配的群组" : "该账号暂无已加入的群组记录"}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-100 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-3 py-2">群组</th>
                <th className="text-left px-3 py-2 w-24">类型</th>
                <th className="text-left px-3 py-2 w-32">加入时间</th>
                <th className="text-center px-3 py-2 w-16">链接</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((g, i) => (
                <tr key={g.id} className={`border-t border-slate-200/50 hover:bg-slate-100/70 ${!g.isActive ? "opacity-50" : ""}`}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-800 truncate max-w-[200px]" title={g.groupTitle}>{g.groupTitle}</div>
                    <div className="text-slate-500 text-xs">@{g.groupId}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${g.groupType === "channel" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
                      {g.groupType === "channel" ? "频道" : "群组"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-500 text-xs">
                    {g.joinedAt ? new Date(g.joinedAt).toLocaleDateString("zh-CN") : "-"}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {g.link ? (
                      <a href={g.link} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">
                        <ChevronRight className="w-4 h-4 inline" />
                      </a>
                    ) : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── 待加入群组 Tab 组件 ──────────────────────────────────────────────────────
function AccountPendingGroupsTab({ accountId }: { accountId: number }) {
  const { data, isLoading, refetch } = trpc.tgAccounts.getAccountPendingGroups.useQuery({ accountId });
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const batchDelete = trpc.tgAccounts.batchDeleteJoinStatus.useMutation({
    onSuccess: (res) => {
      toast.success(`已删除 ${res.deleted} 条记录`);
      setSelected(new Set());
      refetch();
    },
    onError: () => toast.error('删除失败'),
  });

  const filtered = (data?.groups ?? []).filter(g => {
    const kw = search.toLowerCase();
    return !kw || g.groupTitle.toLowerCase().includes(kw) || g.groupId.toLowerCase().includes(kw);
  });

  const allFilteredIds = filtered.map(g => g.id);
  const isAllSelected = allFilteredIds.length > 0 && allFilteredIds.every(id => selected.has(id));
  const isPartialSelected = allFilteredIds.some(id => selected.has(id)) && !isAllSelected;

  const toggleAll = () => {
    if (isAllSelected) {
      setSelected(prev => { const s = new Set(prev); allFilteredIds.forEach(id => s.delete(id)); return s; });
    } else {
      setSelected(prev => { const s = new Set(prev); allFilteredIds.forEach(id => s.add(id)); return s; });
    }
  };

  const toggleOne = (id: number) => {
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  };

  const handleBatchDelete = () => {
    if (selected.size === 0) return;
    if (!confirm(`确认删除已选的 ${selected.size} 条待加入记录？删除后引擎将不再自动尝试加入这些群组。`)) return;
    batchDelete.mutate({ ids: Array.from(selected) });
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case "pending": return { text: "待加入", cls: "bg-yellow-900/50 text-yellow-300" };
      case "joining": return { text: "加入中", cls: "bg-blue-100 text-blue-700" };
      case "failed":  return { text: "失败", cls: "bg-red-900/50 text-red-600" };
      case "not_found": return { text: "未找到", cls: "bg-slate-200 text-slate-500" };
      default: return { text: status, cls: "bg-slate-200 text-slate-500" };
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-yellow-400 mr-2" />
        <span className="text-slate-500 text-sm">加载中...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 py-2 h-full">
      {/* 顶部统计 */}
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">
            待加入 <span className="text-yellow-400 font-bold">{data?.total ?? 0}</span> 个群组
          </span>
          <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
            已分配但尚未加入，引擎将自动执行加群
          </span>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <Button
              size="sm"
              variant="destructive"
              className="gap-1 h-7 text-xs"
              onClick={handleBatchDelete}
              disabled={batchDelete.isPending}
            >
              {batchDelete.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              删除已选 ({selected.size})
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="border-slate-300 text-slate-600 hover:text-slate-800 hover:bg-slate-200 gap-1"
            onClick={() => refetch()}
          >
            <RefreshCw className="w-3.5 h-3.5" /> 刷新
          </Button>
        </div>
      </div>

      {/* 搜索框 */}
      <Input
        placeholder="搜索群组名称或 ID..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="bg-slate-100 border-slate-300 text-slate-800 placeholder-slate-500 h-8 text-sm shrink-0"
      />

      {/* 群组列表 */}
      <div className="flex-1 overflow-y-auto min-h-0 rounded border border-slate-200">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-slate-500 text-sm">
            <Shield className="w-8 h-8 mb-2 opacity-40" />
            {search ? "没有匹配的群组" : "该账号暂无待加入的群组（所有分配群组均已加入）"}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-100 text-slate-500 text-xs">
              <tr>
                <th className="px-3 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    ref={el => { if (el) el.indeterminate = isPartialSelected; }}
                    onChange={toggleAll}
                    className="w-3.5 h-3.5 cursor-pointer accent-yellow-500"
                  />
                </th>
                <th className="text-left px-3 py-2">群组</th>
                <th className="text-left px-3 py-2 w-20">状态</th>
                <th className="text-left px-3 py-2 w-32">更新时间</th>
                <th className="text-left px-3 py-2">失败原因</th>
                <th className="text-center px-3 py-2 w-16">链接</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((g) => {
                const sl = statusLabel(g.status);
                return (
                  <tr key={g.id} className={`border-t border-slate-200/50 hover:bg-slate-100/70 ${!g.isActive ? "opacity-50" : ""} ${selected.has(g.id) ? "bg-yellow-900/20" : ""}`}>
                    <td className="px-3 py-2 w-8">
                      <input
                        type="checkbox"
                        checked={selected.has(g.id)}
                        onChange={() => toggleOne(g.id)}
                        className="w-3.5 h-3.5 cursor-pointer accent-yellow-500"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800 truncate max-w-[180px]" title={g.groupTitle}>{g.groupTitle || g.groupId}</div>
                      <div className="text-slate-500 text-xs">@{g.groupId}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${sl.cls}`}>{sl.text}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-500 text-xs">
                      {g.updatedAt ? new Date(g.updatedAt).toLocaleDateString("zh-CN") : "-"}
                    </td>
                    <td className="px-3 py-2 text-slate-500 text-xs truncate max-w-[160px]" title={g.errorMsg}>
                      {g.errorMsg || "-"}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {g.link ? (
                        <a href={g.link} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">
                          <ChevronRight className="w-4 h-4 inline" />
                        </a>
                      ) : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── 导入监控群组 Tab 组件 ──────────────────────────────────────────────────────
function AccountMonitorGroupsTab({ accountId }: { accountId: number }) {
  const [groupInput, setGroupInput] = useState("");
  const [joining, setJoining] = useState(false);
  const [batchInput, setBatchInput] = useState('');
  const [batchJoining, setBatchJoining] = useState(false);
  const [batchResult, setBatchResult] = useState('');
  const [search, setSearch] = useState("");
  const { data: monitorData, isLoading, refetch: refetchMonitor } = trpc.monitorGroups.list.useQuery();
  const importGroup = trpc.engine.importGroup.useMutation();
  const deleteGroup = trpc.monitorGroups.delete.useMutation();

  // 只显示当前账号的监控群组
  const myGroups = (monitorData ?? []).filter((g: any) => g.tgAccountId === accountId);
  const filtered = myGroups.filter((g: any) => {
    const kw = search.toLowerCase();
    return !kw || (g.groupTitle || "").toLowerCase().includes(kw) || (g.groupId || "").toLowerCase().includes(kw);
  });

  const handleJoin = async () => {
    if (!groupInput.trim()) return;
    setJoining(true);
    try {
      const res = await importGroup.mutateAsync({ tgAccountId: accountId, groupInput: groupInput.trim() });
      toast.success(res.message);
      setGroupInput("");
      refetchMonitor();
    } catch (e: any) {
      toast.error(e.message ?? "加群失败");
    } finally {
      setJoining(false);
    }
  };

  const handleBatchJoin = async () => {
    const lines = batchInput.split('\n').map((l: string) => l.trim()).filter(Boolean);
    if (!lines.length || batchJoining) return;
    setBatchJoining(true);
    setBatchResult('');
    let success = 0, failed = 0;
    for (const line of lines) {
      try {
        await importGroup.mutateAsync({ tgAccountId: accountId, groupInput: line });
        success++;
      } catch {
        failed++;
      }
    }
    setBatchResult(`完成：成功 ${success} 个，失败 ${failed} 个`);
    setBatchInput('');
    setBatchJoining(false);
    refetchMonitor();
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteGroup.mutateAsync({ id });
      toast.success("已移除监控群组");
      refetchMonitor();
    } catch (e: any) {
      toast.error(e.message ?? "删除失败");
    }
  };

  // 获取该账号的统计数据（已加入/待加入数量）
  const { data: statsData } = trpc.tgAccounts.getAccounts.useQuery(undefined, { select: (d) => d.accounts?.find((a: any) => a.id === accountId) });
  const joinedCount = statsData?.joinedGroupCount ?? 0;
  const pendingCount = statsData?.pendingGroupCount ?? 0;

  return (
    <div className="flex flex-col gap-3 py-2 h-full">
      {/* 统计徽章 */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
          <CheckCircle className="w-4 h-4 text-blue-500" />
          <span className="text-sm text-slate-600">已加入</span>
          <span className="text-lg font-bold text-blue-600">{joinedCount}</span>
          <span className="text-xs text-slate-500">个群组</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-lg">
          <Loader2 className="w-4 h-4 text-yellow-500" />
          <span className="text-sm text-slate-600">待加入</span>
          <span className="text-lg font-bold text-yellow-600">{pendingCount}</span>
          <span className="text-xs text-slate-500">个群组</span>
        </div>
      </div>
      {/* 说明 */}
      <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700">
        <strong>添加群组</strong>：输入群组链接或用户名，账号将自动加入并开始实时监控（延迟 &lt;1 秒）。
        支持格式：<code>@groupname</code>、<code>https://t.me/groupname</code>、<code>https://t.me/+invitelink</code>
      </div>
      {/* 输入框 + 按钮 */}
      <div className="flex gap-2 shrink-0">
        <Input
          placeholder="输入群组链接或用户名..."
          value={groupInput}
          onChange={(e) => setGroupInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !joining && handleJoin()}
          className="bg-slate-100 border-slate-300 text-slate-800 placeholder-slate-500 flex-1"
        />
        <Button
          onClick={handleJoin}
          disabled={joining || !groupInput.trim()}
          className="bg-green-600 hover:bg-green-700 shrink-0"
        >
          {joining ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <PackagePlus className="w-4 h-4 mr-1" />}
          加群并监控
        </Button>
      </div>
      {/* 批量导入 */}
      <details className="shrink-0">
        <summary className="text-xs text-blue-600 cursor-pointer hover:text-blue-700 select-none flex items-center gap-1">
          <PackagePlus className="w-3 h-3" /> 批量导入群组链接
        </summary>
        <div className="mt-2 space-y-2">
          <Textarea
            placeholder={"每行一个，支持以下格式：\nhttps://t.me/groupname\n@groupusername\n-1001234567890\n/groupname"}
            value={batchInput}
            onChange={(e) => setBatchInput(e.target.value)}
            className="bg-slate-50 border-slate-300 text-slate-800 placeholder-slate-400 text-xs h-24 resize-none"
          />
          <Button
            size="sm"
            onClick={handleBatchJoin}
            disabled={batchJoining || !batchInput.trim()}
            className="w-full bg-blue-600 hover:bg-blue-700 text-xs h-7"
          >
            {batchJoining ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <PackagePlus className="w-3 h-3 mr-1" />}
            批量加群并监控
          </Button>
          {batchResult && <p className="text-xs text-green-600">{batchResult}</p>}
        </div>
      </details>
      {/* 搜索 + 统计 */}
      <div className="flex items-center gap-2 shrink-0">
        <Input
          placeholder="搜索已监控群组..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-slate-100 border-slate-300 text-slate-800 placeholder-slate-500 h-8 text-sm flex-1"
        />
        <span className="text-xs text-slate-500 shrink-0">
          共 <span className="text-slate-800 font-bold">{myGroups.length}</span> 个
        </span>
      </div>
      {/* 列表 */}
      <div className="flex-1 overflow-y-auto min-h-0 rounded border border-slate-200">
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-blue-400 mr-2" />
            <span className="text-slate-500 text-sm">加载中...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-slate-500 text-sm">
            <Shield className="w-8 h-8 mb-2 opacity-40" />
            {search ? "没有匹配的群组" : "暂无监控群组，请在上方输入群组链接添加"}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-100 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-3 py-2">群组</th>
                <th className="text-left px-3 py-2 w-20">状态</th>
                <th className="text-center px-3 py-2 w-16">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((g: any) => (
                <tr key={g.id} className="border-t border-slate-200/50 hover:bg-slate-100/70">
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-800 truncate max-w-[220px]" title={g.groupTitle}>{g.groupTitle || g.groupId}</div>
                    <div className="text-slate-500 text-xs">{g.groupId}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      g.monitorStatus === "active" ? "bg-green-900/50 text-green-300" :
                      g.monitorStatus === "paused" ? "bg-yellow-900/50 text-yellow-300" :
                      "bg-red-900/50 text-red-600"
                    }`}>
                      {g.monitorStatus === "active" ? "监控中" : g.monitorStatus === "paused" ? "已暂停" : "异常"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="w-6 h-6 text-slate-500 hover:text-red-400"
                      title="移除监控"
                      onClick={() => handleDelete(g.id)}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}



