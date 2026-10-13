import { ArrowRight } from "lucide-react";
import { FormEvent, useState } from "react";
import { cn } from "@/lib/utils";
import { ONBOARDING_OPTIONS, type OnboardingOption } from "./botOnboarding";

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
    <div className="mx-auto my-2 mb-5 box-border w-full max-w-140 px-3">
      <div
        className="relative rounded-lg border border-(--border) bg-(--bg-soft) px-4.5 pt-4.5 pb-3.5 shadow-(--shadow-sm)"

        role="region"
        aria-label="助手引导"
      >
        <button
          type="button"
          className="absolute top-2.5 right-2.5 size-7 cursor-pointer rounded-full border-none bg-transparent text-xl leading-none text-(--muted) hover:bg-(--bg-hover) hover:text-(--text) disabled:cursor-not-allowed disabled:opacity-50"

          aria-label="关闭引导"
          title="关闭"
          disabled={disabled}
          onClick={onDismiss}
        >
          ×
        </button>
        <div className="mb-3 pr-7">
          <h3 className="mb-1.5 text-[15.5px] leading-[1.35] font-[650] text-(--text)">
            你现在最想让我先帮你做什么？
          </h3>
          <p className="m-0 text-[13px] leading-[1.4] text-(--muted)">选一个就行，之后还能随时改。</p>
        </div>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {ONBOARDING_OPTIONS.map((opt) => (
            <li key={opt.letter}>
            <button
              type="button"
              className="flex w-full cursor-pointer items-start gap-3 rounded-md border border-transparent bg-transparent px-2.5 py-2.5 text-left text-inherit hover:border-(--border) hover:bg-(--bg-elevated) disabled:cursor-not-allowed disabled:opacity-55"
              disabled={disabled}
              onClick={() => onSelectOption(opt)}
            >
              <span
                className="mt-px inline-flex size-6.5 shrink-0 items-center justify-center rounded-full border border-(--border) bg-(--bg-elevated) text-[12.5px] font-bold text-(--text)"
                aria-hidden
              >
                {opt.letter}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-[650] text-(--text)">{opt.title}</span>
                {opt.desc ? (
                  <span className="text-[12.5px] leading-[1.35] text-(--muted)">{opt.desc}</span>
                ) : null}
              </span>
            </button>
            </li>
          ))}
        </ul>
        <form
          className="mt-3 flex items-center gap-2 rounded-full border border-(--border) bg-(--bg-elevated) py-1.5 pr-2 pl-3.5"
          onSubmit={submitCustom}
        >
          <input
            className="min-w-0 flex-1 border-none bg-transparent text-[13.5px] text-(--text) outline-none placeholder:text-(--muted)"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="输入你自己的回答"
            aria-label="输入你自己的回答"
            disabled={disabled}
          />
          <button
            type="submit"
            className={cn(
              "inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-(--text) text-white hover:opacity-90",
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
