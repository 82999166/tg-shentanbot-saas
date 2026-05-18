/**
 * 群组采集页面 - 完全重构版 v4
 * 使用简单 useState 控制 Tab 切换，避免 radix-tabs 的潜在问题
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { useAuth } from "@/_core/hooks/useAuth";
import { Search, Users, Link2, Download, Loader2, RefreshCw, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

// ══════════════════════════════════════════════════════════════════════════
// 类型定义
// ══════════════════════════════════════════════════════════════════════════
type MainTab = "keyword" | "members" | "extract";
type ExtractCategory = "all" | "group" | "channel" | "user";

interface SearchResult {
  tgId: string;
  username: string;
  title: string;
  memberCount: number;
  type: string;
  description: string;
  aiScore: number;
}

interface MemberResult {
  tgId: string;
  username: string;
  displayName: string;
  isBot: boolean;
  isPremium: boolean;
}

interface ExtractResult {
  tgId: string;
  username: string;
  title: string;
  type: string;
  memberCount: number;
  description: string;
  isPremium: boolean;
  lastOnline: string;
  aiScore: number;
}

// ══════════════════════════════════════════════════════════════════════════
// 主组件
// ══════════════════════════════════════════════════════════════════════════
export default function GroupScrape() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<MainTab>("keyword");

  if (!user || user.role !== "admin") {
    return <AdminLayout><div className="p-8 text-center text-slate-500">仅管理员可访问</div></AdminLayout>;
  }

  return (
    <AdminLayout>
      <div className="p-6 max-w-[1400px] mx-auto">
        {/* 页面标题 */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Search className="w-6 h-6 text-blue-500" />
            群组采集
          </h1>
          <p className="text-slate-500 mt-1">通过关键词搜索、指定群组采集或消息提取，发现并导入高质量群组/频道/用户</p>
        </div>

        {/* Tab 按钮 - 使用最简单的 onClick + state */}
        <div className="flex gap-1 mb-6 bg-slate-100 p-1 rounded-lg w-fit">
          <button
            type="button"
            onClick={() => setActiveTab("keyword")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === "keyword"
                ? "bg-white text-blue-600 shadow-sm"
                : "text-slate-600 hover:text-slate-800"
            }`}
          >
            <Search className="w-4 h-4" />
            关键词采集
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("members")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === "members"
                ? "bg-white text-blue-600 shadow-sm"
                : "text-slate-600 hover:text-slate-800"
            }`}
          >
            <Users className="w-4 h-4" />
            指定群组采集
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("extract")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === "extract"
                ? "bg-white text-blue-600 shadow-sm"
                : "text-slate-600 hover:text-slate-800"
            }`}
          >
            <Link2 className="w-4 h-4" />
            消息提取链接
          </button>
        </div>

        {/* Tab 内容 */}
        {activeTab === "keyword" && <KeywordTab />}
        {activeTab === "members" && <MembersTab />}
        {activeTab === "extract" && <ExtractTab />}
      </div>
    </AdminLayout>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Tab1: 关键词采集
// ══════════════════════════════════════════════════════════════════════════
function KeywordTab() {
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const searchMutation = trpc.groupScrape.searchByKeyword.useMutation();
  const importMutation = trpc.groupScrape.importToMonitorPool.useMutation();

  const handleSearch = async () => {
    if (!keyword.trim()) return;
    setLoading(true);
    setError("");
    setSelected(new Set());
    try {
      const res = await searchMutation.mutateAsync({ keyword: keyword.trim(), limit: 50 });
      if (res.success) {
        setResults(res.groups);
      } else {
        setError(res.error || "搜索失败");
        setResults([]);
      }
    } catch (e: any) {
      setError(e.message || "请求失败");
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (selected.size === 0) return;
    const items = Array.from(selected).map(i => results[i]);
    try {
      const res = await importMutation.mutateAsync({
        groups: items.map(g => ({
          username: g.username,
          title: g.title,
          type: g.type,
          memberCount: g.memberCount,
        })),
      });
      alert(`导入成功 ${res.imported} 个，跳过 ${res.skipped} 个（已存在）`);
      setSelected(new Set());
    } catch (e: any) {
      alert("导入失败: " + e.message);
    }
  };

  const toggleSelect = (idx: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === results.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(results.map((_, i) => i)));
    }
  };

  return (
    <div className="space-y-4">
      {/* 搜索栏 */}
      <div className="flex gap-3 items-center">
        <Input
          placeholder="输入关键词搜索群组/频道..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          className="max-w-md"
        />
        <Button onClick={handleSearch} disabled={loading || !keyword.trim()}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Search className="w-4 h-4 mr-1" />}
          搜索
        </Button>
        {selected.size > 0 && (
          <Button onClick={handleImport} variant="outline" disabled={importMutation.isPending}>
            <Download className="w-4 h-4 mr-1" />
            导入选中 ({selected.size})
          </Button>
        )}
      </div>

      {error && <div className="text-red-500 text-sm">{error}</div>}

      {/* 结果表格 */}
      {results.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox checked={selected.size === results.length && results.length > 0} onCheckedChange={toggleAll} />
                </TableHead>
                <TableHead>群组/频道</TableHead>
                <TableHead>用户名</TableHead>
                <TableHead className="text-right">人数</TableHead>
                <TableHead>类型</TableHead>
                <TableHead className="text-right">AI评分</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((r, idx) => (
                <TableRow key={idx} className="cursor-pointer hover:bg-slate-50" onClick={() => toggleSelect(idx)}>
                  <TableCell><Checkbox checked={selected.has(idx)} onCheckedChange={() => toggleSelect(idx)} /></TableCell>
                  <TableCell className="font-medium max-w-[300px] truncate">{r.title || "-"}</TableCell>
                  <TableCell className="text-slate-500">@{r.username || "-"}</TableCell>
                  <TableCell className="text-right">{r.memberCount.toLocaleString()}</TableCell>
                  <TableCell>
                    <Badge variant={r.type === "channel" ? "secondary" : "outline"}>
                      {r.type === "channel" ? "频道" : "群组"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={`font-medium ${r.aiScore >= 70 ? "text-green-600" : r.aiScore >= 40 ? "text-amber-600" : "text-slate-400"}`}>
                      {r.aiScore}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {results.length === 0 && !loading && !error && (
        <div className="text-center py-12 text-slate-400">输入关键词开始搜索</div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Tab2: 指定群组采集
// ══════════════════════════════════════════════════════════════════════════
function MembersTab() {
  const [group, setGroup] = useState("");
  const [limit, setLimit] = useState(200);
  const [results, setResults] = useState<MemberResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const scrapeMutation = trpc.groupScrape.scrapeMembers.useMutation();

  const handleScrape = async () => {
    if (!group.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await scrapeMutation.mutateAsync({ group: group.trim(), limit });
      if (res.success) {
        setResults(res.members);
      } else {
        setError(res.error || "采集失败");
        setResults([]);
      }
    } catch (e: any) {
      setError(e.message || "请求失败");
    } finally {
      setLoading(false);
    }
  };

  // 统计
  const stats = useMemo(() => {
    const total = results.length;
    const premium = results.filter(m => m.isPremium).length;
    const bots = results.filter(m => m.isBot).length;
    const withUsername = results.filter(m => m.username).length;
    return { total, premium, bots, withUsername };
  }, [results]);

  return (
    <div className="space-y-4">
      {/* 输入栏 */}
      <div className="flex gap-3 items-center">
        <Input
          placeholder="输入群组链接或用户名，如 @groupname 或 t.me/groupname"
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleScrape()}
          className="max-w-lg"
        />
        <Input
          type="number"
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value) || 200)}
          className="w-24"
          placeholder="数量"
        />
        <Button onClick={handleScrape} disabled={loading || !group.trim()}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Users className="w-4 h-4 mr-1" />}
          采集成员
        </Button>
      </div>

      {error && <div className="text-red-500 text-sm">{error}</div>}

      {/* 统计信息 */}
      {results.length > 0 && (
        <div className="flex gap-4 text-sm">
          <span className="text-slate-600">共 <strong>{stats.total}</strong> 人</span>
          <span className="text-blue-600">Premium: <strong>{stats.premium}</strong></span>
          <span className="text-slate-400">Bot: <strong>{stats.bots}</strong></span>
          <span className="text-green-600">有用户名: <strong>{stats.withUsername}</strong></span>
        </div>
      )}

      {/* 结果表格 */}
      {results.length > 0 && (
        <div className="border rounded-lg overflow-hidden max-h-[600px] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>TG ID</TableHead>
                <TableHead>用户名</TableHead>
                <TableHead>显示名称</TableHead>
                <TableHead>Premium</TableHead>
                <TableHead>Bot</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((m, idx) => (
                <TableRow key={idx}>
                  <TableCell className="font-mono text-xs">{m.tgId}</TableCell>
                  <TableCell className="text-slate-500">{m.username ? `@${m.username}` : "-"}</TableCell>
                  <TableCell>{m.displayName || "-"}</TableCell>
                  <TableCell>{m.isPremium ? <Badge className="bg-blue-100 text-blue-700">Premium</Badge> : "-"}</TableCell>
                  <TableCell>{m.isBot ? <Badge variant="secondary">Bot</Badge> : "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {results.length === 0 && !loading && !error && (
        <div className="text-center py-12 text-slate-400">输入群组链接开始采集成员</div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Tab3: 消息提取链接
// ══════════════════════════════════════════════════════════════════════════
function ExtractTab() {
  const [group, setGroup] = useState("");
  const [limit, setLimit] = useState(100);
  const [results, setResults] = useState<ExtractResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [category, setCategory] = useState<ExtractCategory>("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // 用户过滤条件
  const [filterPremiumOnly, setFilterPremiumOnly] = useState(false);
  const [filterOnlineDays, setFilterOnlineDays] = useState<number>(0); // 0 = 不过滤
  const [showFilters, setShowFilters] = useState(false);

  const extractMutation = trpc.groupScrape.extractLinks.useMutation();
  const importMutation = trpc.groupScrape.importExtractedLinks.useMutation();

  const handleExtract = async () => {
    if (!group.trim()) return;
    setLoading(true);
    setError("");
    setSelected(new Set());
    try {
      const res = await extractMutation.mutateAsync({ group: group.trim(), limit });
      if (res.success) {
        setResults(res.results);
      } else {
        setError(res.error || "提取失败");
        setResults([]);
      }
    } catch (e: any) {
      setError(e.message || "请求失败");
    } finally {
      setLoading(false);
    }
  };

  // 按类别过滤
  const filteredResults = useMemo(() => {
    let filtered = results;
    if (category !== "all") {
      filtered = filtered.filter(r => r.type === category);
    }
    // 用户过滤条件
    if (category === "user" || category === "all") {
      if (filterPremiumOnly) {
        filtered = filtered.filter(r => r.type !== "user" || r.isPremium);
      }
      if (filterOnlineDays > 0) {
        filtered = filtered.filter(r => {
          if (r.type !== "user") return true;
          if (!r.lastOnline) return false;
          const lastDate = new Date(r.lastOnline);
          const diffDays = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
          return diffDays <= filterOnlineDays;
        });
      }
    }
    return filtered;
  }, [results, category, filterPremiumOnly, filterOnlineDays]);

  // 统计
  const stats = useMemo(() => ({
    total: results.length,
    groups: results.filter(r => r.type === "group").length,
    channels: results.filter(r => r.type === "channel").length,
    users: results.filter(r => r.type === "user").length,
  }), [results]);

  const handleImport = async () => {
    if (selected.size === 0) return;
    const items = Array.from(selected).map(i => filteredResults[i]).filter(r => r.type !== "user");
    if (items.length === 0) {
      alert("只能导入群组/频道到监控池");
      return;
    }
    try {
      const res = await importMutation.mutateAsync({
        items: items.map(r => ({
          username: r.username,
          title: r.title,
          type: r.type,
          memberCount: r.memberCount,
        })),
      });
      alert(`导入成功 ${res.imported} 个，跳过 ${res.skipped} 个`);
      setSelected(new Set());
    } catch (e: any) {
      alert("导入失败: " + e.message);
    }
  };

  const toggleSelect = (idx: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* 输入栏 */}
      <div className="flex gap-3 items-center">
        <Input
          placeholder="输入目标群组，如 @groupname 或 t.me/groupname"
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleExtract()}
          className="max-w-lg"
        />
        <Input
          type="number"
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value) || 100)}
          className="w-24"
          placeholder="消息数"
        />
        <Button onClick={handleExtract} disabled={loading || !group.trim()}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Link2 className="w-4 h-4 mr-1" />}
          提取链接
        </Button>
      </div>

      {error && <div className="text-red-500 text-sm">{error}</div>}

      {/* 统计 + 分类Tab + 过滤 */}
      {results.length > 0 && (
        <div className="space-y-3">
          {/* 分类按钮 */}
          <div className="flex items-center gap-4">
            <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
              {([
                { key: "all", label: `全部 (${stats.total})` },
                { key: "group", label: `群组 (${stats.groups})` },
                { key: "channel", label: `频道 (${stats.channels})` },
                { key: "user", label: `用户 (${stats.users})` },
              ] as const).map(item => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => { setCategory(item.key); setSelected(new Set()); }}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    category === item.key
                      ? "bg-white text-blue-600 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {/* 过滤按钮 */}
            {(category === "user" || category === "all") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
                className={showFilters ? "text-blue-600" : "text-slate-500"}
              >
                <Filter className="w-4 h-4 mr-1" />
                用户过滤
              </Button>
            )}

            {/* 导入按钮 */}
            {selected.size > 0 && (
              <Button onClick={handleImport} variant="outline" size="sm" disabled={importMutation.isPending}>
                <Download className="w-4 h-4 mr-1" />
                导入选中 ({selected.size})
              </Button>
            )}
          </div>

          {/* 过滤条件面板 */}
          {showFilters && (category === "user" || category === "all") && (
            <div className="flex gap-6 items-center p-3 bg-slate-50 rounded-lg border text-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={filterPremiumOnly}
                  onCheckedChange={(v) => setFilterPremiumOnly(!!v)}
                />
                <span>仅 Premium 用户</span>
              </label>
              <label className="flex items-center gap-2">
                <span className="text-slate-500">最近在线:</span>
                <select
                  value={filterOnlineDays}
                  onChange={(e) => setFilterOnlineDays(Number(e.target.value))}
                  className="border rounded px-2 py-1 text-sm"
                >
                  <option value={0}>不限</option>
                  <option value={1}>1天内</option>
                  <option value={3}>3天内</option>
                  <option value={7}>7天内</option>
                  <option value={30}>30天内</option>
                  <option value={90}>90天内</option>
                </select>
              </label>
            </div>
          )}

          {/* 结果表格 */}
          <div className="border rounded-lg overflow-hidden max-h-[600px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={selected.size === filteredResults.length && filteredResults.length > 0}
                      onCheckedChange={() => {
                        if (selected.size === filteredResults.length) setSelected(new Set());
                        else setSelected(new Set(filteredResults.map((_, i) => i)));
                      }}
                    />
                  </TableHead>
                  <TableHead>名称</TableHead>
                  <TableHead>用户名</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead className="text-right">人数</TableHead>
                  <TableHead>Premium</TableHead>
                  <TableHead>最近在线</TableHead>
                  <TableHead className="text-right">AI评分</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredResults.map((r, idx) => (
                  <TableRow key={idx} className="cursor-pointer hover:bg-slate-50" onClick={() => toggleSelect(idx)}>
                    <TableCell><Checkbox checked={selected.has(idx)} onCheckedChange={() => toggleSelect(idx)} /></TableCell>
                    <TableCell className="font-medium max-w-[250px] truncate">{r.title || r.username || "-"}</TableCell>
                    <TableCell className="text-slate-500">{r.username ? `@${r.username}` : "-"}</TableCell>
                    <TableCell>
                      <Badge variant={r.type === "channel" ? "secondary" : r.type === "user" ? "default" : "outline"}>
                        {r.type === "channel" ? "频道" : r.type === "user" ? "用户" : "群组"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{r.type !== "user" ? r.memberCount.toLocaleString() : "-"}</TableCell>
                    <TableCell>{r.isPremium ? <Badge className="bg-blue-100 text-blue-700">Premium</Badge> : "-"}</TableCell>
                    <TableCell className="text-xs text-slate-400">{r.lastOnline || "-"}</TableCell>
                    <TableCell className="text-right">
                      <span className={`font-medium ${r.aiScore >= 70 ? "text-green-600" : r.aiScore >= 40 ? "text-amber-600" : "text-slate-400"}`}>
                        {r.aiScore}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredResults.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-slate-400">
                      该分类下无结果
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {results.length === 0 && !loading && !error && (
        <div className="text-center py-12 text-slate-400">输入目标群组，提取消息中的链接和@提及</div>
      )}
    </div>
  );
}
