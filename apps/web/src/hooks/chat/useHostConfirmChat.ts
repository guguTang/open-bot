import { useCallback, useLayoutEffect, useRef } from "react";
import { toast } from "sonner";
import {
  approveConversation,
  createHostConfirm,
  decideHostConfirm,
  decideMicroAppGrantPrompt,
  mergeIncomingMessage,
  type ApprovalDecision,
  type Message,
} from "../../api";
import { parseHostConfirm } from "../../components/hostConfirmModel";
import {
  microAppGrantRetryUserText,
  parseMicroAppGrantPrompt,
} from "../../components/microAppGrantModel";
import type { MicroAppGrantCardDecision } from "../../components/MicroAppGrantConfirmCard";
import {
  ALWAYS_ALLOW_TOAST,
  grantToolFamilyAlwaysAllow,
  isToolFamilyAlwaysAllowed,
  toolFamilyForHostOp,
  toolLabelForHostOp,
} from "../../lib/toolAllowlist";
import { classifyHostExecReview, type HostExecRequest } from "../../lib/hostExec";
import type { MachineExecPolicy } from "../../lib/userSettings";
import type { Conversation } from "../../api";
import type { PatchConvMessages } from "../../lib/app/conversationMessages";
import type { ToolAllowEntry } from "../../lib/toolAllowlist";
import type { Dispatch, SetStateAction } from "react";

export type MicroAppGrantRetryArgs = {
  conversationId: string;
  microAppId: string;
  tool: string;
  command?: string;
  pendingArgs?: string;
  text: string;
};

