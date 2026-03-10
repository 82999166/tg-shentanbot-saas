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
  const utils = trpc.useUtils();
  const { data: accounts = [], isLoading } = trpc.tgAccounts.list.useQuery();

  const [addMode, setAddMode] = useState<AddMode>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

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

  const refresh = () => utils.tgAccounts.list.invalidate();

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
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* 页头 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">TG 账号管理</h1>
            <p className="text-sm text-slate-400 mt-1">管理用于监控和发信的 Telegram 账号</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={refresh} className="border-slate-600 text-slate-300 hover:bg-slate-700">
              <RefreshCw className="w-4 h-4 mr-1" /> 刷新
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

        {/* 账号列表 */}
        {isLoading ? (
          <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-blue-400" /></div>
        ) : accounts.length === 0 ? (
          <Card className="bg-slate-800/60 border-slate-700 border-dashed">
            <CardContent className="py-16 text-center">
              <Smartphone className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400 mb-2">还没有添加任何 TG 账号</p>
              <p className="text-slate-500 text-sm mb-6">通过手机号登录或批量导入 Session 来添加账号</p>
              <div className="flex gap-3 justify-center">
                <Button onClick={() => setAddMode("phone")} className="bg-blue-600 hover:bg-blue-700">
                  <Phone className="w-4 h-4 mr-2" /> 手机号登录
                </Button>
                <Button variant="outline" onClick={() => setAddMode("session_bulk")} className="border-slate-600 text-slate-300">
                  <Upload className="w-4 h-4 mr-2" /> 导入 Session
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {accounts.map((account) => {
              const score = account.healthScore ?? 0;
              const statusMap: Record<string, { label: string; cls: string }> = {
                active: { label: "运行中", cls: "bg-green-900/50 text-green-300 border-green-700" },
                pending: { label: "待激活", cls: "bg-slate-700 text-slate-300 border-slate-600" },
                expired: { label: "已过期", cls: "bg-amber-900/50 text-amber-300 border-amber-700" },
                banned: { label: "已封禁", cls: "bg-red-900/50 text-red-300 border-red-700" },
              };
              const roleMap: Record<string, string> = { monitor: "监控账号", sender: "发信账号", both: "监控+发信" };
              const st = statusMap[account.sessionStatus ?? "pending"] ?? statusMap.pending;
              return (
                <Card key={account.id} className="bg-slate-800/60 border-slate-700 hover:border-slate-500 transition-colors">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-4 flex-1 min-w-0">
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white font-bold text-lg shrink-0">
                          {(account.tgFirstName ?? account.phone ?? "?")[0]?.toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-white truncate">
                              {account.tgFirstName ? `${account.tgFirstName} ${account.tgLastName ?? ""}`.trim() : account.phone ?? `账号 #${account.id}`}
                            </span>
                            {account.tgUsername && <span className="text-slate-400 text-sm">@{account.tgUsername}</span>}
                            <Badge className={`text-xs border ${st.cls}`}>{st.label}</Badge>
                            <Badge variant="outline" className="text-xs border-slate-600 text-slate-400">{roleMap[account.accountRole ?? "both"]}</Badge>
                          </div>
                          <div className="flex items-center gap-4 mt-2 text-xs text-slate-500 flex-wrap">
                            {account.phone && <span><Phone className="w-3 h-3 inline mr-1" />{account.phone}</span>}
                            {account.tgUserId && <span>ID: {account.tgUserId}</span>}
                            <span>今日发信: {account.dailyDmSent ?? 0}</span>
                            {account.lastActiveAt && <span>最后活跃: {new Date(account.lastActiveAt).toLocaleString()}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 shrink-0">
                        <div className="text-right hidden sm:block">
                          <p className={`text-lg font-bold ${healthColor(score)}`}>{score}</p>
                          <p className="text-xs text-slate-500">健康度</p>
                          <Progress value={score} className="w-20 h-1.5 mt-1" />
                        </div>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="w-8 h-8 text-slate-400 hover:text-green-400" title="测试连接"
                            onClick={async () => { const r = await testConn.mutateAsync({ id: account.id }); if (r.success) { toast.success(r.message); refresh(); } else toast.error(r.message); }}>
                            {testConn.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                          </Button>
                          <Button size="icon" variant="ghost"
                            className={`w-8 h-8 ${account.isActive ? "text-green-400 hover:text-slate-400" : "text-slate-500 hover:text-green-400"}`}
                            title={account.isActive ? "停用" : "启用"}
                            onClick={async () => { await toggleActive.mutateAsync({ id: account.id, isActive: !account.isActive }); refresh(); toast.success(account.isActive ? "账号已停用" : "账号已启用"); }}>
                            {account.isActive ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                          </Button>
                          <Button size="icon" variant="ghost" className="w-8 h-8 text-slate-400 hover:text-red-400" title="删除" onClick={() => setDeleteId(account.id)}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
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
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5 text-cyan-400" /> 批量导入 Session
            </DialogTitle>
            <DialogDescription className="text-slate-400">支持文本粘贴或文件上传，单次最多导入 100 个账号</DialogDescription>
          </DialogHeader>

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

          <DialogFooter className="gap-2">
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

      {/* ─── 删除确认 ─────────────────────────────────────────────────────── */}
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
    </AppLayout>
  );
}
