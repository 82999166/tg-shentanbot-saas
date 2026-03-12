import { useState } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Eye, EyeOff, Mail, Lock, User, Shield, CheckCircle } from "lucide-react";

export default function Register() {
  const [, navigate] = useLocation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [registered, setRegistered] = useState(false);

  const registerMutation = trpc.emailAuth.register.useMutation({
    onSuccess: (data) => {
      setRegistered(true);
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

  const strengthLabel = ["", "弱", "一般", "较强", "强"][passwordStrength()];
  const strengthColor = ["", "bg-red-500", "bg-yellow-500", "bg-blue-500", "bg-green-500"][passwordStrength()];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error("两次输入的密码不一致");
      return;
    }
    registerMutation.mutate({ name, email, password, inviteCode: inviteCode || undefined });
  };

  if (registered) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center">
          <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-8 h-8 text-green-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-3">注册成功！</h2>
          <p className="text-gray-400 mb-2">验证邮件已发送至</p>
          <p className="text-blue-400 font-medium mb-6">{email}</p>
          <p className="text-gray-500 text-sm mb-8">请查收邮件并点击验证链接激活账号，然后即可登录。</p>
          <div className="space-y-3">
            <Button
              className="w-full bg-blue-600 hover:bg-blue-700"
              onClick={() => navigate("/login")}
            >
              前往登录
            </Button>
            <Button
              variant="outline"
              className="w-full border-gray-700 text-gray-300 hover:bg-gray-800"
              onClick={() => setRegistered(false)}
            >
              返回修改信息
            </Button>
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
          <h1 className="text-2xl font-bold text-white">TG Monitor Pro</h1>
          <p className="text-gray-400 text-sm mt-1">创建您的账号</p>
        </div>

        {/* Form */}
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6 shadow-xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 用户名 */}
            <div>
              <Label className="text-gray-300 text-sm mb-1.5 block">用户名</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <Input
                  type="text"
                  placeholder="您的昵称"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="pl-10 bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 focus:border-blue-500"
                  required
                />
              </div>
            </div>

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
                />
              </div>
            </div>

            {/* 密码 */}
            <div>
              <Label className="text-gray-300 text-sm mb-1.5 block">密码</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="至少8位，含大写字母和数字"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 pr-10 bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 focus:border-blue-500"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {/* 密码强度 */}
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

            {/* 确认密码 */}
            <div>
              <Label className="text-gray-300 text-sm mb-1.5 block">确认密码</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <Input
                  type={showConfirm ? "text" : "password"}
                  placeholder="再次输入密码"
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

            {/* 邀请码（可选） */}
            <div>
              <Label className="text-gray-300 text-sm mb-1.5 block">
                邀请码 <span className="text-gray-500 font-normal">（选填）</span>
              </Label>
              <Input
                type="text"
                placeholder="TGM-XXXXXX"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 focus:border-blue-500"
              />
            </div>

            <Button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 mt-2"
              disabled={registerMutation.isPending || (!!confirmPassword && confirmPassword !== password)}
            >
              {registerMutation.isPending ? "注册中..." : "创建账号"}
            </Button>
          </form>

          <div className="mt-4 text-center text-sm text-gray-500">
            已有账号？{" "}
            <Link href="/login" className="text-blue-400 hover:text-blue-300 font-medium">
              立即登录
            </Link>
          </div>
        </div>

        <p className="text-center text-xs text-gray-600 mt-6">
          注册即表示您同意我们的服务条款和隐私政策
        </p>
      </div>
    </div>
  );
}
