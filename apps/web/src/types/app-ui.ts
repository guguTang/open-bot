import type { AttachmentMeta, Message } from "../api";

export type UiMessage = Message & {
  streaming?: boolean;
  /** Legacy local stop stamp; unused — empty bubbles are dropped instead of 「（已停止）」. */
  stopped?: boolean;
  attachments?: AttachmentMeta[];
  agent_name?: string;
  reply_to_id?: string;
  thread_root_id?: string;
};

export type SettingsTab =
  | "general"
  | "bot"
  | "llm"
  | "skills"
  | "mcp"
  | "compact"
  | "routines"
  | "sandbox"
  | "machines"
  | "secrets"
  | "integrations"
  | "review";

export const SETTINGS_TITLE: Record<SettingsTab, string> = {
  general: "通用",
  bot: "当前 Bot",
  llm: "模型",
  skills: "扩展能力包",
  mcp: "插件 / MCP",
  compact: "数据与压缩",
  routines: "例行任务",
  sandbox: "运行环境",
  machines: "电脑",
  secrets: "密钥",
  integrations: "连接应用",
  review: "审核",
};

export type LastActiveSelection = { kind: "agent" | "channel"; id: string };

export type ConvRunState = {
  abort: AbortController;
  generation: number;
  assistantId: string | null;
  /** Parallel group: map agent_id → local streaming bubble id */
  assistantIdsByAgent?: Record<string, string>;
  runLabel: string;
  /** Last tool name from stream onStatus phase=tool; cleared on thinking/tool_done. §8 searching hint. */
  activeTool: string;
  /** Agent currently driving RunStatus / robot-heads face (from agent_start / tokens). */
  faceAgentId?: string;
  selectionKey: string;
};

export type ListFoldState = { assistantsCollapsed: boolean; groupsCollapsed: boolean };
