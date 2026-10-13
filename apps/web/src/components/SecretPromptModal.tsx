import { useState } from "react";
import { createPortal } from "react-dom";
import type { BotSecretRequest } from "../api";
import { resolveBotSecretRequest } from "../api";
import { useDialogOpen } from "./useDialogOpen";

type Props = {
  request: BotSecretRequest | null;
  onClose: () => void;
  onResolved: () => void;
};

export function SecretPromptModal({ request, onClose, onResolved }: Props) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const dialogRef = useDialogOpen(request != null, onClose, { blockDismiss: busy });

  if (!request) return null;

  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      await resolveBotSecretRequest(request.id, {
        value,
        name: request.name,
        origin: request.origin,
        auth_type: request.auth_type,
        agent_id: request.agent_id,
      });
      setValue("");
      onResolved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async () => {
    setBusy(true);
    try {
      await resolveBotSecretRequest(request.id, { dismiss: true });
      onResolved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      className="modal-backdrop"
      aria-labelledby="secret-prompt-modal-title"
    >
      <button
        type="button"
        className="modal-backdrop-mask"
        aria-label="关闭"
        disabled={busy}
        onClick={onClose}
      />
      <div className="modal">
        <div className="modal-head">
          <h3 id="secret-prompt-modal-title">需要密钥：{request.name || "secret"}</h3>
          <button type="button" className="ghost" onClick={onClose}>
            关闭
          </button>
        </div>
        <p className="muted">
          {request.reason || "助手请求一个密钥。明文仅加密存库，不会回传给模型。"}
        </p>
        {request.origin ? <p className="muted">Origin：{request.origin}</p> : null}
        <label>
          密钥值
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
            placeholder="粘贴 token / API key"
          />
        </label>
        {err ? <div className="preview-error">{err}</div> : null}
        <div className="modal-actions">
          <button type="button" className="ghost" disabled={busy} onClick={() => void dismiss()}>
            忽略
          </button>
          <button type="button" className="primary" disabled={busy || !value.trim()} onClick={() => void submit()}>
            保存
          </button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
