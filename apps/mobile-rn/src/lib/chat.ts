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
 * 「关过」按会话（或还没建会话时的助手）维度记在 SecureStore。
 */
export async function shouldShowOnboarding(
  conversationId: string | null,
  agentId: string,
  messageCount: number
): Promise<boolean> {
  if (messageCount > 0) return false;
  return !(await isOnboardingDismissed(onboardingStorageKey(conversationId, agentId)));
}

/** 待上传附件的本地校验聚合：任一不合格就不允许发送。 */
export function firstAttachmentIssue(files: PickedFile[]): string | null {
  for (const f of files) {
    const issue = validateAttachment(f);
    if (issue) return issue;
  }
  return null;
}
