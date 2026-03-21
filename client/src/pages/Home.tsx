import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";

/**
 * 根路由入口：已登录用户跳转到仪表盘，未登录用户跳转到 Landing 页
 */
export default function Home() {
  const { isAuthenticated, loading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (loading) return;
    if (isAuthenticated) {
      setLocation("/dashboard");
    } else {
      setLocation("/landing");
    }
  }, [isAuthenticated, loading, setLocation]);

  return null;
}
