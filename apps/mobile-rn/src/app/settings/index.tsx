import { ListGroup, Separator, Typography } from "heroui-native";
import { useRouter } from "expo-router";
import type { JSX } from "react";
import { Pressable, View } from "react-native";

import { Icon } from "@/components/Icon";
import { ScreenHeader } from "@/components/ScreenScaffold";
import { useSession } from "@/providers/session";
import { detectClientContext } from "@/api/client";

/**
 * 设置分区。分区名与顺序对齐 Web 端的 `MobileSettingsHub`（移动端设置中枢），
 * 这样从桌面切到手机上找设置时不用重新扫一遍。
 *
 * 分组沿用中枢的四段：通用 / Bot / 通用能力 / 环境与数据。
 * 「优先电脑」在中枢里归到 Bot 段 —— 它决定这个 Bot 的活派给哪台电脑，
 * 和「运行环境」（沙箱）是两回事，混在一起会让人以为在配同一件东西。
 *
 * 图标统一走 muted 色调：这一屏行数多，每行都上彩色图标会变成一排彩色方块，
 * 反而看不出哪个该点。
 */
type Section = {
  id: string;
  title: string;
  desc: string;
  icon: Parameters<typeof Icon>[0]["name"];
};

const GROUPS: { label: string; items: Section[] }[] = [
  {
    label: "Bot",
    items: [
      {
        id: "bot",
        title: "Bot 设置",
        desc: "岗位描述与本 Bot 能力",
        icon: "hardware-chip-outline",
      },
      { id: "machines", title: "优先电脑", desc: "把活派给哪台电脑执行", icon: "laptop-outline" },
    ],
  },
  {
    label: "能力",
    items: [
      { id: "llm", title: "模型", desc: "LLM 连接与默认模型", icon: "server-outline" },
      { id: "skills", title: "扩展能力包", desc: "启用与上传自定义技能", icon: "flash-outline" },
      { id: "mcp", title: "插件", desc: "外部工具服务（MCP）", icon: "extension-puzzle-outline" },
    ],
  },
  {
    label: "环境与数据",
    items: [
      { id: "sandbox", title: "运行环境", desc: "沙箱状态与桌面", icon: "cube-outline" },
      { id: "routines", title: "例行任务", desc: "定时与事件自动执行", icon: "timer-outline" },
      {
        id: "compact",
        title: "数据与压缩",
        desc: "上下文压缩策略（只读）",
        icon: "layers-outline",
      },
      { id: "secrets", title: "密钥", desc: "助手可用的凭据与授权请求", icon: "key-outline" },
    ],
  },
];

export default function SettingsScreen(): JSX.Element {
  const router = useRouter();
  const { user, signOut } = useSession();

  const client = detectClientContext();
  const generalItems = [
    { key: "account", label: "账号", value: user?.username ?? "—", href: "/settings/general" },
    {
      key: "review",
      label: "审核与时区",
      value: "自动审核 · 报告时区",
      href: "/settings/general",
    },
    { key: "client", label: "客户端", value: `${client.platform} · ${client.app}` },
    { key: "version", label: "版本", value: client.app_version },
  ];

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="设置" />

      <View className="flex-1 gap-7 px-5 pt-6 pb-8">
        <View className="gap-2.5">
          <Typography.Paragraph color="muted" className="px-1 text-sm">
            通用
          </Typography.Paragraph>
          <ListGroup>
            {generalItems.map((item, index) => (
              <View key={item.key}>
                {index > 0 ? <Separator className="mx-4" /> : null}
                <ListGroup.Item
                  {...(item.href
                    ? {
                        accessibilityRole: "button" as const,
                        accessibilityLabel: item.label,
                        onPress: () => router.push(item.href as never),
                      }
                    : {})}
                >
                  <ListGroup.ItemContent>
                    <ListGroup.ItemTitle>{item.label}</ListGroup.ItemTitle>
                  </ListGroup.ItemContent>
                  <ListGroup.ItemSuffix>
                    <Typography.Paragraph color="muted" className="mr-1 text-sm">
                      {item.value}
                    </Typography.Paragraph>
                  </ListGroup.ItemSuffix>
                </ListGroup.Item>
              </View>
            ))}
          </ListGroup>
        </View>

        {GROUPS.map((group) => (
          <View key={group.label} className="gap-2.5">
            <Typography.Paragraph color="muted" className="px-1 text-sm">
              {group.label}
            </Typography.Paragraph>
            <ListGroup>
              {group.items.map((section, index) => (
                <View key={section.id}>
                  {index > 0 ? <Separator className="mx-4" /> : null}
                  {/* ItemSuffix 不传 children 时自带 chevron-right，
                      原来手搓的「›」文本字符既不是图标也没有语义色 */}
                  <ListGroup.Item
                    accessibilityRole="button"
                    accessibilityLabel={section.title}
                    onPress={() => router.push(`/settings/${section.id}` as never)}
                  >
                    <ListGroup.ItemPrefix>
                      <Icon name={section.icon} size={20} tone="muted" />
                    </ListGroup.ItemPrefix>
                    <ListGroup.ItemContent>
                      <ListGroup.ItemTitle>{section.title}</ListGroup.ItemTitle>
                      <ListGroup.ItemDescription>{section.desc}</ListGroup.ItemDescription>
                    </ListGroup.ItemContent>
                    <ListGroup.ItemSuffix />
                  </ListGroup.Item>
                </View>
              ))}
            </ListGroup>
          </View>
        ))}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="退出登录"
          onPress={() => void signOut()}
          className="items-center rounded-3xl bg-surface py-4"
        >
          <Typography.Paragraph className="text-danger">退出登录</Typography.Paragraph>
        </Pressable>
      </View>
    </View>
  );
}
