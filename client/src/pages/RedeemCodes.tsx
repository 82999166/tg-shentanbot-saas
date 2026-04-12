import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Key, Copy, RefreshCw } from "lucide-react";

export default function RedeemCodes() {
  const [genPlan, setGenPlan] = useState<"basic" | "pro" | "enterprise">("pro");
  const [genMonths, setGenMonths] = useState(1);
  const [genCount, setGenCount] = useState(10);
  const [genExpireDays, setGenExpireDays] = useState(30);
  const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);
  const [codeFilter, setCodeFilter] = useState<"all" | "unused" | "used" | "expired">("unused");

  const { data: codes, isRefetching: codesRefetching, refetch: refetchCodes } = trpc.payment.adminCodes.useQuery({
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

  const statusColors: Record<string, string> = {
    unused: "bg-green-500/20 text-green-400 border-green-500/30",
    used: "bg-gray-500/20 text-gray-400 border-gray-500/30",
    expired: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  const statusLabels: Record<string, string> = { unused: "未使用", used: "已使用", expired: "已过期" };

  return (
    <AdminLayout title="卡密管理">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">卡密管理</h1>
          <p className="text-gray-400 text-sm mt-1">批量生成、查看和管理激活卡密</p>
        </div>

        {/* 生成卡密 */}
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-gray-200 text-base flex items-center gap-2">
              <Key className="w-4 h-4 text-blue-400" />
              批量生成卡密
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <Label className="text-gray-400 text-xs mb-1 block">套餐类型</Label>
                <Select value={genPlan} onValueChange={(v) => setGenPlan(v as any)}>
                  <SelectTrigger className="bg-gray-700 border-gray-600 text-gray-200 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700">
                    <SelectItem value="basic" className="text-gray-300 text-xs">基础版</SelectItem>
                    <SelectItem value="pro" className="text-gray-300 text-xs">专业版</SelectItem>
                    <SelectItem value="enterprise" className="text-gray-300 text-xs">企业版</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-gray-400 text-xs mb-1 block">有效月数</Label>
                <Input
                  type="number"
                  min={1}
                  max={24}
                  value={genMonths}
                  onChange={(e) => setGenMonths(Number(e.target.value))}
                  className="bg-gray-700 border-gray-600 text-gray-200 h-8 text-xs"
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
                  className="bg-gray-700 border-gray-600 text-gray-200 h-8 text-xs"
                />
              </div>
              <div>
                <Label className="text-gray-400 text-xs mb-1 block">卡密有效期（天）</Label>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={genExpireDays}
                  onChange={(e) => setGenExpireDays(Number(e.target.value))}
                  className="bg-gray-700 border-gray-600 text-gray-200 h-8 text-xs"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs"
                onClick={() => generateMutation.mutate({ planId: genPlan, durationMonths: genMonths, count: genCount, expiresInDays: genExpireDays })}
                disabled={generateMutation.isPending}
              >
                {generateMutation.isPending ? "生成中..." : `生成 ${genCount} 个卡密`}
              </Button>
              {generatedCodes.length > 0 && (
                <Button size="sm" variant="outline" className="border-gray-600 text-gray-300 text-xs" onClick={copyAllCodes}>
                  <Copy className="w-3 h-3 mr-1" />
                  复制全部 ({generatedCodes.length})
                </Button>
              )}
            </div>
            {generatedCodes.length > 0 && (
              <div className="bg-gray-900 rounded p-3 max-h-40 overflow-y-auto">
                <p className="text-gray-400 text-xs mb-2">已生成 {generatedCodes.length} 个卡密：</p>
                {generatedCodes.map((c, i) => (
                  <div key={i} className="text-green-400 font-mono text-xs">{c}</div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 卡密列表 */}
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-gray-200 text-sm font-medium">卡密列表</CardTitle>
              <div className="flex items-center gap-2">
                <Select value={codeFilter} onValueChange={(v) => setCodeFilter(v as any)}>
                  <SelectTrigger className="bg-gray-700 border-gray-600 text-gray-200 h-7 text-xs w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700">
                    <SelectItem value="all" className="text-gray-300 text-xs">全部</SelectItem>
                    <SelectItem value="unused" className="text-gray-300 text-xs">未使用</SelectItem>
                    <SelectItem value="used" className="text-gray-300 text-xs">已使用</SelectItem>
                    <SelectItem value="expired" className="text-gray-300 text-xs">已过期</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-gray-400" onClick={() => refetchCodes()} disabled={codesRefetching}>
                  <RefreshCw className={`w-3 h-3 ${codesRefetching ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {!codes || codes.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-4">暂无卡密</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {codes.map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between bg-gray-750 rounded px-3 py-2 border border-gray-700">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs text-gray-300">{c.code}</span>
                      <Badge className={`text-xs px-1.5 py-0 ${statusColors[c.status] || ""}`}>
                        {statusLabels[c.status] || c.status}
                      </Badge>
                      <span className="text-xs text-gray-500">{c.plan} · {c.months}个月</span>
                    </div>
                    <div className="text-xs text-gray-500">
                      {c.usedAt ? `使用于 ${new Date(c.usedAt).toLocaleDateString()}` : `过期 ${new Date(c.expiresAt).toLocaleDateString()}`}
                    </div>
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
