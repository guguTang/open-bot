import { API_BASE, authHeaders, readError, triggerBrowserDownload } from "./client";

export type Agent = {
  id: string;
  name: string;
  description: string;
  system_prompt?: string;
  is_builtin?: boolean;
  computer_mode?: "team" | "private" | string;
  user_id?: string;
  /** Whitelisted v2: cloud|bean|drop|soft-hex|petal|puff (legacy ids mapped client-side). */
  avatar_shape?: string;
  /** Whitelisted 12-color palette (#rrggbb). */
  avatar_color?: string;
  /** 优先电脑 (user_machines.id). Empty = session host, else any online. */
  machine_id?: string;
  /** Bound machine exec channel Connected + last_seen within BOT_ONLINE_THRESHOLD_SEC (server-computed). */
  online?: boolean;
  created_at?: string;
  updated_at?: string;
  /** Primary thread id (assistant-level). */
  conversation_id?: string;
  /** Last user/assistant message snippet for sidebar. */
  last_message?: string;
  conversation_updated_at?: string;
  task_active?: boolean;
};

export type AgentInput = {
  name: string;
  description: string;
  system_prompt: string;
  computer_mode?: "team" | "private" | string;
  avatar_shape?: string;
  avatar_color?: string;
  /** Bind to a registered host machine; "" clears on PATCH. */
  machine_id?: string;
};

/** PATCH /v1/agents/{id}: omitted / empty fields keep current values. */
export type AgentPatch = Partial<AgentInput>;

/** bot_presence frame (conversation SSE + chat WS). */
export type BotPresenceStatus = "idle" | "thinking" | "working" | "awaiting_approval" | "error";
export type BotPresenceEvent = {
  type?: "bot_presence" | string;
  conversation_id: string;
  agent_id: string;
  status: BotPresenceStatus | string;
  updated_at?: string;
};

/**
 * Bot online (green dot): session host → 优先电脑 → 任一在线; Connected ∧ heartbeat ≤90s.
 * ListAgents uses 优先电脑→任一在线; conversation participants use session host when set.
 * Client consumes `online` + `bot_online`; never polls machines. Independent of bot_presence.
 */

export const BOT_ONLINE_THRESHOLD_SEC = 90;
export type BotOnlineEvent = {
  type?: "bot_online" | string;
  /** Present on conversation SSE; session-flip pushes update the active chat green dot. */
  conversation_id?: string;
  agent_id: string;
  online: boolean;
  updated_at?: string;
};

export type AgentSkill = {
  name: string;
  description: string;
  /** Effective for this Bot (account-level ∩ Bot allowlist). */
  enabled: boolean;
  custom?: boolean;
  /** Account-level toggle from settings「技能」. */
  account_enabled?: boolean;
  /** Curated role=always_on discovery entry (find-skills). */
  always_on?: boolean;
  /** API refuses disable; UI should lock the toggle. */
  disable_blocked?: boolean;
};

export type SkillSource = "builtin" | "custom";

export type SkillBotRef = { id: string; name: string };

export type Skill = {
  name: string;
  description: string;
  enabled: boolean;
  custom?: boolean;
  file_count?: number;
  files?: { path: string; content?: string }[];
  /** 内置 / 自建 (GET /v1/skills). */
  source?: SkillSource;
  read_only?: boolean;
  updated_at?: string;
  /** Bots of this account whose effective skill set includes this skill. */
  bot_count?: number;
  bots?: SkillBotRef[];
};

/** Editor payload: GET/PUT /v1/skills/{name}/package. */
export type SkillPackage = {
  name: string;
  description: string;
  enabled: boolean;
  custom: boolean;
  source: SkillSource;
  read_only: boolean;
  updated_at?: string;
  file_count: number;
  files: SkillFile[];
};

export type SkillFile = {
  path: string;
  content: string;
};

