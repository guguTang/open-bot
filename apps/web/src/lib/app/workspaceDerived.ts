import type { Agent, Channel, Conversation } from "../../api";

export function agentNameMap(agents: readonly Agent[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const agent of agents) names.set(agent.id, agent.name);
  return names;
}

export function resolveActiveAgent(agentId: string, agents: readonly Agent[]): Agent | undefined {
  return agentId ? agents.find((agent) => agent.id === agentId) : undefined;
}

export function resolveActiveChannel(
  conversation: Conversation | null,
  channels: readonly Channel[],
): Channel | null {
  if (!conversation?.channel_id) return null;
  return channels.find((channel) => channel.id === conversation.channel_id) ?? null;
}

export function channelMemberProfiles(
  channel: Channel,
  agents: readonly Agent[],
  names: Map<string, string>,
) {
  return (channel.members || []).map((id) => {
    const agent = agents.find((item) => item.id === id);
    const profile = channel.member_profiles?.find((item) => item.agent_id === id);
    return {
      agent_id: id,
      name: agent?.name || profile?.name || names.get(id) || id,
      avatar_shape: agent?.avatar_shape || profile?.avatar_shape,
      avatar_color: agent?.avatar_color || profile?.avatar_color,
      online: agent?.online ?? profile?.online,
    };
  });
}
