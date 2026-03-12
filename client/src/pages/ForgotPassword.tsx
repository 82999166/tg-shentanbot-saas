import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Mail, Shield, CheckCircle, ArrowLeft } from "lucide-react";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const forgotMutation = trpc.emailAuth.forgotPassword.useMutation({
    onSuccess: (data) => {
      setSent(true);
      toast.success(data.message);
    },
    onError: (e) => toast.error(e.message),
  });

  if (sent) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center">
          <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-8 h-8 text-blue-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-3">邮件已发送</h2>
          <p className="text-gray-400 mb-2">重置密码链接已发送至</p>
          <p className="text-blue-400 font-medium mb-6">{email}</p>
          <p className="text-gray-500 text-sm mb-8">
            请查收邮件并在 1 小时内点击链接重置密码。如未收到，请检查垃圾邮件文件夹。
          </p>
          <div className="space-y-3">
            <Button
              variant="outline"
              className="w-full border-gray-700 text-gray-300 hover:bg-gray-800"
              onClick={() => { setSent(false); setEmail(""); }}
            >
              重新发送
            </Button>
            <Link href="/login">
              <Button className="w-full bg-blue-600 hover:bg-blue-700">
                返回登录
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center mx-auto mb-4">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">找回密码</h1>
          <p className="text-gray-400 text-sm mt-1">输入注册邮箱，我们将发送重置链接</p>
        </div>

        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6 shadow-xl">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              forgotMutation.mutate({ email });
            }}
            className="space-y-4"
          >
            <div>
              <Label className="text-gray-300 text-sm mb-1.5 block">注册邮箱</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <Input
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10 bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 focus:border-blue-500"
                  required
                />
              </div>
            </div>

            <Button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5"
              disabled={forgotMutation.isPending}
            >
              {forgotMutation.isPending ? "发送中..." : "发送重置链接"}
            </Button>
          </form>

          <div className="mt-4 text-center">
            <Link href="/login" className="text-sm text-gray-500 hover:text-gray-300 flex items-center justify-center gap-1">
              <ArrowLeft className="w-3 h-3" />
              返回登录
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
