import { useState } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Download,
  Copy,
  RefreshCw,
  Globe,
  Link2,
  Search,
  CheckCircle2,
  XCircle,
  Users,
  FileText,
} from "lucide-react";
import { toast } from "sonner";

export default function PublicGroupExport() {
  const [onlyActive, setOnlyActive] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [copied, setCopied] = useState(false);

  const { data, isLoading, isRefetching, refetch } = trpc.sysConfig.exportPublicGroupLinks.useQuery(
    { onlyActive, format: "links" },
    { refetchOnWindowFocus: false }
  );

  const groups = (data?.groups ?? []).filter((g) => {
    if (!searchText.trim()) return true;
    const kw = searchText.toLowerCase();
    return (
      g.groupTitle.toLowerCase().includes(kw) ||
      g.groupId.toLowerCase().includes(kw) ||
      g.link.toLowerCase().includes(kw)
    );
  });

  const allLinks = groups.map((g) => g.link).join("\n");
  const allTitlesLinks = groups.map((g) => `${g.groupTitle}\t${g.link}`).join("\n");

  const copyLinks = async () => {
    await navigator.clipboard.writeText(allLinks);
    setCopied(true);
    toast.success(`已复制 ${groups.length} 个群组链接`);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadTxt = () => {
    const content = groups
      .map((g) => `${g.groupTitle}\t${g.link}\t${g.groupType}\t${g.memberCount}人`)
      .join("\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `公共群组链接_${new Date().toLocaleDateString("zh-CN").replace(/\//g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("已下载 TXT 文件");
  };

  const downloadCsv = () => {
    const header = "群组名称,链接,类型,成员数,备注\n";
    const rows = groups
      .map((g) => `"${g.groupTitle}","${g.link}","${g.groupType}","${g.memberCount}","${g.note}"`)
      .join("\n");
    const blob = new Blob(["\uFEFF" + header + rows], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `公共群组链接_${new Date().toLocaleDateString("zh-CN").replace(/\//g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("已下载 CSV 文件");
  };

  return (
    <AdminLayout>
      <div className="p-6 space-y-6">
        {/* 页头 */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Link2 className="w-6 h-6 text-cyan-400" /> 公共群组链接导出
            </h1>
            <p className="text-sm text-slate-400 mt-1">导出系统公共群组池中的所有群组链接，支持复制和下载</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isRefetching}
            className="border-slate-600 text-slate-300 hover:bg-slate-700"
          >
            <RefreshCw className={`w-4 h-4 mr-1 ${isRefetching ? 'animate-spin' : ''}`} /> 刷新
          </Button>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "总群组数", value: data?.total ?? 0, icon: Globe, color: "text-blue-400" },
            { label: "当前筛选", value: groups.length, icon: Search, color: "text-cyan-400" },
            { label: "群组类型", value: [...new Set(groups.map(g => g.groupType))].length, icon: FileText, color: "text-purple-400" },
            { label: "总成员数", value: groups.reduce((s, g) => s + (g.memberCount ?? 0), 0).toLocaleString(), icon: Users, color: "text-green-400" },
          ].map((item) => (
            <Card key={item.label} className="bg-slate-800/60 border-slate-700">
              <CardContent className="p-4 flex items-center gap-3">
                <item.icon className={`w-8 h-8 ${item.color}`} />
                <div>
                  <p className="text-2xl font-bold text-white">{item.value}</p>
                  <p className="text-xs text-slate-400">{item.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* 操作栏 */}
        <Card className="bg-slate-800/60 border-slate-700">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  id="only-active"
                  checked={onlyActive}
                  onCheckedChange={setOnlyActive}
                />
                <Label htmlFor="only-active" className="text-slate-300 text-sm cursor-pointer">
                  仅显示已启用群组
                </Label>
              </div>
              <div className="flex-1 min-w-48">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    placeholder="搜索群组名称或链接..."
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    className="pl-9 bg-slate-700 border-slate-600 text-white placeholder:text-slate-500"
                  />
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={copyLinks}
                  disabled={groups.length === 0}
                  className="border-slate-600 text-slate-300 hover:bg-slate-700"
                >
                  {copied ? <CheckCircle2 className="w-4 h-4 mr-1 text-green-400" /> : <Copy className="w-4 h-4 mr-1" />}
                  复制链接 ({groups.length})
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={downloadTxt}
                  disabled={groups.length === 0}
                  className="border-slate-600 text-slate-300 hover:bg-slate-700"
                >
                  <Download className="w-4 h-4 mr-1" /> 下载 TXT
                </Button>
                <Button
                  size="sm"
                  onClick={downloadCsv}
                  disabled={groups.length === 0}
                  className="bg-cyan-600 hover:bg-cyan-700"
                >
                  <Download className="w-4 h-4 mr-1" /> 下载 CSV
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 群组列表 */}
        <Card className="bg-slate-800/60 border-slate-700">
          <CardHeader className="pb-3">
            <CardTitle className="text-white text-base flex items-center gap-2">
              <Globe className="w-4 h-4 text-cyan-400" /> 群组列表
              <Badge variant="outline" className="text-slate-400 border-slate-600 ml-2">{groups.length} 个</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-16 text-center text-slate-400">加载中...</div>
            ) : groups.length === 0 ? (
              <div className="py-16 text-center">
                <Globe className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400">暂无群组数据</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700 hover:bg-transparent">
                      <TableHead className="text-slate-400">#</TableHead>
                      <TableHead className="text-slate-400">群组名称</TableHead>
                      <TableHead className="text-slate-400">链接</TableHead>
                      <TableHead className="text-slate-400">类型</TableHead>
                      <TableHead className="text-slate-400">成员数</TableHead>
                      <TableHead className="text-slate-400">状态</TableHead>
                      <TableHead className="text-slate-400">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groups.map((g, idx) => (
                      <TableRow key={g.id} className="border-slate-700 hover:bg-slate-700/30">
                        <TableCell className="text-slate-500 text-sm">{idx + 1}</TableCell>
                        <TableCell>
                          <div className="font-medium text-white text-sm">{g.groupTitle}</div>
                          {g.note && <div className="text-xs text-slate-500 mt-0.5">{g.note}</div>}
                        </TableCell>
                        <TableCell>
                          {/^https?:\/\//.test(g.link) ? (
                            <a
                              href={g.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-cyan-400 hover:text-cyan-300 text-sm font-mono truncate block max-w-xs"
                            >
                              {g.link}
                            </a>
                          ) : (
                            <span className="text-slate-400 text-sm font-mono">{g.link}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-xs ${g.groupType === "channel" ? "border-purple-600 text-purple-300" : "border-blue-600 text-blue-300"}`}
                          >
                            {g.groupType === "channel" ? "频道" : "群组"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-slate-300 text-sm">
                          {g.memberCount > 0 ? g.memberCount.toLocaleString() : "—"}
                        </TableCell>
                        <TableCell>
                          {g.isActive ? (
                            <span className="flex items-center gap-1 text-green-400 text-xs">
                              <CheckCircle2 className="w-3 h-3" /> 启用
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-slate-500 text-xs">
                              <XCircle className="w-3 h-3" /> 停用
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="w-7 h-7 text-slate-400 hover:text-cyan-400"
                            title="复制链接"
                            onClick={async () => {
                              await navigator.clipboard.writeText(g.link);
                              toast.success("链接已复制");
                            }}
                          >
                            <Copy className="w-3 h-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
