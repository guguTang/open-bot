import { useState } from "react";
import { createPortal } from "react-dom";
import type { Agent, CloneAgentResult } from "../api";
import { cloneAgent } from "../api";
import { useDialogChrome } from "./useDialogOpen";

type Props = {
  agent: Agent | null;
  onClose: () => void;
  onCloned: (result: CloneAgentResult) => void;
};

type FormProps = {
  agent: Agent;
  onClose: () => void;
  onCloned: (result: CloneAgentResult) => void;
};

function CloneAgentModalForm({ agent, onClose, onCloned }: FormProps) {
  const [name, setName] = useState(() => `${agent.name} 副本`);
  const [copyMemory, setCopyMemory] = useState(true);
  const [copyRoutines, setCopyRoutines] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const { ref: dialogRef, maskProps } = useDialogChrome(true, onClose, {
    blockDismiss: busy,
    systemBack: true,
  });

  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      const res = await cloneAgent(agent.id, {
        name: name.trim() || undefined,
        copy_memory: copyMemory,
        copy_routines: copyRoutines,
      });
      onCloned(res);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="modal-backdrop"
      aria-labelledby="clone-agent-modal-title"
    >
      <button {...maskProps} />
      <div className="modal clone-agent-modal">
        <div className="modal-head">
          <h3 id="clone-agent-modal-title">复制助手「{agent.name}」</h3>
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>
            关闭
          </button>
        </div>
        <label className="clone-field">
          新助手名称
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} maxLength={80} />
        </label>
        <div className="clone-section">
          <div className="clone-section-title">会复制</div>
          <ul>
            <li>岗位描述、人设（系统提示）、电脑模式</li>
            <li>本助手的 Skills 开关</li>
          </ul>
          <label className="check">
            <input type="checkbox" checked={copyMemory} onChange={(e) => setCopyMemory(e.target.checked)} disabled={busy} />
            同时复制本助手的专属记忆
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={copyRoutines}
              onChange={(e) => setCopyRoutines(e.target.checked)}
              disabled={busy}
            />
            同时复制例行任务（复制后为暂停，需手动开启）
          </label>
        </div>
        <div className="clone-section">
          <div className="clone-section-title">与原助手共享（账号级）</div>
          <ul>
            <li>你的个人记忆、技能库、模型连接、MCP、已登记的电脑</li>
          </ul>
          <div className="clone-section-title">不会复制</div>
          <ul>
            <li>聊天记录与线程、群聊成员身份</li>
            <li>助手密钥（需重新授权）、private 模式下的私有文件</li>
          </ul>
        </div>
        {err ? <div className="preview-error">{err}</div> : null}
        <div className="modal-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button type="button" className="primary" disabled={busy} onClick={() => void submit()}>
            {busy ? "复制中…" : "复制"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

/** 「复制助手」：人设与 Skills 总是复制；Bot 记忆默认勾选，例行任务可选。 */
export function CloneAgentModal({ agent, onClose, onCloned }: Props) {
  if (!agent) return null;

  return createPortal(
    <CloneAgentModalForm key={agent.id} agent={agent} onClose={onClose} onCloned={onCloned} />,
    document.body,
  );
}
