/**
 * 编号「来源」脚注。对齐 Web `MessageSourcesFooter`。
 */

import { Typography } from "heroui-native";
import type { JSX } from "react";
import { Linking, Pressable, View } from "react-native";

import type { MessageSource } from "@/api/types";
import { normalizeMessageSources } from "@/lib/messageBody";

function displayLabel(src: MessageSource): string {
  if (src.title && src.title.trim()) return src.title.trim();
  try {
    const u = new URL(src.url);
    return u.hostname.replace(/^www\./, "") || src.url;
  } catch {
    return src.url;
  }
}

type Props = {
  sources?: MessageSource[] | null;
};

export function MessageSourcesFooter({ sources }: Props): JSX.Element | null {
  const list = normalizeMessageSources(sources);
  if (list.length === 0) return null;

  return (
    <View className="mt-1 gap-1.5 border-t border-default-soft-hover pt-2" accessibilityLabel="来源">
      <Typography.Paragraph color="muted" className="text-[10px]">
        来源
      </Typography.Paragraph>
      {list.map((s, i) => {
        const n = i + 1;
        return (
          <Pressable
            key={s.url}
            onPress={() => void Linking.openURL(s.url)}
            accessibilityRole="link"
            accessibilityLabel={`来源 ${n}：${displayLabel(s)}`}
            className="flex-row gap-1.5"
          >
            <Typography.Paragraph className="text-[11px] text-accent">[{n}]</Typography.Paragraph>
            <Typography.Paragraph className="flex-1 text-[11px] text-accent" numberOfLines={2}>
              {displayLabel(s)}
            </Typography.Paragraph>
          </Pressable>
        );
      })}
    </View>
  );
}
