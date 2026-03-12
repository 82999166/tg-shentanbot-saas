import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BarChart3, Download, Users, TrendingUp, ChevronLeft, ChevronRight } from "lucide-react";

export default function KeywordStats() {
  const [selectedKeywordId, setSelectedKeywordId] = useState<number | undefined>();
  const [sendersPage, setSendersPage] = useState(1);
  const [showSenders, setShowSenders] = useState(false);

  const { data: statsData, isLoading } = trpc.hitMessages.keywordStats.useQuery({
    keywordId: selectedKeywordId,
  });

  const { data: sendersData } = trpc.hitMessages.keywordSenders.useQuery(
    { keywordId: selectedKeywordId!, page: sendersPage },
    { enabled: !!selectedKeywordId && showSenders }
  );

  const keywords = statsData?.keywords ?? [];
  const dates = statsData?.dates ?? [];
  const stats = statsData?.stats ?? [];

  // 按关键词聚合统计
  const kwStatsMap: Record<number, Record<string, number>> = {};
  stats.forEach((s) => {
    if (!kwStatsMap[s.keywordId]) kwStatsMap[s.keywordId] = {};
    kwStatsMap[s.keywordId][s.date] = s.hitCount;
  });

  // 获取选中关键词的每日数据
  const selectedKwDailyData = selectedKeywordId
    ? dates.map((d) => ({
        date: d,
        count: kwStatsMap[selectedKeywordId]?.[d] ?? 0,
      }))
    : [];

  const maxCount = Math.max(...selectedKwDailyData.map((d) => d.count), 1);

  // 导出 CSV
  const exportCSV = () => {
    if (!sendersData?.rows) return;
    const header = "发送者TG ID,用户名,名字,命中次数,最后命中时间\n";
    const rows = sendersData.rows
      .map(
        (r) =>
          `${r.senderTgId},${r.senderUsername ?? ""},${r.senderFirstName ?? ""},${r.hitCount},${new Date(r.lastHit).toLocaleString("zh-CN")}`
      )
      .join("\n");
    const blob = new Blob(["\uFEFF" + header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `keyword_senders_${selectedKeywordId}_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6">
      {/* 页头 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">关键词统计</h1>
          <p className="text-muted-foreground text-sm mt-1">
            查看各关键词近7天命中趋势，以及命中用户列表
          </p>
        </div>
      </div>

      {/* 关键词总览 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {keywords.map((kw) => {
          const weekTotal = Object.values(kwStatsMap[kw.id] ?? {}).reduce(
            (a, b) => a + b,
            0
          );
          return (
            <Card
              key={kw.id}
              className={`cursor-pointer transition-all hover:shadow-md ${
                selectedKeywordId === kw.id ? "ring-2 ring-primary" : ""
              }`}
              onClick={() => {
                setSelectedKeywordId(kw.id === selectedKeywordId ? undefined : kw.id);
                setShowSenders(false);
                setSendersPage(1);
              }}
            >
              <CardContent className="pt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium truncate">{kw.keyword}</span>
                  <Badge variant="secondary">{weekTotal} 次/周</Badge>
                </div>
                <div className="flex items-end gap-1 h-8">
                  {dates.map((d) => {
                    const count = kwStatsMap[kw.id]?.[d] ?? 0;
                    const maxKwCount = Math.max(
                      ...dates.map((dd) => kwStatsMap[kw.id]?.[dd] ?? 0),
                      1
                    );
                    const height = Math.max((count / maxKwCount) * 100, 4);
                    return (
                      <div
                        key={d}
                        className="flex-1 bg-primary/70 rounded-sm"
                        style={{ height: `${height}%` }}
                        title={`${d}: ${count} 次`}
                      />
                    );
                  })}
                </div>
                <div className="text-xs text-muted-foreground mt-1">近7天趋势</div>
              </CardContent>
            </Card>
          );
        })}
        {keywords.length === 0 && !isLoading && (
          <div className="col-span-3 text-center py-12 text-muted-foreground">
            <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>暂无关键词数据</p>
            <p className="text-xs mt-1">添加关键词并开始监控后，统计数据将显示在这里</p>
          </div>
        )}
      </div>

      {/* 选中关键词详情 */}
      {selectedKeywordId && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                {keywords.find((k) => k.id === selectedKeywordId)?.keyword} — 近7天详情
              </CardTitle>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowSenders(true);
                    setSendersPage(1);
                  }}
                >
                  <Users className="h-4 w-4 mr-2" />
                  查看命中用户
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* 柱状图 */}
            <div className="flex items-end gap-3 h-40 mb-2">
              {selectedKwDailyData.map((d) => {
                const height = Math.max((d.count / maxCount) * 100, 2);
                return (
                  <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-xs text-muted-foreground">{d.count}</span>
                    <div
                      className="w-full bg-primary rounded-t-sm transition-all"
                      style={{ height: `${height}%` }}
                    />
                    <span className="text-xs text-muted-foreground">
                      {d.date.slice(5)}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 命中用户列表 */}
      {showSenders && selectedKeywordId && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5 text-blue-500" />
                命中用户列表
                {sendersData?.total && (
                  <Badge variant="secondary">{sendersData.total} 人</Badge>
                )}
              </CardTitle>
              <Button variant="outline" size="sm" onClick={exportCSV}>
                <Download className="h-4 w-4 mr-2" />
                导出 CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {!sendersData?.rows?.length ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                暂无命中用户数据
              </div>
            ) : (
              <>
                <div className="divide-y">
                  <div className="flex items-center gap-3 px-4 py-2 bg-muted/30 text-xs text-muted-foreground">
                    <span className="w-32">用户名</span>
                    <span className="flex-1">TG ID</span>
                    <span className="w-20 text-right">命中次数</span>
                    <span className="w-36 text-right">最后命中</span>
                  </div>
                  {sendersData.rows.map((r, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-2 hover:bg-muted/20">
                      <div className="w-32 min-w-0">
                        <div className="font-medium text-sm truncate">
                          {r.senderUsername ? `@${r.senderUsername}` : r.senderFirstName ?? "—"}
                        </div>
                      </div>
                      <div className="flex-1 text-xs text-muted-foreground">{r.senderTgId}</div>
                      <div className="w-20 text-right">
                        <Badge variant="secondary">{r.hitCount}</Badge>
                      </div>
                      <div className="w-36 text-right text-xs text-muted-foreground">
                        {new Date(r.lastHit).toLocaleString("zh-CN", {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                {/* 分页 */}
                {sendersData.total > 20 && (
                  <div className="flex items-center justify-center gap-2 py-3">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={sendersPage === 1}
                      onClick={() => setSendersPage((p) => p - 1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      第 {sendersPage} / {Math.ceil(sendersData.total / 20)} 页
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={sendersPage >= Math.ceil(sendersData.total / 20)}
                      onClick={() => setSendersPage((p) => p + 1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
