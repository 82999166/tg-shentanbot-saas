import { useState } from "react";
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
} from "lucide-react";

// ── 系统设置 Tab ─────────────────────────────────────────────
function PaymentSettingsTab() {
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
}

// ── 卡密管理 Tab ─────────────────────────────────────────────
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
  const { data: orders, refetch } = trpc.payment.adminOrders.useQuery({
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
        <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={() => refetch()}>
          <RefreshCw className="w-3.5 h-3.5" />
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

// ── 主页面 ───────────────────────────────────────────────────
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
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
          <Settings className="w-5 h-5 text-blue-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">系统设置</h1>
          <p className="text-gray-400 text-sm">配置 USDT 收款、套餐价格、卡密管理</p>
        </div>
      </div>

      <Tabs defaultValue="payment" className="space-y-4">
        <TabsList className="bg-gray-800 border border-gray-700">
          <TabsTrigger value="payment" className="data-[state=active]:bg-blue-600 text-gray-300 data-[state=active]:text-white">
            <DollarSign className="w-4 h-4 mr-1.5" />
            支付配置
          </TabsTrigger>
          <TabsTrigger value="codes" className="data-[state=active]:bg-blue-600 text-gray-300 data-[state=active]:text-white">
            <Key className="w-4 h-4 mr-1.5" />
            卡密管理
          </TabsTrigger>
          <TabsTrigger value="orders" className="data-[state=active]:bg-blue-600 text-gray-300 data-[state=active]:text-white">
            <ShoppingCart className="w-4 h-4 mr-1.5" />
            订单管理
          </TabsTrigger>
        </TabsList>

        <TabsContent value="payment">
          <PaymentSettingsTab />
        </TabsContent>
        <TabsContent value="codes">
          <RedeemCodesTab />
        </TabsContent>
        <TabsContent value="orders">
          <OrdersTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
