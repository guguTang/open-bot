import { ListGroup, Separator, Typography } from "heroui-native";
import { useRouter } from "expo-router";
import type { JSX } from "react";
import { View } from "react-native";

import { Icon } from "@/components/Icon";
import { ScreenHeader } from "@/components/ScreenScaffold";
import { useSession } from "@/providers/session";
import { detectClientContext } from "@/api/client";

/**
 * 设置分区。与 Web 端 `SettingsTab` 一一对应，顺序也保持一致，
 * 这样从桌面切到手机上找设置时不用重新扫一遍。
 *
 * 图标统一走 muted 色调：这一屏有 8 行，如果每行都上彩色图标，
 * 整屏会变成一排彩色方块，反而看不出哪个该点。
 */
const SECTIONS = [
  { id: "llm", title: "模型", desc: "LLM 连接与默认模型", icon: "hardware-chip-outline" },
  { id: "skills", title: "Skills", desc: "启用与上传自定义技能", icon: "flash-outline" },
  { id: "mcp", title: "MCP", desc: "外部工具服务", icon: "extension-puzzle-outline" },
  { id: "routines", title: "例行任务", desc: "定时自动执行", icon: "timer-outline" },
  { id: "compact", title: "压缩", desc: "上下文压缩策略（只读）", icon: "layers-outline" },
  { id: "sandbox", title: "运行环境", desc: "沙箱状态与桌面", icon: "cube-outline" },
  { id: "machines", title: "电脑", desc: "已登记的本机设备", icon: "laptop-outline" },
  { id: "secrets", title: "密钥", desc: "助手可用的凭据与授权请求", icon: "key-outline" },
] as const satisfies readonly {
  id: string;
  title: string;
  desc: string;
  icon: Parameters<typeof Icon>[0]["name"];
}[];

export default function SettingsScreen(): JSX.Element {
  const router = useRouter();
  const { user } = useSession();

  const client = detectClientContext();
  const generalItems = [
    { key: "account", label: "账号", value: user?.username ?? "—" },
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
                <ListGroup.Item>
                  <ListGroup.ItemContent>
                    <ListGroup.ItemTitle>{item.label}</ListGroup.ItemTitle>
                  </ListGroup.ItemContent>
                  <ListGroup.ItemSuffix>
                    <Typography.Paragraph color="muted" className="text-sm">
                      {item.value}
                    </Typography.Paragraph>
                  </ListGroup.ItemSuffix>
                </ListGroup.Item>
              </View>
            ))}
          </ListGroup>
        </View>

        <View className="gap-2.5">
          <Typography.Paragraph color="muted" className="px-1 text-sm">
            功能
          </Typography.Paragraph>
          <ListGroup>
            {SECTIONS.map((section, index) => (
              <View key={section.id}>
                {index > 0 ? <Separator className="mx-4" /> : null}
                {/* ItemSuffix 不传 children 时自带 chevron-right，
                    原来手搓的「›」文本字符既不是图标也没有语义色 */}
                <ListGroup.Item
                  accessibilityRole="button"
                  accessibilityLabel={section.title}
                  onPress={() => router.push(`/settings/${section.id}`)}
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
      </View>
    </View>
  );
}