import { useAuth } from "@/_core/hooks/useAuth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Globe, Users, Bot, Shield, Settings, LogOut, ShieldCheck, PanelLeft,
  MessageCircle, BarChart2, Send, UserCog, Wrench, ShoppingCart, Key, KeyRound, Search
} from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";

// 管理后台专属菜单 - 与用户后台完全独立
const adminMenuItems = [
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

  // 推送配置
  { icon: Send, label: "推送设置", path: "/admin-push-settings", group: "推送配置" },

  // 财务管理
  { icon: ShoppingCart, label: "订单管理", path: "/admin-orders", group: "财务管理" },
  { icon: Key, label: "卡密管理", path: "/admin-redeem-codes", group: "财务管理" },

  // 系统配置
  { icon: Shield, label: "防封设置", path: "/admin-antiban", group: "系统配置" },
  { icon: Settings, label: "系统设置", path: "/system-settings", group: "系统配置" },
  { icon: Wrench, label: "系统维护", path: "/admin-maintenance", group: "系统配置" },
  { icon: KeyRound, label: "修改密码", path: "/admin-change-password", group: "系统配置" },
];

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
      <div className="flex h-screen items-center justify-center bg-gray-950">
        <div className="text-gray-400 text-sm">加载中...</div>
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
    <div className="flex h-screen bg-gray-950 text-gray-100 overflow-hidden">
      {/* 侧边栏 - 仅显示管理员菜单 */}
      <aside
        className="flex flex-col border-r border-gray-800 bg-gray-900 transition-all duration-200 shrink-0"
        style={{ width: collapsed ? 56 : 220 }}
      >
        {/* Logo 区域 */}
        <div className="flex items-center gap-2 px-3 py-4 border-b border-gray-800">
          <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center shrink-0">
            <ShieldCheck className="w-4 h-4 text-white" />
          </div>
          {collapsed ? null : (
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white truncate">TG Monitor</div>
              <div className="text-xs text-red-400 font-medium">管理后台</div>
            </div>
          )}
          <button
            onClick={() => setCollapsed(c => !c)}
            className="ml-auto text-gray-500 hover:text-gray-300 transition-colors"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        </div>

        {/* 菜单 */}
        <nav className="flex-1 overflow-y-auto py-2">
          {groups.map(group => (
            <div key={group}>
              {collapsed ? null : (
                <div className="px-3 pt-3 pb-1">
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">{group}</span>
                </div>
              )}
              {adminMenuItems.filter(i => i.group === group).map(item => {
                const isActive = location === item.path;
                return (
                  <button
                    key={item.path}
                    onClick={() => setLocation(item.path)}
                    title={item.label}
                    className={[
                      "flex items-center gap-3 w-full text-sm font-medium transition-colors rounded-lg my-0.5",
                      collapsed ? "justify-center px-0 py-2.5 mx-auto" : "px-3 py-2.5 mx-1",
                      isActive
                        ? "bg-red-600/20 text-red-400"
                        : "text-gray-400 hover:bg-gray-800 hover:text-gray-100",
                    ].join(" ")}
                    style={{ width: collapsed ? 40 : "calc(100% - 8px)" }}
                  >
                    <item.icon className={"w-4 h-4 shrink-0" + (isActive ? " text-red-400" : "")} />
                    {collapsed ? null : <span className="truncate">{item.label}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* 底部用户信息 */}
        <div className="border-t border-gray-800 p-3">
          {collapsed ? null : (
            <div className="text-xs text-gray-600 text-center mb-2">TG Monitor Pro v1.2.0</div>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 w-full rounded-lg px-2 py-1.5 hover:bg-gray-800 transition-colors text-left">
                <div className="w-7 h-7 bg-red-700 rounded-full flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold text-white">{user?.name?.charAt(0)?.toUpperCase() ?? "A"}</span>
                </div>
                {collapsed ? null : (
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-gray-200 truncate">{user?.name}</div>
                    <div className="text-xs text-gray-500 truncate">{user?.email}</div>
                  </div>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem
                onClick={logout}
                className="cursor-pointer text-red-400 focus:text-red-400"
              >
                <LogOut className="mr-2 h-4 w-4" />
                <span>退出登录</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 overflow-y-auto bg-gray-950">
        {children}
      </main>
    </div>
  );
}
