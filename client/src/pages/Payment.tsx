import { useState, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CheckCircle,
  Copy,
  Clock,
  Zap,
  Shield,
  Star,
  Building2,
  RefreshCw,
  Key,
  AlertCircle,
} from "lucide-react";

// ── 套餐配置 ─────────────────────────────────────────────────
const PLAN_META = {
  basic: {
    name: "基础版",
    icon: Zap,
    color: "text-blue-400",
    border: "border-blue-500/40",
    bg: "bg-blue-500/10",
    badge: "bg-blue-500/20 text-blue-300",
    features: ["5 个监控群组", "20 个关键词", "每日 30 条私信", "2 个 TG 账号", "7 天历史记录"],
  },
  pro: {
    name: "专业版",
    icon: Star,
    color: "text-purple-400",
    border: "border-purple-500/40",
    bg: "bg-purple-500/10",
    badge: "bg-purple-500/20 text-purple-300",
    features: ["20 个监控群组", "100 个关键词", "每日 200 条私信", "10 个 TG 账号", "30 天历史记录", "多模板轮换", "防封策略"],
    popular: true,
  },
  enterprise: {
    name: "企业版",
    icon: Building2,
    color: "text-amber-400",
    border: "border-amber-500/40",
    bg: "bg-amber-500/10",
    badge: "bg-amber-500/20 text-amber-300",
    features: ["无限监控群组", "无限关键词", "每日 1000 条私信", "50 个 TG 账号", "90 天历史记录", "账号池管理", "优先支持"],
  },
};

// ── 倒计时组件 ───────────────────────────────────────────────
function Countdown({ expiredAt }: { expiredAt: number }) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const update = () => setRemaining(Math.max(0, expiredAt - Date.now()));
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [expiredAt]);

  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  const isUrgent = remaining < 5 * 60 * 1000;

  if (remaining === 0) return <span className="text-red-400 font-mono">已过期</span>;

  return (
    <span className={`font-mono text-lg font-bold ${isUrgent ? "text-red-400 animate-pulse" : "text-amber-400"}`}>
      {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
    </span>
  );
}

