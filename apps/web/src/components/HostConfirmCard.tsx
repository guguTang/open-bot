import {
  isGitWriteRisk,
  toolFamilyForHostOp,
  toolLabelForHostOp,
  type ApprovalDecision,
} from "../lib/toolAllowlist";
import { type HostConfirmPayload } from "./hostConfirmModel";

function pathList(path: string): string[] {
  return path
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function commandSnippet(item: HostConfirmPayload): string {
  if (item.op === "shell" || item.op === "ssh_exec") {
    const cmd = (item.path || "").trim();
    if (!cmd) return item.dest === "terminal" ? "打开终端" : "（空命令）";
    return cmd.length > 72 ? `${cmd.slice(0, 72)}…` : cmd;
  }
  if (item.op === "email_send") {
    const subj = (item.dest || "").trim() || "(无主题)";
    const to = (item.path || "").trim() || "(无收件人)";
    return `${to} · ${subj}`;
  }
  if (item.op === "move") {
    return item.dest ? `${item.path} → ${item.dest}` : item.path;
  }
  if (item.op === "screenshot") {
    if (item.dest) return `显示器 ${item.dest}`;
    if (item.path === "all") return "全部屏幕";
    return "主屏幕";
  }
  if (item.op === "ssh_write" || item.op === "ssh_delete") {
    return item.dest ? `${item.dest} ${item.path}` : item.path;
  }
  const n = pathList(item.path).length;
  if ((item.op === "delete" || item.op === "ssh_delete") && n > 1) {
    return `${n} 个路径`;
  }
  return item.path || "";
}

function actionCopy(item: HostConfirmPayload): { detail: string; danger: boolean } {
  if (item.op === "shell") {
    return { detail: item.path, danger: true };
  }
  if (item.op === "ssh_exec") {
    return {
      detail: item.dest ? `${item.dest}\n${item.path}` : item.path,
      danger: true,
    };
  }
  if (item.op === "ssh_delete") {
    return {
      detail: item.dest ? `${item.dest}\n${item.path}` : item.path,
      danger: true,
    };
  }
  if (item.op === "ssh_write") {
    return {
      detail: item.dest ? `${item.dest} ${item.path}` : item.path,
      danger: false,
    };
  }
  if (item.op === "write") {
    return { detail: item.path, danger: false };
  }
  if (item.op === "delete") {
    return { detail: item.path, danger: true };
  }
  if (item.op === "move") {
    return {
      detail: item.dest ? `${item.path} → ${item.dest}` : item.path,
      danger: true,
    };
  }
  if (item.op === "screenshot") {
    return { detail: "", danger: false };
  }
  if (item.op === "email_send") {
    const attachLine = (item.preview || "")
      .split("\n")
      .map((s) => s.trim())
      .find((s) => s.startsWith("附件："));
    return {
      detail: [item.path && `收件人：${item.path}`, item.dest && `主题：${item.dest}`, attachLine]
        .filter(Boolean)
        .join("\n"),
      danger: false,
    };
  }
  return { detail: item.path, danger: false };
}

/**
 * HITL approval card — 审批三态 (Allow once / Always allow / Deny).
 * UE: narrow = primary full-width + second row; wide = three right-aligned.
 * MVP: no 「始终拒绝」 on main card.
 */
export function HostConfirmCard({
  item,
  onDecide,
  alwaysAllowEnabled = true,
}: {
  item: HostConfirmPayload;
  onDecide?: (decision: ApprovalDecision) => void;
  /** When false (e.g. machine exec_policy=ask), hide Always — degrades to once-only. */
  alwaysAllowEnabled?: boolean;
}) {
  const { detail } = actionCopy(item);
  const pending = item.status === "pending";
  const settled = item.status === "allowed" ? "已允许" : item.status === "denied" ? "已拒绝" : "";
  const tool = toolLabelForHostOp(item.op, item.path);
  const snippet = commandSnippet(item);
  // email_send: keep title short; to/subject live in detail + preview with normal wrap.
  const titleLine =
    item.op === "email_send" ? tool : snippet ? `${tool} · ${snippet}` : tool;
  // Product: 不擅自代发 — never offer Always allow for email.
  const allowAlways = alwaysAllowEnabled && item.op !== "email_send";
  const gitWriteHint =
    allowAlways && isGitWriteRisk(item.op, item.path)
      ? "始终允许将覆盖同类 Git 写操作（含 push），请确认风险"
      : "";
  const reason = item.reason || "";
  const family = toolFamilyForHostOp(item.op, item.path);

  return (
    <div
      className="host-confirm-card"
      role="region"
      aria-label="工具需要确认"
      data-tool-family={family}
      data-tool={tool}
    >
      <div className="host-confirm-kicker">工具需要确认</div>
      <div className="host-confirm-title">{titleLine}</div>
      {reason ? <div className="host-confirm-reason">{reason}</div> : null}
      {gitWriteHint ? (
        <div className="host-confirm-reason host-confirm-risk-hint">{gitWriteHint}</div>
      ) : null}
      {detail && detail !== snippet ? <div className="host-confirm-path">{detail}</div> : null}
      {item.preview &&
      (item.op === "write" || item.op === "shell" || item.op === "ssh_write" || item.op === "ssh_exec" || item.op === "email_send") ? (
        <pre className="host-confirm-preview">{item.preview}</pre>
      ) : null}
      {pending && onDecide ? (
        <div className={`host-confirm-actions${allowAlways ? " host-confirm-actions-tri" : ""}`}>
          <button
            type="button"
            className="host-confirm-allow-once primary"
            onClick={() => onDecide("allow_once")}
          >
            允许一次
          </button>
          {allowAlways ? (
            <button
              type="button"
              className="host-confirm-always ghost"
              onClick={() => onDecide("always_allow")}
            >
              始终允许
            </button>
          ) : null}
          <button
            type="button"
            className="host-confirm-deny ghost danger-outline"
            onClick={() => onDecide("deny")}
          >
            拒绝
          </button>
        </div>
      ) : pending ? (
        <div className="host-confirm-settled">等待确认</div>
      ) : (
        <div className={`host-confirm-settled${item.status === "denied" ? " denied" : ""}`}>{settled}</div>
      )}
    </div>
  );
}
