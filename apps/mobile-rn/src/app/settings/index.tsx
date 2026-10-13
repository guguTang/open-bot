import { Button, ListGroup, Separator, Typography } from "heroui-native";
import { useRouter } from "expo-router";
import type { JSX } from "react";
import { ScrollView, View } from "react-native";

import { getApiBase } from "@/api/config";
import { useConfirm } from "@/components/ConfirmDialog";
import { Icon } from "@/components/Icon";
import { ScreenHeader } from "@/components/ScreenScaffold";
import { useSession } from "@/providers/session";
import { detectClientContext } from "@/api/client";
import { useCurrentBot } from "@/stores/client";

/**
 * 设置分区。分区名与顺序对齐 Web 端的 `MobileSettingsHub`。
 *
 * 分组：账号/服务器 → 插件 → Bot（当前 Bot / 形象与优先电脑 / 优先电脑 / 审核）
 * → 通用（模型 / 技能 / 沙箱 / 例行 / 压缩 / 连接应用 / 密钥 / 时区与自动审核）。
 */

type Section = {
  id: string;
  title: string;
  desc?: string;
  value?: string;
  icon?: Parameters<typeof Icon>[0]["name"];
  href: string;
};

function truncBase(url: string): string {
  try {
    const u = new URL(url);
    const host = u.host || url;
    return host.length > 22 ? `${host.slice(0, 20)}…` : host;
  } catch {
    return url.length > 22 ? `${url.slice(0, 20)}…` : url;
  }
}

export default function SettingsScreen(): JSX.Element {
  const router = useRouter();
  const { confirm } = useConfirm();
  const { user, signOut } = useSession();
  const currentBot = useCurrentBot((s) => s.bot);
  const client = detectClientContext();
  const apiLabel = truncBase(getApiBase());

  async function onSignOut(): Promise<void> {
    const ok = await confirm({
      title: "退出登录？",
      message: "退出后需要重新登录才能继续使用。",
      confirmLabel: "退出登录",
      cancelLabel: "取消",
      destructive: true,
    });
    if (!ok) return;
    await signOut();
  }

  const topItems: Section[] = [
    {
      id: "account",
      title: user?.username || "账户",
      desc: user?.email || "账号信息",
      icon: "person-outline",
      href: "/settings/general",
    },
    {
      id: "server",
      title: "服务器",
      desc: "API 地址 · 局域网 / 隧道配对",
      value: apiLabel,
      href: "/settings/server",
    },
  ];

  const pluginItems: Section[] = [
    {
      id: "mcp",
      title: "插件",
      desc: "扩展能力与连接",
      icon: "extension-puzzle-outline",
      href: "/settings/mcp",
    },
  ];

  const botItems: Section[] = [
    {
      id: "bot",
      title: "当前 Bot",
      desc: currentBot
        ? `人设 · 岗位 · 能力 · ${currentBot.name}`
        : "人设 · 岗位 · 能力",
      icon: "hardware-chip-outline",
      href: "/settings/bot",
    },
    {
      id: "machines",
      title: "优先电脑",
      desc: "把活派给哪台电脑执行",
      icon: "laptop-outline",
      href: "/settings/machines",
    },
    {
      id: "review",
      title: "审核",
      desc: "始终允许的操作",
      icon: "shield-checkmark-outline",
      href: "/settings/review",
    },
  ];

  const generalItems: Section[] = [
    { id: "llm", title: "模型", icon: "server-outline", href: "/settings/llm" },
    {
      id: "skills",
      title: "扩展能力包",
      icon: "flash-outline",
      href: "/settings/skills",
    },
    { id: "sandbox", title: "运行环境", icon: "cube-outline", href: "/settings/sandbox" },
    { id: "routines", title: "例行任务", icon: "timer-outline", href: "/settings/routines" },
    {
      id: "compact",
      title: "数据与压缩",
      desc: "上下文压缩策略（只读）",
      icon: "layers-outline",
      href: "/settings/compact",
    },
    {
      id: "integrations",
      title: "连接应用",
      desc: "Gmail 等邮箱授权",
      icon: "mail-outline",
      href: "/settings/integrations",
    },
    { id: "secrets", title: "密钥", icon: "key-outline", href: "/settings/secrets" },
    {
      id: "general",
      title: "时区与自动审核",
      desc: "自动审核规则与报告时区",
      icon: "time-outline",
      href: "/settings/general",
    },
  ];

  const groups: { label?: string; items: Section[] }[] = [
    { items: topItems },
    { items: pluginItems },
    { label: "Bot", items: botItems },
    { label: "通用", items: generalItems },
  ];

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="设置" />

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-7 px-5 pt-6 pb-safe-offset-8"
        keyboardShouldPersistTaps="handled"
      >
        <Typography.Paragraph color="muted" className="px-1 text-xs">
          {client.platform} · {client.app} · {client.app_version}
        </Typography.Paragraph>

        {groups.map((group, gi) => (
          <View key={group.label ?? `g-${gi}`} className="gap-2.5">
            {group.label ? (
              <Typography.Paragraph color="muted" className="px-1 text-sm">
                {group.label}
              </Typography.Paragraph>
            ) : null}
            <ListGroup>
              {group.items.map((section, index) => (
                <View key={section.id}>
                  {index > 0 ? <Separator className="mx-4" /> : null}
                  <ListGroup.Item
                    accessibilityRole="button"
                    accessibilityLabel={section.title}
                    onPress={() => router.push(section.href as never)}
                  >
                    {section.icon ? (
                      <ListGroup.ItemPrefix>
                        <Icon name={section.icon} size={20} tone="muted" />
                      </ListGroup.ItemPrefix>
                    ) : null}
                    <ListGroup.ItemContent>
                      <ListGroup.ItemTitle>{section.title}</ListGroup.ItemTitle>
                      {section.desc ? (
                        <ListGroup.ItemDescription>{section.desc}</ListGroup.ItemDescription>
                      ) : null}
                    </ListGroup.ItemContent>
                    {section.value ? (
                      <ListGroup.ItemSuffix>
                        <Typography.Paragraph color="muted" className="mr-1 text-sm">
                          {section.value}
                        </Typography.Paragraph>
                      </ListGroup.ItemSuffix>
                    ) : (
                      <ListGroup.ItemSuffix />
                    )}
                  </ListGroup.Item>
                </View>
              ))}
            </ListGroup>
          </View>
        ))}

        <Button
          size="sm"
          variant="danger-soft"
          className="w-full"
          accessibilityLabel="退出登录"
          onPress={() => void onSignOut()}
        >
          <Button.Label>退出登录</Button.Label>
        </Button>
      </ScrollView>
    </View>
  );
}
