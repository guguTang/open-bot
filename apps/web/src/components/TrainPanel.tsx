import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { Agent, BotLesson, LessonStatus } from "../api";
import { deleteLesson, listAgentLessons, updateLesson } from "../api";

type Tab = LessonStatus;

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

function TrainPanelBody({ agent, onClose }: BodyProps) {
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
    () => lessons.filter((l) => l.status === tab),
    [lessons, tab],
  );

  const patchStatus = async (id: string, status: LessonStatus) => {
    setBusy(true);
    setErr("");
    try {
      const updated = await updateLesson(id, { status });
      setLessons((prev) => prev.map((l) => (l.id === id ? updated : l)));
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("确定删除这条经验？删除后不可恢复。")) return;
    setBusy(true);
    setErr("");
    try {
      await deleteLesson(id);
      setLessons((prev) => prev.filter((l) => l.id !== id));
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (l: BotLesson) => {
    setEdit(l);
    setEditTitle(l.title);
    setEditBody(l.body);
  };

  const saveEdit = async (e: FormEvent) => {
    e.preventDefault();
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
      setLessons((prev) => prev.map((l) => (l.id === edit.id ? updated : l)));
      setEdit(null);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  };

  const confirmActive = async (l: BotLesson) => {
    if (!window.confirm("确认后会进入该 Bot 的运行提示，可随时停用。")) return;
    await patchStatus(l.id, "active");
  };

  const emptyText =
    tab === "pending"
      ? "还没有待确认的经验。给 Bot 回复点「反馈」或 👎 后写原因，会出现在这里。"
      : tab === "active"
        ? "还没有已生效的经验。"
        : "还没有已忽略的经验。";

  return (
    <div className="modal-backdrop train-backdrop" onClick={onClose}>
      <div className="modal train-panel-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>训练 · {agent.name}</h3>
          <button type="button" className="ghost train-back-btn" onClick={onClose}>
            返回
          </button>
        </div>

        <div className="train-tabs" role="tablist">
          {(
            [
              ["pending", "待确认"],
              ["active", "已生效"],
              ["ignored", "已忽略"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`train-tab${tab === id ? " active" : ""}`}
              onClick={() => setTab(id)}
            >
              {label}
              <span className="train-tab-count">
                {lessons.filter((l) => l.status === id).length}
              </span>
            </button>
          ))}
        </div>

        {err ? <div className="text-[13px] text-(--danger)">{err}</div> : null}

        {edit ? (
          <form className="train-edit" onSubmit={(e) => void saveEdit(e)}>
            <label className="feedback-label">
              标题
              <input
                value={editTitle}
                maxLength={40}
                onChange={(e) => setEditTitle(e.target.value)}
                required
              />
            </label>
            <label className="feedback-label">
              指导内容
              <textarea
                className="feedback-note"
                rows={4}
                maxLength={500}
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                required
              />
            </label>
            <div className="feedback-actions">
              <button type="button" className="ghost" onClick={() => setEdit(null)} disabled={busy}>
                取消
              </button>
              <button type="submit" className="primary" disabled={busy}>
                保存
              </button>
            </div>
          </form>
        ) : (
          <div className="train-list">
            {busy && filtered.length === 0 ? (
              <div className="muted small">加载中…</div>
            ) : filtered.length === 0 ? (
              <div className="train-empty muted">{emptyText}</div>
            ) : (
              filtered.map((l) => (
                <div key={l.id} className="train-card">
                  <div className="train-card-title">{l.title}</div>
                  <div className="train-card-body muted small">{l.body}</div>
                  <div className="train-card-meta muted small">
                    {l.tags?.length ? l.tags.join(" · ") : null}
                    {l.created_at ? ` · ${new Date(l.created_at).toLocaleString()}` : null}
                  </div>
                  <div className="train-card-actions">
                    {tab === "pending" ? (
                      <>
                        <button type="button" className="primary" disabled={busy} onClick={() => void confirmActive(l)}>
                          确认生效
                        </button>
                        <button type="button" className="ghost" disabled={busy} onClick={() => openEdit(l)}>
                          编辑
                        </button>
                        <button type="button" className="ghost" disabled={busy} onClick={() => void patchStatus(l.id, "ignored")}>
                          忽略
                        </button>
                      </>
                    ) : null}
                    {tab === "active" ? (
                      <>
                        <button type="button" className="ghost" disabled={busy} onClick={() => openEdit(l)}>
                          编辑
                        </button>
                        <button type="button" className="ghost" disabled={busy} onClick={() => void patchStatus(l.id, "ignored")}>
                          停用
                        </button>
                        <button type="button" className="ghost danger-text" disabled={busy} onClick={() => void remove(l.id)}>
                          删除
                        </button>
                      </>
                    ) : null}
                    {tab === "ignored" ? (
                      <>
                        <button type="button" className="ghost" disabled={busy} onClick={() => void patchStatus(l.id, "pending")}>
                          恢复待确认
                        </button>
                        <button type="button" className="ghost danger-text" disabled={busy} onClick={() => void remove(l.id)}>
                          删除
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function TrainPanel({ agent, open, onClose, reloadToken = 0 }: Props) {
  if (!open || !agent) return null;

  return <TrainPanelBody key={`${agent.id}-${reloadToken}`} agent={agent} onClose={onClose} />;
}
