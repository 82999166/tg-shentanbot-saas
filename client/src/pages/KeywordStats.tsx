import AppLayout from "@/components/AppLayout";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Download, Users, TrendingUp, Search, ChevronLeft, ChevronRight } from "lucide-react";

export default function KeywordStats() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [search, setSearch] = useState("");
  const [selectedKeywordId, setSelectedKeywordId] = useState<number | undefined>();
  const [sendersPage, setSendersPage] = useState(1);
  const [showSenders, setShowSenders] = useState(false);

  const { data: statsData, isLoading } = trpc.hitMessages.keywordStats.useQuery({
    keywordId: undefined,
  });
  const { data: sendersData, isLoading: sendersLoading } = trpc.hitMessages.keywordSenders.useQuery(
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

  // 计算每个关键词的周总命中和今日命中
  const today = new Date().toISOString().split("T")[0];
  const kwTableData = keywords
    .map((kw) => {
      const weekTotal = Object.values(kwStatsMap[kw.id] ?? {}).reduce((a, b) => a + b, 0);
      const todayCount = kwStatsMap[kw.id]?.[today] ?? 0;
      return { ...kw, weekTotal, todayCount };
    })
    .filter((kw) =>
      search ? kw.keyword.toLowerCase().includes(search.toLowerCase()) : true
    )
    .sort((a, b) => b.weekTotal - a.weekTotal);

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

  const handleViewSenders = (kwId: number) => {
    setSelectedKeywordId(kwId);
    setShowSenders(true);
    setSendersPage(1);
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div>
          <h1 className="text-2xl font-bold">关键词统计</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isAdmin ? "全平台所有用户的关键词命中统计" : "您的关键词命中统计（近7天）"}
          </p>
        </div>

        {/* 关键词命中统计表格 */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                关键词命中统计
                <Badge variant="secondary">{keywords.length} 个关键词</Badge>
              </CardTitle>
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="搜索关键词..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="text-center py-12 text-muted-foreground">加载中...</div>
            ) : kwTableData.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <TrendingUp className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>暂无关键词数据</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12 text-center">#</TableHead>
                    <TableHead>关键词</TableHead>
                    {isAdmin && <TableHead>所属用户</TableHead>}
                    <TableHead className="text-center">今日命中</TableHead>
                    <TableHead className="text-center">近7天命中</TableHead>
                    <TableHead className="text-center">总命中</TableHead>
                    <TableHead className="text-center">近7天趋势</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {kwTableData.map((kw, idx) => {
                    const dailyData = dates.map((d) => kwStatsMap[kw.id]?.[d] ?? 0);
                    const maxVal = Math.max(...dailyData, 1);
                    return (
                      <TableRow
                        key={kw.id}
                        className={selectedKeywordId === kw.id ? "bg-primary/5" : ""}
                      >
                        <TableCell className="text-center text-muted-foreground text-sm">
                          {idx + 1}
                        </TableCell>
                        <TableCell>
                          <span className="font-medium">{kw.keyword}</span>
                        </TableCell>
                        {isAdmin && (
                          <TableCell>
                            <span className="text-sm text-muted-foreground">
                              {(kw as any).userName || (kw as any).userEmail || `用户#${(kw as any).userId}`}
                            </span>
                          </TableCell>
                        )}
                        <TableCell className="text-center">
                          {kw.todayCount > 0 ? (
                            <Badge variant="default" className="bg-green-500 hover:bg-green-600">
                              {kw.todayCount}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-sm">0</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {kw.weekTotal > 0 ? (
                            <Badge variant="secondary">{kw.weekTotal}</Badge>
                          ) : (
                            <span className="text-muted-foreground text-sm">0</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="text-sm font-medium">{kw.hitCount ?? 0}</span>
                        </TableCell>
                        <TableCell>
                          {/* 迷你趋势图 */}
                          <div className="flex items-end gap-0.5 h-8">
                            {dailyData.map((count, i) => {
                              const h = Math.max((count / maxVal) * 100, 4);
                              return (
                                <div
                                  key={i}
                                  className="flex-1 rounded-sm bg-primary/60 transition-all"
                                  style={{ height: `${h}%` }}
                                  title={`${dates[i]}: ${count}次`}
                                />
                              );
                            })}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleViewSenders(kw.id)}
                          >
                            <Users className="h-3.5 w-3.5 mr-1.5" />
                            命中用户
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* 命中用户列表 */}
        {showSenders && selectedKeywordId && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Users className="h-5 w-5 text-blue-500" />
                  命中用户列表 —— {kwTableData.find(k => k.id === selectedKeywordId)?.keyword}
                  {sendersData?.total != null && (
                    <Badge variant="secondary">{sendersData.total} 人</Badge>
                  )}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={exportCSV}>
                    <Download className="h-4 w-4 mr-2" />
                    导出 CSV
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowSenders(false)}>
                    关闭
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {sendersLoading ? (
                <div className="text-center py-8 text-muted-foreground text-sm">加载中...</div>
              ) : !sendersData?.rows?.length ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  暂无命中用户数据
                </div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>用户名</TableHead>
                        <TableHead>TG ID</TableHead>
                        <TableHead className="text-center">命中次数</TableHead>
                        <TableHead className="text-right">最后命中时间</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sendersData.rows.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">
                            {r.senderUsername ? `@${r.senderUsername}` : r.senderFirstName ?? "—"}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {r.senderTgId}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="secondary">{r.hitCount}</Badge>
                          </TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground">
                            {new Date(r.lastHit).toLocaleString("zh-CN", {
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
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
    </AppLayout>
  );
}
