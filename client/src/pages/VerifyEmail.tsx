import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Loader2, Shield } from "lucide-react";

export default function VerifyEmail() {
  const [location, navigate] = useLocation();
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  const verifyMutation = trpc.emailAuth.verifyEmail.useMutation({
    onSuccess: (data) => {
      setStatus("success");
      setMessage(data.message);
    },
    onError: (e) => {
      setStatus("error");
      setMessage(e.message);
    },
  });

  useEffect(() => {
    if (token) {
      verifyMutation.mutate({ token });
    } else {
      setStatus("error");
      setMessage("验证链接无效，缺少 token 参数");
    }
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center">
        <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center mx-auto mb-8">
          <Shield className="w-6 h-6 text-white" />
        </div>

        {status === "loading" && (
          <>
            <Loader2 className="w-12 h-12 text-blue-400 animate-spin mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">正在验证邮箱...</h2>
            <p className="text-gray-400 text-sm">请稍候</p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-8 h-8 text-green-400" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-3">邮箱验证成功！</h2>
            <p className="text-gray-400 mb-8">{message}</p>
            <Button
              className="bg-blue-600 hover:bg-blue-700 px-8"
              onClick={() => navigate("/login")}
            >
              立即登录
            </Button>
          </>
        )}

        {status === "error" && (
          <>
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <XCircle className="w-8 h-8 text-red-400" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-3">验证失败</h2>
            <p className="text-gray-400 mb-8">{message}</p>
            <div className="space-y-3">
              <Button
                className="w-full bg-blue-600 hover:bg-blue-700"
                onClick={() => navigate("/login")}
              >
                返回登录
              </Button>
              <p className="text-sm text-gray-500">
                如需重新发送验证邮件，请在登录页面尝试登录后点击「重新发送验证邮件」。
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
