import { SubmitEvent } from "react";
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
import { ONBOARDING_OPTIONS, type OnboardingOption } from "./botOnboarding";

type Props = {
  disabled?: boolean;
  onSelectOption: (option: OnboardingOption) => void;
  onCustomSubmit: (text: string) => void;
  onDismiss: () => void;
};

const FOCUS_FIELD = "focus";

const questionnaireItems = [
  {
    name: FOCUS_FIELD,
    required: true,
    choices: ONBOARDING_OPTIONS.map((opt) => ({ value: opt.letter })),
  },
] as const;

export function BotOnboardingCard({
  disabled,
  onSelectOption,
  onCustomSubmit,
  onDismiss,
}: Props) {
  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled) return;

    const raw = new FormData(event.currentTarget).get(FOCUS_FIELD);
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) return;

    const option = ONBOARDING_OPTIONS.find((opt) => opt.letter === value);
    if (option) {
      onSelectOption(option);
      return;
    }
    onCustomSubmit(value);
  };

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
                选一个就行，之后还能随时改。也可按 A–E 快捷键选择。
              </QuestionnaireDescription>
              <QuestionnaireChoices>
                {ONBOARDING_OPTIONS.map((opt) => (
                  <QuestionnaireChoice key={opt.letter} value={opt.letter} disabled={disabled}>
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
