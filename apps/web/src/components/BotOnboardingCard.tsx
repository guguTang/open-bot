import { ArrowRight } from "lucide-react";
import { FormEvent, useState } from "react";

export type OnboardingOption = {
  letter: string;
  title: string;
  desc: string;
  /** Sent as the first user message */
  prompt: string;
};

export const ONBOARDING_OPTIONS: OnboardingOption[] = [
  {
    letter: "A",
    title: "日常事务与提醒",
    desc: "日程、待办、定时提醒",
    prompt:
      "我想先用你来做：日常事务与提醒（日程、待办、定时提醒）。请按这个方向协助我，之后我还可以随时改。",
  },
  {
    letter: "B",
    title: "查资料与总结",
    desc: "搜索、阅读、整理要点",
    prompt:
      "我想先用你来做：查资料与总结（搜索、阅读、整理要点）。请按这个方向协助我，之后我还可以随时改。",
  },
  {
    letter: "C",
    title: "写东西与改稿",
    desc: "邮件、文档、文案",
    prompt:
      "我想先用你来做：写东西与改稿（邮件、文档、文案）。请按这个方向协助我，之后我还可以随时改。",
  },
  {
    letter: "D",
    title: "写代码与排障",
    desc: "改项目、查 bug、联调",
    prompt:
      "我想先用你来做：写代码与排障（改项目、查 bug、联调）。请按这个方向协助我，之后我还可以随时改。",
  },
  {
    letter: "E",
    title: "先随便聊聊",
    desc: "",
    prompt: "先随便聊聊就好，不用急着定方向。",
  },
];

export const ONBOARDING_WELCOME = [
  "你好。我是你的新助手。有什么想让我帮你的，随时说就行。",
  "你现在最想让我先帮你做什么？",
] as const;

type Props = {
  disabled?: boolean;
  onSelectOption: (option: OnboardingOption) => void;
  onCustomSubmit: (text: string) => void;
  onDismiss: () => void;
};

export function BotOnboardingCard({
  disabled,
  onSelectOption,
  onCustomSubmit,
  onDismiss,
}: Props) {
  const [custom, setCustom] = useState("");

  const submitCustom = (e: FormEvent) => {
    e.preventDefault();
    const text = custom.trim();
    if (!text || disabled) return;
    onCustomSubmit(text);
    setCustom("");
  };

  return (
    <div className="onboard-wrap">
      <div className="onboard-card" role="region" aria-label="助手引导">
        <button
          type="button"
          className="onboard-close"
          aria-label="关闭引导"
          title="关闭"
          disabled={disabled}
          onClick={onDismiss}
        >
          ×
        </button>
        <div className="onboard-head">
          <h3 className="onboard-title">你现在最想让我先帮你做什么？</h3>
          <p className="onboard-sub">选一个就行，之后还能随时改。</p>
        </div>
        <div className="onboard-options" role="list">
          {ONBOARDING_OPTIONS.map((opt) => (
            <button
              key={opt.letter}
              type="button"
              className="onboard-option"
              role="listitem"
              disabled={disabled}
              onClick={() => onSelectOption(opt)}
            >
              <span className="onboard-letter" aria-hidden>
                {opt.letter}
              </span>
              <span className="onboard-option-main">
                <span className="onboard-option-title">{opt.title}</span>
                {opt.desc ? <span className="onboard-option-desc">{opt.desc}</span> : null}
              </span>
            </button>
          ))}
        </div>
        <form className="onboard-custom" onSubmit={submitCustom}>
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="输入你自己的回答"
            aria-label="输入你自己的回答"
            disabled={disabled}
          />
          <button
            type="submit"
            className="onboard-custom-send"
            disabled={disabled || !custom.trim()}
            aria-label="发送"
            title="发送"
          >
            <ArrowRight size={16} strokeWidth={2.2} aria-hidden />
          </button>
        </form>
      </div>
    </div>
  );
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
