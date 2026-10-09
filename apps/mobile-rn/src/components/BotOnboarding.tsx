import { Button, Card, CloseButton, Input, Label, Typography } from "heroui-native";
import type { JSX } from "react";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { ONBOARDING_OPTIONS, ONBOARDING_WELCOME, type OnboardingOption } from "@/lib/onboarding";

type Props = {
  disabled?: boolean;
  onSelectOption: (option: OnboardingOption) => void;
  onCustomSubmit: (text: string) => void;
  onDismiss: () => void;
};

/**
 * 新助手首次对话的引导卡。
 *
 * 与 Web 端 `BotOnboardingCard.tsx` 内容一致，但布局改成移动端的横向卡片流：
 * Web 上是竖排列表 + 底部输入框，手机上改成横向滚动的选项，节省纵向空间。
 */
export function BotOnboarding({
  disabled,
  onSelectOption,
  onCustomSubmit,
  onDismiss,
}: Props): JSX.Element {
  const [custom, setCustom] = useState("");

  const submitCustom = (): void => {
    const text = custom.trim();
    if (!text || disabled) return;
    onCustomSubmit(text);
    setCustom("");
  };

  return (
    <Card>
      <Card.Body className="gap-5">
        <View className="flex-row items-start gap-3">
          <View className="flex-1 gap-1">
            <Typography.Heading type="h4">{ONBOARDING_WELCOME[1]}</Typography.Heading>
            <Typography.Paragraph color="muted" className="text-sm">
              {ONBOARDING_WELCOME[0]}
            </Typography.Paragraph>
          </View>
          <CloseButton isDisabled={disabled} onPress={onDismiss} accessibilityLabel="关闭引导" />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View className="flex-row gap-2 pr-2">
            {ONBOARDING_OPTIONS.map((opt) => (
              <Pressable
                key={opt.letter}
                disabled={disabled}
                onPress={() => onSelectOption(opt)}
                accessibilityRole="button"
                accessibilityLabel={opt.title}
                // rounded-xl 而不是 2xl：外层 Card 是 3xl，内层再用同级圆角
                // 会让这张卡看起来像又嵌了一层容器
                className="w-44 rounded-xl bg-surface-secondary px-3 py-3"
              >
                <View className="flex-row items-center gap-2">
                  <View className="size-5 items-center justify-center rounded-full bg-accent-soft">
                    <Typography.Paragraph className="text-[10px] text-accent-soft-foreground">
                      {opt.letter}
                    </Typography.Paragraph>
                  </View>
                  <Typography.Paragraph
                    className="flex-1 text-sm"
                    weight="medium"
                    numberOfLines={1}
                  >
                    {opt.title}
                  </Typography.Paragraph>
                </View>
                {opt.desc ? (
                  <Typography.Paragraph color="muted" className="mt-1.5 text-xs" numberOfLines={2}>
                    {opt.desc}
                  </Typography.Paragraph>
                ) : null}
              </Pressable>
            ))}
          </View>
        </ScrollView>

        <View className="flex-row items-end gap-2">
          <Label className="flex-1">
            <Input
              value={custom}
              onChangeText={setCustom}
              placeholder="输入你自己的回答"
              editable={!disabled}
              returnKeyType="go"
              onSubmitEditing={submitCustom}
            />
          </Label>
          <Button
            size="sm"
            isDisabled={disabled || !custom.trim()}
            onPress={submitCustom}
            accessibilityLabel="发送"
          >
            <Button.Label>发送</Button.Label>
          </Button>
        </View>
      </Card.Body>
    </Card>
  );
}
