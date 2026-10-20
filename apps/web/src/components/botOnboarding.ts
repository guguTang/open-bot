import { API_BASE, authHeaders } from "../api/client";

export type OnboardingOption = {
  /** Focus key sent to POST /v1/agents/{id}/onboarding */
  id: string;
  /** Positional badge / shortcut letter (A, B, C…) */
  letter: string;
  title: string;
  desc: string;
  /** Sent as the first user message */
  prompt: string;
};

/** @deprecated Use option.id; kept as alias of id for older call sites. */
export type OnboardingOptionLegacyLetter = OnboardingOption;

const FALLBACK_SEED: Omit<OnboardingOption, "letter">[] = [
  {
    id: "A",
    title: "日常事务与提醒",
    desc: "日程、待办、定时提醒",
    prompt:
      "我想先用你来做：日常事务与提醒（日程、待办、定时提醒）。请按这个方向协助我，之后我还可以随时改。",
  },
  {
    id: "B",
    title: "查资料与总结",
    desc: "搜索、阅读、整理要点",
    prompt:
      "我想先用你来做：查资料与总结（搜索、阅读、整理要点）。请按这个方向协助我，之后我还可以随时改。",
  },
  {
    id: "C",
    title: "写东西与改稿",
    desc: "邮件、文档、文案",
    prompt:
      "我想先用你来做：写东西与改稿（邮件、文档、文案）。请按这个方向协助我，之后我还可以随时改。",
  },
  {
    id: "D",
    title: "写代码与排障",
    desc: "改项目、查 bug、联调",
    prompt:
      "我想先用你来做：写代码与排障（改项目、查 bug、联调）。请按这个方向协助我，之后我还可以随时改。",
  },
  {
    id: "E",
    title: "先随便聊聊",
    desc: "",
    prompt: "先随便聊聊就好，不用急着定方向。",
  },
  {
    id: "F",
    title: "微应用与本机工具",
    desc: "微应用、本机能力、授权闸门",
    prompt:
      "我想先用你来做：微应用与本机工具（搭建/配置微应用、本机能力与授权）。请按这个方向协助我，之后我还可以随时改。",
  },
];

function withLetters(items: Omit<OnboardingOption, "letter">[]): OnboardingOption[] {
  return items.map((item, i) => ({
    ...item,
    letter: String.fromCharCode(65 + (i % 26)),
  }));
}

/** Offline / unreachable API fallback (seed A–F). */
export const ONBOARDING_OPTIONS: OnboardingOption[] = withLetters(FALLBACK_SEED);

export const ONBOARDING_CUSTOM_FALLBACK_ID = "E";

export const ONBOARDING_WELCOME = [
  "你好。我是你的新助手。有什么想让我帮你的，随时说就行。",
  "你现在最想让我先帮你做什么？",
] as const;

type PresetsResponse = {
  presets?: Array<{
    id: string;
    title: string;
    card_desc?: string;
    user_prompt?: string;
    sort_order?: number;
  }>;
  custom_fallback_id?: string;
};

let cached: { options: OnboardingOption[]; customFallbackId: string; at: number } | null = null;
const CACHE_MS = 60_000;

export function getOnboardingCustomFallbackId(): string {
  return cached?.customFallbackId || ONBOARDING_CUSTOM_FALLBACK_ID;
}

export function getCachedOnboardingOptions(): OnboardingOption[] {
  return cached?.options?.length ? cached.options : ONBOARDING_OPTIONS;
}

/** Fetch enabled presets from API; falls back to seed A–F on failure/empty. */
export async function loadOnboardingOptions(force = false): Promise<{
  options: OnboardingOption[];
  customFallbackId: string;
}> {
  if (!force && cached && Date.now() - cached.at < CACHE_MS && cached.options.length) {
    return { options: cached.options, customFallbackId: cached.customFallbackId };
  }
  try {
    const res = await fetch(`${API_BASE}/v1/onboarding/presets`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as PresetsResponse;
    const raw = Array.isArray(data.presets) ? data.presets : [];
    if (raw.length === 0) throw new Error("empty presets");
    const sorted = [...raw].sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id.localeCompare(b.id),
    );
    const options = withLetters(
      sorted.map((p) => ({
        id: p.id,
        title: p.title || p.id,
        desc: p.card_desc || "",
        prompt: p.user_prompt || `我想先用你来做：${p.title || p.id}。`,
      })),
    );
    const customFallbackId =
      (typeof data.custom_fallback_id === "string" && data.custom_fallback_id.trim()) ||
      ONBOARDING_CUSTOM_FALLBACK_ID;
    cached = { options, customFallbackId, at: Date.now() };
    return { options, customFallbackId };
  } catch {
    const options = ONBOARDING_OPTIONS;
    const customFallbackId = ONBOARDING_CUSTOM_FALLBACK_ID;
    cached = { options, customFallbackId, at: Date.now() };
    return { options, customFallbackId };
  }
}

const DISMISS_KEY = "openbot_onboarding_dismissed";

function readDismissed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function onboardingStorageKey(conversationId: string | null | undefined, agentId: string): string {
  return conversationId ? `conv:${conversationId}` : `pending:${agentId}`;
}

export function isOnboardingDismissed(key: string): boolean {
  return Boolean(readDismissed()[key]);
}

export function setOnboardingDismissed(key: string): void {
  const map = readDismissed();
  map[key] = true;
  localStorage.setItem(DISMISS_KEY, JSON.stringify(map));
}

/** Clear dismiss so the job questionnaire can show again for this bot/conversation. */
export function clearOnboardingDismissed(key: string): void {
  const map = readDismissed();
  if (!map[key]) return;
  delete map[key];
  localStorage.setItem(DISMISS_KEY, JSON.stringify(map));
}
