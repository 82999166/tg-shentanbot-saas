import AdminLayout from "@/components/AdminLayout";
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Bot, Copy, ExternalLink, CheckCircle2, AlertCircle,
  MessageSquare, Bell, Zap, Shield, Code2, BookOpen
} from "lucide-react";

export default function BotConfig() {
  const [botToken, setBotToken] = useState("");
  const [notifyTgId, setNotifyTgId] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: settingsList, refetch } = trpc.settings.list.useQuery();

  // 初始化表单字段
  useEffect(() => {
    if (settingsList) {
      const botTokenSetting = settingsList.find((s) => s.key === "bot_token");
      const notifyTgIdSetting = settingsList.find((s) => s.key === "notify_tg_id");
      if (botTokenSetting?.value) setBotToken(botTokenSetting.value);
      if (notifyTgIdSetting?.value) setNotifyTgId(notifyTgIdSetting.value);
    }
  }, [settingsList]);

  const settings = {
    botToken: settingsList?.find((s) => s.key === "bot_token")?.value,
    notifyTgId: settingsList?.find((s) => s.key === "notify_tg_id")?.value,
  };

  const updateMutation = trpc.settings.upsert.useMutation({
    onSuccess: () => {
      toast.success("Bot 配置已保存");
      refetch();
      setSaving(false);
    },
    onError: (e: { message: string }) => {
      toast.error(e.message);
      setSaving(false);
    },
  });

  const handleSave = () => {
    setSaving(true);
    updateMutation.mutate([
      { key: "bot_token", value: botToken, description: "Telegram Bot Token" },
      { key: "notify_tg_id", value: notifyTgId, description: "命中通知接收 TG ID" },
    ]);
  };

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("已复制到剪贴板");
  };

  const BOT_COMMANDS = [
    { cmd: "/start", desc: "主菜单 + 功能导航" },
    { cmd: "/help", desc: "查看所有命令帮助" },
    { cmd: "/status", desc: "系统运行状态" },
    { cmd: "/stats", desc: "今日监控统计" },
    { cmd: "/add_keyword <词>", desc: "快速添加关键词" },
    { cmd: "/list_keywords", desc: "查看关键词列表" },
    { cmd: "/add_group <链接>", desc: "添加监控群组" },
    { cmd: "/list_groups", desc: "查看监控群组" },
    { cmd: "/dm_on", desc: "开启自动私信功能" },
    { cmd: "/dm_off", desc: "关闭自动私信功能" },
    { cmd: "/dm_template <内容>", desc: "设置私信模板" },
    { cmd: "/dm_status", desc: "查看私信队列状态" },
    { cmd: "/plan", desc: "查看当前套餐信息" },
    { cmd: "/activate <卡密>", desc: "激活套餐卡密" },
  ];

  const TEMPLATE_VARS = [
    { var: "{username}", desc: "目标用户名（@xxx）" },
    { var: "{first_name}", desc: "目标用户名字" },
    { var: "{keyword}", desc: "命中的关键词" },
    { var: "{group_name}", desc: "来源群组名称" },
    { var: "{message}", desc: "原始消息内容" },
    { var: "{date}", desc: "当前日期" },
    { var: "{time}", desc: "当前时间" },
  ];

  return (
    <AdminLayout title="Bot 配置">
    <div className="p-6 space-y-6 max-w-4xl">
      {/* 页面标题 */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Bot className="h-6 w-6 text-primary" />
          Telegram Bot 配置
        </h1>
        <p className="text-muted-foreground mt-1">
          配置专属 Bot 实现命令交互与实时通知推送
        </p>
      </div>

      {/* Bot 配置卡片 */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            Bot Token 配置
          </CardTitle>
          <CardDescription>
            通过 @BotFather 创建 Bot 并获取 Token
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Bot Token</Label>
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="1234567890:ABCdefGHIjklMNOpqrsTUVwxyz"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                className="bg-background border-border font-mono text-sm"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => window.open("https://t.me/BotFather", "_blank")}
                title="打开 @BotFather"
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              在 Telegram 中找到 @BotFather，发送 /newbot 创建新 Bot 并获取 Token
            </p>
          </div>

          <div className="space-y-2">
            <Label>通知接收 Telegram ID</Label>
            <Input
              placeholder="你的 Telegram 用户 ID（数字）"
              value={notifyTgId}
              onChange={(e) => setNotifyTgId(e.target.value)}
              className="bg-background border-border"
            />
            <p className="text-xs text-muted-foreground">
              命中通知将发送到此 ID。通过 @userinfobot 获取你的 Telegram ID
            </p>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={saving} className="bg-primary hover:bg-primary/90">
              {saving ? "保存中..." : "保存配置"}
            </Button>
            <Button
              variant="outline"
              onClick={() => window.open("https://t.me/userinfobot", "_blank")}
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              获取我的 TG ID
            </Button>
          </div>

          {/* 配置状态 */}
          {settings?.botToken ? (
            <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-400/10 rounded-lg px-3 py-2">
              <CheckCircle2 className="h-4 w-4" />
              Bot 已配置，Token 已保存
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-amber-400 bg-amber-400/10 rounded-lg px-3 py-2">
              <AlertCircle className="h-4 w-4" />
              尚未配置 Bot Token，通知功能不可用
            </div>
          )}
        </CardContent>
      </Card>

      {/* 部署说明 */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Code2 className="h-4 w-4 text-primary" />
            Bot 部署说明
          </CardTitle>
          <CardDescription>在服务器上运行 Bot 服务</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="bg-background rounded-lg p-3 border border-border">
              <p className="text-xs text-muted-foreground mb-2">1. 安装依赖</p>
              <div className="flex items-center justify-between">
                <code className="text-sm text-primary font-mono">pip install pyrogram TgCrypto aiohttp</code>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyText("pip install pyrogram TgCrypto aiohttp")}>
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>

            <div className="bg-background rounded-lg p-3 border border-border">
              <p className="text-xs text-muted-foreground mb-2">2. 设置环境变量</p>
              <div className="flex items-center justify-between">
                <code className="text-sm text-primary font-mono whitespace-pre">
                  {`export BOT_TOKEN="你的Bot Token"
export TG_API_ID="你的API_ID"
export TG_API_HASH="你的API_HASH"
export WEB_API_BASE="http://你的服务器:3000/api"`}
                </code>
                <Button variant="ghost" size="icon" className="h-6 w-6 self-start" onClick={() => copyText(`export BOT_TOKEN="你的Bot Token"\nexport TG_API_ID="你的API_ID"\nexport TG_API_HASH="你的API_HASH"\nexport WEB_API_BASE="http://你的服务器:3000/api"`)}>
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>

            <div className="bg-background rounded-lg p-3 border border-border">
              <p className="text-xs text-muted-foreground mb-2">3. 启动 Bot</p>
              <div className="flex items-center justify-between">
                <code className="text-sm text-primary font-mono">python monitor-engine/bot.py</code>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyText("python monitor-engine/bot.py")}>
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>

            <div className="bg-background rounded-lg p-3 border border-border">
              <p className="text-xs text-muted-foreground mb-2">4. 后台持久运行（推荐）</p>
              <div className="flex items-center justify-between">
                <code className="text-sm text-primary font-mono">nohup python monitor-engine/bot.py &gt; bot.log 2&gt;&amp;1 &amp;</code>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyText("nohup python monitor-engine/bot.py > bot.log 2>&1 &")}>
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 命令列表 */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            Bot 命令列表
          </CardTitle>
          <CardDescription>用户可在 Telegram 中使用以下命令</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            {BOT_COMMANDS.map((item) => (
              <div key={item.cmd} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <code className="text-sm text-primary font-mono bg-primary/10 px-2 py-0.5 rounded">
                  {item.cmd}
                </code>
                <span className="text-sm text-muted-foreground">{item.desc}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 通知模板变量 */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary" />
            通知推送说明
          </CardTitle>
          <CardDescription>命中通知包含的信息和快捷操作按钮</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-background rounded-lg p-4 border border-border">
            <p className="text-xs text-muted-foreground mb-3 font-medium">通知消息格式预览：</p>
            <div className="text-sm space-y-1 font-mono text-foreground/80">
              <p>🎯 <strong>关键词命中通知</strong></p>
              <p>📍 <strong>来源群组：</strong> 加密货币交流群</p>
              <p>🔑 <strong>命中关键词：</strong> `求购 BTC`</p>
              <p>👤 <strong>发送者：</strong> @zhangsan (`123456789`)</p>
              <p>💬 <strong>消息内容：</strong></p>
              <p className="ml-4 text-muted-foreground">`有没有人出 BTC，求购 5 个...`</p>
              <p>📬 <strong>私信状态：</strong> ✅ 已加入私信队列</p>
            </div>
            <Separator className="my-3" />
            <div className="flex gap-2 flex-wrap">
              <Badge variant="outline" className="text-xs">💬 私聊TA</Badge>
              <Badge variant="outline" className="text-xs">✅ 标记已处理</Badge>
              <Badge variant="outline" className="text-xs">🚫 屏蔽此用户</Badge>
              <Badge variant="outline" className="text-xs">📊 查看记录</Badge>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-2">消息模板可用变量：</p>
            <div className="grid grid-cols-2 gap-2">
              {TEMPLATE_VARS.map((item) => (
                <div key={item.var} className="flex items-center gap-2 text-sm">
                  <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs font-mono">
                    {item.var}
                  </code>
                  <span className="text-muted-foreground text-xs">{item.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 监控引擎部署 */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            监控引擎部署
          </CardTitle>
          <CardDescription>Pyrogram 监控引擎是系统的核心，需要单独部署在服务器上</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="bg-amber-400/10 border border-amber-400/30 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-amber-400 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-amber-300">
                <p className="font-medium">重要说明</p>
                <p className="text-amber-300/80 mt-1">
                  监控引擎需要部署在稳定的 VPS 服务器上（推荐香港/新加坡节点），
                  需要获取 Telegram API ID 和 API Hash。
                  引擎通过 HTTP API 与本 Web 管理台通信，配置同步间隔为 30 秒。
                </p>
              </div>
            </div>
          </div>

          <div className="bg-background rounded-lg p-3 border border-border">
            <p className="text-xs text-muted-foreground mb-2">启动监控引擎</p>
            <div className="flex items-center justify-between">
              <code className="text-sm text-primary font-mono">python monitor-engine/main.py</code>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyText("python monitor-engine/main.py")}>
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open("https://my.telegram.org/apps", "_blank")}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              获取 API 凭证
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open("https://docs.pyrogram.org", "_blank")}
            >
              <BookOpen className="h-3 w-3 mr-1" />
              Pyrogram 文档
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
    </AdminLayout>
  );
}