// ── 支付等待弹窗 ─────────────────────────────────────────────
function PaymentDialog({
  order,
  onClose,
  onSuccess,
}: {
  order: { orderId: number; usdtAmount: string; usdtAddress: string; expiredAt: number; planId: string; durationMonths: number };
  onClose: () => void;
  onSuccess: (code: string) => void;
}) {
  const [polling, setPolling] = useState(true);
  const [checkCount, setCheckCount] = useState(0);

  const { data: status, refetch } = trpc.payment.checkOrder.useQuery(
    { orderId: order.orderId },
    { enabled: polling, refetchInterval: polling ? 15000 : false }
  );

  useEffect(() => {
    if (status?.status === "completed" && status.redeemCode) {
      setPolling(false);
      onSuccess(status.redeemCode);
    }
    if (status?.status === "expired" || status?.status === "failed") {
      setPolling(false);
    }
  }, [status, onSuccess]);

  const copyAddress = () => {
    navigator.clipboard.writeText(order.usdtAddress);
    toast.success("收款地址已复制");
  };

  const copyAmount = () => {
    navigator.clipboard.writeText(order.usdtAmount);
    toast.success("金额已复制");
  };

  const handleManualCheck = async () => {
    setCheckCount((c) => c + 1);
    await refetch();
    toast.info("已重新检查链上状态");
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-gray-900 border-gray-700 max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-400" />
            等待 USDT 到账
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* 状态提示 */}
          {status?.status === "expired" ? (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span className="text-red-300 text-sm">订单已过期，请重新下单</span>
            </div>
          ) : (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-amber-300 text-sm font-medium">订单有效期</span>
                <Countdown expiredAt={order.expiredAt} />
              </div>
              <p className="text-gray-400 text-xs">系统每 15 秒自动检查链上到账状态</p>
            </div>
          )}

          {/* 收款信息 */}
          <div className="bg-gray-800 rounded-lg p-4 space-y-3">
            <div>
              <Label className="text-gray-400 text-xs mb-1 block">收款网络</Label>
              <Badge className="bg-green-500/20 text-green-300 border-green-500/30">TRC20 (TRON)</Badge>
            </div>

            <div>
              <Label className="text-gray-400 text-xs mb-1 block">收款地址</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs text-cyan-300 bg-gray-900 rounded px-2 py-1.5 break-all font-mono">
                  {order.usdtAddress}
                </code>
                <Button size="icon" variant="ghost" className="shrink-0 h-7 w-7" onClick={copyAddress}>
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            <div>
              <Label className="text-gray-400 text-xs mb-1 block">转账金额（精确到小数）</Label>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-gray-900 rounded px-3 py-1.5 flex items-center justify-between">
                  <span className="text-2xl font-bold text-white font-mono">{order.usdtAmount}</span>
                  <span className="text-gray-400 text-sm">USDT</span>
                </div>
                <Button size="icon" variant="ghost" className="shrink-0 h-7 w-7" onClick={copyAmount}>
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              </div>
              <p className="text-amber-400 text-xs mt-1">⚠️ 请务必转账精确金额，用于区分您的订单</p>
            </div>
          </div>

          {/* 步骤说明 */}
          <div className="space-y-1.5">
            {[
              "打开 USDT 钱包（支持 TRC20）",
              "转账精确金额到上方地址",
              "等待系统自动检测到账（约 1-3 分钟）",
              "到账后自动发送卡密，用于激活套餐",
            ].map((step, i) => (
              <div key={i} className="flex items-start gap-2 text-sm text-gray-300">
                <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 text-xs flex items-center justify-center shrink-0 mt-0.5">
                  {i + 1}
                </span>
                {step}
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1 border-gray-600 text-gray-300"
              onClick={handleManualCheck}
              disabled={status?.status === "expired"}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              手动检查 {checkCount > 0 && `(${checkCount})`}
            </Button>
            <Button variant="ghost" className="text-gray-500" onClick={onClose}>
              取消
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── 卡密激活弹窗 ─────────────────────────────────────────────
function RedeemDialog({ code: initialCode, onClose }: { code?: string; onClose: () => void }) {
  const [code, setCode] = useState(initialCode || "");
  const utils = trpc.useUtils();

  const redeemMutation = trpc.payment.redeemCode.useMutation({
    onSuccess: (data) => {
      toast.success(`🎉 激活成功！套餐已升级为 ${data.planId}，有效期至 ${new Date(data.expiresAt).toLocaleDateString()}`);
      utils.auth.me.invalidate();
      utils.plans.myPlan.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-gray-900 border-gray-700 max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Key className="w-5 h-5 text-green-400" />
            激活卡密
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {initialCode && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3">
              <p className="text-green-300 text-sm font-medium mb-1">✅ 支付成功！您的卡密：</p>
              <code className="text-green-400 font-mono text-lg font-bold">{initialCode}</code>
            </div>
          )}
          <div>
            <Label className="text-gray-300 mb-2 block">输入卡密</Label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="TGPRO-XXXX-XXXX-XXXX"
              className="bg-gray-800 border-gray-600 text-white font-mono tracking-wider"
            />
          </div>
          <Button
            className="w-full bg-green-600 hover:bg-green-700 text-white"
            onClick={() => redeemMutation.mutate({ code })}
            disabled={!code.trim() || redeemMutation.isPending}
          >
            {redeemMutation.isPending ? "激活中..." : "立即激活"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── 主页面 ───────────────────────────────────────────────────
export default function Payment() {
  const { user } = useAuth();
  const [selectedPlan, setSelectedPlan] = useState<"basic" | "pro" | "enterprise" | null>(null);
  const [selectedDuration, setSelectedDuration] = useState<1 | 3>(1);
  const [pendingOrder, setPendingOrder] = useState<null | {
    orderId: number;
    usdtAmount: string;
    usdtAddress: string;
    expiredAt: number;
    planId: string;
    durationMonths: number;
  }>(null);
  const [successCode, setSuccessCode] = useState<string | null>(null);
  const [showRedeem, setShowRedeem] = useState(false);

  const { data: publicConfig } = trpc.settings.publicConfig.useQuery();
  const { data: myOrders } = trpc.payment.myOrders.useQuery({ limit: 5, offset: 0 });

  const createOrder = trpc.payment.createOrder.useMutation({
    onSuccess: (data) => {
      setPendingOrder(data);
    },
    onError: (e) => toast.error(e.message),
  });

  const getPrice = (planId: string, months: number) => {
    const key = `plan_${planId}_price_${months >= 3 ? "quarterly" : "monthly"}`;
    return publicConfig?.[key] || "—";
  };

  const handleBuy = (planId: "basic" | "pro" | "enterprise") => {
    if (!user) {
      toast.error("请先登录");
      return;
    }
    createOrder.mutate({ planId, durationMonths: selectedDuration });
  };

  const handlePaymentSuccess = (code: string) => {
    setPendingOrder(null);
    setSuccessCode(code);
    setShowRedeem(true);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      {/* 标题 */}
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold text-white">升级套餐</h1>
        <p className="text-gray-400">选择适合您业务规模的套餐，USDT 支付，自动发卡激活</p>
      </div>

      {/* 时长选择 */}
      <div className="flex justify-center gap-2">
        {([1, 3] as const).map((m) => (
          <Button
            key={m}
            variant={selectedDuration === m ? "default" : "outline"}
            className={selectedDuration === m ? "bg-blue-600" : "border-gray-600 text-gray-300"}
            onClick={() => setSelectedDuration(m)}
          >
            {m === 1 ? "月付" : "季付（9折）"}
          </Button>
        ))}
      </div>

      {/* 套餐卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {(["basic", "pro", "enterprise"] as const).map((planId) => {
          const meta = PLAN_META[planId];
          const Icon = meta.icon;
          const price = getPrice(planId, selectedDuration);
          const isCurrentPlan = user?.planId === planId;

          return (
            <Card
              key={planId}
              className={`relative bg-gray-900 ${meta.border} border-2 ${meta.bg} transition-all hover:scale-[1.02] cursor-pointer ${
                selectedPlan === planId ? "ring-2 ring-blue-500" : ""
              }`}
              onClick={() => setSelectedPlan(planId)}
            >
              {(meta as any).popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-purple-600 text-white px-3">最受欢迎</Badge>
                </div>
              )}
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2 mb-2">
                  <Icon className={`w-5 h-5 ${meta.color}`} />
                  <CardTitle className="text-white text-lg">{meta.name}</CardTitle>
                  {isCurrentPlan && (
                    <Badge className="ml-auto bg-green-500/20 text-green-300 text-xs">当前套餐</Badge>
                  )}
                </div>
                <div className="flex items-baseline gap-1">
                  <span className={`text-3xl font-bold ${meta.color}`}>{price}</span>
                  <span className="text-gray-400 text-sm">USDT/{selectedDuration === 1 ? "月" : "季"}</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2">
                  {meta.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-gray-300">
                      <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  className={`w-full ${
                    planId === "pro"
                      ? "bg-purple-600 hover:bg-purple-700"
                      : planId === "enterprise"
                      ? "bg-amber-600 hover:bg-amber-700"
                      : "bg-blue-600 hover:bg-blue-700"
                  } text-white`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleBuy(planId);
                  }}
                  disabled={createOrder.isPending || isCurrentPlan}
                >
                  {createOrder.isPending && selectedPlan === planId
                    ? "生成订单..."
                    : isCurrentPlan
                    ? "当前套餐"
                    : "立即购买"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* 卡密激活区域 */}
      <Card className="bg-gray-900 border-gray-700">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                <Key className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <h3 className="text-white font-medium">已有卡密？</h3>
                <p className="text-gray-400 text-sm">直接输入卡密激活套餐</p>
              </div>
            </div>
            <Button
              variant="outline"
              className="border-green-500/40 text-green-400 hover:bg-green-500/10"
              onClick={() => setShowRedeem(true)}
            >
              <Key className="w-4 h-4 mr-2" />
              激活卡密
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 支付说明 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { icon: Shield, title: "安全支付", desc: "链上交易自动验证，无需人工审核" },
          { icon: Zap, title: "即时发卡", desc: "到账后 1-3 分钟自动发送卡密" },
          { icon: RefreshCw, title: "自动续期", desc: "激活卡密后套餐立即生效，支持叠加" },
        ].map(({ icon: Icon, title, desc }) => (
          <div key={title} className="bg-gray-800/50 rounded-lg p-4 flex items-start gap-3">
            <Icon className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-white text-sm font-medium">{title}</p>
              <p className="text-gray-400 text-xs mt-0.5">{desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* 订单历史 */}
      {myOrders && myOrders.length > 0 && (
        <Card className="bg-gray-900 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white text-base">最近订单</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {myOrders.map((order) => (
                <div
                  key={order.id}
                  className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0"
                >
                  <div className="flex items-center gap-3">
                    <Badge
                      className={
                        order.status === "completed"
                          ? "bg-green-500/20 text-green-300"
                          : order.status === "pending"
                          ? "bg-amber-500/20 text-amber-300"
                          : "bg-red-500/20 text-red-300"
                      }
                    >
                      {order.status === "completed" ? "已完成" : order.status === "pending" ? "待支付" : "已过期"}
                    </Badge>
                    <span className="text-gray-300 text-sm">
                      {PLAN_META[order.planId as keyof typeof PLAN_META]?.name} × {order.durationMonths}月
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="text-white text-sm font-mono">{order.usdtAmount} USDT</p>
                    <p className="text-gray-500 text-xs">{new Date(order.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 支付等待弹窗 */}
      {pendingOrder && (
        <PaymentDialog
          order={pendingOrder}
          onClose={() => setPendingOrder(null)}
          onSuccess={handlePaymentSuccess}
        />
      )}

      {/* 卡密激活弹窗 */}
      {showRedeem && (
        <RedeemDialog
          code={successCode || undefined}
          onClose={() => {
            setShowRedeem(false);
            setSuccessCode(null);
          }}
        />
      )}
    </div>
  );
}
