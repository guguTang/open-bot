import { useCallback, useLayoutEffect, useRef } from "react";
import { toast } from "sonner";
import {
  approveConversation,
  createHostConfirm,
  decideHostConfirm,
  mergeIncomingMessage,
  type ApprovalDecision,
  type Message,
} from "../../api";
import { parseHostConfirm } from "../../components/hostConfirmModel";
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

export function useHostConfirmChat(deps: {
  conversationRef: React.RefObject<Conversation | null>;
  patchConvMessages: PatchConvMessages;
  userId: string | undefined;
  hostExecPolicy: MachineExecPolicy;
  toolAllowEntries: ToolAllowEntry[];
  setToolAllowEntries: Dispatch<SetStateAction<ToolAllowEntry[]>>;
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
            .then((saved) => acceptServerMessage(saved))
            .catch(() => {});
        }
        if (runRequestId) {
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

  return {
    hostConfirmResolvers,
    askHostConfirmRef,
    applyRemoteHostDecisionRef,
    acceptServerMessage,
    settleHostConfirm,
  };
}
