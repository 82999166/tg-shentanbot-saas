import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, Bot, MessageSquare, Shield, Zap, ArrowRight, CheckCircle2 } from "lucide-react";
import { Link, useLocation } from "wouter";

const FEATURES = [
  { icon: Bot, title: "多账号监控引擎", desc: "支持多个 Telegram 账号同时监控数十个群组，实时捕获关键词消息" },
  { icon: MessageSquare, title: "智能自动私信", desc: "命中关键词后自动向目标用户发送预设消息，支持多模板轮换和变量插值" },
  { icon: Activity, title: "实时仪表盘", desc: "命中趋势、发信成功率、账号健康度一目了然，数据实时更新" },
  { icon: Shield, title: "四层防封体系", desc: "账号隔离、行为拟人化、内容多样化、配额管理，最大化账号存活率" },
  { icon: Zap, title: "关键词规则引擎", desc: "支持精确匹配、正则表达式、AND/OR/NOT 逻辑组合，灵活配置监控规则" },
];

const PLANS = [
  { name: "免费版", price: "¥0", period: "/月", features: ["2个监控群组", "10个关键词", "每日5条私信", "1个TG账号"], color: "border-slate-600" },
  { name: "基础版", price: "¥29", period: "/月", features: ["10个监控群组", "50个关键词", "每日30条私信", "3个TG账号", "7天历史记录"], color: "border-blue-600", popular: false },
  { name: "专业版", price: "¥99", period: "/月", features: ["50个监控群组", "200个关键词", "每日100条私信", "10个TG账号", "30天历史记录", "防封策略配置"], color: "border-purple-500", popular: true },
  { name: "企业版", price: "¥299", period: "/月", features: ["200个监控群组", "1000个关键词", "每日500条私信", "50个TG账号", "90天历史记录", "账号池管理", "优先支持"], color: "border-amber-500" },
];

export default function Landing() {
  const { isAuthenticated } = useAuth();
  const [, navigate] = useLocation();

  const handleStart = () => {
    if (isAuthenticated) {
      navigate("/dashboard");
    } else {
      navigate("/register");
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* 导航栏 */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Zap className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="font-bold text-lg">TG Monitor Pro</span>
        </div>
        <div className="flex items-center gap-3">
          {isAuthenticated ? (
            <Button onClick={() => navigate("/dashboard")} size="sm">
              进入控制台 <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Link href="/login">
                <Button variant="ghost" size="sm" className="text-gray-300 hover:text-white">
                  登录
                </Button>
              </Link>
              <Link href="/register">
                <Button size="sm">
                  免费注册 <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </Link>
            </div>
          )}
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-20 px-6 text-center">
        <Badge className="mb-6 bg-primary/20 text-primary border-primary/30 hover:bg-primary/20">
          🚀 Telegram 关键词监控 SaaS 平台
        </Badge>
        <h1 className="text-5xl md:text-6xl font-bold mb-6 leading-tight">
          监控群组消息<br />
          <span className="text-primary">自动触达潜在客户</span>
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
          当目标群组出现关键词时，立即获取发送者信息，并自动发送您预设的广告消息。智能防封策略，稳定高效运行。
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Button size="lg" onClick={handleStart} className="text-base px-8">
            免费开始使用 <ArrowRight className="w-5 h-5 ml-2" />
          </Button>
          <Button size="lg" variant="outline" onClick={() => navigate("/dashboard")} className="text-base px-8 border-border">
            查看演示
          </Button>
        </div>
      </section>

      {/* 功能特性 */}
      <section className="py-20 px-6 bg-card/30">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">核心功能</h2>
          <p className="text-muted-foreground text-center mb-12">专为 Telegram 营销场景设计的完整解决方案</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((f, i) => (
              <div key={i} className="bg-card border border-border rounded-xl p-6 hover:border-primary/40 transition-colors">
                <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center mb-4">
                  <f.icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-semibold mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 套餐 */}
      <section className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">选择套餐</h2>
          <p className="text-muted-foreground text-center mb-12">从免费版开始，按需升级</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {PLANS.map((plan, i) => (
              <div key={i} className={`relative bg-card border-2 ${plan.color} rounded-xl p-6 ${plan.popular ? "scale-105" : ""}`}>
                {plan.popular && (
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-purple-600 text-white border-0">最受欢迎</Badge>
                )}
                <div className="mb-4">
                  <div className="font-bold text-lg">{plan.name}</div>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-3xl font-bold">{plan.price}</span>
                    <span className="text-muted-foreground text-sm">{plan.period}</span>
                  </div>
                </div>
                <ul className="space-y-2 mb-6">
                  {plan.features.map((f, j) => (
                    <li key={j} className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Button className="w-full" variant={plan.popular ? "default" : "outline"} onClick={handleStart}>
                  立即开始
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 border-t border-border text-center text-sm text-muted-foreground">
        <p>© 2025 TG Monitor Pro · Telegram 关键词监控平台</p>
      </footer>
    </div>
  );
}
