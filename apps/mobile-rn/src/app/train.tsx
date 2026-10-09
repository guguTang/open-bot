import { Button, Dialog, Spinner, Typography } from "heroui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { JSX } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";

import * as api from "@/api";
import type { BotLesson, LessonStatus } from "@/api/types";
import { useConfirm } from "@/components/ConfirmDialog";
import { FormField } from "@/components/FormField";
import { ScreenHeader } from "@/components/ScreenScaffold";
import { EmptyState, ErrorAlert, ListSkeleton } from "@/components/states";
import { formatRelativeTime } from "@/lib/format";

/**
 * 训练面板：把用户对回复的反馈沉淀成这个 Bot 的经验。
 *
 * 三个 Tab 对应经验的三种状态，和 Web 端 TrainPanel 语义一致：
 * - pending 待确认：反馈刚落库时的初稿，用户点头才生效
 * - active 已生效：进入 Bot 的运行提示，真正影响后续回答
 * - ignored 已忽略：用户明确不要它
 *
 * 这是个独立路由（`/train?agentId=…`）而不是聊天页里的 Modal —— 手机上
 * 三段内容加编辑表单比弹窗更适合整屏滚动，键盘也不会顶掉半个面板。
 */

const TABS: { key: LessonStatus; label: string }[] = [
  { key: "pending", label: "待确认" },
  { key: "active", label: "已生效" },
  { key: "ignored", label: "已忽略" },
];

const EMPTY_TEXT: Record<LessonStatus, string> = {
  pending: "还没有待确认的经验。给 Bot 回复点「反馈」或 👎 并写明原因，就会出现在这里。",
  active: "还没有已生效的经验。",
  ignored: "还没有已忽略的经验。",
};

