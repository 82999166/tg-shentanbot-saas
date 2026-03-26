import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { cn } from "@/lib/utils";
import {
  Activity,
  BarChart3,
  Bell,
  Bot,
  ChevronLeft,
  ChevronRight,
  Crown,
  CreditCard,
  Gift,
  Hash,
  Inbox,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Monitor,
  Settings,
  Shield,
  Users,
  Wrench,
  Zap,
  FileText,
  Radio,
} from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { trpc } from "@/lib/trpc";

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: "仪表盘", path: "/dashboard" },
  { icon: Monitor, label: "群组监控", path: "/monitor" },
  { icon: Hash, label: "关键词管理", path: "/keywords" },
  { icon: MessageSquare, label: "消息模板", path: "/templates" },
  { icon: Inbox, label: "私信队列", path: "/queue" },
  { icon: Activity, label: "命中记录", path: "/records" },
  { icon: FileText, label: "命中消息", path: "/hit-messages" },
  { icon: BarChart3, label: "关键词统计", path: "/keyword-stats" },
  { icon: Radio, label: "推送设置", path: "/push-settings" },
  { icon: Users, label: "群组审核", path: "/group-submissions" },
  { icon: Bot, label: "TG 账号", path: "/accounts" },
  { icon: Shield, label: "防封策略", path: "/antiban" },
  { icon: Crown, label: "套餐管理", path: "/plans" },
  { icon: CreditCard, label: "购买升级", path: "/payment" },
  { icon: Gift, label: "邀请裂变", path: "/invite" },
];

const ADMIN_ITEMS = [
  { icon: Users, label: "用户管理", path: "/admin" },
  { icon: Wrench, label: "系统设置", path: "/system-settings" },
];

interface AppLayoutProps {
  children: React.ReactNode;
  title?: string;
}

export default function AppLayout({ children, title }: AppLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [location] = useLocation();
  const { user, isAuthenticated, loading, logout } = useAuth();
  const { data: planData } = trpc.plans.myPlan.useQuery(undefined, { enabled: isAuthenticated });

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">加载中...</div>
      </div>
    );
  }

  // 管理后台路径由 AdminPanel 自行处理权限，不走用户登录跳转
  if (!isAuthenticated && !location.startsWith("/admin")) {
    window.location.href = getLoginUrl();
    return null;
  }

  const planColors: Record<string, string> = {
    free: "bg-slate-600",
    basic: "bg-blue-600",
    pro: "bg-purple-600",
    enterprise: "bg-amber-600",
  };

  const planNames: Record<string, string> = {
    free: "免费版",
    basic: "基础版",
    pro: "专业版",
    enterprise: "企业版",
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* 侧边栏 */}
      <aside
        className={cn(
          "flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300 shrink-0",
          collapsed ? "w-16" : "w-60"
        )}
      >
        {/* Logo */}
        <div className={cn("flex items-center gap-3 px-4 py-4 border-b border-sidebar-border", collapsed && "justify-center px-2")}>
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
            <Zap className="w-5 h-5 text-primary-foreground" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="font-bold text-sm text-foreground leading-tight">TG Monitor</div>
              <div className="text-xs text-muted-foreground">Pro</div>
            </div>
          )}
        </div>

        {/* 导航 */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-1">
          {NAV_ITEMS.map((item) => {
            const active = location === item.path || (item.path !== "/" && location.startsWith(item.path));
            return (
              <Tooltip key={item.path} delayDuration={0}>
                <TooltipTrigger asChild>
                  <Link href={item.path}>
                    <div
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer",
                        active
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                        collapsed && "justify-center px-2"
                      )}
                    >
                      <item.icon className="w-4 h-4 shrink-0" />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </div>
                  </Link>
                </TooltipTrigger>
                {collapsed && (
                  <TooltipContent side="right" className="text-xs">
                    {item.label}
                  </TooltipContent>
                )}
              </Tooltip>
            );
          })}

          {user?.role === "admin" && (
            <>
              <Separator className="my-2 bg-sidebar-border" />
              {!collapsed && <div className="px-3 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">管理员</div>}
              {ADMIN_ITEMS.map((item) => {
                const active = location === item.path;
                return (
                  <Tooltip key={item.path} delayDuration={0}>
                    <TooltipTrigger asChild>
                      <Link href={item.path}>
                        <div
                          className={cn(
                            "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer",
                            active
                              ? "bg-primary text-primary-foreground"
                              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                            collapsed && "justify-center px-2"
                          )}
                        >
                          <item.icon className="w-4 h-4 shrink-0" />
                          {!collapsed && <span className="truncate">{item.label}</span>}
                        </div>
                      </Link>
                    </TooltipTrigger>
                    {collapsed && (
                      <TooltipContent side="right" className="text-xs">
                        {item.label}
                      </TooltipContent>
                    )}
                  </Tooltip>
                );
              })}
            </>
          )}
        </nav>

        {/* 用户信息 */}
        <div className="border-t border-sidebar-border p-3">
          {!collapsed ? (
            <div className="flex items-center gap-3">
              <Avatar className="w-8 h-8 shrink-0">
                <AvatarFallback className="bg-primary text-primary-foreground text-xs font-bold">
                  {user?.name?.charAt(0)?.toUpperCase() ?? "U"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground truncate">{user?.name ?? "用户"}</div>
                <Badge className={cn("text-xs px-1.5 py-0 h-4 text-white", planColors[planData?.planId ?? "free"])}>
                  {planNames[planData?.planId ?? "free"]}
                </Badge>
              </div>
              <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-foreground" onClick={logout}>
                <LogOut className="w-3.5 h-3.5" />
              </Button>
            </div>
          ) : (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Avatar className="w-8 h-8 mx-auto cursor-pointer" onClick={logout}>
                  <AvatarFallback className="bg-primary text-primary-foreground text-xs font-bold">
                    {user?.name?.charAt(0)?.toUpperCase() ?? "U"}
                  </AvatarFallback>
                </Avatar>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">
                {user?.name} · 点击退出
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* 折叠按钮 */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute left-full top-1/2 -translate-y-1/2 -translate-x-0 w-5 h-10 bg-sidebar border border-sidebar-border rounded-r-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors z-10"
          style={{ marginLeft: "-1px" }}
        >
          {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
        </button>
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {/* 顶部栏 */}
        {title && (
          <header className="shrink-0 flex items-center gap-4 px-6 py-4 border-b border-border bg-card/50 backdrop-blur-sm">
            <h1 className="text-lg font-semibold text-foreground">{title}</h1>
          </header>
        )}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
