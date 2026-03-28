import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ShoppingCart, RefreshCw, CheckCircle } from "lucide-react";

export default function Orders() {
  const { data: orders, refetch } = trpc.payment.adminOrders.useQuery({ limit: 100, offset: 0 });

  const confirmMutation = trpc.payment.adminConfirmOrder.useMutation({
    onSuccess: (data) => {
      toast.success(`订单已确认，卡密：${data.redeemCode}`);
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const statusColors: Record<string, string> = {
    pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    paid: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    confirmed: "bg-green-500/20 text-green-400 border-green-500/30",
    cancelled: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  const statusLabels: Record<string, string> = {
    pending: "待支付",
    paid: "已支付",
    confirmed: "已确认",
    cancelled: "已取消",
  };

  return (
    <AdminLayout title="订单管理">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">订单管理</h1>
          <p className="text-gray-400 text-sm mt-1">查看和处理用户的套餐购买订单</p>
        </div>

        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-gray-200 text-base flex items-center gap-2">
                <ShoppingCart className="w-4 h-4 text-blue-400" />
                订单列表
              </CardTitle>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-gray-400" onClick={() => refetch()}>
                <RefreshCw className="w-3 h-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {!orders || orders.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-8">暂无订单</p>
            ) : (
              <div className="space-y-3">
                {orders.map((o: any) => (
                  <div key={o.id} className="flex items-center justify-between bg-gray-900 rounded-lg px-4 py-3 border border-gray-700">
                    <div className="space-y-1">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-xs text-gray-400">#{o.id}</span>
                        <Badge className={`text-xs px-1.5 py-0 ${statusColors[o.status] || ""}`}>
                          {statusLabels[o.status] || o.status}
                        </Badge>
                        <span className="text-xs text-gray-300">{o.plan} · {o.months}个月</span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span>用户 ID: {o.userId}</span>
                        <span>金额: {o.amount} USDT</span>
                        <span>创建: {new Date(o.createdAt).toLocaleString()}</span>
                      </div>
                    </div>
                    {o.status === "paid" && (
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700 text-white text-xs h-7"
                        onClick={() => confirmMutation.mutate({ orderId: o.id })}
                        disabled={confirmMutation.isPending}
                      >
                        <CheckCircle className="w-3 h-3 mr-1" />
                        确认发货
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
