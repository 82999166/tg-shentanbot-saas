import { useState } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Eye, EyeOff, Mail, Lock, Shield, AlertCircle } from "lucide-react";

export default function Login() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [needVerify, setNeedVerify] = useState(false);

  const utils = trpc.useUtils();

  const loginMutation = trpc.emailAuth.login.useMutation({
    onSuccess: async () => {
      toast.success("登录成功");
      await utils.auth.me.invalidate();
      navigate("/dashboard");
    },
    onError: (e) => {
      if (e.message.includes("验证邮箱")) {
        setNeedVerify(true);
      }
      toast.error(e.message);
    },
  });

  const resendMutation = trpc.emailAuth.resendVerifyEmail.useMutation({
    onSuccess: (data) => toast.success(data.message),
    onError: (e) => toast.error(e.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate({ email, password, rememberMe });
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center mx-auto mb-4">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">TG Monitor Pro</h1>
          <p className="text-gray-400 text-sm mt-1">登录您的账号</p>
        </div>

        {/* 邮箱未验证提示 */}
        {needVerify && (
          <div className="mb-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-amber-300 text-sm font-medium">邮箱未验证</p>
              <p className="text-gray-400 text-xs mt-1">请先验证邮箱后再登录。</p>
              <button
                className="text-blue-400 text-xs underline mt-2 hover:text-blue-300"
                onClick={() => resendMutation.mutate({ email })}
                disabled={resendMutation.isPending}
              >
                {resendMutation.isPending ? "发送中..." : "重新发送验证邮件"}
              </button>
            </div>
          </div>
        )}

        {/* Form */}
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6 shadow-xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 邮箱 */}
            <div>
              <Label className="text-gray-300 text-sm mb-1.5 block">邮箱地址</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <Input
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10 bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 focus:border-blue-500"
                  required
                  autoComplete="email"
                />
              </div>
            </div>

            {/* 密码 */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-gray-300 text-sm">密码</Label>
                <Link href="/forgot-password" className="text-xs text-blue-400 hover:text-blue-300">
                  忘记密码？
                </Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="输入密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 pr-10 bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 focus:border-blue-500"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* 记住我 */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="rememberMe"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-4 h-4 rounded border-gray-600 bg-gray-800 accent-blue-500"
              />
              <label htmlFor="rememberMe" className="text-sm text-gray-400 cursor-pointer">
                记住我（30天免登录）
              </label>
            </div>

            <Button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 mt-2"
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? "登录中..." : "登录"}
            </Button>
          </form>

          <div className="mt-4 text-center text-sm text-gray-500">
            还没有账号？{" "}
            <Link href="/register" className="text-blue-400 hover:text-blue-300 font-medium">
              立即注册
            </Link>
          </div>
        </div>

        <p className="text-center text-xs text-gray-600 mt-6">
          © 2025 TG Monitor Pro. 保留所有权利。
        </p>
      </div>
    </div>
  );
}
