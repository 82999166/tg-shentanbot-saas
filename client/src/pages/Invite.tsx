import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Gift,
  Copy,
  Users,
  Trophy,
  CheckCircle,
  Clock,
  Share2,
  Crown,
  Star,
  TrendingUp,
  Link,
} from "lucide-react";

export default function Invite() {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);

  const { data: myCode, isLoading: codeLoading } = trpc.invite.myCode.useQuery();
  const { data: records, isLoading: recordsLoading } = trpc.invite.myRecords.useQuery();
  const { data: leaderboard } = trpc.invite.leaderboard.useQuery();
  const { data: rewardConfig } = trpc.invite.rewardConfig.useQuery();

  const inviteLink = myCode
    ? `${window.location.origin}/?invite=${myCode.code}`
    : "";

  const copyLink = () => {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink).then(() => {
      setCopied(true);
      toast.success("邀请链接已复制到剪贴板");
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const copyCode = () => {
    if (!myCode?.code) return;
    navigator.clipboard.writeText(myCode.code).then(() => {
      toast.success("邀请码已复制");
    });
  };

  const shareText = `我在使用 TG Monitor Pro 监控 Telegram 群组关键词，效果非常好！用我的邀请码注册可以获得免费体验天数：${myCode?.code ?? ""}\n注册链接：${inviteLink}`;

  const myRank = leaderboard?.findIndex((item) => item.userId === user?.id);

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* 页面标题 */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-yellow-500 to-orange-500 flex items-center justify-center">
          <Gift className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">邀请裂变</h1>
          <p className="text-sm text-muted-foreground">邀请好友注册，双方均可获得套餐奖励天数</p>
        </div>
      </div>

      {/* 奖励说明横幅 */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-yellow-500/20 via-orange-500/20 to-red-500/20 border border-yellow-500/30 p-6">
        <div className="absolute top-0 right-0 w-64 h-64 bg-yellow-500/5 rounded-full -translate-y-32 translate-x-32" />
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-4">
            <Crown className="w-5 h-5 text-yellow-400" />
            <span className="text-yellow-400 font-semibold text-lg">邀请奖励规则</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-start gap-3 bg-background/40 rounded-xl p-4">
              <div className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center flex-shrink-0">
                <Users className="w-4 h-4 text-green-400" />
              </div>
              <div>
                <div className="font-semibold text-foreground">好友注册奖励</div>
                <div className="text-sm text-muted-foreground mt-1">
                  好友通过您的邀请链接注册后，您立即获得{" "}
                  <span className="text-green-400 font-bold">
                    {rewardConfig?.registerRewardDays ?? 3} 天
                  </span>{" "}
                  套餐延期
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3 bg-background/40 rounded-xl p-4">
              <div className="w-8 h-8 rounded-lg bg-yellow-500/20 flex items-center justify-center flex-shrink-0">
                <Trophy className="w-4 h-4 text-yellow-400" />
              </div>
              <div>
                <div className="font-semibold text-foreground">好友付费奖励</div>
                <div className="text-sm text-muted-foreground mt-1">
                  好友成功付费购买套餐后，您额外获得{" "}
                  <span className="text-yellow-400 font-bold">
                    {rewardConfig?.paymentRewardDays ?? 15} 天
                  </span>{" "}
                  套餐延期
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 我的邀请码 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Link className="w-4 h-4 text-primary" />
                我的邀请链接
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {codeLoading ? (
                <div className="h-10 bg-muted animate-pulse rounded-lg" />
              ) : (
                <>
                  {/* 邀请码 */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-muted/50 border border-border rounded-lg px-4 py-2 font-mono text-lg font-bold text-primary tracking-widest">
                      {myCode?.code ?? "—"}
                    </div>
                    <Button variant="outline" size="sm" onClick={copyCode}>
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>

                  {/* 邀请链接 */}
                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      value={inviteLink}
                      className="font-mono text-xs bg-muted/30"
                    />
                    <Button
                      variant={copied ? "default" : "outline"}
                      size="sm"
                      onClick={copyLink}
                      className="flex-shrink-0"
                    >
                      {copied ? (
                        <CheckCircle className="w-4 h-4" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </Button>
                  </div>

                  {/* 分享按钮 */}
                  <Button
                    className="w-full bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 text-white"
                    onClick={() => {
                      if (navigator.share) {
                        navigator.share({ text: shareText, url: inviteLink });
                      } else {
                        navigator.clipboard.writeText(shareText);
                        toast.success("分享文案已复制到剪贴板");
                      }
                    }}
                  >
                    <Share2 className="w-4 h-4 mr-2" />
                    一键分享邀请
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          {/* 我的邀请统计 */}
          <div className="grid grid-cols-3 gap-3">
            {[
              {
                label: "已邀请注册",
                value: myCode?.totalInvited ?? 0,
                unit: "人",
                icon: Users,
                color: "text-blue-400",
                bg: "bg-blue-500/10",
              },
              {
                label: "已邀请付费",
                value: myCode?.totalPaidInvited ?? 0,
                unit: "人",
                icon: Trophy,
                color: "text-yellow-400",
                bg: "bg-yellow-500/10",
              },
              {
                label: "累计奖励",
                value: myCode?.totalRewardDays ?? 0,
                unit: "天",
                icon: Gift,
                color: "text-green-400",
                bg: "bg-green-500/10",
              },
            ].map((stat) => (
              <Card key={stat.label} className="bg-card border-border">
                <CardContent className="p-4 text-center">
                  <div
                    className={`w-8 h-8 rounded-lg ${stat.bg} flex items-center justify-center mx-auto mb-2`}
                  >
                    <stat.icon className={`w-4 h-4 ${stat.color}`} />
                  </div>
                  <div className={`text-2xl font-bold ${stat.color}`}>
                    {stat.value}
                    <span className="text-sm font-normal text-muted-foreground ml-1">
                      {stat.unit}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{stat.label}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* 排行榜 */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-yellow-400" />
              邀请排行榜
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {leaderboard?.slice(0, 10).map((item, index) => (
                <div
                  key={item.userId}
                  className={`flex items-center gap-3 px-4 py-3 ${
                    item.userId === user?.id ? "bg-primary/5" : ""
                  }`}
                >
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                      index === 0
                        ? "bg-yellow-500 text-white"
                        : index === 1
                        ? "bg-gray-400 text-white"
                        : index === 2
                        ? "bg-orange-600 text-white"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate flex items-center gap-1">
                      {item.userName ?? "匿名用户"}
                      {item.userId === user?.id && (
                        <Star className="w-3 h-3 text-yellow-400" />
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      邀请付费 {item.totalPaidInvited} 人
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs text-yellow-400 border-yellow-400/30">
                    +{item.totalRewardDays}天
                  </Badge>
                </div>
              ))}
              {(!leaderboard || leaderboard.length === 0) && (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  暂无排行数据
                </div>
              )}
            </div>
            {myRank !== undefined && myRank >= 0 && myRank >= 10 && (
              <div className="px-4 py-3 border-t border-border bg-primary/5">
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                    {myRank + 1}
                  </div>
                  <div className="flex-1 text-sm font-medium">我的排名</div>
                  <Badge variant="outline" className="text-xs text-primary border-primary/30">
                    +{myCode?.totalRewardDays ?? 0}天
                  </Badge>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 邀请记录 */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" />
            邀请记录
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recordsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />
              ))}
            </div>
          ) : records && records.length > 0 ? (
            <div className="space-y-2">
              {records.map((record) => (
                <div
                  key={record.id}
                  className="flex items-center gap-4 p-3 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors"
                >
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-sm font-bold text-primary flex-shrink-0">
                    {(record.inviteeName ?? "?")[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {record.inviteeName ?? "匿名用户"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {record.inviteeEmail ?? "—"} ·{" "}
                      {new Date(record.registeredAt).toLocaleDateString("zh-CN")}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge
                      variant="outline"
                      className={`text-xs ${
                        record.registrationRewarded
                          ? "text-green-400 border-green-400/30"
                          : "text-muted-foreground"
                      }`}
                    >
                      {record.registrationRewarded ? (
                        <CheckCircle className="w-3 h-3 mr-1" />
                      ) : (
                        <Clock className="w-3 h-3 mr-1" />
                      )}
                      注册奖励
                    </Badge>
                    <Badge
                      variant="outline"
                      className={`text-xs ${
                        record.paymentRewarded
                          ? "text-yellow-400 border-yellow-400/30"
                          : "text-muted-foreground"
                      }`}
                    >
                      {record.paymentRewarded ? (
                        <CheckCircle className="w-3 h-3 mr-1" />
                      ) : (
                        <Clock className="w-3 h-3 mr-1" />
                      )}
                      付费奖励
                    </Badge>
                    {record.rewardDaysGranted > 0 && (
                      <Badge className="text-xs bg-green-500/20 text-green-400 border-0">
                        +{record.rewardDaysGranted}天
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <Gift className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">还没有邀请记录</p>
              <p className="text-muted-foreground/60 text-xs mt-1">
                分享您的邀请链接，邀请好友注册即可获得奖励
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