export function useHostConfirmChat(deps: {
  conversationRef: React.RefObject<Conversation | null>;
  patchConvMessages: PatchConvMessages;
  userId: string | undefined;
  hostExecPolicy: MachineExecPolicy;
  toolAllowEntries: ToolAllowEntry[];
  setToolAllowEntries: Dispatch<SetStateAction<ToolAllowEntry[]>>;
  /** After allow_once/always_allow: parent sends a continue turn with micro_app_id. */
  retryAfterMicroAppGrantRef?: React.MutableRefObject<
    ((args: MicroAppGrantRetryArgs) => void) | null
  >;
}) {
  const hostConfirmResolvers = useRef(new Map<string, (ok: boolean) => void>());
  const askHostConfirmRef = useRef<(req: HostExecRequest) => Promise<boolean>>(async () => false);
  const applyRemoteHostDecisionRef = useRef<(msg: Message) => void>(() => {});

  const releaseHostConfirm = useCallback((reqId: string, ok: boolean) => {
    const resolve = hostConfirmResolvers.current.get(reqId);
    if (!resolve) return;
    hostConfirmResolvers.current.delete(reqId);
    resolve(ok);
  }, []);

  const applyRemoteHostDecision = useCallback(
    (msg: Message) => {
      if (msg.role !== "host_confirm") return;
      const parsed = parseHostConfirm(msg.content);
      if (!parsed || (parsed.status !== "allowed" && parsed.status !== "denied")) return;
      releaseHostConfirm(parsed.req_id, parsed.status === "allowed");
    },
    [releaseHostConfirm],
  );

  const acceptServerMessage = useCallback(
    (msg: Message) => {
      applyRemoteHostDecision(msg);
      const convId = msg.conversation_id;
      if (!convId) return;
      deps.patchConvMessages(convId, (prev) => mergeIncomingMessage(prev, msg));
    },
    [applyRemoteHostDecision, deps],
  );

  useLayoutEffect(() => {
    applyRemoteHostDecisionRef.current = applyRemoteHostDecision;
    askHostConfirmRef.current = (req) => {
      const conversationId = req.conversation_id || deps.conversationRef.current?.id || "";
      return new Promise<boolean>((resolve) => {
        // Optimistic Always-allow skip (client cache / server list). exec_policy=ask forces a card.
        const family = toolFamilyForHostOp(req.op, req.path || "");
        const uid = deps.userId || "";
        if (
          deps.hostExecPolicy !== "ask" &&
          (isToolFamilyAlwaysAllowed(uid, family) ||
            deps.toolAllowEntries.some((e) => e.family === family))
        ) {
          resolve(true);
          return;
        }
        hostConfirmResolvers.current.set(req.req_id, resolve);
        if (!conversationId) return;
        const raw = req.content || "";
        let preview = raw.length > 180 ? `${raw.slice(0, 180)}…` : raw;
        if (req.op === "shell" && req.dest === "terminal" && !preview) {
          preview = "会打开终端窗口，你可以在里面输入密码或继续操作";
        }
        const review = classifyHostExecReview(req.op, req.path || "", req.dest || "");
        void createHostConfirm(conversationId, {
          req_id: req.req_id,
          op: req.op,
          path: req.path || "",
          dest: req.dest || "",
          preview,
          reason: review.reason,
          review_tier: review.tier,
        })
          .then((msg) => acceptServerMessage(msg))
          .catch(() => {
            acceptServerMessage({
              id: `local-${req.req_id}`,
              role: "host_confirm",
              conversation_id: conversationId,
              created_at: new Date().toISOString(),
              content: JSON.stringify({
                req_id: req.req_id,
                op: req.op,
                path: req.path || "",
                dest: req.dest || "",
                preview,
                reason: review.reason,
                review_tier: review.tier,
                status: "pending",
              }),
            });
          });
      });
    };
  });

  const settleHostConfirm = useCallback(
    (message: Message, decision: ApprovalDecision) => {
      const parsed = parseHostConfirm(message.content);
      if (!parsed?.req_id || parsed.status === "allowed" || parsed.status === "denied") return;
      const ok = decision !== "deny";
      const status = ok ? "allowed" : "denied";
      const family = toolFamilyForHostOp(parsed.op, parsed.path);
      const tool = toolLabelForHostOp(parsed.op, parsed.path);
      const scope = { tool, tool_group: family };
      const content = JSON.stringify({ ...parsed, status, decision });
      const convId = message.conversation_id || deps.conversationRef.current?.id || "";
      const runRequestId = (message as Message & { request_id?: string }).request_id || "";

      if (decision === "always_allow") {
        const uid = deps.userId || "";
        deps.setToolAllowEntries(grantToolFamilyAlwaysAllow(uid, family, tool));
        toast.message(ALWAYS_ALLOW_TOAST, { duration: 4000 });
      }

      if (convId) {
        deps.patchConvMessages(convId, (prev) =>
          prev.map((m) => (m.id === message.id ? { ...m, content } : m)),
        );
        if (!message.id.startsWith("local-")) {
          void decideHostConfirm(convId, message.id, status, {
            decision,
            scope,
            reason: parsed.reason || "",
          })
            .then((saved: Message) => acceptServerMessage(saved))
            .catch(() => {});
        }
        // Host-confirm for email_send parks on Go's confirm gate, not LangGraph
        // interrupt(). Calling /approve here with Command(resume=...) when the
        // durable thread is mid-tool (or idle) raises EmptyInputError and can
        // spur a re-plan → second gmail_send → second card.
        if (runRequestId && parsed.op !== "email_send") {
          void approveConversation(convId, {
            request_id: runRequestId,
            decision,
            approve: ok,
            reason: parsed.reason || "",
            scope,
          }).catch(() => {});
        }
      }
      releaseHostConfirm(parsed.req_id, ok);
    },
    [acceptServerMessage, deps, releaseHostConfirm],
  );

  const settleMicroAppGrant = useCallback(
    (message: Message, choice: MicroAppGrantCardDecision) => {
      const parsed = parseMicroAppGrantPrompt(message.content);
      if (!parsed?.req_id || parsed.status === "allowed" || parsed.status === "denied") return;
      const status = choice.decision === "deny" ? "denied" : "allowed";
      const content = JSON.stringify({
        ...parsed,
        status,
        decision: choice.decision,
        allowlist_entry: choice.allowlistEntry || "",
        auto_retry: choice.decision !== "deny",
      });
      const convId = message.conversation_id || deps.conversationRef.current?.id || "";
      if (!convId) return;

      deps.patchConvMessages(convId, (prev) =>
        prev.map((m) => (m.id === message.id ? { ...m, content } : m)),
      );

      if (message.id.startsWith("local-")) {
        if (choice.decision === "deny") {
          toast.message("已拒绝微应用授权", { duration: 2500 });
        }
        return;
      }

      void (async () => {
        try {
          const saved = await decideMicroAppGrantPrompt(convId, message.id, {
            decision: choice.decision,
            allowlist_entry: choice.allowlistEntry,
            machine_id: parsed.machine_id || "",
          });
          acceptServerMessage(saved);
          if (choice.decision === "deny") {
            toast.message("已拒绝微应用授权", { duration: 2500 });
            return;
          }
          toast.message("已授权，正在自动继续…", { duration: 2500 });
          const retryText = microAppGrantRetryUserText({
            ...parsed,
            status: "allowed",
            decision: choice.decision,
          });
          deps.retryAfterMicroAppGrantRef?.current?.({
            conversationId: convId,
            microAppId: parsed.micro_app_id,
            tool: parsed.tool || "",
            command: parsed.command || "",
            pendingArgs: parsed.pending_args || "",
            text: retryText,
          });
        } catch {
          toast.message("授权写入失败", { duration: 3000 });
        }
      })();
    },
    [acceptServerMessage, deps],
  );

  return {
    hostConfirmResolvers,
    askHostConfirmRef,
    applyRemoteHostDecisionRef,
    acceptServerMessage,
    settleHostConfirm,
    settleMicroAppGrant,
  };
}
