import { request } from "@/api/http";
import { readJson, writeJson } from "@/lib/storage";

export type OnboardingOption = {
  /** Focus key for POST /v1/agents/{id}/onboarding */
  id: string;
  /** Positional badge letter A, B, C… */
  letter: string;
  title: string;
  desc: string;
  /** 作为第一条用户消息发送 */
  prompt: string;
};

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

export const ONBOARDING_OPTIONS: OnboardingOption[] = withLetters(FALLBACK_SEED);

export const ONBOARDING_CUSTOM_FALLBACK_ID = "E";

export const ONBOARDING_WELCOME = [
  "你好。我是你的新助手。有什么想让我帮你的，随时说就行。",
  "你现在最想让我先帮你做什么？",
] as const;

let cached: { options: OnboardingOption[]; customFallbackId: string; at: number } | null = null;
const CACHE_MS = 60_000;

export function getOnboardingCustomFallbackId(): string {
  return cached?.customFallbackId || ONBOARDING_CUSTOM_FALLBACK_ID;
}

export function getCachedOnboardingOptions(): OnboardingOption[] {
  return cached?.options?.length ? cached.options : ONBOARDING_OPTIONS;
}

export async function loadOnboardingOptions(force = false): Promise<{
  options: OnboardingOption[];
  customFallbackId: string;
}> {
  if (!force && cached && Date.now() - cached.at < CACHE_MS && cached.options.length) {
    return { options: cached.options, customFallbackId: cached.customFallbackId };
  }
  try {
    const data = await request<{
      presets?: Array<{
        id: string;
        title: string;
        card_desc?: string;
        user_prompt?: string;
        sort_order?: number;
      }>;
      custom_fallback_id?: string;
    }>("/v1/onboarding/presets");
    const raw = Array.isArray(data.presets) ? data.presets : [];
    if (raw.length === 0) throw new Error("empty");
    const sorted = [...raw].sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id.localeCompare(b.id)
    );
    const options = withLetters(
      sorted.map((p) => ({
        id: p.id,
        title: p.title || p.id,
        desc: p.card_desc || "",
        prompt: p.user_prompt || `我想先用你来做：${p.title || p.id}。`,
      }))
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

const DISMISS_KEY = "onboarding_dismissed";

/**
 * 引导卡的展示粒度：一个助手一个 key，会话建出来后改用会话 id。
 * 与 Web 端 `onboardingStorageKey` 语义一致。
 */
export function onboardingStorageKey(
  conversationId: string | null | undefined,
  agentId: string
): string {
  return conversationId ? `conv:${conversationId}` : `pending:${agentId}`;
}

export function isOnboardingDismissed(key: string): boolean {
  return Boolean(readJson<Record<string, boolean>>(DISMISS_KEY, {})[key]);
}

export function setOnboardingDismissed(key: string): void {
  const map = readJson<Record<string, boolean>>(DISMISS_KEY, {});
  map[key] = true;
  // 存不进去只是下次再看到一次引导卡，不阻断流程
  writeJson(DISMISS_KEY, map);
}
