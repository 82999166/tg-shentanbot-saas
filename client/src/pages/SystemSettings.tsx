import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Settings,
  DollarSign,
  Key,
  ShoppingCart,
  Save,
  Plus,
  Copy,
  Download,
  RefreshCw,
  CheckCircle,
  Clock,
  XCircle,
  Bot,
  Eye,
  EyeOff,
  Zap,
  Mail,
  Globe,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Users,
  Tag,
  ChevronDown,
  ChevronRight,
  Shield,
  AlertTriangle,
  Cpu,
  UserCog,
} from "lucide-react";
import TdlibEngineTab from "./TdlibEngineTab";
import UserConfigPanel from "./UserConfigPanel";
// ── 公共监控群组 Tab ──────────────────────────────────────────────
// 公共群组关键词子面板
function GroupKeywordsPanel({ groupId, groupTitle }: { groupId: number; groupTitle: string }) {
  const { data: keywords, refetch } = trpc.sysConfig.getPublicGroupKeywords.useQuery({ publicGroupId: groupId });
  const [newKw, setNewKw] = useState("");
  const [matchType, setMatchType] = useState<"contains" | "exact" | "regex">("contains");
  const addKwMutation = trpc.sysConfig.addPublicGroupKeyword.useMutation({
    onSuccess: () => { toast.success("关键词已添加"); setNewKw(""); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const removeKwMutation = trpc.sysConfig.removePublicGroupKeyword.useMutation({
    onSuccess: () => { toast.success("关键词已删除"); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="mt-3 p-3 bg-gray-950/60 rounded-lg border border-gray-700 space-y-3">
      <div className="flex items-center gap-2 text-xs text-gray-400 font-medium">
        <Tag className="w-3.5 h-3.5" />
        <span>「{groupTitle}」独立关键词</span>
        <span className="ml-auto text-gray-600">{keywords?.length ?? 0} 个</span>
      </div>
      <div className="flex gap-2">
        <Input
          placeholder="输入关键词"
          value={newKw}
          onChange={(e) => setNewKw(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && newKw.trim()) addKwMutation.mutate({ publicGroupId: groupId, pattern: newKw.trim(), matchType }); }}
          className="bg-gray-900 border-gray-700 text-white text-xs h-7 flex-1"
        />
        <Select value={matchType} onValueChange={(v) => setMatchType(v as any)}>
          <SelectTrigger className="bg-gray-900 border-gray-700 text-gray-300 text-xs h-7 w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-gray-800 border-gray-700">
            <SelectItem value="contains" className="text-gray-300 text-xs">包含</SelectItem>
            <SelectItem value="exact" className="text-gray-300 text-xs">精确</SelectItem>
            <SelectItem value="regex" className="text-gray-300 text-xs">正则</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" className="h-7 px-2 bg-blue-600 hover:bg-blue-700 text-xs"
          onClick={() => { if (newKw.trim()) addKwMutation.mutate({ publicGroupId: groupId, pattern: newKw.trim(), matchType }); }}
          disabled={!newKw.trim() || addKwMutation.isPending}
        >
          <Plus className="w-3 h-3" />
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {!keywords || keywords.length === 0 ? (
          <span className="text-gray-600 text-xs">暂无关键词，此群组将使用各用户自己的关键词规则</span>
        ) : (
          keywords.map((kw) => (
            <div key={kw.id} className="flex items-center gap-1 bg-blue-500/15 border border-blue-500/30 rounded px-2 py-0.5">
              <span className="text-blue-300 text-xs">{kw.pattern}</span>
              <span className="text-blue-500/60 text-xs">[{kw.matchType}]</span>
              <button onClick={() => removeKwMutation.mutate({ id: kw.id })} className="text-gray-500 hover:text-red-400 ml-1">
                <XCircle className="w-3 h-3" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// 公共群组加群状态子面板
function GroupJoinStatusPanel({ groupId, groupTitle }: { groupId: number; groupTitle: string }) {
  const { data: statusList } = trpc.sysConfig.getPublicGroupJoinStatus.useQuery({ publicGroupId: groupId });
  const joinedCount = statusList?.filter(s => s.joinStatus === "joined").length ?? 0;
  const totalCount = statusList?.length ?? 0;
  return (
    <div className="mt-2 p-3 bg-gray-950/60 rounded-lg border border-gray-700 space-y-2">
      <div className="flex items-center gap-2 text-xs text-gray-400 font-medium">
        <Users className="w-3.5 h-3.5" />
        <span>监控账号加群状态</span>
        <span className="ml-auto">
          <span className="text-green-400">{joinedCount}</span>
          <span className="text-gray-600">/{totalCount} 已加入</span>
        </span>
      </div>
      {!statusList || statusList.length === 0 ? (
        <span className="text-gray-600 text-xs">暂无监控账号</span>
      ) : (
        <div className="space-y-1">
          {statusList.map((s) => (
            <div key={s.accountId} className="flex items-center gap-2 text-xs">
              <span className="text-gray-400 truncate flex-1">{s.tgFirstName || s.tgUsername || s.phone || `账号#${s.accountId}`}</span>
              {s.joinStatus === "joined" && <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs px-1.5 py-0">已加入</Badge>}
              {s.joinStatus === "failed" && <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs px-1.5 py-0" title={s.errorMsg || ""}>失败</Badge>}
              {s.joinStatus === "pending" && <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30 text-xs px-1.5 py-0">待加入</Badge>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PublicGroupsTab() {
  const { data: groups, refetch } = trpc.sysConfig.getPublicGroups.useQuery();
  const [newGroupId, setNewGroupId] = useState("");
  const [newGroupTitle, setNewGroupTitle] = useState("");
  const [newNote, setNewNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState<number | null>(null);
  const [expandedTab, setExpandedTab] = useState<"keywords" | "status">("keywords");

  const addMutation = trpc.sysConfig.addPublicGroup.useMutation({
    onSuccess: (res) => {
      toast.success(res.isNew ? "群组已添加" : "群组已重新激活");
      setNewGroupId(""); setNewGroupTitle(""); setNewNote(""); setAdding(false);
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });
  const removeMutation = trpc.sysConfig.removePublicGroup.useMutation({
    onSuccess: () => { toast.success("群组已移除"); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const toggleMutation = trpc.sysConfig.updatePublicGroup.useMutation({
    onSuccess: () => { toast.success("状态已更新"); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const syncMutation = trpc.sysConfig.syncPrivateToPublic.useMutation({
    onSuccess: (res: { added: number; skipped: number }) => {
      if (res.added > 0) {
        toast.success(`同步完成：新增 ${res.added} 个群组，跳过 ${res.skipped} 个（已存在）`);
      } else {
        toast.info(`没有新群组需要同步（${res.skipped} 个已存在）`);
      }
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader className="pb-3">
          <CardTitle className="text-gray-200 text-sm font-medium flex items-center gap-2">
            <Globe className="w-4 h-4" />
            公共监控群组管理
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300">
            此处添加的群组供所有会员共同监控使用，不占用会员个人群组配额。可为每个群组单独配置关键词（若不配置则使用各用户自己的关键词规则）。
          </div>

          {adding ? (
            <div className="space-y-3 p-4 bg-gray-900/50 rounded-lg border border-gray-600">
              <h4 className="text-gray-300 text-sm font-medium">添加新公共群组</h4>
              <div>
                <Label className="text-gray-400 text-xs mb-1 block">群组 ID 或 @用户名 *</Label>
                <Input
                  placeholder="例如：-1001234567890 或 @groupname"
                  value={newGroupId}
                  onChange={(e) => setNewGroupId(e.target.value)}
                  className="bg-gray-900 border-gray-600 text-white"
                />
              </div>
              <div>
                <Label className="text-gray-400 text-xs mb-1 block">群组名称（可选）</Label>
                <Input
                  placeholder="为这个群组起一个备注名称"
                  value={newGroupTitle}
                  onChange={(e) => setNewGroupTitle(e.target.value)}
                  className="bg-gray-900 border-gray-600 text-white"
                />
              </div>
              <div>
                <Label className="text-gray-400 text-xs mb-1 block">备注（可选）</Label>
                <Input
                  placeholder="例如：某某行业交流群"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  className="bg-gray-900 border-gray-600 text-white"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700"
                  onClick={() => addMutation.mutate({ groupId: newGroupId.trim(), groupTitle: newGroupTitle.trim() || undefined, note: newNote.trim() || undefined })}
                  disabled={!newGroupId.trim() || addMutation.isPending}
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  {addMutation.isPending ? "添加中..." : "确认添加"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setAdding(false)} className="border-gray-600 text-gray-300">
                  取消
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => setAdding(true)}>
                <Plus className="w-3.5 h-3.5 mr-1" />添加公共群组
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-gray-600 text-gray-300 hover:bg-gray-700"
                disabled={syncMutation.isPending}
                onClick={() => {
                  if (confirm("将「群组监控」中的所有私有群组一键同步到公共群组池？\n已存在的群组将自动跳过。")) {
                    syncMutation.mutate();
                  }
                }}
              >
                {syncMutation.isPending ? "同步中..." : "⇪ 一键同步私有群组"}
              </Button>
            </div>
          )}

          <div className="space-y-2">
            {!groups || groups.length === 0 ? (
              <div className="text-center py-8 text-gray-500 text-sm">暂无公共监控群组，点击上方按钮添加</div>
            ) : (
              groups.map((g) => (
                <div key={g.id} className={`rounded-lg border ${
                  g.isActive ? "bg-gray-900/50 border-gray-600" : "bg-gray-900/20 border-gray-700 opacity-60"
                }`}>
                  <div className="flex items-center justify-between p-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-200 text-sm font-medium truncate">{g.groupTitle || g.groupId}</span>
                        {g.isActive
                          ? <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">监控中</Badge>
                          : <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30 text-xs">已禁用</Badge>}
                      </div>
                      <div className="text-gray-500 text-xs mt-0.5 font-mono">{g.groupId}</div>
                      {g.note && <div className="text-gray-500 text-xs mt-0.5">{g.note}</div>}
                    </div>
                    <div className="flex items-center gap-1.5 ml-3 shrink-0">
                      <Button
                        size="sm" variant="ghost"
                        className="h-7 px-2 text-gray-400 hover:text-blue-400 text-xs"
                        onClick={() => {
                          if (expandedGroup === g.id) { setExpandedGroup(null); }
                          else { setExpandedGroup(g.id); setExpandedTab("keywords"); }
                        }}
                      >
                        {expandedGroup === g.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </Button>
                      <Button
                        size="sm" variant="ghost"
                        className="h-7 w-7 p-0 text-gray-400 hover:text-yellow-400"
                        title={g.isActive ? "禁用" : "启用"}
                        onClick={() => toggleMutation.mutate({ id: g.id, isActive: !g.isActive })}
                      >
                        {g.isActive ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                      </Button>
                      <Button
                        size="sm" variant="ghost"
                        className="h-7 w-7 p-0 text-gray-400 hover:text-red-400"
                        title="移除"
                        onClick={() => removeMutation.mutate({ id: g.id })}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  {expandedGroup === g.id && (
                    <div className="px-3 pb-3">
                      <div className="flex gap-2 mb-2">
                        <button
                          onClick={() => setExpandedTab("keywords")}
                          className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                            expandedTab === "keywords" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-gray-200"
                          }`}
                        >
                          <Tag className="w-3 h-3 inline mr-1" />关键词配置
                        </button>
                        <button
                          onClick={() => setExpandedTab("status")}
                          className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                            expandedTab === "status" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-gray-200"
                          }`}
                        >
                          <Users className="w-3 h-3 inline mr-1" />加群状态
                        </button>
                      </div>
                      {expandedTab === "keywords" && (
                        <GroupKeywordsPanel groupId={g.id} groupTitle={g.groupTitle || g.groupId} />
                      )}
                      {expandedTab === "status" && (
                        <GroupJoinStatusPanel groupId={g.id} groupTitle={g.groupTitle || g.groupId} />
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          {groups && groups.length > 0 && (
            <p className="text-gray-500 text-xs">共 {groups.filter(g => g.isActive).length} 个活跃公共群组，{groups.filter(g => !g.isActive).length} 个已禁用</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
// ── 支付配置 Tab ──────────────────────────────────────────────
function PaymentSettingsTab(){
  const { data: settings, refetch } = trpc.settings.list.useQuery();
  const upsertMutation = trpc.settings.upsert.useMutation({
    onSuccess: () => {
      toast.success("设置已保存");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });
  const settingFields = [
    {
      group: "USDT 收款配置",
      fields: [
        { key: "usdt_address", label: "TRC20 收款地址", placeholder: "TJ2PYgURpRrKiVVir6JGRxmg8LLcMHd3eN", type: "text" },
        { key: "trongrid_api_key", label: "TronGrid API Key（可选，提高稳定性）", placeholder: "留空使用免费额度", type: "text" },
      ],
    },
    {
      group: "套餐月付价格（USDT）",
      fields: [
        { key: "plan_basic_price_monthly", label: "基础版月付", placeholder: "29", type: "number" },
        { key: "plan_pro_price_monthly", label: "专业版月付", placeholder: "89", type: "number" },
        { key: "plan_enterprise_price_monthly", label: "企业版月付", placeholder: "299", type: "number" },
      ],
    },
    {
      group: "套餐季付价格（USDT，建议设为月付×3×0.9）",
      fields: [
        { key: "plan_basic_price_quarterly", label: "基础版季付", placeholder: "78", type: "number" },
        { key: "plan_pro_price_quarterly", label: "专业版季付", placeholder: "240", type: "number" },
        { key: "plan_enterprise_price_quarterly", label: "企业版季付", placeholder: "808", type: "number" },
      ],
    },
  ];

  const getValue = (key: string) =>
    settings?.find((s) => s.key === key)?.value || "";

  const [formValues, setFormValues] = useState<Record<string, string>>({});

  const handleChange = (key: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    const allFields = settingFields.flatMap((g) => g.fields);
    const updates = allFields.map((f) => ({
      key: f.key,
      value: formValues[f.key] !== undefined ? formValues[f.key] : getValue(f.key),
      description: f.label,
    }));
    upsertMutation.mutate(updates);
  };

  return (
    <div className="space-y-6">
      {settingFields.map((group) => (
        <Card key={group.group} className="bg-gray-800/50 border-gray-700">
          <CardHeader className="pb-3">
            <CardTitle className="text-gray-200 text-sm font-medium">{group.group}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {group.fields.map((field) => (
              <div key={field.key}>
                <Label className="text-gray-400 text-xs mb-1 block">{field.label}</Label>
                <Input
                  type={field.type}
                  placeholder={field.placeholder}
                  defaultValue={getValue(field.key)}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                  className="bg-gray-900 border-gray-600 text-white"
                />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      <Button
        className="w-full bg-blue-600 hover:bg-blue-700"
        onClick={handleSave}
        disabled={upsertMutation.isPending}
      >
        <Save className="w-4 h-4 mr-2" />
        {upsertMutation.isPending ? "保存中..." : "保存所有设置"}
      </Button>

      {/* 当前配置预览 */}
      {settings && settings.length > 0 && (
        <Card className="bg-gray-800/50 border-gray-700">
          <CardHeader className="pb-3">
            <CardTitle className="text-gray-200 text-sm font-medium">当前配置预览</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {settings.map((s) => (
                <div key={s.key} className="flex items-center justify-between py-1 border-b border-gray-700/50 last:border-0">
                  <span className="text-gray-400 text-xs font-mono">{s.key}</span>
                  <span className="text-gray-200 text-xs font-mono max-w-[200px] truncate">
                    {s.key.includes("address") || s.key.includes("key")
                      ? s.value
                        ? `${s.value.slice(0, 8)}...`
                        : "—"
                      : s.value || "—"}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}// ── TG API 凭证 Tab ────────────────────────────────────────────────
function TgApiCredentialsTab() {
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [showHash, setShowHash] = useState(false);

  const { data: status, refetch } = trpc.settings.getTgApiStatus.useQuery(undefined, {
    refetchInterval: 10000,
  });

  const saveMutation = trpc.settings.saveTgApiCredentials.useMutation({
    onSuccess: () => {
      toast.success("凭证已保存，监控引擎正在重启...");
      setApiId("");
      setApiHash("");
      setTimeout(() => refetch(), 3000);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      {/* 当前状态 */}
      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader className="pb-3">
          <CardTitle className="text-gray-200 text-sm font-medium flex items-center gap-2">
            <Zap className="w-4 h-4" />
            引擎当前状态
          </CardTitle>
        </CardHeader>
        <CardContent>
          {status?.configured ? (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/30">
              <CheckCircle className="w-5 h-5 text-green-400 shrink-0" />
              <div>
                <p className="text-green-300 text-sm font-medium">凭证已配置</p>
                <p className="text-gray-400 text-xs mt-0.5">API ID: {status.apiId} · 监控引擎运行中</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
              <Clock className="w-5 h-5 text-amber-400 shrink-0" />
              <div>
                <p className="text-amber-300 text-sm font-medium">等待配置</p>
                <p className="text-gray-400 text-xs mt-0.5">请填入 TG API 凭证以启动监控引擎</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 凭证输入 */}
      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader className="pb-3">
          <CardTitle className="text-gray-200 text-sm font-medium flex items-center gap-2">
            <Bot className="w-4 h-4" />
            Telegram API 凭证
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300">
            请访问{" "}
            <a
              href="https://my.telegram.org/apps"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-medium"
            >
              my.telegram.org/apps
            </a>
            {" "}登录您的 Telegram 账号，创建应用后获取 API ID 和 API Hash。
          </div>

          <div>
            <Label className="text-gray-400 text-xs mb-1.5 block">API ID</Label>
            <Input
              type="number"
              placeholder="例如：12345678"
              value={apiId}
              onChange={(e) => setApiId(e.target.value)}
              className="bg-gray-900 border-gray-600 text-white"
            />
          </div>

          <div>
            <Label className="text-gray-400 text-xs mb-1.5 block">API Hash</Label>
            <div className="relative">
              <Input
                type={showHash ? "text" : "password"}
                placeholder="例如：0123456789abcdef0123456789abcdef"
                value={apiHash}
                onChange={(e) => setApiHash(e.target.value)}
                className="bg-gray-900 border-gray-600 text-white pr-10"
              />
              <button
                type="button"
                onClick={() => setShowHash(!showHash)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
              >
                {showHash ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <Button
            className="w-full bg-blue-600 hover:bg-blue-700"
            onClick={() => saveMutation.mutate({ tgApiId: apiId, tgApiHash: apiHash })}
            disabled={saveMutation.isPending || !apiId || !apiHash}
          >
            <Save className="w-4 h-4 mr-2" />
            {saveMutation.isPending ? "保存并重启引擎..." : "保存凭证并启动引擎"}
          </Button>
        </CardContent>
      </Card>

      {/* 使用说明 */}
      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader className="pb-3">
          <CardTitle className="text-gray-200 text-sm font-medium">使用说明</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-gray-400">
          <p>1. 一个 TG API 凭证可供所有监控账号共用，无需每个账号单独配置。</p>
          <p>2. 保存后监控引擎会自动重启，并开始加载您在《TG 账号管理》中添加的 Session。</p>
          <p>3. 如果引擎状态不更新，请通过 SSH 登录服务器执行 <code className="bg-gray-700 px-1 rounded">pm2 logs ecosystem.engine</code> 查看日志。</p>
        </CardContent>
      </Card>
    </div>
  );
}
// ── 卡密管理 Tab ──────────────────────────────────────────────────────
function RedeemCodesTab() {
  const [genPlan, setGenPlan] = useState<"basic" | "pro" | "enterprise">("pro");
  const [genMonths, setGenMonths] = useState(1);
  const [genCount, setGenCount] = useState(10);
  const [genExpireDays, setGenExpireDays] = useState(30);
  const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);
  const [codeFilter, setCodeFilter] = useState<"all" | "unused" | "used" | "expired">("unused");

  const { data: codes, refetch: refetchCodes } = trpc.payment.adminCodes.useQuery({
    status: codeFilter,
    limit: 100,
    offset: 0,
  });

  const generateMutation = trpc.payment.adminGenerateCodes.useMutation({
    onSuccess: (data) => {
      toast.success(`成功生成 ${data.count} 个卡密`);
      setGeneratedCodes(data.codes);
      refetchCodes();
    },
    onError: (e) => toast.error(e.message),
  });

  const copyAllCodes = () => {
    navigator.clipboard.writeText(generatedCodes.join("\n"));
    toast.success("所有卡密已复制到剪贴板");
  };

  const downloadCodes = () => {
    const blob = new Blob([generatedCodes.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tgpro-codes-${new Date().toISOString().split("T")[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* 批量生成 */}
      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader className="pb-3">
          <CardTitle className="text-gray-200 text-sm font-medium flex items-center gap-2">
            <Plus className="w-4 h-4" />
            批量生成卡密
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-gray-400 text-xs mb-1 block">套餐类型</Label>
              <Select value={genPlan} onValueChange={(v) => setGenPlan(v as any)}>
                <SelectTrigger className="bg-gray-900 border-gray-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-600">
                  <SelectItem value="basic">基础版</SelectItem>
                  <SelectItem value="pro">专业版</SelectItem>
                  <SelectItem value="enterprise">企业版</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-gray-400 text-xs mb-1 block">有效月数</Label>
              <Input
                type="number"
                min={1}
                max={12}
                value={genMonths}
                onChange={(e) => setGenMonths(Number(e.target.value))}
                className="bg-gray-900 border-gray-600 text-white"
              />
            </div>
            <div>
              <Label className="text-gray-400 text-xs mb-1 block">生成数量</Label>
              <Input
                type="number"
                min={1}
                max={500}
                value={genCount}
                onChange={(e) => setGenCount(Number(e.target.value))}
                className="bg-gray-900 border-gray-600 text-white"
              />
            </div>
            <div>
              <Label className="text-gray-400 text-xs mb-1 block">卡密有效期（天）</Label>
              <Input
                type="number"
                min={1}
                value={genExpireDays}
                onChange={(e) => setGenExpireDays(Number(e.target.value))}
                className="bg-gray-900 border-gray-600 text-white"
              />
            </div>
          </div>
          <Button
            className="w-full bg-blue-600 hover:bg-blue-700"
            onClick={() =>
              generateMutation.mutate({
                planId: genPlan,
                durationMonths: genMonths,
                count: genCount,
                expiresInDays: genExpireDays,
              })
            }
            disabled={generateMutation.isPending}
          >
            <Plus className="w-4 h-4 mr-2" />
            {generateMutation.isPending ? "生成中..." : `生成 ${genCount} 个卡密`}
          </Button>
        </CardContent>
      </Card>

      {/* 生成结果 */}
      {generatedCodes.length > 0 && (
        <Card className="bg-green-900/20 border-green-700/40">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-green-300 text-sm font-medium">
                已生成 {generatedCodes.length} 个卡密
              </CardTitle>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="border-green-600 text-green-400 h-7 text-xs" onClick={copyAllCodes}>
                  <Copy className="w-3 h-3 mr-1" />
                  复制全部
                </Button>
                <Button size="sm" variant="outline" className="border-green-600 text-green-400 h-7 text-xs" onClick={downloadCodes}>
                  <Download className="w-3 h-3 mr-1" />
                  下载 TXT
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="max-h-48 overflow-y-auto space-y-1">
              {generatedCodes.map((code) => (
                <div key={code} className="flex items-center justify-between py-1">
                  <code className="text-green-400 font-mono text-sm">{code}</code>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => {
                      navigator.clipboard.writeText(code);
                      toast.success("已复制");
                    }}
                  >
                    <Copy className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 卡密列表 */}
      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-gray-200 text-sm font-medium">卡密列表</CardTitle>
            <div className="flex gap-1">
              {(["all", "unused", "used", "expired"] as const).map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={codeFilter === f ? "default" : "ghost"}
                  className={`h-6 text-xs px-2 ${codeFilter === f ? "bg-blue-600" : "text-gray-400"}`}
                  onClick={() => setCodeFilter(f)}
                >
                  {f === "all" ? "全部" : f === "unused" ? "未使用" : f === "used" ? "已使用" : "已过期"}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!codes || codes.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-4">暂无卡密</p>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {codes.map((code) => (
                <div key={code.id} className="flex items-center justify-between py-1.5 border-b border-gray-700/50 last:border-0">
                  <div className="flex items-center gap-2">
                    <Badge
                      className={
                        code.status === "unused"
                          ? "bg-green-500/20 text-green-300 text-xs"
                          : code.status === "used"
                          ? "bg-gray-500/20 text-gray-400 text-xs"
                          : "bg-red-500/20 text-red-300 text-xs"
                      }
                    >
                      {code.status === "unused" ? "未使用" : code.status === "used" ? "已使用" : "已过期"}
                    </Badge>
                    <code className="text-gray-300 font-mono text-xs">{code.code}</code>
                  </div>
                  <div className="text-right">
                    <p className="text-gray-400 text-xs">
                      {code.planId} × {code.durationMonths}月
                    </p>
                    {code.usedAt && (
                      <p className="text-gray-500 text-xs">{new Date(code.usedAt).toLocaleDateString()}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── 订单管理 Tab ─────────────────────────────────────────────
function OrdersTab() {
  const [orderFilter, setOrderFilter] = useState<"all" | "pending" | "completed" | "expired">("all");
  const { data: orders, isRefetching: ordersRefetching, refetch } = trpc.payment.adminOrders.useQuery({
    status: orderFilter,
    limit: 50,
    offset: 0,
  });

  const confirmMutation = trpc.payment.adminConfirmOrder.useMutation({
    onSuccess: (data) => {
      toast.success(`订单已确认，卡密：${data.redeemCode}`);
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const statusIcon = (status: string) => {
    if (status === "completed") return <CheckCircle className="w-4 h-4 text-green-400" />;
    if (status === "pending") return <Clock className="w-4 h-4 text-amber-400" />;
    return <XCircle className="w-4 h-4 text-red-400" />;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {(["all", "pending", "completed", "expired"] as const).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={orderFilter === f ? "default" : "outline"}
            className={`h-7 text-xs ${orderFilter === f ? "bg-blue-600" : "border-gray-600 text-gray-400"}`}
            onClick={() => setOrderFilter(f)}
          >
            {f === "all" ? "全部" : f === "pending" ? "待支付" : f === "completed" ? "已完成" : "已过期"}
          </Button>
        ))}
        <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={() => refetch()} disabled={ordersRefetching}>
          <RefreshCw className={`w-3.5 h-3.5 ${ordersRefetching ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {!orders || orders.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-8">暂无订单</p>
      ) : (
        <div className="space-y-2">
          {orders.map((order) => (
            <Card key={order.id} className="bg-gray-800/50 border-gray-700">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    {statusIcon(order.status)}
                    <div>
                      <p className="text-white text-sm font-medium">
                        订单 #{order.id} · {order.planId} × {order.durationMonths}月
                      </p>
                      <p className="text-gray-400 text-xs">
                        用户 ID: {order.userId} · {new Date(order.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-white font-mono text-sm">{order.usdtAmount} USDT</p>
                    <Badge
                      className={
                        order.status === "completed"
                          ? "bg-green-500/20 text-green-300 text-xs"
                          : order.status === "pending"
                          ? "bg-amber-500/20 text-amber-300 text-xs"
                          : "bg-red-500/20 text-red-300 text-xs"
                      }
                    >
                      {order.status === "completed" ? "已完成" : order.status === "pending" ? "待支付" : "已过期/失败"}
                    </Badge>
                  </div>
                </div>

                {order.redeemCode && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-gray-400 text-xs">卡密：</span>
                    <code className="text-green-400 font-mono text-xs">{order.redeemCode}</code>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-5 w-5"
                      onClick={() => {
                        navigator.clipboard.writeText(order.redeemCode!);
                        toast.success("已复制");
                      }}
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                  </div>
                )}

                {order.txHash && (
                  <p className="mt-1 text-gray-500 text-xs font-mono truncate">
                    TxHash: {order.txHash}
                  </p>
                )}

                {order.status === "pending" && (
                  <Button
                    size="sm"
                    className="mt-2 h-7 text-xs bg-green-700 hover:bg-green-600"
                    onClick={() => confirmMutation.mutate({ orderId: order.id })}
                    disabled={confirmMutation.isPending}
                  >
                    手动确认到账
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Bot 配置 Tab ────────────────────────────────────────────────
function BotConfigTab() {
  const { data: config, refetch } = trpc.settings.getBotConfig.useQuery();
  const [botToken, setBotToken] = useState("");
  const [channelId, setChannelId] = useState("");
  const [showToken, setShowToken] = useState(false);
  // 健康告警配置
  const { data: alertCfg, refetch: refetchAlert } = trpc.sysConfig.getAll.useQuery();
  const [alertThreshold, setAlertThreshold] = useState("");
  const [alertCooldown, setAlertCooldown] = useState("");
  const saveAlertMutation = trpc.sysConfig.updateBatch.useMutation({
    onSuccess: () => { toast.success("健康告警配置已保存"); refetchAlert(); },
    onError: (e) => toast.error(e.message),
  });
  // 初始化告警配置表单值
  const alertCfgMap = alertCfg ? Object.fromEntries(alertCfg.map((r: any) => [r.configKey, r.configValue ?? ""])) : {};

  const saveMutation = trpc.settings.saveBotConfig.useMutation({
    onSuccess: () => {
      toast.success("Bot 配置已保存，引擎正在重启...");
      setBotToken("");
      setTimeout(() => refetch(), 2000);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      {/* 当前状态 */}
      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader className="pb-3">
          <CardTitle className="text-gray-200 text-sm font-medium flex items-center gap-2">
            <Bot className="w-4 h-4" />
            当前 Bot 状态
          </CardTitle>
        </CardHeader>
        <CardContent>
          {config?.botToken ? (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/30">
              <CheckCircle className="w-5 h-5 text-green-400 shrink-0" />
              <div>
                <p className="text-green-300 text-sm font-medium">Bot 已配置</p>
                <p className="text-gray-400 text-xs mt-0.5">
                  Token: {config.botToken.slice(0, 10)}...{config.botToken.slice(-6)}
                  {config.notifyChannelId && ` · 推送频道: ${config.notifyChannelId}`}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
              <Clock className="w-5 h-5 text-amber-400 shrink-0" />
              <div>
                <p className="text-amber-300 text-sm font-medium">未配置</p>
                <p className="text-gray-400 text-xs mt-0.5">请填入 Bot Token 以启用推送通知</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bot Token 输入 */}
      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader className="pb-3">
          <CardTitle className="text-gray-200 text-sm font-medium">Telegram Bot 配置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300">
            通过{" "}
            <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="underline font-medium">@BotFather</a>
            {" "}创建 Bot 并获取 Token。关键词命中后，Bot 将向指定频道/群组推送通知。
          </div>

          <div>
            <Label className="text-gray-400 text-xs mb-1.5 block">Bot Token</Label>
            <div className="relative">
              <Input
                type={showToken ? "text" : "password"}
                placeholder="例如：7123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                className="bg-gray-900 border-gray-600 text-white pr-10"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
              >
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <Label className="text-gray-400 text-xs mb-1.5 block">推送频道/群组 ID（可选）</Label>
            <Input
              type="text"
              placeholder="例如：-1001234567890（频道/群组的数字 ID）"
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              className="bg-gray-900 border-gray-600 text-white"
            />
            <p className="text-gray-500 text-xs mt-1">将关键词命中通知推送到此频道或群组。留空则不推送到频道。</p>
          </div>

          <Button
            className="w-full bg-blue-600 hover:bg-blue-700"
            onClick={() => saveMutation.mutate({ botToken: botToken || config?.botToken || "", notifyChannelId: channelId || config?.notifyChannelId || "" })}
            disabled={saveMutation.isPending || (!botToken && !config?.botToken)}
          >
            <Save className="w-4 h-4 mr-2" />
            {saveMutation.isPending ? "保存中..." : "保存 Bot 配置"}
          </Button>
        </CardContent>
      </Card>

      {/* 健康告警阈值配置 */}
      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader className="pb-3">
          <CardTitle className="text-gray-200 text-sm font-medium flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            账号健康告警配置
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
            当账号健康度下降到阈值以下时，Bot 会自动向账号所属用户发送告警通知。冷却时间内同一账号不重复告警。
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-gray-400 text-xs mb-1.5 block">告警阈值（健康度分）</Label>
              <Input
                type="number"
                min={0}
                max={100}
                placeholder={alertCfgMap["health_alert_threshold"] || "40"}
                value={alertThreshold}
                onChange={(e) => setAlertThreshold(e.target.value)}
                className="bg-gray-900 border-gray-600 text-white"
              />
              <p className="text-gray-500 text-xs mt-1">当前设置：{alertCfgMap["health_alert_threshold"] || "40"} 分</p>
            </div>
            <div>
              <Label className="text-gray-400 text-xs mb-1.5 block">告警冷却时间（小时）</Label>
              <Input
                type="number"
                min={1}
                max={24}
                placeholder={alertCfgMap["health_alert_cooldown_hours"] || "1"}
                value={alertCooldown}
                onChange={(e) => setAlertCooldown(e.target.value)}
                className="bg-gray-900 border-gray-600 text-white"
              />
              <p className="text-gray-500 text-xs mt-1">当前设置：{alertCfgMap["health_alert_cooldown_hours"] || "1"} 小时</p>
            </div>
          </div>
          <Button
            className="w-full bg-amber-600 hover:bg-amber-700"
            onClick={() => saveAlertMutation.mutate({ configs: [
              { key: "health_alert_threshold", value: alertThreshold || alertCfgMap["health_alert_threshold"] || "40" },
              { key: "health_alert_cooldown_hours", value: alertCooldown || alertCfgMap["health_alert_cooldown_hours"] || "1" },
            ] })}
            disabled={saveAlertMutation.isPending || (!alertThreshold && !alertCooldown)}
          >
            <Save className="w-4 h-4 mr-2" />
            {saveAlertMutation.isPending ? "保存中..." : "保存告警配置"}
          </Button>
        </CardContent>
      </Card>

      {/* 说明 */}
      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader className="pb-3">
          <CardTitle className="text-gray-200 text-sm font-medium">使用说明</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-gray-400">
          <p>1. 创建 Bot 后，将 Bot 添加到目标频道/群组并设为管理员（需要发送消息权限）。</p>
          <p>2. 频道 ID 可通过将频道转发消息给 @userinfobot 获取，格式为负数（如 -1001234567890）。</p>
          <p>3. 配置后，每次关键词命中时 Bot 会自动推送包含发送者信息和消息内容的通知。</p>
          <p>4. 健康告警：当账号健康度低于阈值时，Bot 会向账号所属用户发送告警，并在冷却时间内不重复告警。</p>
        </CardContent>
      </Card>
    </div>
  );
}

// ── 系统配置 Tab（客服、官方频道、使用教程）────────────────────────────────
function SysConfigTab() {
  const { data: configs, refetch } = trpc.sysConfig.getAll.useQuery();
  const [values, setValues] = useState<Record<string, string>>({});

  const updateMutation = trpc.sysConfig.updateBatch.useMutation({
    onSuccess: () => { toast.success("系统配置已保存"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const getValue = (key: string) => {
    if (values[key] !== undefined) return values[key];
    return configs?.find((c) => c.key === key)?.value ?? "";
  };

  const handleChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    const allKeys = ["support_username", "official_channel", "tutorial_text", "bot_name", "site_name", "anti_spam_enabled", "anti_spam_daily_limit", "anti_spam_rate_window", "anti_spam_rate_limit", "anti_spam_min_msg_len", "anti_spam_max_msg_len"];
    const configsToSave = allKeys.map((key) => ({ key, value: getValue(key) }));
    updateMutation.mutate({ configs: configsToSave });
  };

  return (
    <div className="space-y-6">
      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader className="pb-3">
          <CardTitle className="text-gray-200 text-sm font-medium flex items-center gap-2">
            <Bot className="w-4 h-4" />
            Bot 菜单配置
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300">
            以下配置将在 Bot 菜单中展示，用户点击对应按钮时会看到这些信息。
          </div>

          <div>
            <Label className="text-gray-400 text-xs mb-1.5 block">平台名称</Label>
            <Input
              placeholder="例如：TG Monitor Pro"
              value={getValue("site_name")}
              onChange={(e) => handleChange("site_name", e.target.value)}
              className="bg-gray-900 border-gray-600 text-white"
            />
          </div>

          <div>
            <Label className="text-gray-400 text-xs mb-1.5 block">客服 TG 用户名（不含 @）</Label>
            <Input
              placeholder="例如：support_admin"
              value={getValue("support_username")}
              onChange={(e) => handleChange("support_username", e.target.value)}
              className="bg-gray-900 border-gray-600 text-white"
            />
            <p className="text-gray-500 text-xs mt-1">用户点击「技术支持」按钮时，将跳转到此 TG 账号</p>
          </div>

          <div>
            <Label className="text-gray-400 text-xs mb-1.5 block">官方频道链接</Label>
            <Input
              placeholder="例如：https://t.me/yourchannel"
              value={getValue("official_channel")}
              onChange={(e) => handleChange("official_channel", e.target.value)}
              className="bg-gray-900 border-gray-600 text-white"
            />
            <p className="text-gray-500 text-xs mt-1">用户点击「官方频道」按钮时，将跳转到此链接</p>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader className="pb-3">
          <CardTitle className="text-gray-200 text-sm font-medium">使用教程内容</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-gray-500 text-xs">用户点击「使用教程」按钮时显示的内容，支持 Markdown 格式</p>
          <textarea
            rows={10}
            placeholder={`例如：\n📖 **使用教程**\n\n1. 添加监控账号\n2. 设置关键词\n3. 添加监控群组\n4. 开启自动私信`}
            value={getValue("tutorial_text")}
            onChange={(e) => handleChange("tutorial_text", e.target.value)}
            className="w-full bg-gray-900 border border-gray-600 text-white rounded-md p-3 text-sm resize-y font-mono"
          />
        </CardContent>
      </Card>

      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader className="pb-3">
          <CardTitle className="text-gray-200 text-sm font-medium flex items-center gap-2">
            <Shield className="w-4 h-4" />
            刷词过滤配置
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-300">
            防止刷词机器人触发大量无效命中。正常用户一天内搜索同一类词不超过 10 次，超过阈値的发送者将被自动跳过。
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-gray-300 text-sm">启用刷词过滤</Label>
              <p className="text-gray-500 text-xs mt-0.5">关闭后所有发送者均不受频率限制</p>
            </div>
            <button
              type="button"
              onClick={() => handleChange("anti_spam_enabled", getValue("anti_spam_enabled") === "false" ? "true" : "false")}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${getValue("anti_spam_enabled") === "false" ? "bg-gray-600" : "bg-blue-600"}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${getValue("anti_spam_enabled") === "false" ? "translate-x-1" : "translate-x-6"}`} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-gray-400 text-xs mb-1.5 block">每日命中上限（次/人）</Label>
              <Input
                type="number" min={1} max={1000} placeholder="10"
                value={getValue("anti_spam_daily_limit") || "10"}
                onChange={(e) => handleChange("anti_spam_daily_limit", e.target.value)}
                className="bg-gray-900 border-gray-600 text-white"
              />
              <p className="text-gray-500 text-xs mt-1">同一用户当天命中超过此次数后跳过</p>
            </div>
            <div>
              <Label className="text-gray-400 text-xs mb-1.5 block">短时窗口（秒）</Label>
              <Input
                type="number" min={10} max={3600} placeholder="60"
                value={getValue("anti_spam_rate_window") || "60"}
                onChange={(e) => handleChange("anti_spam_rate_window", e.target.value)}
                className="bg-gray-900 border-gray-600 text-white"
              />
              <p className="text-gray-500 text-xs mt-1">短时频率检测的时间窗口</p>
            </div>
            <div>
              <Label className="text-gray-400 text-xs mb-1.5 block">窗口内最大命中次数</Label>
              <Input
                type="number" min={1} max={100} placeholder="3"
                value={getValue("anti_spam_rate_limit") || "3"}
                onChange={(e) => handleChange("anti_spam_rate_limit", e.target.value)}
                className="bg-gray-900 border-gray-600 text-white"
              />
              <p className="text-gray-500 text-xs mt-1">窗口内超过此次数则判定为刷词</p>
            </div>
            <div>
              <Label className="text-gray-400 text-xs mb-1.5 block">最小消息长度（字符）</Label>
              <Input
                type="number" min={0} max={100} placeholder="0"
                value={getValue("anti_spam_min_msg_len") || "0"}
                onChange={(e) => handleChange("anti_spam_min_msg_len", e.target.value)}
                className="bg-gray-900 border-gray-600 text-white"
              />
              <p className="text-gray-500 text-xs mt-1">0 = 不限制；设为 2 可过滤纯单字消息</p>
            </div>
            <div>
              <Label className="text-gray-400 text-xs mb-1.5 block">最大消息长度（字符）</Label>
              <Input
                type="number" min={0} max={10000} placeholder="0"
                value={getValue("anti_spam_max_msg_len") || "0"}
                onChange={(e) => handleChange("anti_spam_max_msg_len", e.target.value)}
                className="bg-gray-900 border-gray-600 text-white"
              />
              <p className="text-gray-500 text-xs mt-1">0 = 不限制；超过此长度的消息将被过滤</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Button
        className="w-full bg-blue-600 hover:bg-blue-700"
        onClick={handleSave}
        disabled={updateMutation.isPending}
      >
        <Save className="w-4 h-4 mr-2" />
        {updateMutation.isPending ? "保存中..." : "保存系统配置"}
      </Button>
    </div>
  );
}

// ── SMTP 邮件配置 Tab ────────────────────────────────
function SmtpSettingsTab() {
  const { data: settings, refetch } = trpc.settings.list.useQuery();
  const upsertMutation = trpc.settings.upsert.useMutation({
    onSuccess: () => { toast.success("设置已保存"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const smtpFields = [
    { key: "smtp_host", label: "SMTP 服务器", placeholder: "smtp.qq.com / smtp.gmail.com / smtp.163.com", type: "text" },
    { key: "smtp_port", label: "SMTP 端口", placeholder: "465（SSL）或 587（TLS）", type: "number" },
    { key: "smtp_user", label: "邮箱账号", placeholder: "your@email.com", type: "email" },
    { key: "smtp_pass", label: "邮箱密码/授权码", placeholder: "QQ邮箱请使用授权码", type: "password" },
    { key: "smtp_from", label: "发件人显示名称", placeholder: "TG Monitor Pro", type: "text" },
    { key: "site_url", label: "站点地址（用于生成邮件链接）", placeholder: "http://72.167.134.119", type: "text" },
  ];

  const getValue = (key: string) => settings?.find((s) => s.key === key)?.value || "";
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const handleChange = (key: string, value: string) => setFormValues((prev) => ({ ...prev, [key]: value }));

  const handleSave = () => {
    const updates = smtpFields.map((f) => ({
      key: f.key,
      value: formValues[f.key] !== undefined ? formValues[f.key] : getValue(f.key),
      description: f.label,
    }));
    upsertMutation.mutate(updates);
  };

  return (
    <div className="space-y-6">
      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader className="pb-3">
          <CardTitle className="text-gray-200 text-sm font-medium">SMTP 邮件服务配置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300">
            配置后，系统将通过此 SMTP 服务器发送注册验证邮件和密码重置邮件。
            支持 QQ 邮箱、163 邮箱、Gmail 等常见邮件服务商。
          </div>
          {smtpFields.map((field) => (
            <div key={field.key}>
              <Label className="text-gray-400 text-xs mb-1 block">{field.label}</Label>
              <Input
                type={field.type}
                placeholder={field.placeholder}
                defaultValue={getValue(field.key)}
                onChange={(e) => handleChange(field.key, e.target.value)}
                className="bg-gray-900 border-gray-600 text-white"
              />
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="smtp_secure"
              defaultChecked={getValue("smtp_secure") !== "false"}
              onChange={(e) => handleChange("smtp_secure", e.target.checked ? "true" : "false")}
              className="w-4 h-4 rounded border-gray-600 bg-gray-800 accent-blue-500"
            />
            <label htmlFor="smtp_secure" className="text-sm text-gray-400 cursor-pointer">
              使用 SSL/TLS 加密连接（端口 465 请勾选）
            </label>
          </div>
        </CardContent>
      </Card>

      <Button
        className="w-full bg-blue-600 hover:bg-blue-700"
        onClick={handleSave}
        disabled={upsertMutation.isPending}
      >
        <Save className="w-4 h-4 mr-2" />
        {upsertMutation.isPending ? "保存中..." : "保存 SMTP 配置"}
      </Button>

      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader className="pb-3">
          <CardTitle className="text-gray-200 text-sm font-medium">常用邮件服务商配置参考</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-gray-400">
          <div className="grid grid-cols-2 gap-3">
            {[
              { name: "QQ 邮箱", host: "smtp.qq.com", port: "465", note: "需开启 SMTP 服务并获取授权码" },
              { name: "163 邮箱", host: "smtp.163.com", port: "465", note: "需开启 SMTP 服务并设置客户端授权码" },
              { name: "Gmail", host: "smtp.gmail.com", port: "587", note: "需开启 2FA 并使用应用密码" },
              { name: "Outlook", host: "smtp.office365.com", port: "587", note: "使用账号密码登录" },
            ].map((s) => (
              <div key={s.name} className="p-2 rounded bg-gray-900 border border-gray-700">
                <p className="text-gray-200 font-medium mb-1">{s.name}</p>
                <p>服务器：{s.host}</p>
                <p>端口：{s.port}</p>
                <p className="text-gray-500 mt-1">{s.note}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── 主页面 ───────────────────────────────────────────
export default function SystemSettings() {
  const { user } = useAuth();

  if (user?.role !== "admin") {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Settings className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">仅管理员可访问此页面</p>
        </div>
      </div>
    );
  }

  return (
    <AdminLayout title="系统设置">
    <div className="p-6 w-full space-y-6">

      <Tabs defaultValue="tgapi" className="space-y-4">
        <TabsList className="bg-gray-800 border border-gray-700 flex-wrap h-auto gap-1">
          <TabsTrigger value="tgapi" className="data-[state=active]:bg-blue-600 text-gray-300 data-[state=active]:text-white">
            <Bot className="w-4 h-4 mr-1.5" />
            TG API 凭证
          </TabsTrigger>
          <TabsTrigger value="payment" className="data-[state=active]:bg-blue-600 text-gray-300 data-[state=active]:text-white">
            <DollarSign className="w-4 h-4 mr-1.5" />
            支付配置
          </TabsTrigger>
          <TabsTrigger value="smtp" className="data-[state=active]:bg-blue-600 text-gray-300 data-[state=active]:text-white">
            <Mail className="w-4 h-4 mr-1.5" />
            邮件配置
          </TabsTrigger>
          <TabsTrigger value="sysconfig" className="data-[state=active]:bg-blue-600 text-gray-300 data-[state=active]:text-white">
            <Settings className="w-4 h-4 mr-1.5" />
            系统配置
          </TabsTrigger>
          <TabsTrigger value="tdlib" className="data-[state=active]:bg-blue-600 text-gray-300 data-[state=active]:text-white">
            <Cpu className="w-4 h-4 mr-1.5" />
            TDLib 引擎
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tgapi">
          <TgApiCredentialsTab />
        </TabsContent>
        <TabsContent value="payment">
          <PaymentSettingsTab />
        </TabsContent>
        <TabsContent value="smtp">
          <SmtpSettingsTab />
        </TabsContent>
        <TabsContent value="sysconfig">
          <SysConfigTab />
        </TabsContent>
        <TabsContent value="tdlib">
          <TdlibEngineTab />
        </TabsContent>
      </Tabs>
    </div>
    </AdminLayout>
  );
}