export async function listAgents(): Promise<Agent[]> {
  const res = await fetch(`${API_BASE}/v1/agents`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.agents ?? [];
}

export async function createAgent(body: AgentInput): Promise<Agent> {
  const res = await fetch(`${API_BASE}/v1/agents`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function updateAgent(id: string, body: AgentPatch): Promise<Agent> {
  const res = await fetch(`${API_BASE}/v1/agents/${id}`, {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function deleteAgent(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/agents/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 204) throw new Error(await readError(res));
}

export type CloneAgentInput = {
  name?: string;
  description?: string;
  system_prompt?: string;
  system_prompt_append?: string;
  computer_mode?: "team" | "private";
  /** Copy bot-scope memories (default true in UI / clone_agent tool). */
  copy_memory?: boolean;
  /** Copy routines bound to this bot — created paused (default false). */
  copy_routines?: boolean;
  enable_skills?: string[];
  disable_skills?: string[];
  /** Task handed to the copy right after cloning (runs in its own thread). */
  follow_up?: string;
};

export type CloneAgentResult = {
  ok: boolean;
  agent: Agent;
  source_agent_id: string;
  conversation_id?: string;
  skills_copied: number;
  skills_inherit_account: boolean;
  memories_copied: number;
  routines_copied: number;
  routine_names?: string[];
  enabled_skills?: string[];
  follow_up_status?: string;
  warning?: string;
  skill_errors?: string[];
};

/** Duplicate a bot (persona + skills; memory/routines opt-in). */
export async function cloneAgent(id: string, body: CloneAgentInput = {}): Promise<CloneAgentResult> {
  const res = await fetch(`${API_BASE}/v1/agents/${encodeURIComponent(id)}/clone`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function listAgentSkills(agentId: string): Promise<AgentSkill[]> {
  const res = await fetch(`${API_BASE}/v1/agents/${encodeURIComponent(agentId)}/skills`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.skills ?? [];
}

export async function setAgentSkill(
  agentId: string,
  name: string,
  enabled: boolean,
): Promise<AgentSkill> {
  const res = await fetch(
    `${API_BASE}/v1/agents/${encodeURIComponent(agentId)}/skills/${encodeURIComponent(name)}`,
    {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ enabled }),
    },
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function replaceAgentSkills(
  agentId: string,
  enabled: string[],
): Promise<AgentSkill[]> {
  const res = await fetch(`${API_BASE}/v1/agents/${encodeURIComponent(agentId)}/skills`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.skills ?? [];
}

export async function applyAgentOnboarding(
  agentId: string,
  body: {
    focus?: string;
    description?: string;
    system_prompt?: string;
    skills?: string[] | null;
  },
): Promise<Agent> {
  const res = await fetch(`${API_BASE}/v1/agents/${encodeURIComponent(agentId)}/onboarding`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.agent as Agent;
}

/** Persist assistant reply as a custom skill package (SKILL.md). Off by default in UI. */
export async function saveSkillFromText(opts: {
  name: string;
  description?: string;
  body_markdown: string;
}): Promise<Skill> {
  return uploadSkill({
    name: opts.name,
    description: opts.description || "",
    body_markdown: opts.body_markdown,
  });
}

export async function listSkills(): Promise<Skill[]> {
  const res = await fetch(`${API_BASE}/v1/skills`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.skills ?? [];
}

export async function setSkillEnabled(name: string, enabled: boolean): Promise<Skill> {
  const res = await fetch(`${API_BASE}/v1/skills/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}


export async function uploadSkill(body: {
  name: string;
  description: string;
  body_markdown: string;
}): Promise<Skill> {
  const res = await fetch(`${API_BASE}/v1/skills/upload`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function uploadSkillPackage(opts: {
  name?: string;
  description?: string;
  files?: SkillFile[];
  archive?: File;
  folderFiles?: File[];
}): Promise<Skill> {
  const { name, description, files, archive, folderFiles } = opts;
  if (archive || (folderFiles && folderFiles.length > 0)) {
    const form = new FormData();
    if (name?.trim()) form.append("name", name.trim());
    if (description?.trim()) form.append("description", description.trim());
    if (archive) {
      form.append("archive", archive, archive.name || "skill.zip");
    } else if (folderFiles) {
      for (const f of folderFiles) {
        const rel =
          (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
        form.append("files", f, rel);
      }
    }
    const res = await fetch(`${API_BASE}/v1/skills/upload`, {
      method: "POST",
      headers: authHeaders(),
      body: form,
    });
    if (!res.ok) throw new Error(await readError(res));
    return res.json();
  }
  const res = await fetch(`${API_BASE}/v1/skills/upload`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      name,
      description,
      files,
    }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function getSkillPackage(name: string): Promise<SkillPackage> {
  const res = await fetch(`${API_BASE}/v1/skills/${encodeURIComponent(name)}/package`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as SkillPackage;
  return { ...data, files: data.files ?? [] };
}

/** Create an empty custom skill (server writes a SKILL.md template) or one from files. 409 if name taken. */
export async function createSkill(body: {
  name: string;
  description?: string;
  files?: SkillFile[];
}): Promise<SkillPackage> {
  const res = await fetch(`${API_BASE}/v1/skills`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as SkillPackage;
  return { ...data, files: data.files ?? [] };
}

/** Whole-package write-back for a custom skill (editor save). */
export async function saveSkillPackage(name: string, files: SkillFile[]): Promise<SkillPackage> {
  const res = await fetch(`${API_BASE}/v1/skills/${encodeURIComponent(name)}/package`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ files }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as SkillPackage;
  return { ...data, files: data.files ?? [] };
}

export async function exportSkillZip(name: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/skills/${encodeURIComponent(name)}/export`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  triggerBrowserDownload(await res.blob(), `${name}.zip`);
}

export async function deleteSkill(name: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/skills/${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 204) throw new Error(await readError(res));
}

export type RoutineRun = {
  id: string;
  routine_id: string;
  status: string;
  result_text: string;
  created_at: string;
};

export type RoutineTrigger = {
  source: string;
  type: string;
  keywords?: string[];
  actions?: string[];
  repo?: string;
};

export type Routine = {
  id: string;
  user_id: string;
  name: string;
  prompt: string;
  schedule_cron: string;
  enabled: boolean;
  agent_id: string;
  timezone?: string;
  conversation_id?: string;
  triggers_json?: string;
  triggers?: RoutineTrigger[];
  max_retries?: number;
  fail_count?: number;
  quiet_unchanged?: boolean;
  last_run_at?: string | null;
  next_run_at?: string | null;
  last_error?: string;
  created_at: string;
  updated_at: string;
  last_run?: RoutineRun | null;
};

export type RoutineInput = {
  name: string;
  prompt: string;
  schedule_cron: string;
  enabled?: boolean;
  agent_id?: string;
  timezone?: string;
  conversation_id?: string;
  triggers?: RoutineTrigger[];
  triggers_json?: string;
  max_retries?: number;
  quiet_unchanged?: boolean;
};

export type InboundHook = {
  id: string;
  user_id: string;
  provider: string;
  token: string;
  label: string;
  has_secret?: boolean;
  created_at: string;
  url_slack?: string;
  url_github?: string;
};

export async function listInboundHooks(): Promise<InboundHook[]> {
  const res = await fetch(`${API_BASE}/v1/inbound-hooks`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.hooks ?? [];
}

export async function createInboundHook(body: {
  provider: string;
  label?: string;
  secret?: string;
}): Promise<InboundHook & { hint?: string }> {
  const res = await fetch(`${API_BASE}/v1/inbound-hooks`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function deleteInboundHook(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/inbound-hooks/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
}

export async function listRoutines(): Promise<Routine[]> {
  const res = await fetch(`${API_BASE}/v1/routines`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.routines ?? [];
}

export async function createRoutine(body: RoutineInput): Promise<Routine> {
  const res = await fetch(`${API_BASE}/v1/routines`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function updateRoutine(
  id: string,
  body: Partial<RoutineInput>,
): Promise<Routine> {
  const res = await fetch(`${API_BASE}/v1/routines/${id}`, {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function deleteRoutine(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/routines/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
}

export async function runRoutine(
  id: string,
): Promise<{ routine: Routine; run: RoutineRun }> {
  const res = await fetch(`${API_BASE}/v1/routines/${id}/run`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export type BotSecretMeta = {
  id: string;
  user_id: string;
  agent_id: string;
  name: string;
  origin: string;
  auth_type: string;
  created_at: string;
  updated_at: string;
};

export type BotSecretRequest = {
  id: string;
  user_id: string;
  agent_id: string;
  conversation_id: string;
  name: string;
  origin: string;
  auth_type: string;
  reason: string;
  status: string;
  created_at: string;
};

export async function listBotSecrets(agentId?: string): Promise<BotSecretMeta[]> {
  const q = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : "";
  const res = await fetch(`${API_BASE}/v1/bot-secrets${q}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.secrets || [];
}

export async function createBotSecret(body: {
  name: string;
  value: string;
  origin?: string;
  auth_type?: string;
  agent_id?: string;
}): Promise<BotSecretMeta> {
  const res = await fetch(`${API_BASE}/v1/bot-secrets`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function deleteBotSecret(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/bot-secrets/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
}

export async function listBotSecretRequests(): Promise<BotSecretRequest[]> {
  const res = await fetch(`${API_BASE}/v1/bot-secret-requests`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.requests || [];
}

export async function resolveBotSecretRequest(
  id: string,
  body: { value?: string; name?: string; origin?: string; auth_type?: string; agent_id?: string; dismiss?: boolean },
): Promise<unknown> {
  const res = await fetch(`${API_BASE}/v1/bot-secret-requests/${encodeURIComponent(id)}/resolve`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}
