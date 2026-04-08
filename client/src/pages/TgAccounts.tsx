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
} from "lucide-react";
import { useState, useRef } from "react";

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
            <h1 className="text-2xl font-bold text-white">TG 账号管理</h1>
            <p className="text-sm text-slate-400 mt-1">管理用于监控和发信的 Telegram 账号</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={refresh} disabled={isRefetching} className="border-slate-600 text-slate-300 hover:bg-slate-700">
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
            <Card key={item.label} className="bg-slate-800/60 border-slate-700">
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
        {/* 条件筛选栏 */}
        <div className="flex flex-wrap gap-3 items-center bg-slate-800/40 border border-slate-700 rounded-lg p-3">
          <Input
            placeholder="搜索账号名/手机号/@用户名..."
            value={filterKeyword}
            onChange={(e) => setFilterKeyword(e.target.value)}
            className="bg-slate-800 border-slate-600 text-white placeholder-slate-500 w-56 h-8 text-sm"
          />
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="bg-slate-800 border-slate-600 text-white h-8 text-sm w-32"><SelectValue placeholder="状态" /></SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-600">
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="active">运行中</SelectItem>
              <SelectItem value="inactive">未激活</SelectItem>
              <SelectItem value="banned">已封禁</SelectItem>
              <SelectItem value="error">异常</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterRole} onValueChange={setFilterRole}>
            <SelectTrigger className="bg-slate-800 border-slate-600 text-white h-8 text-sm w-36"><SelectValue placeholder="账号角色" /></SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-600">
              <SelectItem value="all">全部角色</SelectItem>
              <SelectItem value="monitor">仅监控</SelectItem>
              <SelectItem value="sender">仅发信</SelectItem>
              <SelectItem value="both">监控+发信</SelectItem>
            </SelectContent>
          </Select>
          {user?.role === "admin" && (
            <Select value={filterOwner} onValueChange={setFilterOwner}>
              <SelectTrigger className="bg-slate-800 border-slate-600 text-white h-8 text-sm w-36"><SelectValue placeholder="归属用户" /></SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600">
                <SelectItem value="all">全部用户</SelectItem>
                {Array.from(new Set(accounts.map((a) => (a as any).ownerEmail).filter(Boolean))).map((email) => (
                  <SelectItem key={email as string} value={email as string}>{email as string}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <span className="text-xs text-slate-500 ml-auto">共 {filteredAccounts.length} 条</span>
          {(filterKeyword || filterStatus !== "all" || filterRole !== "all" || filterOwner !== "all") && (
            <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white h-8 text-xs"
              onClick={() => { setFilterKeyword(""); setFilterStatus("all"); setFilterRole("all"); setFilterOwner("all"); }}>
              清除筛选
            </Button>
          )}
        </div>
        {/* 账号表格 */}
        {isLoading ? (
          <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-blue-400" /></div>
        ) : filteredAccounts.length === 0 ? (
          <Card className="bg-slate-800/60 border-slate-700 border-dashed">
            <CardContent className="py-16 text-center">
              <Smartphone className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400 mb-2">{accounts.length === 0 ? "还没有添加任何 TG 账号" : "没有符合筛选条件的账号"}</p>
            </CardContent>
          </Card>
        ) : (
          <>
          {/* 批量操作栏 */}
          {selectedIds.length > 0 && (
            <div className="flex items-center gap-3 px-4 py-2 bg-blue-900/30 border border-blue-700/50 rounded-lg mb-3">
              <span className="text-sm text-blue-300">已选 {selectedIds.length} 个账号</span>
              <Button size="sm" variant="outline" className="h-7 text-xs border-green-600 text-green-400 hover:bg-green-900/30"
                onClick={() => setInEngine.mutate({ ids: selectedIds, inEngine: true })}>
                <Server className="w-3 h-3 mr-1" /> 加入监控引擎
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs border-slate-600 text-slate-400 hover:bg-slate-700/30"
                onClick={() => setInEngine.mutate({ ids: selectedIds, inEngine: false })}>
                <ServerOff className="w-3 h-3 mr-1" /> 移出引擎（备用）
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs text-slate-500" onClick={clearSelect}>取消选择</Button>
            </div>
          )}
          <div className="bg-slate-800/60 border border-slate-700 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700 bg-slate-800/80">
                    <th className="px-3 py-3 w-8">
                      <input type="checkbox" className="rounded border-slate-600 bg-slate-700 cursor-pointer"
                        title="全选/取消全选"
                        checked={selectedIds.length === filteredAccounts.length && filteredAccounts.length > 0}
                        onChange={(e) => e.target.checked ? selectAll() : clearSelect()} />
                    </th>{/* th-checkbox-col */}
                    <th className="text-left px-4 py-3 text-slate-400 font-medium">账号信息</th>
                    {user?.role === "admin" && <th className="text-left px-4 py-3 text-slate-400 font-medium">归属用户</th>}
                    <th className="text-left px-4 py-3 text-slate-400 font-medium">状态</th>
                    <th className="text-left px-4 py-3 text-slate-400 font-medium">角色</th>
                    <th className="text-center px-4 py-3 text-slate-400 font-medium"><span title="该账号监控的私有群组数">私有群组</span></th>
                    <th className="text-center px-4 py-3 text-slate-400 font-medium"><span title="该账号正在订阅监控的公共群组数（账号已加入且在公共群组池中）">监控群组</span></th>
                    <th className="text-center px-4 py-3 text-slate-400 font-medium">总群组数</th>
                    <th className="text-center px-4 py-3 text-slate-400 font-medium"><span title="该账号在 Telegram 中实际加入的群组总数（从引擎实时获取）">已加入群组</span></th>
                    <th className="text-center px-4 py-3 text-slate-400 font-medium">健康度</th>
                    <th className="text-center px-4 py-3 text-slate-400 font-medium">今日发信</th>
                    <th className="text-center px-4 py-3 text-slate-400 font-medium" title="是否加入监控引擎">引擎</th>
                    <th className="text-right px-4 py-3 text-slate-400 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAccounts.map((account, idx) => {
                    const score = account.healthScore ?? 0;
                    const statusMap: Record<string, { label: string; cls: string }> = {
                      active: { label: "运行中", cls: "bg-green-900/40 text-green-400 border-green-700/50" },
                      inactive: { label: "未激活", cls: "bg-slate-700/40 text-slate-400 border-slate-600/50" },
                      banned: { label: "已封禁", cls: "bg-red-900/40 text-red-400 border-red-700/50" },
                      error: { label: "异常", cls: "bg-orange-900/40 text-orange-400 border-orange-700/50" },
                    };
                    const roleMap: Record<string, string> = { monitor: "仅监控", sender: "仅发信", both: "监控+发信" };
                    const st = statusMap[account.sessionStatus ?? "inactive"] ?? statusMap.inactive;
                    const privateCount = (account as any).privateGroupCount ?? 0;
                    const publicCount = (account as any).publicGroupCount ?? 0;
                    const totalCount = (account as any).totalGroupCount ?? 0;
                    const joinedCount = (account as any).joinedGroupCount;
                    return (
                      <tr key={account.id} className={`border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors ${idx % 2 === 0 ? "" : "bg-slate-800/20"}`}>
                        {/* 复选框 */}
                        <td className="px-3 py-3 w-8">{/* td-checkbox-col */}
                          <input type="checkbox" className="rounded border-slate-600 bg-slate-700 cursor-pointer"
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
                              <p className="font-medium text-white">
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
                            <span className="text-xs px-2 py-1 rounded bg-purple-900/40 text-purple-300 border border-purple-700/40">
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
                          <span className="text-xs text-slate-400">{roleMap[account.accountRole ?? "both"]}</span>
                        </td>
                        {/* 私有群组数 */}
                        <td className="px-4 py-3 text-center">
                          <span className={`text-sm font-bold ${privateCount > 0 ? "text-blue-400" : "text-slate-600"}`}>{privateCount}</span>
                        </td>
                        {/* 公共群组数 */}
                        <td className="px-4 py-3 text-center">
                          <span className={`text-sm font-bold ${publicCount > 0 ? "text-cyan-400" : "text-slate-600"}`}>{publicCount}</span>
                        </td>
                        {/* 总群组数 */}
                        <td className="px-4 py-3 text-center">
                          <span className={`text-sm font-bold ${totalCount > 0 ? "text-green-400" : "text-slate-600"}`}>{totalCount}</span>
                        </td>
                        {/* 已加入群组（引擎实时） */}
                        <td className="px-4 py-3 text-center">
                          {joinedCount == null ? (
                            <span className="text-slate-600 text-xs">-</span>
                          ) : (
                            <span className={`text-sm font-bold ${joinedCount > 0 ? "text-orange-400" : "text-slate-600"}`}>{joinedCount}</span>
                          )}
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
                          <span className="text-sm text-slate-400">{account.dailyDmSent ?? 0}</span>
                        </td>
                        {/* 引擎状态 */}
                        <td className="px-4 py-3 text-center">
                          {(account as any).inEngine ? (
                            <span title="已加入监控引擎" className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-900/40 text-green-400">
                              <Server className="w-3 h-3" />
                            </span>
                          ) : (
                            <span title="备用账号（未加入引擎）" className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-700/40 text-slate-500">
                              <ServerOff className="w-3 h-3" />
                            </span>
                          )}
                        </td>
                        {/* 操作 */}
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="icon" variant="ghost" className="w-7 h-7 text-slate-400 hover:text-purple-400" title="从TG账号导入群组到公共群组池"
                              onClick={() => openImportChats(account.id)}>
                              {importChatsLoading && importChatsAccountId === account.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <FolderInput className="w-3 h-3" />}
                            </Button>
                            <Button size="icon" variant="ghost" className="w-7 h-7 text-slate-400 hover:text-green-400" title="测试连接"
                              onClick={async () => { const r = await testConn.mutateAsync({ id: account.id }); if (r.success) { toast.success(r.message); refresh(); } else toast.error(r.message); }}>
                              {testConn.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                            </Button>
                            <Button size="icon" variant="ghost"
                              className={`w-7 h-7 ${account.isActive ? "text-green-400 hover:text-slate-400" : "text-slate-500 hover:text-green-400"}`}
                              title={account.isActive ? "停用" : "启用"}
                              onClick={async () => { await toggleActive.mutateAsync({ id: account.id, isActive: !account.isActive }); refresh(); toast.success(account.isActive ? "账号已停用" : "账号已启用"); }}>
                              {account.isActive ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                            </Button>
                            <Button size="icon" variant="ghost" className="w-7 h-7 text-slate-400 hover:text-blue-400" title="编辑"
                              onClick={() => setEditAccount({ id: account.id, accountRole: account.accountRole ?? "both", notes: account.notes ?? "", maxGroupsLimit: (account as any).maxGroupsLimit ?? null })}>  
                              <Edit2 className="w-3 h-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="w-7 h-7 text-slate-400 hover:text-red-400" title="删除" onClick={() => setDeleteId(account.id)}>
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
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Phone className="w-5 h-5 text-blue-400" /> 手机号登录 Telegram
            </DialogTitle>
            <DialogDescription className="text-slate-400">使用手机号和验证码安全接入您的 Telegram 账号</DialogDescription>
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
                    ${isDone ? "bg-green-500 text-white" : isActive ? "bg-blue-500 text-white" : "bg-slate-700 text-slate-400"}`}>
                    {isDone ? "✓" : i + 1}
                  </div>
                  <span className={isActive ? "text-white" : "text-slate-500"}>{STEP_LABELS[i]}</span>
                  {i < 3 && <ChevronRight className="w-3 h-3 text-slate-600" />}
                </div>
              );
            })}
          </div>

          {phoneStep === "phone" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-slate-300">手机号（含国际区号）</Label>
                <Input placeholder="+8613800000000" value={phoneForm.phone}
                  onChange={(e) => setPhoneForm((f) => ({ ...f, phone: e.target.value }))}
                  className="bg-slate-800 border-slate-600 text-white placeholder-slate-500"
                  onKeyDown={(e) => e.key === "Enter" && handleSendCode()} />
                <p className="text-xs text-slate-500">示例：+8613800000000（中国）、+6591234567（新加坡）</p>
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300">账号角色</Label>
                <Select value={phoneForm.role} onValueChange={(v) => setPhoneForm((f) => ({ ...f, role: v as any }))}>
                  <SelectTrigger className="bg-slate-800 border-slate-600 text-white"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-600">
                    <SelectItem value="both">监控 + 发信（推荐）</SelectItem>
                    <SelectItem value="monitor">仅监控</SelectItem>
                    <SelectItem value="sender">仅发信</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="bg-blue-950/40 border border-blue-800/40 rounded-lg p-3 text-xs text-blue-300 space-y-1">
                <p className="font-medium flex items-center gap-1"><Shield className="w-3 h-3" /> 安全提示</p>
                <p>• 验证码将发送到您的 Telegram 账号（非 SMS）</p>
                <p>• 建议使用专用账号，避免使用主账号</p>
                <p>• Session 将加密存储在服务器</p>
              </div>
            </div>
          )}

          {phoneStep === "code" && (
            <div className="space-y-4">
              <div className="bg-slate-800 rounded-lg p-3 text-sm text-slate-300 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-blue-400 shrink-0" />
                验证码已发送至 <span className="text-white font-medium">{phoneForm.phone}</span> 的 Telegram
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300">验证码</Label>
                <Input placeholder="请输入验证码" value={phoneForm.code}
                  onChange={(e) => setPhoneForm((f) => ({ ...f, code: e.target.value.replace(/\D/g, "").slice(0, 8) }))}
                  className="bg-slate-800 border-slate-600 text-white text-center text-xl tracking-widest"
                  maxLength={8} onKeyDown={(e) => e.key === "Enter" && handleVerifyCode()} />
              </div>
              <div className="flex justify-between text-xs text-slate-500">
                <button onClick={() => setPhoneStep("phone")} className="hover:text-slate-300 underline">← 修改手机号</button>
                <button onClick={handleSendCode} className="hover:text-slate-300 underline">重新发送</button>
              </div>
            </div>
          )}

          {phoneStep === "twofa" && (
            <div className="space-y-4">
              <div className="bg-amber-950/40 border border-amber-700/40 rounded-lg p-3 text-sm text-amber-300 flex items-center gap-2">
                <Shield className="w-4 h-4 shrink-0" /> 该账号已开启二步验证，请输入您设置的密码
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300">二步验证密码</Label>
                <div className="relative">
                  <Input type={show2faPassword ? "text" : "password"} placeholder="请输入二步验证密码"
                    value={phoneForm.password}
                    onChange={(e) => setPhoneForm((f) => ({ ...f, password: e.target.value }))}
                    className="bg-slate-800 border-slate-600 text-white pr-10"
                    onKeyDown={(e) => e.key === "Enter" && handleVerify2FA()} />
                  <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
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
              <p className="text-lg font-semibold text-white">账号添加成功！</p>
              <p className="text-sm text-slate-400">账号已成功登录并添加到账号列表</p>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={closeDialog} className="text-slate-400 hover:text-white">
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
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5 text-cyan-400" /> 批量导入 Session
            </DialogTitle>
            <DialogDescription className="text-slate-400">支持文本粘贴或文件上传，单次最多导入 100 个账号</DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto min-h-0">
          {importStep === "input" && (
            <div className="space-y-4">
              <Tabs defaultValue="text" className="w-full">
                <TabsList className="bg-slate-800 border border-slate-700">
                  <TabsTrigger value="text" className="data-[state=active]:bg-slate-700">文本粘贴</TabsTrigger>
                  <TabsTrigger value="file" className="data-[state=active]:bg-slate-700">文件上传</TabsTrigger>
                  <TabsTrigger value="format" className="data-[state=active]:bg-slate-700">格式说明</TabsTrigger>
                </TabsList>

                <TabsContent value="text" className="space-y-3 mt-3">
                  <div className="flex items-center gap-3">
                    <Label className="text-slate-300 shrink-0">解析格式</Label>
                    <Select value={bulkFormat} onValueChange={(v) => setBulkFormat(v as any)}>
                      <SelectTrigger className="bg-slate-800 border-slate-600 text-white w-44"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-slate-800 border-slate-600">
                        <SelectItem value="auto">自动识别</SelectItem>
                        <SelectItem value="one_per_line">每行一个 Session</SelectItem>
                        <SelectItem value="json">JSON 数组</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Textarea
                    placeholder={"每行一个 Session 字符串，或 JSON 数组格式\n\n示例（每行）：\n1BVtsOK8Buxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n\n示例（带手机号）：\n+8613800000000|1BVtsOK8Buxxxxxxxx..."}
                    value={bulkText} onChange={(e) => setBulkText(e.target.value)}
                    className="bg-slate-800 border-slate-600 text-white placeholder-slate-600 font-mono text-xs min-h-[160px]" />
                </TabsContent>

                <TabsContent value="file" className="mt-3">
                  <div className="border-2 border-dashed border-slate-600 rounded-lg p-10 text-center cursor-pointer hover:border-cyan-500 transition-colors"
                    onClick={() => fileInputRef.current?.click()}>
                    <Download className="w-10 h-10 text-slate-500 mx-auto mb-3" />
                    <p className="text-slate-300 font-medium">点击选择文件</p>
                    <p className="text-slate-500 text-sm mt-1">支持 .txt、.json 格式</p>
                    {bulkText && <p className="text-green-400 text-sm mt-3">✓ 已读取 {bulkText.split("\n").filter(Boolean).length} 行</p>}
                  </div>
                  <input ref={fileInputRef} type="file" accept=".txt,.json" className="hidden" onChange={handleFileUpload} />
                </TabsContent>

                <TabsContent value="format" className="mt-3">
                  <div className="bg-slate-800 rounded-lg p-4 space-y-4 text-sm">
                    <div>
                      <p className="text-cyan-400 font-medium mb-2">格式一：每行一个 Session</p>
                      <pre className="text-slate-300 text-xs bg-slate-900 p-3 rounded overflow-x-auto whitespace-pre-wrap">{`1BVtsOK8BuXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX\n1BVtsOK8BuYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY`}</pre>
                    </div>
                    <div>
                      <p className="text-cyan-400 font-medium mb-2">格式二：手机号|Session（竖线分隔）</p>
                      <pre className="text-slate-300 text-xs bg-slate-900 p-3 rounded overflow-x-auto whitespace-pre-wrap">{`+8613800000001|1BVtsOK8BuXXXXXXXXXXXXXXXXXXXXXXXXXX\n+6591234567|1BVtsOK8BuYYYYYYYYYYYYYYYYYYYYYYYYYYYY`}</pre>
                    </div>
                    <div>
                      <p className="text-cyan-400 font-medium mb-2">格式三：JSON 数组</p>
                      <pre className="text-slate-300 text-xs bg-slate-900 p-3 rounded overflow-x-auto whitespace-pre-wrap">{`[\n  {"phone": "+8613800000001", "session": "1BVtsOK8Bu..."},\n  {"phone": "+6591234567", "session": "1BVtsOK8Bu..."}\n]`}</pre>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}

          {importStep === "preview" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-slate-300 font-medium">解析结果预览</p>
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
                  <div key={i} className="bg-slate-800 rounded-lg p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-white text-sm font-medium">{s.phone ?? `Session #${i + 1}`}</p>
                      <p className="text-slate-500 text-xs font-mono truncate">{s.sessionString.slice(0, 40)}...</p>
                    </div>
                    <Select value={s.accountRole}
                      onValueChange={(v) => { const u = [...parsedSessions]; u[i] = { ...s, accountRole: v as any }; setParsedSessions(u); }}>
                      <SelectTrigger className="bg-slate-700 border-slate-600 text-white w-28 h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-slate-800 border-slate-600">
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
              <p className="text-lg font-semibold text-white">导入完成</p>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-green-950/40 border border-green-800/40 rounded-lg p-3">
                  <p className="text-2xl font-bold text-green-400">{importResult.imported}</p>
                  <p className="text-xs text-slate-400">成功导入</p>
                </div>
                <div className="bg-red-950/40 border border-red-800/40 rounded-lg p-3">
                  <p className="text-2xl font-bold text-red-400">{importResult.failed}</p>
                  <p className="text-xs text-slate-400">导入失败</p>
                </div>
                <div className="bg-amber-950/40 border border-amber-800/40 rounded-lg p-3">
                  <p className="text-2xl font-bold text-amber-400">{importResult.skipped}</p>
                  <p className="text-xs text-slate-400">配额不足跳过</p>
                </div>
              </div>
            </div>
          )}

          </div>
          <DialogFooter className="gap-2 shrink-0">
            <Button variant="ghost" onClick={closeDialog} className="text-slate-400 hover:text-white">
              {importStep === "done" ? "关闭" : "取消"}
            </Button>
            {importStep === "input" && (
              <Button onClick={handleParseText} disabled={parseSessionText.isPending || !bulkText.trim()} className="bg-cyan-600 hover:bg-cyan-700">
                {parseSessionText.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />} 解析预览
              </Button>
            )}
            {importStep === "preview" && (
              <>
                <Button variant="outline" onClick={() => setImportStep("input")} className="border-slate-600 text-slate-300">返回修改</Button>
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
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2"><Edit2 className="w-5 h-5 text-blue-400" /> 编辑账号</DialogTitle>
            <DialogDescription className="text-slate-400">修改账号信息，或查看该账号已加入的群组</DialogDescription>
          </DialogHeader>
          {editAccount && (
            <Tabs defaultValue="info" className="flex-1 flex flex-col min-h-0">
              <TabsList className="bg-slate-800 border border-slate-700 shrink-0">
                <TabsTrigger value="info" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white">基本信息</TabsTrigger>
                <TabsTrigger value="groups" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white">已加入群组</TabsTrigger>
              </TabsList>

              {/* ── 基本信息 Tab ── */}
              <TabsContent value="info" className="flex-1 overflow-y-auto">
                <div className="space-y-4 py-2">
                  <div className="space-y-2">
                    <Label className="text-slate-300">账号角色</Label>
                    <Select value={editAccount.accountRole} onValueChange={(v) => setEditAccount((a) => a ? { ...a, accountRole: v } : a)}>
                      <SelectTrigger className="bg-slate-800 border-slate-600 text-white"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-slate-800 border-slate-600">
                        <SelectItem value="both">监控 + 发信（推荐）</SelectItem>
                        <SelectItem value="monitor">仅监控</SelectItem>
                        <SelectItem value="sender">仅发信</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-slate-300">加群上限（留空使用全局设置）</Label>
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
                      className="bg-slate-800 border-slate-600 text-white placeholder-slate-500"
                    />
                    <p className="text-xs text-slate-500">设置后此账号最多加入该数量的群组，覆盖全局上限</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-slate-300">备注（可选）</Label>
                    <Input
                      placeholder="输入备注信息..."
                      value={editAccount.notes}
                      onChange={(e) => setEditAccount((a) => a ? { ...a, notes: e.target.value } : a)}
                      className="bg-slate-800 border-slate-600 text-white placeholder-slate-500"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="ghost" onClick={() => setEditAccount(null)} className="text-slate-400 hover:text-white">取消</Button>
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

              {/* ── 已加入群组 Tab ── */}
              <TabsContent value="groups" className="flex-1 flex flex-col min-h-0">
                <AccountJoinedGroupsTab accountId={editAccount.id} />
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

       {/* ─── 导入群组到公共群组池 Dialog ─────────────────────────────────── */}
      <Dialog open={importChatsAccountId !== null} onOpenChange={(o) => { if (!o) { setImportChatsAccountId(null); setImportChatsList([]); setImportChatsSelected(new Set()); setImportChatsStep('loading'); setImportChatsError(''); } }}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderInput className="w-5 h-5 text-purple-400" /> 从TG账号导入群组到公共群组池
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              读取该TG账号已加入的群组，选择后批量导入到公共群组池，引擎将自动订阅监控这些群组的消息
            </DialogDescription>
          </DialogHeader>

          {importChatsStep === 'loading' && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
              <p className="text-slate-400 text-sm">正在从引擎读取群组列表，请稍候...</p>
            </div>
          )}

          {importChatsStep === 'select' && (
            <>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-400">共找到 <span className="text-white font-bold">{importChatsList.length}</span> 个群组，已选 <span className="text-purple-400 font-bold">{importChatsSelected.size}</span> 个</span>
                <div className="flex gap-2">
                  <button className="text-xs text-slate-400 hover:text-white underline" onClick={() => setImportChatsSelected(new Set(importChatsList.map(c => c.chatId)))}>全选</button>
                  <button className="text-xs text-slate-400 hover:text-white underline" onClick={() => setImportChatsSelected(new Set())}>全不选</button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto space-y-1 max-h-96 pr-1">
                {importChatsList.length === 0 ? (
                  <div className="text-center py-8 text-slate-500">
                    <PackagePlus className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    <p>该账号暂无已加入的群组（可能 session 已失效）</p>
                  </div>
                ) : importChatsList.map(chat => (
                  <label key={chat.chatId} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-800 cursor-pointer">
                    <input type="checkbox"
                      className="rounded border-slate-600 bg-slate-700 cursor-pointer"
                      checked={importChatsSelected.has(chat.chatId)}
                      onChange={(e) => {
                        const next = new Set(importChatsSelected);
                        if (e.target.checked) next.add(chat.chatId); else next.delete(chat.chatId);
                        setImportChatsSelected(next);
                      }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{chat.title || chat.chatId}</p>
                      <p className="text-xs text-slate-500">{chat.username ? `@${chat.username}` : `ID: ${chat.chatId}`} &middot; {chat.type === 'supergroup' ? '超级群组' : '普通群组'}</p>
                    </div>
                  </label>
                ))}
              </div>
              <DialogFooter className="gap-2 pt-2">
                <Button variant="ghost" onClick={() => setImportChatsAccountId(null)} className="text-slate-400 hover:text-white">取消</Button>
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
              <p className="text-white font-medium">导入完成！</p>
              <p className="text-slate-400 text-sm">公共群组池已更新，引擎将在下次轮询时自动订阅监控这些群组的消息</p>
              <Button onClick={() => setImportChatsAccountId(null)} className="bg-slate-700 hover:bg-slate-600">关闭</Button>
            </div>
          )}

          {importChatsStep === 'error' && (
            <div className="flex flex-col items-center justify-center py-10 gap-4">
              <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
                <span className="text-red-400 text-2xl">⚠</span>
              </div>
              <p className="text-white font-medium">获取群组列表失败</p>
              <p className="text-slate-400 text-sm text-center max-w-sm">{importChatsError}</p>
              <div className="text-xs text-slate-500 bg-slate-800 rounded-lg p-3 max-w-sm w-full">
                <p className="font-medium text-slate-400 mb-1">常见原因：</p>
                <p>• 账号 session 已失效，需要重新登录</p>
                <p>• 账号未在引擎中运行，请先启用账号</p>
                <p>• 引擎初始化中，请等待 30 秒后重试</p>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setImportChatsAccountId(null)} className="text-slate-400 hover:text-white">关闭</Button>
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
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400"><Trash2 className="w-5 h-5" /> 确认删除</DialogTitle>
            <DialogDescription className="text-slate-400">删除后该账号的 Session 将被清除，监控任务将停止。此操作不可撤销。</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setDeleteId(null)} className="text-slate-400">取消</Button>
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
    </Layout>
  );
}

// ─── 已加入群组 Tab 子组件 ─────────────────────────────────────────────────────
function AccountJoinedGroupsTab({ accountId }: { accountId: number }) {
  const { data, isLoading } = trpc.tgAccounts.getAccountJoinedGroups.useQuery({ accountId });
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-blue-400 mr-2" />
        <span className="text-slate-400 text-sm">加载中...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 py-2 h-full">
      {/* 顶部统计 + 操作栏 */}
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-400">
            共已加入 <span className="text-white font-bold">{data?.total ?? 0}</span> 个群组
          </span>
          <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded">
            封号后可导出，用新账号补加
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="border-slate-600 text-slate-300 hover:text-white hover:bg-slate-700 gap-1"
          onClick={handleExport}
          disabled={!data?.groups?.length}
        >
          <Download className="w-3.5 h-3.5" /> 导出 CSV
        </Button>
      </div>

      {/* 搜索框 */}
      <Input
        placeholder="搜索群组名称或 ID..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="bg-slate-800 border-slate-600 text-white placeholder-slate-500 h-8 text-sm shrink-0"
      />

      {/* 群组列表 */}
      <div className="flex-1 overflow-y-auto min-h-0 rounded border border-slate-700">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-slate-500 text-sm">
            <Shield className="w-8 h-8 mb-2 opacity-40" />
            {search ? "没有匹配的群组" : "该账号暂无已加入的群组记录"}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-800 text-slate-400 text-xs">
              <tr>
                <th className="text-left px-3 py-2">群组</th>
                <th className="text-left px-3 py-2 w-24">类型</th>
                <th className="text-left px-3 py-2 w-32">加入时间</th>
                <th className="text-center px-3 py-2 w-16">链接</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((g, i) => (
                <tr key={g.id} className={`border-t border-slate-700/50 hover:bg-slate-800/50 ${!g.isActive ? "opacity-50" : ""}`}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-white truncate max-w-[200px]" title={g.groupTitle}>{g.groupTitle}</div>
                    <div className="text-slate-500 text-xs">@{g.groupId}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${g.groupType === "channel" ? "bg-purple-900/50 text-purple-300" : "bg-blue-900/50 text-blue-300"}`}>
                      {g.groupType === "channel" ? "频道" : "群组"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-400 text-xs">
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
