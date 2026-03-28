import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Eye, EyeOff, Lock, ShieldCheck, KeyRound } from "lucide-react";

export default function AdminChangePassword() {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const changePasswordMutation = trpc.emailAuth.changePassword.useMutation({
    onSuccess: () => {
      toast.success("密码修改成功，请下次使用新密码登录");
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (e) => {
      toast.error(e.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("两次输入的新密码不一致");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("新密码至少需要 8 位");
      return;
    }
    if (!/[A-Z]/.test(newPassword)) {
      toast.error("新密码需包含至少一个大写字母");
      return;
    }
    if (!/[0-9]/.test(newPassword)) {
      toast.error("新密码需包含至少一个数字");
      return;
    }
    changePasswordMutation.mutate({ oldPassword, newPassword });
  };

  // 密码强度检测
  const getStrength = (pwd: string) => {
    let score = 0;
    if (pwd.length >= 8) score++;
    if (pwd.length >= 12) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;
    return score;
  };
  const strength = getStrength(newPassword);
  const strengthLabel = ["", "弱", "弱", "中", "强", "非常强"][strength] || "";
  const strengthColor = ["", "bg-red-500", "bg-orange-500", "bg-yellow-500", "bg-green-500", "bg-emerald-500"][strength] || "";

  return (
    <AdminLayout>
      <div className="max-w-xl mx-auto py-8 px-4">
        {/* 页头 */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-red-600/20 border border-red-600/30 rounded-xl flex items-center justify-center">
              <KeyRound className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">修改管理员密码</h1>
              <p className="text-gray-400 text-sm">定期更换密码有助于保护账号安全</p>
            </div>
          </div>
        </div>

        {/* 表单卡片 */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* 原密码 */}
            <div className="space-y-2">
              <Label className="text-gray-300 text-sm flex items-center gap-2">
                <Lock className="w-3.5 h-3.5 text-gray-500" />
                当前密码
              </Label>
              <div className="relative">
                <Input
                  type={showOld ? "text" : "password"}
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  placeholder="请输入当前密码"
                  className="bg-gray-800 border-gray-700 text-white placeholder-gray-500 pr-10 focus:border-red-500 focus:ring-red-500/20"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowOld(!showOld)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
                >
                  {showOld ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* 分割线 */}
            <div className="border-t border-gray-800" />

            {/* 新密码 */}
            <div className="space-y-2">
              <Label className="text-gray-300 text-sm flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-gray-500" />
                新密码
              </Label>
              <div className="relative">
                <Input
                  type={showNew ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="至少8位，含大写字母和数字"
                  className="bg-gray-800 border-gray-700 text-white placeholder-gray-500 pr-10 focus:border-red-500 focus:ring-red-500/20"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowNew(!showNew)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
                >
                  {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {/* 密码强度条 */}
              {newPassword.length > 0 && (
                <div className="space-y-1">
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div
                        key={i}
                        className={`h-1 flex-1 rounded-full transition-all ${
                          i <= strength ? strengthColor : "bg-gray-700"
                        }`}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-gray-400">
                    密码强度：<span className={`font-medium ${
                      strength <= 2 ? "text-red-400" : strength === 3 ? "text-yellow-400" : "text-green-400"
                    }`}>{strengthLabel}</span>
                  </p>
                </div>
              )}
            </div>

            {/* 确认新密码 */}
            <div className="space-y-2">
              <Label className="text-gray-300 text-sm flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-gray-500" />
                确认新密码
              </Label>
              <div className="relative">
                <Input
                  type={showConfirm ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="再次输入新密码"
                  className={`bg-gray-800 border-gray-700 text-white placeholder-gray-500 pr-10 focus:border-red-500 focus:ring-red-500/20 ${
                    confirmPassword && confirmPassword !== newPassword ? "border-red-500" : ""
                  }`}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
                >
                  {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {confirmPassword && confirmPassword !== newPassword && (
                <p className="text-xs text-red-400">两次输入的密码不一致</p>
              )}
              {confirmPassword && confirmPassword === newPassword && newPassword.length >= 8 && (
                <p className="text-xs text-green-400">✓ 密码一致</p>
              )}
            </div>

            {/* 密码要求说明 */}
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 space-y-1.5">
              <p className="text-xs text-gray-400 font-medium mb-2">密码要求：</p>
              {[
                { label: "至少 8 个字符", ok: newPassword.length >= 8 },
                { label: "包含大写字母（A-Z）", ok: /[A-Z]/.test(newPassword) },
                { label: "包含数字（0-9）", ok: /[0-9]/.test(newPassword) },
                { label: "包含特殊字符（推荐）", ok: /[^A-Za-z0-9]/.test(newPassword) },
              ].map((req) => (
                <div key={req.label} className="flex items-center gap-2">
                  <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[10px] ${
                    newPassword.length === 0
                      ? "bg-gray-700 text-gray-500"
                      : req.ok
                      ? "bg-green-500/20 text-green-400"
                      : "bg-red-500/20 text-red-400"
                  }`}>
                    {newPassword.length === 0 ? "·" : req.ok ? "✓" : "✗"}
                  </div>
                  <span className={`text-xs ${
                    newPassword.length === 0
                      ? "text-gray-500"
                      : req.ok ? "text-green-400" : "text-gray-400"
                  }`}>{req.label}</span>
                </div>
              ))}
            </div>

            {/* 提交按钮 */}
            <Button
              type="submit"
              disabled={changePasswordMutation.isPending || !oldPassword || !newPassword || !confirmPassword}
              className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-2.5 rounded-xl transition-all disabled:opacity-50"
            >
              {changePasswordMutation.isPending ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  修改中...
                </span>
              ) : (
                <span className="flex items-center gap-2 justify-center">
                  <KeyRound className="w-4 h-4" />
                  确认修改密码
                </span>
              )}
            </Button>
          </form>
        </div>

        {/* 安全提示 */}
        <div className="mt-4 bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-4">
          <p className="text-xs text-yellow-400/80 leading-relaxed">
            <span className="font-medium text-yellow-400">安全提示：</span>
            修改密码后当前会话仍然有效，下次登录时需使用新密码。建议定期更换密码，并避免使用与其他平台相同的密码。
          </p>
        </div>
      </div>
    </AdminLayout>
  );
}
