import { useEffect, useMemo, useState } from "react";
import {
  listAgentSkills,
  type Agent,
  type Channel,
  type Conversation,
  type MCPServer,
  type Routine,
} from "../api";
import { type ComposerMentionItem, type ComposerSkillOption } from "../components/Composer";

export type UseAppComposerOptionsParams = {
  conversation: Conversation | null;
  channels: Channel[];
  agents: Agent[];
  authed: boolean;
  agentId: string;
  routines: Routine[];
  mcpServers: MCPServer[];
  /** Bumps when skill list changes so composer skills refresh. */
  skillsRevision: unknown;
};

export function useAppComposerOptions(p: UseAppComposerOptionsParams) {
  const { conversation, channels, agents, authed, agentId, routines, mcpServers, skillsRevision } = p;

  const agentNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents) m.set(a.id, a.name);
    return m;
  }, [agents]);

  const activeChannel = useMemo(() => {
    if (!conversation?.channel_id) return null;
    return channels.find((c) => c.id === conversation.channel_id) ?? null;
  }, [channels, conversation?.channel_id]);

  const groupMentionMembers = useMemo(() => {
    if (!activeChannel?.members?.length) return undefined;
    return activeChannel.members
      .map((id): Agent | undefined => {
        const a = agents.find((x) => x.id === id);
        if (!a) return undefined;
        const prof = activeChannel.member_profiles?.find((x) => x.agent_id === id);
        return {
          ...a,
          avatar_shape: a.avatar_shape || prof?.avatar_shape,
          avatar_color: a.avatar_color || prof?.avatar_color,
        };
      })
      .filter((a): a is Agent => Boolean(a));
  }, [activeChannel, agents]);

  const composerMentionItems = useMemo((): ComposerMentionItem[] => {
    const items: ComposerMentionItem[] = [];
    if (activeChannel?.members?.length) {
      items.push({
        kind: "everyone",
        insert: "everyone",
        label: "所有人",
        subtitle: "本回合全体成员回复",
      });
      for (const a of groupMentionMembers || []) {
        items.push({
          kind: "agent",
          insert: a.name,
          label: a.name,
          subtitle: a.description || a.id,
          agentId: a.id,
          avatarShape: a.avatar_shape,
          avatarColor: a.avatar_color,
        });
      }
    } else {
      for (const a of agents) {
        items.push({
          kind: "bot",
          insert: a.name,
          label: a.name,
          subtitle: a.description || a.id,
          agentId: a.id,
          avatarShape: a.avatar_shape,
          avatarColor: a.avatar_color,
        });
      }
    }
    for (const r of routines.filter((x) => x.enabled)) {
      items.push({
        kind: "routine",
        insert: `routine:${r.name}`,
        label: r.name,
        subtitle: `例行 · ${r.schedule_cron}`,
      });
    }
    for (const s of mcpServers.filter((x) => x.enabled)) {
      items.push({
        kind: "mcp",
        insert: `mcp:${s.name}`,
        label: s.name,
        subtitle: `插件 · ${s.transport}`,
      });
    }
    return items;
  }, [activeChannel, groupMentionMembers, agents, routines, mcpServers]);

  const [composerSkills, setComposerSkills] = useState<ComposerSkillOption[]>([]);

  useEffect(() => {
    if (!authed || !agentId) {
      setComposerSkills([]);
      return;
    }
    let cancelled = false;
    void listAgentSkills(agentId)
      .then((list) => {
        if (cancelled) return;
        setComposerSkills(
          list.filter((s) => s.enabled).map((s) => ({ name: s.name, description: s.description })),
        );
      })
      .catch(() => {
        if (!cancelled) setComposerSkills([]);
      });
    return () => {
      cancelled = true;
    };
  }, [authed, agentId, skillsRevision]);

  return {
    agentNameById,
    activeChannel,
    groupMentionMembers,
    composerMentionItems,
    composerSkills,
  };
}
