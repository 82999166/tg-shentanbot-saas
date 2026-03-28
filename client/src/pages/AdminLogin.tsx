import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Eye, EyeOff, Lock, ShieldCheck } from "lucide-react";

export default function AdminLogin() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const utils = trpc.useUtils();

  const loginMutation = trpc.emailAuth.login.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      // 获取用户信息，确认是管理员
      const me = await utils.auth.me.fetch();
      if (me?.role === "admin") {
        toast.success("管理员登录成功");
        navigate("/admin-groups");
      } else {
        toast.error("该账号无管理员权限");
        // 退出登录
        await fetch("/api/auth/logout", { method: "POST" });
        await utils.auth.me.invalidate();
      }
    },
    onError: (e) => {
      toast.error(e.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate({ email, password, rememberMe: true });
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-red-600 rounded-xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-red-900/40">
            <ShieldCheck className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">TG Monitor</h1>
          <p className="text-red-400 text-sm mt-1 font-medium tracking-wide uppercase">管理后台 · Admin Panel</p>
        </div>

        {/* 登录表单 */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-gray-300 text-sm">管理员邮箱</Label>
              <Input
                id="email"
                type="email"
                placeholder="admin@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
                className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 focus:border-red-500 focus:ring-red-500/20 h-11"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-gray-300 text-sm">密码</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="请输入密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 focus:border-red-500 focus:ring-red-500/20 h-11 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              disabled={loginMutation.isPending}
              className="w-full h-11 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors"
            >
              {loginMutation.isPending ? (
                <span className="flex items-center gap-2">
                  <Lock className="w-4 h-4 animate-pulse" />
                  验证中...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Lock className="w-4 h-4" />
                  登录管理后台
                </span>
              )}
            </Button>
          </form>

          <div className="mt-6 pt-5 border-t border-gray-800 text-center">
            <p className="text-gray-500 text-xs">
              此页面仅限系统管理员访问
            </p>
            <a
              href="/login"
              className="text-gray-400 hover:text-gray-200 text-xs mt-1 inline-block transition-colors"
            >
              返回会员登录 →
            </a>
          </div>
        </div>

        <p className="text-center text-gray-600 text-xs mt-6">
          © 2025 TG Monitor Pro · 管理后台
        </p>
      </div>
    </div>
  );
}
