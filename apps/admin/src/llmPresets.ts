import type { ComponentType } from "react";
import {
  DeepSeek,
  Doubao,
  Gemini,
  Groq,
  Minimax,
  Mistral,
  Moonshot,
  Ollama,
  OpenAI,
  OpenRouter,
  Qwen,
  SiliconCloud,
  Stepfun,
  XAI,
  Zhipu,
} from "@lobehub/icons";

export type LLMPresetGroup = "cn" | "intl" | "local";

export type LLMPresetIcon = ComponentType<{ size?: number }> & {
  Avatar: ComponentType<{ size?: number; shape?: "circle" | "square" }>;
};

export interface LLMPreset {
  id: string;
  name: string;
  group: LLMPresetGroup;
  baseURL: string;
  /** Extra Base URLs that still highlight this preset (e.g. regional aliases). */
  matchURLs?: string[];
  docsURL: string;
  suggestedName: string;
  suggestedModel: string;
  Icon: LLMPresetIcon;
}

export const LLM_PRESET_GROUPS: { id: LLMPresetGroup; label: string }[] = [
  { id: "cn", label: "国内" },
  { id: "intl", label: "国际" },
  { id: "local", label: "本地" },
];

/** OpenAI-compatible endpoints only ({baseURL}/chat/completions). */
export const LLM_PRESETS: LLMPreset[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    group: "cn",
    baseURL: "https://api.deepseek.com/v1",
    matchURLs: ["https://api.deepseek.com"],
    docsURL: "https://api-docs.deepseek.com/",
    suggestedName: "DeepSeek",
    suggestedModel: "deepseek-chat",
    Icon: DeepSeek as LLMPresetIcon,
  },
  {
    id: "qwen",
    name: "通义千问",
    group: "cn",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    docsURL: "https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope",
    suggestedName: "通义千问",
    suggestedModel: "qwen-plus",
    Icon: Qwen as LLMPresetIcon,
  },
  {
    id: "kimi",
    name: "Kimi",
    group: "cn",
    baseURL: "https://api.moonshot.cn/v1",
    docsURL: "https://platform.kimi.com/docs/api/overview",
    suggestedName: "Kimi",
    suggestedModel: "kimi-k2.5",
    Icon: Moonshot as LLMPresetIcon,
  },
  {
    id: "zhipu",
    name: "智谱",
    group: "cn",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    docsURL: "https://docs.bigmodel.cn/cn/guide/develop/openai/introduction",
    suggestedName: "智谱",
    suggestedModel: "glm-4-flash",
    Icon: Zhipu as LLMPresetIcon,
  },
  {
    id: "doubao",
    name: "豆包",
    group: "cn",
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    docsURL: "https://www.volcengine.com/docs/82379/1263279",
    suggestedName: "豆包",
    suggestedModel: "doubao-seed-1-6-250615",
    Icon: Doubao as LLMPresetIcon,
  },
  {
    id: "stepfun",
    name: "阶跃星辰",
    group: "cn",
    baseURL: "https://api.stepfun.com/v1",
    docsURL: "https://platform.stepfun.com/docs/zh/guides/developer/openai",
    suggestedName: "阶跃星辰",
    suggestedModel: "step-1-8k",
    Icon: Stepfun as LLMPresetIcon,
  },
  {
    id: "minimax",
    name: "MiniMax",
    group: "cn",
    baseURL: "https://api.minimax.cn/v1",
    matchURLs: ["https://api.minimaxi.com/v1"],
    docsURL: "https://platform.minimaxi.com/docs/guides/text-generation",
    suggestedName: "MiniMax",
    suggestedModel: "MiniMax-M2.5",
    Icon: Minimax as LLMPresetIcon,
  },
  {
    id: "siliconflow",
    name: "硅基流动",
    group: "cn",
    baseURL: "https://api.siliconflow.cn/v1",
    docsURL: "https://docs.siliconflow.cn/cn/userguide/quickstart",
    suggestedName: "硅基流动",
    suggestedModel: "deepseek-ai/DeepSeek-V3",
    Icon: SiliconCloud as LLMPresetIcon,
  },
  {
    id: "openai",
    name: "OpenAI",
    group: "intl",
    baseURL: "https://api.openai.com/v1",
    docsURL: "https://platform.openai.com/docs/api-reference/chat",
    suggestedName: "OpenAI",
    suggestedModel: "gpt-4o-mini",
    Icon: OpenAI as LLMPresetIcon,
  },
  {
    id: "gemini",
    name: "Gemini",
    group: "intl",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    docsURL: "https://ai.google.dev/gemini-api/docs/openai",
    suggestedName: "Gemini",
    suggestedModel: "gemini-2.0-flash",
    Icon: Gemini as LLMPresetIcon,
  },
  {
    id: "groq",
    name: "Groq",
    group: "intl",
    baseURL: "https://api.groq.com/openai/v1",
    docsURL: "https://console.groq.com/docs/openai",
    suggestedName: "Groq",
    suggestedModel: "llama-3.3-70b-versatile",
    Icon: Groq as LLMPresetIcon,
  },
  {
    id: "mistral",
    name: "Mistral",
    group: "intl",
    baseURL: "https://api.mistral.ai/v1",
    docsURL: "https://docs.mistral.ai/api/",
    suggestedName: "Mistral",
    suggestedModel: "mistral-small-latest",
    Icon: Mistral as LLMPresetIcon,
  },
  {
    id: "xai",
    name: "xAI",
    group: "intl",
    baseURL: "https://api.x.ai/v1",
    docsURL: "https://docs.x.ai/docs/api-reference",
    suggestedName: "xAI",
    suggestedModel: "grok-2-latest",
    Icon: XAI as LLMPresetIcon,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    group: "intl",
    baseURL: "https://openrouter.ai/api/v1",
    docsURL: "https://openrouter.ai/docs/quickstart",
    suggestedName: "OpenRouter",
    suggestedModel: "openai/gpt-4o-mini",
    Icon: OpenRouter as LLMPresetIcon,
  },
  {
    id: "ollama",
    name: "Ollama",
    group: "local",
    baseURL: "http://127.0.0.1:11434/v1",
    docsURL: "https://github.com/ollama/ollama/blob/main/docs/openai.md",
    suggestedName: "Ollama",
    suggestedModel: "llama3.2",
    Icon: Ollama as LLMPresetIcon,
  },
];

export function normalizeLLMBaseURL(url: string): string {
  return String(url || "")
    .trim()
    .replace(/\/+$/, "");
}

export function findPresetByBaseURL(url: string): LLMPreset | null {
  const normalized = normalizeLLMBaseURL(url);
  if (!normalized) return null;
  return (
    LLM_PRESETS.find((p) => {
      if (normalizeLLMBaseURL(p.baseURL) === normalized) return true;
      return (p.matchURLs || []).some((alias) => normalizeLLMBaseURL(alias) === normalized);
    }) ?? null
  );
}

export function findPresetById(id: string | null | undefined): LLMPreset | null {
  if (!id) return null;
  return LLM_PRESETS.find((p) => p.id === id) ?? null;
}
