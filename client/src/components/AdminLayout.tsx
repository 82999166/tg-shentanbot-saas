import { useAuth } from "@/_core/hooks/useAuth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Globe, Users, Bot, Shield, Settings, LogOut, ShieldCheck, PanelLeft, LayoutDashboard,
  MessageCircle, BarChart2, Send, Wrench, ShoppingCart, Key, KeyRound, Search, LogIn, ChevronRight
} from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";

// 管理后台专属菜单 - 与用户后台完全独立
const adminMenuItems = [
  // 仪表盘
  { icon: LayoutDashboard, label: "系统仪表盘", path: "/admin-dashboard", group: "概览" },

  // 用户管理
  { icon: Users, label: "客户管理", path: "/admin-users", group: "用户管理" },

  // 监控数据
  { icon: MessageCircle, label: "全平台命中消息", path: "/admin-hit-messages", group: "监控数据" },
  { icon: BarChart2, label: "公共关键词统计", path: "/admin-keyword-stats", group: "监控数据" },

  // 监控管理
  { icon: Globe, label: "公共群组管理", path: "/admin-groups", group: "监控管理" },
  { icon: Search, label: "群组采集", path: "/admin-group-scrape", group: "监控管理" },
  { icon: Users, label: "系统 TG 账号", path: "/admin-accounts", group: "监控管理" },
  { icon: Bot, label: "Bot 配置", path: "/bot-config", group: "监控管理" },

  // 财务管理
  { icon: ShoppingCart, label: "订单管理", path: "/admin-orders", group: "财务管理" },
  { icon: Key, label: "卡密管理", path: "/admin-redeem-codes", group: "财务管理" },

  // 系统配置
  { icon: Send, label: "推送设置", path: "/admin-push-settings", group: "系统配置" },
  { icon: Shield, label: "防封设置", path: "/admin-antiban", group: "系统配置" },
  { icon: Settings, label: "系统设置", path: "/system-settings", group: "系统配置" },
  { icon: Wrench, label: "系统维护", path: "/admin-maintenance", group: "系统配置" },
  { icon: KeyRound, label: "修改密码", path: "/admin-change-password", group: "系统配置" },
  { icon: LogIn, label: "管理员登录页", path: "/admin/login", group: "系统配置" },
];

// 分组图标颜色映射
const groupColors: Record<string, string> = {
  "概览": "text-blue-500",
  "用户管理": "text-violet-500",
  "监控数据": "text-emerald-500",
  "监控管理": "text-sky-500",
  "财务管理": "text-amber-500",
  "系统配置": "text-slate-500",
};

interface AdminLayoutProps {
  children: React.ReactNode;
  title?: string;
}

export default function AdminLayout({ children, title }: AdminLayoutProps) {
  const { user, logout, loading } = useAuth();
  const [location, setLocation] = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-slate-500 text-sm">加载中...</span>
        </div>
      </div>
    );
  }

  // 未登录或非管理员，跳转到管理员登录页
  if (!user || user.role !== "admin") {
    window.location.href = "/admin/login";
    return null;
  }

  const groups = Array.from(new Set(adminMenuItems.map(i => i.group)));

  return (
    <div className="flex h-screen bg-slate-50 text-slate-800 overflow-hidden">
      {/* 侧边栏 */}
      <aside
        className="flex flex-col border-r border-slate-200 bg-white shadow-sm transition-all duration-200 shrink-0"
        style={{ width: collapsed ? 56 : 216 }}
      >
        {/* Logo 区域 */}
        <div className="flex items-center gap-2.5 px-3 py-3.5 border-b border-slate-100 shrink-0">
          <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center shrink-0 shadow-sm">
            <ShieldCheck className="w-4 h-4 text-white" />
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-slate-800 truncate">TG Monitor</div>
              <div className="text-xs text-blue-500 font-medium">管理后台</div>
            </div>
          )}
          <button
            onClick={() => setCollapsed(c => !c)}
            className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md p-0.5 transition-colors shrink-0"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        </div>

        {/* 菜单区域 */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden" style={{ padding: "8px 0 4px" }}>
          <div>
            {groups.map((group, gi) => (
              <div key={group} className={gi > 0 ? "mt-1" : ""}>
                {!collapsed && (
                  <div style={{ padding: "6px 14px 2px" }}>
                    <span
                      className="font-semibold text-slate-400 uppercase tracking-wider"
                      style={{ fontSize: 10 }}
                    >
                      {group}
                    </span>
                  </div>
                )}
                {adminMenuItems.filter(i => i.group === group).map(item => {
                  const isActive = location === item.path;
                  const iconColor = groupColors[group] || "text-slate-500";
                  return (
                    <button
                      key={item.path}
                      onClick={() => {
                        if (item.path === "/admin/login") {
                          window.location.href = "/admin/login";
                        } else {
                          setLocation(item.path);
                        }
                      }}
                      title={collapsed ? item.label : undefined}
                      className={[
                        "flex items-center gap-2.5 w-full font-medium transition-all rounded-lg",
                        collapsed ? "justify-center" : "",
                        isActive
                          ? "bg-blue-50 text-blue-600"
                          : "text-slate-600 hover:bg-slate-50 hover:text-slate-800",
                      ].join(" ")}
                      style={{
                        fontSize: 13,
                        padding: collapsed ? "7px 0" : "6px 10px",
                        margin: collapsed ? "1px auto" : "1px 6px",
                        width: collapsed ? 40 : "calc(100% - 12px)",
                      }}
                    >
                      <item.icon
                        className={[
                          "shrink-0",
                          isActive ? "text-blue-500" : iconColor,
                        ].join(" ")}
                        style={{ width: 15, height: 15 }}
                      />
                      {!collapsed && (
                        <>
                          <span className="truncate flex-1 text-left">{item.label}</span>
                          {isActive && <ChevronRight className="w-3 h-3 text-blue-400 shrink-0" />}
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </nav>

        {/* 底部用户信息 */}
        <div className="border-t border-slate-100 p-2 shrink-0 bg-white">
          {!collapsed && (
            <div className="text-center mb-2" style={{ fontSize: 10, color: "#94a3b8" }}>
              TG Monitor Pro v1.2.0
            </div>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 w-full rounded-lg px-2 py-2 hover:bg-slate-50 transition-colors text-left">
                <div className="w-7 h-7 bg-gradient-to-br from-blue-400 to-blue-600 rounded-full flex items-center justify-center shrink-0 shadow-sm">
                  <span className="text-xs font-bold text-white">{user?.name?.charAt(0)?.toUpperCase() ?? "A"}</span>
                </div>
                {!collapsed && (
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-slate-700 truncate">{user?.name}</div>
                    <div className="truncate" style={{ fontSize: 10, color: "#94a3b8" }}>{user?.email}</div>
                  </div>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44 bg-white border-slate-200 shadow-lg">
              <DropdownMenuItem
                onClick={logout}
                className="cursor-pointer text-red-500 focus:text-red-500 focus:bg-red-50"
              >
                <LogOut className="mr-2 h-4 w-4" />
                <span>退出登录</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 overflow-y-auto bg-slate-50">
        {children}
      </main>
    </div>
  );
}
