/**
 * OpenUI 组件库的 React Native 渲染器。
 *
 * 选型：直接用 `@openuidev/react-lang` 的 react-native 入口（包内自带 `index.native`，
 * 无 DOM 依赖），同名组件映射到 RN View + heroui-native。不走 WebView：
 * 原生渲染能跟随主题、无白屏、手势/键盘行为一致，且与 web 共用同一份契约（./spec.ts）。
 */
import {
  FormNameContext,
  useFormName,
  useIsStreaming,
  useStateField,
  useTriggerAction,
} from "@openuidev/react-lang";
import { Button, Chip, Input, TextField, Typography } from "heroui-native";
import { ScrollView, View } from "react-native";

import { createOpenBotLibrary, type OpenBotRenderers } from "./spec";

const renderers: OpenBotRenderers = {
  Card: ({ props, renderNode }) => (
    <View className="gap-2 rounded-2xl border border-border bg-surface-secondary p-3">
      {props.title ? (
        <Typography.Paragraph className="text-[15px] font-semibold text-foreground">
          {props.title}
        </Typography.Paragraph>
      ) : null}
      <View className="gap-2">{renderNode(props.children)}</View>
    </View>
  ),
  Text: ({ props }) => {
    const v = props.variant ?? "body";
    const cls =
      v === "heading"
        ? "text-[15px] font-semibold text-foreground"
        : v === "caption"
          ? "text-[12px] text-muted"
          : "text-[14.5px] leading-[1.45] text-foreground";
    return <Typography.Paragraph className={cls}>{props.content}</Typography.Paragraph>;
  },
  Button: function OuiButton({ props }) {
    const trigger = useTriggerAction();
    const streaming = useIsStreaming();
    const formName = useFormName();
    return (
      <Button
        size="sm"
        variant={props.variant === "primary" ? "primary" : "secondary"}
        isDisabled={streaming}
        onPress={() => void trigger(props.label, formName, props.action as never)}
      >
        <Button.Label>{props.label}</Button.Label>
      </Button>
    );
  },
  Buttons: ({ props, renderNode }) => (
    <View className="flex-row flex-wrap gap-2">{renderNode(props.buttons)}</View>
  ),
  Table: ({ props }) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View className="rounded-lg border border-border">
        {[props.headers, ...props.rows].map((row, r) => (
          <View key={r} className={`flex-row ${r === 0 ? "bg-surface-tertiary" : ""}`}>
            {row.map((c, i) => (
              <View key={i} className="min-w-[88px] border-b border-r border-border px-2 py-1.5">
                <Typography.Paragraph
                  className={`text-[13px] text-foreground ${r === 0 ? "font-semibold" : ""}`}
                >
                  {c}
                </Typography.Paragraph>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  ),
  List: ({ props }) => (
    <View className="gap-1">
      {props.items.map((it, i) => (
        <View key={i} className="flex-row gap-2">
          <Typography.Paragraph className="text-[14px] text-muted">
            {props.ordered ? `${i + 1}.` : "•"}
          </Typography.Paragraph>
          <Typography.Paragraph className="flex-1 text-[14px] text-foreground">
            {it}
          </Typography.Paragraph>
        </View>
      ))}
    </View>
  ),
  Field: ({ props }) => (
    <View className="flex-row justify-between gap-3">
      <Typography.Paragraph className="text-[13px] text-muted">{props.label}</Typography.Paragraph>
      <Typography.Paragraph className="flex-shrink text-right text-[13px] font-medium text-foreground">
        {props.value}
      </Typography.Paragraph>
    </View>
  ),
  Form: ({ props, renderNode }) => (
    <FormNameContext.Provider value={props.name}>
      <View className="gap-3">
        {renderNode(props.fields)}
        <View className="flex-row flex-wrap gap-2">{renderNode(props.submit)}</View>
      </View>
    </FormNameContext.Provider>
  ),
  Input: function OuiInput({ props }) {
    const field = useStateField<string>(props.name);
    const streaming = useIsStreaming();
    return (
      <View className="gap-1">
        <Typography.Paragraph className="text-[13px] text-muted">
          {props.label}
        </Typography.Paragraph>
        <TextField isDisabled={streaming}>
          <Input
            value={(field.value as string | undefined) ?? ""}
            onChangeText={(t: string) => field.setValue(t)}
            placeholder={props.placeholder}
            accessibilityLabel={props.label}
          />
        </TextField>
      </View>
    );
  },
  // 原生下拉在 iOS/Android 体验差异大，选项用 Chip 平铺（选项一般很少）
  Select: function OuiSelect({ props }) {
    const field = useStateField<string>(props.name);
    const streaming = useIsStreaming();
    const cur = (field.value as string | undefined) ?? "";
    return (
      <View className="gap-1">
        <Typography.Paragraph className="text-[13px] text-muted">
          {props.label}
        </Typography.Paragraph>
        <View className="flex-row flex-wrap gap-2">
          {props.options.map((o) => (
            <Chip
              key={o}
              size="sm"
              variant={cur === o ? "primary" : "secondary"}
              color={cur === o ? "accent" : "default"}
              onPress={streaming ? undefined : () => field.setValue(o)}
            >
              <Chip.Label>{o}</Chip.Label>
            </Chip>
          ))}
        </View>
      </View>
    );
  },
};

export const openBotLibrary = createOpenBotLibrary(renderers);
