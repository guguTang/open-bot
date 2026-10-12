import { ChevronLeft } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Agent, Channel } from "../api";
import { addChannelMember, removeChannelMember } from "../api";
import { AgentAvatar } from "./AgentAvatar";
import { useConfirm } from "./ConfirmProvider";
import { useSheetFormUi } from "./useIsTouchUi";
import { OPENBOT_SYSTEM_BACK_EVENT } from "../lib/mobileSystemBack";

type Props = {
  open: boolean;
  channel: Channel | null;
  agents: Agent[];
  onClose: () => void;
  /** Merge updated channel into list / activeChannel after add or remove. */
  onChanged: (ch: Channel) => void;
};

type View = "members" | "add";

/**
 * 群设置 · 成员 — list / add / remove channel members.
 * Entry: channel pill or list long-press「群设置」.
 * removeChannelMember may 404 until backend ships DELETE (graceful toast).
 */
export function GroupMembersSettings({ open, channel, agents, onClose, onChanged }: Props) {
  const sheetForm = useSheetFormUi();
  const confirm = useConfirm();
  const [view, setView] = useState<View>("members");
  const [busy, setBusy] = useState(false);
  const [localChannel, setLocalChannel] = useState<Channel | null>(channel);

  useEffect(() => {
    if (!open) return;
    setLocalChannel(channel);
    setView("members");
  }, [open, channel]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (view === "add") setView("members");
        else onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose, view]);

  useEffect(() => {
    if (!open) return;
    const onBack = (e: Event) => {
      e.preventDefault();
      if (view === "add") setView("members");
      else onClose();
    };
    document.addEventListener(OPENBOT_SYSTEM_BACK_EVENT, onBack);
    return () => document.removeEventListener(OPENBOT_SYSTEM_BACK_EVENT, onBack);
  }, [open, onClose, view]);

  const memberIds = useMemo(() => new Set(localChannel?.members || []), [localChannel]);

  const memberRows = useMemo(() => {
    if (!localChannel) return [];
    return (localChannel.members || []).map((id) => {
      const a = agents.find((x) => x.id === id);
      const p = localChannel.member_profiles?.find((x) => x.agent_id === id);
      return {
        agent_id: id,
        name: a?.name || p?.name || id,
        avatar_shape: a?.avatar_shape || p?.avatar_shape,
        avatar_color: a?.avatar_color || p?.avatar_color,
        online: a?.online ?? p?.online,
      };
    });
  }, [localChannel, agents]);

  const candidates = useMemo(
    () => agents.filter((a) => !memberIds.has(a.id)),
    [agents, memberIds],
  );

  const applyChannel = useCallback(
    (updated: Channel) => {
      if (!localChannel) return;
      // 204 stub omits members — keep prior members unless caller already patched.
      const merged: Channel = {
        ...localChannel,
        ...updated,
        name: updated.name || localChannel.name || "",
        members: updated.members ?? localChannel.members,
        member_profiles: updated.member_profiles ?? localChannel.member_profiles,
      };
      setLocalChannel(merged);
      onChanged(merged);
    },
    [localChannel, onChanged],
  );

  const onAdd = async (agentId: string) => {
    if (!localChannel || busy) return;
    setBusy(true);
    try {
      const updated = await addChannelMember(localChannel.id, agentId);
      applyChannel(updated);
      toast.success("已添加成员");
      setView("members");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (agentId: string, name: string) => {
    if (!localChannel || busy) return;
    const ok = await confirm({
      title: "移除成员？",
      description: `将「${name}」移出群聊「${localChannel.name}」`,
      confirmLabel: "移除",
      cancelLabel: "取消",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const updated = await removeChannelMember(localChannel.id, agentId);
      if (!updated.members) {
        // 204 stub — patch members locally then let parent refresh.
        const nextMembers = (localChannel.members || []).filter((id) => id !== agentId);
        const nextProfiles = (localChannel.member_profiles || []).filter((p) => p.agent_id !== agentId);
        applyChannel({
          ...localChannel,
          members: nextMembers,
          member_profiles: nextProfiles,
        });
      } else {
        applyChannel(updated);
      }
      toast.success(`已移除「${name}」`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Server gap: DELETE member not implemented yet.
      if (/404|not found|not implemented|method not allowed|405/i.test(msg)) {
        toast.error("移除成员接口尚未就绪（需后端 DELETE /v1/channels/{id}/members/{agentId}）");
      } else {
        toast.error(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!open || !localChannel) return null;

  const title = view === "add" ? "添加成员" : "群设置";

  return (
    <div
      className={`modal-backdrop group-channel-backdrop${sheetForm ? " group-channel-backdrop-sheet" : ""}`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal group-channel-modal${sheetForm ? " group-channel-modal-shell" : ""}`}
        onPointerDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${title} ${localChannel.name}`}
      >
        <div className="modal-head group-channel-modal-head">
          {sheetForm ? (
            <>
              <button
                type="button"
                className="settings-shell-back group-channel-close"
                aria-label={view === "add" ? "返回成员列表" : "返回"}
                onClick={() => {
                  if (view === "add") setView("members");
                  else onClose();
                }}
              >
                <ChevronLeft size={18} strokeWidth={2} aria-hidden />
              </button>
              <h3 className="group-channel-modal-title">{title}</h3>
              <button
                type="button"
                className="settings-hub-close group-channel-close"
                aria-label="关闭"
                onClick={onClose}
              >
                ×
              </button>
            </>
          ) : (
            <>
              <h3>
                {title}
                {view === "members" ? ` · ${localChannel.name}` : ""}
              </h3>
              <div className="group-channel-head-actions">
                {view === "add" ? (
                  <button type="button" className="ghost" onClick={() => setView("members")}>
                    返回
                  </button>
                ) : null}
                <button type="button" className="ghost" onClick={onClose} aria-label="关闭">
                  关闭
                </button>
              </div>
            </>
          )}
        </div>

        <div className="group-channel-scroll">
          {view === "members" ? (
            <>
              {sheetForm ? (
                <p className="group-channel-name-line muted small">{localChannel.name}</p>
              ) : null}

              <section className="group-channel-section" aria-labelledby="group-members-title">
                <div className="group-members-section-head">
                  <h4 id="group-members-title" className="group-channel-section-title">
                    成员（{memberRows.length}）
                  </h4>
                  <button
                    type="button"
                    className="ghost group-members-add-btn"
                    disabled={busy || candidates.length === 0}
                    onClick={() => setView("add")}
                  >
                    添加成员
                  </button>
                </div>
                {memberRows.length === 0 ? (
                  <p className="muted small" style={{ margin: "4px 0 8px" }}>
                    暂无成员
                  </p>
                ) : (
                  <ul className="group-members-list">
                    {memberRows.map((row) => (
                      <li key={row.agent_id} className="group-members-row">
                        <AgentAvatar
                          id={row.agent_id}
                          name={row.name}
                          size={36}
                          shape={row.avatar_shape}
                          color={row.avatar_color}
                          online={row.online === true}
                        />
                        <span className="group-members-name">{row.name}</span>
                        <button
                          type="button"
                          className="ghost group-members-remove"
                          disabled={busy}
                          aria-label={`移除 ${row.name}`}
                          onClick={() => void onRemove(row.agent_id, row.name)}
                        >
                          移除
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {candidates.length === 0 && memberRows.length > 0 ? (
                  <p className="muted small" style={{ margin: "8px 0 0" }}>
                    账号下助手均已在群内
                  </p>
                ) : null}
              </section>
            </>
          ) : (
            <section className="group-channel-section" aria-labelledby="group-add-title">
              <h4 id="group-add-title" className="group-channel-section-title">
                选择要加入的助手
              </h4>
              {candidates.length === 0 ? (
                <p className="muted small">没有可添加的助手</p>
              ) : (
                <div className="new-chat-members group-add-members">
                  {candidates.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className="new-chat-member group-add-member-btn"
                      disabled={busy}
                      onClick={() => void onAdd(a.id)}
                    >
                      <AgentAvatar
                        id={a.id}
                        name={a.name}
                        size={28}
                        shape={a.avatar_shape}
                        color={a.avatar_color}
                        online={a.online === true}
                      />
                      <span>{a.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
