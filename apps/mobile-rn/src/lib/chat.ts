import type { Agent } from "@/api/types";
import { validateAttachment, type PickedFile } from "@/lib/attachments";
import { isOnboardingDismissed, onboardingStorageKey } from "@/lib/onboarding";

/**
 * 从待发送的本地文件 + 候选助手列表里，解析出本轮该由谁应答。
 *
 * 群聊规则（对齐 Web 端 `@BotName` 解析）：
 * - 没 @ 任何人 → 交给服务端按频道成员默认处理
 * - @ 了 → 按 **@ 出现的顺序**依次应答，顺序要和展示顺序一致
 *
 * 助手名可能重名，所以先按名字匹配、再按 id 兜底（`@agent_id` 也允许）。
 */
export function resolveMentionedAgents(text: string, agents: Agent[]): Agent[] {
  const picked: Agent[] = [];
  const push = (agent: Agent | undefined): void => {
    if (agent && !picked.some((p) => p.id === agent.id)) picked.push(agent);
  };

  for (const m of text.matchAll(/@([^\s@]+)/g)) {
    const token = m[1];
    if (!token) continue;
    push(
      agents.find((a) => a.id.toLowerCase() === token.toLowerCase()) ??
        agents.find((a) => a.name.toLowerCase() === token.toLowerCase())
    );
  }
  return picked;
}

/** 群聊的 @ 候选 = 该频道的成员；单聊时为空。 */
export function mentionMembersOf(
  agents: Agent[],
  memberIds?: string[]
): { id: string; name: string; description?: string }[] {
  if (!memberIds?.length) return [];
  return memberIds
    .map((id) => agents.find((a) => a.id === id))
    .filter((a): a is Agent => Boolean(a))
    .map((a) => ({ id: a.id, name: a.name, description: a.description }));
}

/**
 * 判断是否展示首次引导卡。
 *
 * 条件与 Web 端一致：会话还没有任何消息，且用户没关过这个会话的引导。
 * 「关过」按会话（或还没建会话时的助手）维度记在 MMKV（见 lib/storage.ts）。
 */
export function shouldShowOnboarding(
  conversationId: string | null,
  agentId: string,
  messageCount: number
): boolean {
  if (messageCount > 0) return false;
  return !isOnboardingDismissed(onboardingStorageKey(conversationId, agentId));
}

/** 待上传附件的本地校验聚合：任一不合格就不允许发送。 */
export function firstAttachmentIssue(files: PickedFile[]): string | null {
  for (const f of files) {
    const issue = validateAttachment(f);
    if (issue) return issue;
  }
  return null;
}

/* ------------------------------------------------------------------ 图表分段 */

/**
 * 把一条助手回复切成「正文 / 图表」交替的片段，**保持原始顺序**。
 *
 * 为什么不能简单地「正文照渲染、图表堆到末尾」：助手经常先讲结论再给图，
 * 堆到末尾会让图和解释它的文字脱节。所以这里按围栏出现的位置切段，
 * 渲染时逐段输出，图的相对位置就和助手写出来的顺序一致。
 *
 * 规则对齐 Web 端 `lib/mermaidFence.ts`：
 * - 围栏标记是 3 个以上反引号或波浪号
 * - 语言标注只认 mermaid / html（大小写不敏感）
 * - 没闭合的围栏（流式输出中很常见）也切出来，但标记 pending —— 卡片据此
 *   提示「生成中」，而不是把半截源码当完整图表渲染
 */
export type ContentSegment =
  | { kind: "text"; text: string }
  | { kind: "diagram"; lang: "mermaid" | "html"; source: string; pending: boolean };

const DIAGRAM_LANGS = new Set(["mermaid", "html"]);

export function splitDiagrams(content: string): ContentSegment[] {
  const text = content || "";
  if (!text) return [];

  // 开围栏：行首 0-3 个空格 + 3+ 个 ` 或 ~ + 语言
  const open = /^ {0,3}(`{3,}|~{3,})[ \t]*(mermaid|html)[ \t]*$/gim;
  const segments: ContentSegment[] = [];
  let cursor = 0;
  let m: RegExpExecArray | null;

  while ((m = open.exec(text)) !== null) {
    const marker = m[1]!;
    const lang = m[2]!.toLowerCase() as "mermaid" | "html";
    if (!DIAGRAM_LANGS.has(lang)) continue;

    const bodyStart = m.index + m[0].length + 1; // +1 跳过围栏行尾换行
    const close = new RegExp(
      `^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}[ \\t]*$`,
      "m"
    );
    const rest = text.slice(bodyStart);
    const end = close.exec(rest);

    if (m.index > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, m.index) });
    }
    segments.push({
      kind: "diagram",
      lang,
      source: (end ? rest.slice(0, end.index) : rest).replace(/\n$/, ""),
      pending: !end,
    });

    cursor = end ? bodyStart + end.index + end[0].length : text.length;
    open.lastIndex = cursor;
  }

  if (cursor < text.length) {
    segments.push({ kind: "text", text: text.slice(cursor) });
  }
  return segments;
}
