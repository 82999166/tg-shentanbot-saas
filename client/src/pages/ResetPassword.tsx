import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Eye, EyeOff, Lock, Shield, CheckCircle, XCircle } from "lucide-react";

export default function ResetPassword() {
  const [, navigate] = useLocation();
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [success, setSuccess] = useState(false);
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);

  // 验证 token 是否有效
  const verifyQuery = trpc.emailAuth.verifyResetToken.useQuery(
    { token },
    { enabled: !!token, retry: false }
  );

  useEffect(() => {
    if (verifyQuery.data) setTokenValid(true);
    if (verifyQuery.error) setTokenValid(false);
  }, [verifyQuery.data, verifyQuery.error]);

  const resetMutation = trpc.emailAuth.resetPassword.useMutation({
    onSuccess: (data) => {
      setSuccess(true);
      toast.success(data.message);
    },
    onError: (e) => toast.error(e.message),
  });

  const passwordStrength = () => {
    if (!password) return 0;
    let score = 0;
    if (password.length >= 8) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    return score;
  };

  const strengthColor = ["", "bg-red-500", "bg-yellow-500", "bg-blue-500", "bg-green-500"][passwordStrength()];
  const strengthLabel = ["", "弱", "一般", "较强", "强"][passwordStrength()];

  if (!token) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="text-center">
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">链接无效</h2>
          <p className="text-gray-400 mb-6">重置密码链接缺少必要参数</p>
          <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => navigate("/forgot-password")}>
            重新申请
          </Button>
        </div>
      </div>
    );
  }

  if (tokenValid === false) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="text-center">
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">链接已失效</h2>
          <p className="text-gray-400 mb-6">重置密码链接已过期或已被使用，请重新申请</p>
          <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => navigate("/forgot-password")}>
            重新申请
          </Button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-8 h-8 text-green-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-3">密码重置成功！</h2>
          <p className="text-gray-400 mb-8">您的密码已更新，请使用新密码登录</p>
          <Button className="bg-blue-600 hover:bg-blue-700 px-8" onClick={() => navigate("/login")}>
            立即登录
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center mx-auto mb-4">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">重置密码</h1>
          <p className="text-gray-400 text-sm mt-1">请输入您的新密码</p>
        </div>

        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6 shadow-xl">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (password !== confirmPassword) {
                toast.error("两次密码不一致");
                return;
              }
              resetMutation.mutate({ token, newPassword: password });
            }}
            className="space-y-4"
          >
            <div>
              <Label className="text-gray-300 text-sm mb-1.5 block">新密码</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="至少8位，含大写字母和数字"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 pr-10 bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 focus:border-blue-500"
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {password && (
                <div className="mt-2">
                  <div className="flex gap-1 mb-1">
                    {[1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className={`h-1 flex-1 rounded-full transition-colors ${
                          i <= passwordStrength() ? strengthColor : "bg-gray-700"
                        }`}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-gray-500">密码强度：{strengthLabel}</p>
                </div>
              )}
            </div>

            <div>
              <Label className="text-gray-300 text-sm mb-1.5 block">确认新密码</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <Input
                  type={showConfirm ? "text" : "password"}
                  placeholder="再次输入新密码"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={`pl-10 pr-10 bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 focus:border-blue-500 ${
                    confirmPassword && confirmPassword !== password ? "border-red-500" : ""
                  }`}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                >
                  {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {confirmPassword && confirmPassword !== password && (
                <p className="text-xs text-red-400 mt-1">两次密码不一致</p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 mt-2"
              disabled={resetMutation.isPending || (!!confirmPassword && confirmPassword !== password)}
            >
              {resetMutation.isPending ? "重置中..." : "确认重置密码"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
