import { SubmitEvent, useEffect, useMemo, useState } from "react";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@/components/ui/questionnaire";
import {
  getCachedOnboardingOptions,
  loadOnboardingOptions,
  type OnboardingOption,
} from "./botOnboarding";

type Props = {
  disabled?: boolean;
  onSelectOption: (option: OnboardingOption) => void;
  onCustomSubmit: (text: string) => void;
  onDismiss: () => void;
};

const FOCUS_FIELD = "focus";

export function BotOnboardingCard({
  disabled,
  onSelectOption,
  onCustomSubmit,
  onDismiss,
}: Props) {
  const [options, setOptions] = useState<OnboardingOption[]>(() => getCachedOnboardingOptions());

  useEffect(() => {
    let cancelled = false;
    void loadOnboardingOptions().then((res) => {
      if (!cancelled && res.options.length) setOptions(res.options);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const questionnaireItems = useMemo(
    () => [
      {
        name: FOCUS_FIELD,
        required: true,
        choices: options.map((opt) => ({ value: opt.id })),
      },
    ],
    [options],
  );

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled) return;

    const raw = new FormData(event.currentTarget).get(FOCUS_FIELD);
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) return;

    const option = options.find((opt) => opt.id === value);
    if (option) {
      onSelectOption(option);
      return;
    }
    onCustomSubmit(value);
  };

  const shortcutHint =
    options.length > 0 && options.length <= 26
      ? `也可按 A–${String.fromCharCode(64 + options.length)} 快捷键选择。`
      : "也可按字母快捷键选择。";

  return (
    <div className="mx-auto my-2 mb-5 box-border w-full max-w-140 px-3">
      <Card
        size="sm"
        className="relative bg-card shadow-(--shadow-sm)"
        role="region"
        aria-label="助手引导"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2 z-10 size-7"
          aria-label="关闭引导"
          title="关闭"
          disabled={disabled}
          onClick={onDismiss}
        >
          <XIcon />
        </Button>
        <CardContent>
          <Questionnaire
            items={questionnaireItems}
            shortcuts="letters"
            onSubmit={handleSubmit}
            className={disabled ? "pointer-events-none opacity-55" : undefined}
          >
            <QuestionnaireItem name={FOCUS_FIELD} required>
              <QuestionnaireTitle className="pr-8">
                你现在最想让我先帮你做什么？
              </QuestionnaireTitle>
              <QuestionnaireDescription>
                选一个就行，之后还能随时改。{shortcutHint}
              </QuestionnaireDescription>
              <QuestionnaireChoices>
                {options.map((opt) => (
                  <QuestionnaireChoice key={opt.id} value={opt.id} disabled={disabled}>
                    <span className="font-medium">{opt.title}</span>
                    {opt.desc ? (
                      <QuestionnaireChoiceDescription>{opt.desc}</QuestionnaireChoiceDescription>
                    ) : null}
                  </QuestionnaireChoice>
                ))}
                <QuestionnaireInput
                  aria-label="输入你自己的回答"
                  placeholder="输入你自己的回答"
                  disabled={disabled}
                />
              </QuestionnaireChoices>
              <QuestionnaireError>请选择一个方向，或输入你自己的回答。</QuestionnaireError>
            </QuestionnaireItem>
            <QuestionnaireActions>
              <QuestionnaireSubmit disabled={disabled}>开始</QuestionnaireSubmit>
            </QuestionnaireActions>
          </Questionnaire>
        </CardContent>
      </Card>
    </div>
  );
}