export default function TrainScreen(): JSX.Element {
  const { agentId } = useLocalSearchParams<{ agentId: string }>();
  const id = String(agentId ?? "");
  const router = useRouter();
  const { confirm } = useConfirm();

  const [tab, setTab] = useState<LessonStatus>("pending");
  const [lessons, setLessons] = useState<BotLesson[]>([]);
  const [agentName, setAgentName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<BotLesson | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const list = await api.listAgentLessons(id);
      setLessons(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    // 豁免 react-hooks/set-state-in-effect：load 内的 setState 全部发生在
    // `await api.listAgentLessons()` 之后（网络往返完成才写状态），
    // 不是渲染期同步更新。规则无法跨 async 边界证明这点，只能显式说明。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void api
      .listAgents()
      .then((list) => {
        if (!cancelled) setAgentName(list.find((a) => a.id === id)?.name ?? "助手");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [id]);

  const counts = useMemo(() => {
    const out: Record<string, number> = { pending: 0, active: 0, ignored: 0 };
    for (const l of lessons) out[l.status] = (out[l.status] ?? 0) + 1;
    return out;
  }, [lessons]);

  const filtered = useMemo(() => lessons.filter((l) => l.status === tab), [lessons, tab]);

  const patchStatus = useCallback(async (lessonId: string, status: LessonStatus): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateLesson(lessonId, { status });
      setLessons((prev) => prev.map((l) => (l.id === lessonId ? updated : l)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新失败");
    } finally {
      setBusy(false);
    }
  }, []);

  const confirmActive = useCallback(
    async (lesson: BotLesson): Promise<void> => {
      const ok = await confirm({
        title: "让这条经验生效？",
        message: "生效后会进入该助手的运行提示，影响它之后的回答。可随时停用。",
        confirmLabel: "确认生效",
      });
      if (ok) await patchStatus(lesson.id, "active");
    },
    [confirm, patchStatus]
  );

  const remove = useCallback(
    async (lesson: BotLesson): Promise<void> => {
      const ok = await confirm({
        title: "删除这条经验？",
        message: "删除后不可恢复。",
        confirmLabel: "删除",
        destructive: true,
      });
      if (!ok) return;
      setBusy(true);
      setError(null);
      try {
        await api.deleteLesson(lesson.id);
        setLessons((prev) => prev.filter((l) => l.id !== lesson.id));
      } catch (err) {
        setError(err instanceof Error ? err.message : "删除失败");
      } finally {
        setBusy(false);
      }
    },
    [confirm]
  );

  const openEdit = (lesson: BotLesson): void => {
    setEditing(lesson);
    setEditTitle(lesson.title);
    setEditBody(lesson.body);
  };

  const saveEdit = async (): Promise<void> => {
    if (!editing) return;
    const title = editTitle.trim().slice(0, 40);
    const body = editBody.trim().slice(0, 500);
    if (!title || !body) {
      setError("标题和指导内容必填");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateLesson(editing.id, { title, body });
      setLessons((prev) => prev.map((l) => (l.id === editing.id ? updated : l)));
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  if (!id) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader title="训练" onBack={() => router.back()} />
        <EmptyState icon="school-outline" title="缺少助手" hint="请从聊天页的训练入口进入。" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={`训练 · ${agentName || "助手"}`} onBack={() => router.back()} />

      <View className="flex-row gap-2 px-5 pt-4">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <Button
              key={t.key}
              size="sm"
              variant={active ? "primary" : "secondary"}
              onPress={() => setTab(t.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Button.Label>
                {t.label}
                {counts[t.key] ? ` · ${counts[t.key]}` : ""}
              </Button.Label>
            </Button>
          );
        })}
      </View>

      <ScrollView className="flex-1" contentContainerClassName="gap-4 px-5 pt-5 pb-8">
        {error ? (
          <ErrorAlert title="出了点问题" description={error} onRetry={() => void load()} />
        ) : null}

        {loading ? (
          <ListSkeleton rows={3} />
        ) : filtered.length === 0 ? (
          <EmptyState icon="school-outline" title="这里是空的" hint={EMPTY_TEXT[tab]} />
        ) : (
          filtered.map((lesson) => (
            <View key={lesson.id} className="gap-2.5 rounded-3xl bg-surface p-4">
              <View className="flex-row items-start justify-between gap-3">
                <Typography.Paragraph weight="medium" className="flex-1">
                  {lesson.title}
                </Typography.Paragraph>
                {lesson.updated_at ? (
                  <Typography.Paragraph type="body-sm" color="muted">
                    {formatRelativeTime(lesson.updated_at)}
                  </Typography.Paragraph>
                ) : null}
              </View>

              <Typography.Paragraph type="body-sm" className="text-muted">
                {lesson.body}
              </Typography.Paragraph>

              {lesson.tags?.length ? (
                <View className="flex-row flex-wrap gap-1.5">
                  {lesson.tags.map((tag) => (
                    <Typography.Paragraph
                      key={tag}
                      type="body-sm"
                      color="muted"
                      className="rounded-md bg-background px-2 py-0.5"
                    >
                      {tag}
                    </Typography.Paragraph>
                  ))}
                </View>
              ) : null}

              <View className="flex-row flex-wrap gap-2">
                {lesson.status === "pending" ? (
                  <>
                    <Button size="sm" isDisabled={busy} onPress={() => void confirmActive(lesson)}>
                      <Button.Label>确认生效</Button.Label>
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      isDisabled={busy}
                      onPress={() => void patchStatus(lesson.id, "ignored")}
                    >
                      <Button.Label>忽略</Button.Label>
                    </Button>
                  </>
                ) : lesson.status === "active" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    isDisabled={busy}
                    onPress={() => void patchStatus(lesson.id, "ignored")}
                  >
                    <Button.Label>停用</Button.Label>
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    isDisabled={busy}
                    onPress={() => void patchStatus(lesson.id, "pending")}
                  >
                    <Button.Label>恢复待确认</Button.Label>
                  </Button>
                )}

                <Button
                  size="sm"
                  variant="ghost"
                  isDisabled={busy}
                  onPress={() => openEdit(lesson)}
                >
                  <Button.Label>编辑</Button.Label>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  isDisabled={busy}
                  onPress={() => void remove(lesson)}
                >
                  <Button.Label>删除</Button.Label>
                </Button>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <Dialog
        isOpen={editing !== null}
        onOpenChange={(next: boolean) => {
          if (!next) setEditing(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay isCloseOnPress>
            <Dialog.Content>
              <Dialog.Title>编辑经验</Dialog.Title>
              <View className="mt-3 gap-3">
                <FormField
                  label="标题"
                  value={editTitle}
                  onChangeText={setEditTitle}
                  placeholder="不超过 40 字"
                  hint={`${editTitle.length}/40`}
                />
                <FormField
                  label="指导内容"
                  value={editBody}
                  onChangeText={setEditBody}
                  placeholder="告诉助手以后该怎么做，不超过 500 字"
                  multiline
                  hint={`${editBody.length}/500`}
                />
              </View>
              <View className="mt-4 flex-row justify-end gap-3">
                <Button size="sm" variant="secondary" onPress={() => setEditing(null)}>
                  <Button.Label>取消</Button.Label>
                </Button>
                <Button size="sm" isDisabled={busy} onPress={() => void saveEdit()}>
                  {busy ? <Spinner size="sm" /> : null}
                  <Button.Label>保存</Button.Label>
                </Button>
              </View>
            </Dialog.Content>
          </Dialog.Overlay>
        </Dialog.Portal>
      </Dialog>
    </View>
  );
}
