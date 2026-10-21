import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ThumbsDown } from "lucide-react";
import type { Agent, BotLesson, LessonStatus } from "../api";
import { deleteLesson, listAgentLessons, updateLesson } from "../api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useConfirm } from "./ConfirmProvider";

type Tab = LessonStatus;

const TABS: ReadonlyArray<readonly [Tab, string]> = [
  ["pending", "待确认"],
  ["active", "已生效"],
  ["ignored", "已忽略"],
];

type Props = {
  agent: Agent | null;
  open: boolean;
  onClose: () => void;
  /** Bump to force reload after external feedback submit. */
  reloadToken?: number;
};

type BodyProps = {
  agent: Agent;
  onClose: () => void;
};

function lessonMeta(lesson: BotLesson): string {
  const tags = lesson.tags?.length ? lesson.tags.join(" · ") : "";
  const created = lesson.created_at ? new Date(lesson.created_at).toLocaleString() : "";
  if (tags && created) return `${tags} · ${created}`;
  return tags || created;
}

function TrainPanelBody({ agent, onClose }: BodyProps) {
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>("pending");
  const [lessons, setLessons] = useState<BotLesson[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [edit, setEdit] = useState<BotLesson | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setErr("");
    try {
      const list = await listAgentLessons(agent.id);
      setLessons(list);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  }, [agent.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () => lessons.filter((lesson) => lesson.status === tab),
    [lessons, tab],
  );

  const counts = useMemo(() => {
    const next: Record<Tab, number> = { pending: 0, active: 0, ignored: 0 };
    for (const lesson of lessons) {
      if (lesson.status === "pending" || lesson.status === "active" || lesson.status === "ignored") {
        next[lesson.status] += 1;
      }
    }
    return next;
  }, [lessons]);

  const patchStatus = async (id: string, status: LessonStatus) => {
    setBusy(true);
    setErr("");
    try {
      const updated = await updateLesson(id, { status });
      setLessons((prev) => prev.map((lesson) => (lesson.id === id ? updated : lesson)));
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    const ok = await confirm({
      title: "删除这条经验？",
      description: "删除后不可恢复。",
      confirmLabel: "删除",
      cancelLabel: "取消",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setErr("");
    try {
      await deleteLesson(id);
      setLessons((prev) => prev.filter((lesson) => lesson.id !== id));
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (lesson: BotLesson) => {
    setEdit(lesson);
    setEditTitle(lesson.title);
    setEditBody(lesson.body);
    setErr("");
  };

  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!edit) return;
    const title = editTitle.trim().slice(0, 40);
    const body = editBody.trim().slice(0, 500);
    if (!title || !body) {
      setErr("标题和指导内容必填");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const updated = await updateLesson(edit.id, { title, body });
      setLessons((prev) => prev.map((lesson) => (lesson.id === edit.id ? updated : lesson)));
      setEdit(null);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  };

  const confirmActive = async (lesson: BotLesson) => {
    const ok = await confirm({
      title: "确认生效？",
      description: "确认后会进入该 Bot 的运行提示，可随时停用。",
      confirmLabel: "确认生效",
      cancelLabel: "取消",
    });
    if (!ok) return;
    await patchStatus(lesson.id, "active");
  };

  const emptyText =
    tab === "pending"
      ? "还没有待确认的经验。给 Bot 回复点「反馈」或踩一下后写原因，会出现在这里。"
      : tab === "active"
        ? "还没有已生效的经验。"
        : "还没有已忽略的经验。";

  const validationErr = err === "标题和指导内容必填";
  const titleInvalid = validationErr && !editTitle.trim();
  const bodyInvalid = validationErr && !editBody.trim();

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "flex max-h-[min(80vh,720px)] flex-col gap-4 overflow-hidden sm:max-w-130",
          "max-[767px]:inset-0 max-[767px]:h-dvh max-[767px]:max-h-none max-[767px]:max-w-none max-[767px]:translate-x-0 max-[767px]:translate-y-0 max-[767px]:rounded-none",
          "max-[767px]:pt-[max(1.5rem,env(safe-area-inset-top))] max-[767px]:pb-[max(1.5rem,env(safe-area-inset-bottom))]",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <DialogHeader className="min-w-0 text-left">
            <DialogTitle className="text-balance">训练 · {agent.name}</DialogTitle>
            <DialogDescription className="sr-only">
              确认、编辑或停用从这个助手的反馈里生成的经验。
            </DialogDescription>
          </DialogHeader>
          <Button type="button" variant="ghost" className="shrink-0" onClick={onClose}>
            返回
          </Button>
        </div>

        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as Tab)}
          className="min-h-0 gap-3"
        >
          <TabsList variant="line" className="w-full justify-start">
            {TABS.map(([id, label]) => (
              <TabsTrigger key={id} value={id}>
                {label}
                <span className="tabular-nums">{counts[id]}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          {err && !edit ? <FieldError>{err}</FieldError> : null}

          <TabsContent value={tab} className="min-h-0">
            {edit ? (
              <form className="flex flex-col gap-4" onSubmit={(event) => void saveEdit(event)}>
                <FieldGroup className="gap-4">
                  <Field data-invalid={titleInvalid ? true : undefined} data-disabled={busy ? true : undefined}>
                    <FieldLabel htmlFor="train-lesson-title">标题</FieldLabel>
                    <Input
                      id="train-lesson-title"
                      value={editTitle}
                      maxLength={40}
                      aria-invalid={titleInvalid || undefined}
                      disabled={busy}
                      required
                      onChange={(event) => setEditTitle(event.target.value)}
                    />
                  </Field>
                  <Field data-invalid={bodyInvalid ? true : undefined} data-disabled={busy ? true : undefined}>
                    <FieldLabel htmlFor="train-lesson-body">指导内容</FieldLabel>
                    <Textarea
                      id="train-lesson-body"
                      rows={4}
                      maxLength={500}
                      aria-invalid={bodyInvalid || undefined}
                      disabled={busy}
                      required
                      value={editBody}
                      onChange={(event) => setEditBody(event.target.value)}
                    />
                  </Field>
                </FieldGroup>
                {err ? <FieldError>{err}</FieldError> : null}
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setEdit(null)} disabled={busy}>
                    取消
                  </Button>
                  <Button type="submit" disabled={busy}>
                    保存
                  </Button>
                </DialogFooter>
              </form>
            ) : filtered.length === 0 ? (
              <p className="py-6 text-center text-sm text-pretty text-muted">
                {busy ? (
                  "加载中…"
                ) : (
                  <span className="inline-flex items-start gap-2 text-left">
                    {tab === "pending" ? <ThumbsDown className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /> : null}
                    <span>{emptyText}</span>
                  </span>
                )}
              </p>
            ) : (
              <ScrollArea className="h-[min(52vh,28rem)] max-[767px]:h-[min(70dvh,36rem)]">
                <div className="flex flex-col gap-3 pr-3">
                  {filtered.map((lesson) => {
                    const meta = lessonMeta(lesson);
                    return (
                      <Card key={lesson.id} size="sm">
                        <CardHeader>
                          <CardTitle>{lesson.title}</CardTitle>
                          <CardDescription className="whitespace-pre-wrap">{lesson.body}</CardDescription>
                        </CardHeader>
                        {meta ? (
                          <CardContent>
                            <p className="text-xs text-muted">{meta}</p>
                          </CardContent>
                        ) : null}
                        <CardFooter className="flex-wrap gap-2">
                          {tab === "pending" ? (
                            <>
                              <Button type="button" disabled={busy} onClick={() => void confirmActive(lesson)}>
                                确认生效
                              </Button>
                              <Button type="button" variant="outline" disabled={busy} onClick={() => openEdit(lesson)}>
                                编辑
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                disabled={busy}
                                onClick={() => void patchStatus(lesson.id, "ignored")}
                              >
                                忽略
                              </Button>
                            </>
                          ) : null}
                          {tab === "active" ? (
                            <>
                              <Button type="button" variant="outline" disabled={busy} onClick={() => openEdit(lesson)}>
                                编辑
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                disabled={busy}
                                onClick={() => void patchStatus(lesson.id, "ignored")}
                              >
                                停用
                              </Button>
                              <Button
                                type="button"
                                variant="destructive"
                                disabled={busy}
                                onClick={() => void remove(lesson.id)}
                              >
                                删除
                              </Button>
                            </>
                          ) : null}
                          {tab === "ignored" ? (
                            <>
                              <Button
                                type="button"
                                variant="outline"
                                disabled={busy}
                                onClick={() => void patchStatus(lesson.id, "pending")}
                              >
                                恢复待确认
                              </Button>
                              <Button
                                type="button"
                                variant="destructive"
                                disabled={busy}
                                onClick={() => void remove(lesson.id)}
                              >
                                删除
                              </Button>
                            </>
                          ) : null}
                        </CardFooter>
                      </Card>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

export function TrainPanel({ agent, open, onClose, reloadToken = 0 }: Props) {
  if (!open || !agent) return null;

  return <TrainPanelBody key={`${agent.id}-${reloadToken}`} agent={agent} onClose={onClose} />;
}
