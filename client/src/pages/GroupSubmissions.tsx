import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, CheckCircle2, XCircle, Clock, Send, RefreshCw } from "lucide-react";

type Submission = {
  id: number;
  groupLink: string;
  groupTitle: string | null;
  description: string | null;
  status: string;
  reviewNote: string | null;
  createdAt: Date;
};

export default function GroupSubmissions() {
  const [submitDialog, setSubmitDialog] = useState(false);
  const [groupLink, setGroupLink] = useState("");
  const [groupTitle, setGroupTitle] = useState("");
  const [description, setDescription] = useState("");
  const [rejectDialog, setRejectDialog] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const utils = trpc.useUtils();

  // 管理员看全部，普通用户看自己的
  const { data: allData, isLoading: allLoading, refetch: refetchAll } =
    trpc.hitMessages.listSubmissions.useQuery({ status: undefined });
  const { data: myData, isLoading: myLoading, refetch: refetchMy } =
    trpc.hitMessages.mySubmissions.useQuery();

  const submitGroup = trpc.hitMessages.submitGroup.useMutation({
    onSuccess: () => {
      utils.hitMessages.mySubmissions.invalidate();
      utils.hitMessages.listSubmissions.invalidate();
      setSubmitDialog(false);
      setGroupLink("");
      setGroupTitle("");
      setDescription("");
      toast.success("群组提交成功！等待管理员审核");
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const reviewSubmission = trpc.hitMessages.reviewSubmission.useMutation({
    onSuccess: (_: unknown, vars: { id: number; status: string; reviewNote?: string }) => {
      utils.hitMessages.listSubmissions.invalidate();
      setRejectDialog(null);
      setRejectReason("");
      toast.success(vars.status === "approved" ? "已批准，群组已加入监控" : "已拒绝提交");
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const allRows = (allData ?? []) as Submission[];
  const myRows = (myData ?? []) as Submission[];

  const statusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return (
          <Badge variant="secondary" className="bg-yellow-100 text-yellow-700 text-xs">
            <Clock className="h-3 w-3 mr-1" />待审核
          </Badge>
        );
      case "approved":
        return (
          <Badge variant="secondary" className="bg-green-100 text-green-700 text-xs">
            <CheckCircle2 className="h-3 w-3 mr-1" />已批准
          </Badge>
        );
      case "rejected":
        return (
          <Badge variant="secondary" className="bg-red-100 text-red-700 text-xs">
            <XCircle className="h-3 w-3 mr-1" />已拒绝
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const SubmissionTable = ({
    rows,
    isAdmin,
  }: {
    rows: Submission[];
    isAdmin: boolean;
  }) => (
    <div className="divide-y">
      <div className="flex items-center gap-3 px-4 py-2 bg-muted/30 text-xs text-muted-foreground">
        <span className="flex-1">群组信息</span>
        <span className="w-28">链接</span>
        <span className="w-24">状态</span>
        <span className="w-32">提交时间</span>
        {isAdmin && <span className="w-32">操作</span>}
      </div>
      {rows.map((r) => (
        <div key={r.id} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/20">
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm">{r.groupTitle ?? "未命名群组"}</div>
            {r.description && (
              <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                {r.description}
              </div>
            )}
            {r.reviewNote && (
              <div className="text-xs text-red-500 mt-0.5">拒绝原因：{r.reviewNote}</div>
            )}
          </div>
          <div className="w-28 min-w-0">
            <a
              href={r.groupLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-500 hover:underline truncate block"
            >
              {r.groupLink}
            </a>
          </div>
          <div className="w-24">{statusBadge(r.status)}</div>
          <div className="w-32 text-xs text-muted-foreground">
            {new Date(r.createdAt).toLocaleString("zh-CN", {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
          {isAdmin && (
            <div className="w-32 flex gap-1">
              {r.status === "pending" && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs text-green-600 border-green-200"
                    onClick={() => reviewSubmission.mutate({ id: r.id, status: "approved" })}
                    disabled={reviewSubmission.isPending}
                  >
                    批准
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs text-red-600 border-red-200"
                    onClick={() => setRejectDialog(r.id)}
                  >
                    拒绝
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      {/* 页头 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">群组提交审核</h1>
          <p className="text-muted-foreground text-sm mt-1">
            提交新群组申请，管理员审核通过后自动加入监控池
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { refetchAll(); refetchMy(); }}>
            <RefreshCw className="h-4 w-4 mr-2" />刷新
          </Button>
          <Button size="sm" onClick={() => setSubmitDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />提交群组
          </Button>
        </div>
      </div>

      {/* 我的提交 */}
      <div>
        <h2 className="text-base font-semibold mb-3">我的提交</h2>
        <Card>
          <CardContent className="p-0">
            {myLoading ? (
              <div className="text-center py-8 text-muted-foreground text-sm">加载中...</div>
            ) : myRows.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Send className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">暂无提交记录</p>
              </div>
            ) : (
              <SubmissionTable rows={myRows} isAdmin={false} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* 管理员审核区 */}
      {allData !== undefined && (
        <div>
          <h2 className="text-base font-semibold mb-3">
            待审核列表
            <Badge variant="secondary" className="ml-2">
              {allRows.filter((r) => r.status === "pending").length} 条待审
            </Badge>
          </h2>
          <Card>
            <CardContent className="p-0">
              {allLoading ? (
                <div className="text-center py-8 text-muted-foreground text-sm">加载中...</div>
              ) : allRows.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">暂无提交</div>
              ) : (
                <SubmissionTable rows={allRows} isAdmin={true} />
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* 提交群组对话框 */}
      <Dialog open={submitDialog} onOpenChange={setSubmitDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>提交群组</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">群组链接 *</label>
              <Input
                placeholder="https://t.me/groupname 或 @groupname"
                value={groupLink}
                onChange={(e) => setGroupLink(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">群组名称（可选）</label>
              <Input
                placeholder="群组的显示名称"
                value={groupTitle}
                onChange={(e) => setGroupTitle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">描述（可选）</label>
              <Textarea
                placeholder="描述这个群组的主题或特点..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubmitDialog(false)}>取消</Button>
            <Button
              onClick={() =>
                submitGroup.mutate({
                  groupLink,
                  groupTitle: groupTitle || undefined,
                  description: description || undefined,
                })
              }
              disabled={!groupLink || submitGroup.isPending}
            >
              提交审核
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 拒绝对话框 */}
      <Dialog open={!!rejectDialog} onOpenChange={() => setRejectDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>填写拒绝原因</DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder="请填写拒绝原因（可选）"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialog(null)}>取消</Button>
            <Button
              variant="destructive"
              onClick={() =>
                rejectDialog &&
                reviewSubmission.mutate({
                  id: rejectDialog,
                  status: "rejected",
                  reviewNote: rejectReason || undefined,
                })
              }
              disabled={reviewSubmission.isPending}
            >
              确认拒绝
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
