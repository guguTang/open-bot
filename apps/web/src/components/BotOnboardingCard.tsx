import { ArrowRight } from "lucide-react";
import { FormEvent, useState } from "react";
import { cn } from "@/lib/utils";

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
    <div className="mx-auto my-2 mb-5 box-border w-full max-w-[560px] px-3">
      <div
        className="relative rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-soft)] px-[18px] pt-[18px] pb-3.5 shadow-[var(--shadow-sm)]"
        role="region"
        aria-label="助手引导"
      >
        <button
          type="button"
          className="absolute top-2.5 right-2.5 size-7 cursor-pointer rounded-full border-none bg-transparent text-xl leading-none text-[var(--muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="关闭引导"
          title="关闭"
          disabled={disabled}
          onClick={onDismiss}
        >
          ×
        </button>
        <div className="mb-3 pr-7">
          <h3 className="mb-1.5 text-[15.5px] leading-[1.35] font-[650] text-[var(--text)]">
            你现在最想让我先帮你做什么？
          </h3>
          <p className="m-0 text-[13px] leading-[1.4] text-[var(--muted)]">选一个就行，之后还能随时改。</p>
        </div>
        <div className="flex flex-col gap-1.5" role="list">
          {ONBOARDING_OPTIONS.map((opt) => (
            <button
              key={opt.letter}
              type="button"
              className="flex w-full cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border border-transparent bg-transparent px-2.5 py-2.5 text-left text-inherit hover:border-[var(--border)] hover:bg-[var(--bg-elevated)] disabled:cursor-not-allowed disabled:opacity-55"
              role="listitem"
              disabled={disabled}
              onClick={() => onSelectOption(opt)}
            >
              <span
                className="mt-px inline-flex size-[26px] shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-elevated)] text-[12.5px] font-bold text-[var(--text)]"
                aria-hidden
              >
                {opt.letter}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-[650] text-[var(--text)]">{opt.title}</span>
                {opt.desc ? (
                  <span className="text-[12.5px] leading-[1.35] text-[var(--muted)]">{opt.desc}</span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
        <form
          className="mt-3 flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-elevated)] py-1.5 pr-2 pl-3.5"
          onSubmit={submitCustom}
        >
          <input
            className="min-w-0 flex-1 border-none bg-transparent text-[13.5px] text-[var(--text)] outline-none placeholder:text-[var(--muted)]"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="输入你自己的回答"
            aria-label="输入你自己的回答"
            disabled={disabled}
          />
          <button
            type="submit"
            className={cn(
              "inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-[var(--text)] text-white hover:opacity-90",
              "disabled:cursor-not-allowed disabled:opacity-35",
            )}
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
