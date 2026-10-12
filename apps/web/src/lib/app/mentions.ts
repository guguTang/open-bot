import type { Agent } from "../../api";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchAgentByMentionToken(tok: string, list: Agent[]): Agent | undefined {
  const lower = tok.toLowerCase();
  const exactId = list.find((a) => a.id.toLowerCase() === lower);
  if (exactId) return exactId;
  const exactName = list.find((a) => a.name.toLowerCase() === lower);
  if (exactName) return exactName;
  const idPrefix = list.find((a) => a.id.toLowerCase().startsWith(lower));
  if (idPrefix) return idPrefix;
  const namePrefix = list.find((a) => a.name.toLowerCase().startsWith(lower));
  if (namePrefix) return namePrefix;
  return list.find((a) => a.name.toLowerCase().includes(lower));
}

/** First @Bot in text (skips @everyone / @routine: / @mcp:). */
export function firstMentionedAgent(content: string, list: Agent[]): Agent | undefined {
  const re = /@([^\s@]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const tok = m[1].replace(/[.,!?;:，。！？；：]+$/u, "");
    const lower = tok.toLowerCase();
    if (lower === "everyone" || lower === "all") continue;
    if (lower.startsWith("routine:") || lower.startsWith("mcp:")) continue;
    const hit = matchAgentByMentionToken(tok, list);
    if (hit) return hit;
  }
  return undefined;
}

export function stripLeadingAtAgent(content: string, agent: Agent): string {
  for (const p of [agent.name, agent.id]) {
    if (!p) continue;
    const re = new RegExp(`^@${escapeRegExp(p)}\\s*`, "i");
    if (re.test(content)) {
      const next = content.replace(re, "").trim();
      return next || content;
    }
  }
  return content;
}
