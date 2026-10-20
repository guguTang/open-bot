/**
 * OpenUI 组件契约（web 与 mobile-rn 共用，两份文件必须逐字节一致）。
 *
 * - 本文件只描述「模型能用哪些组件、参数是什么」，不含任何平台渲染代码。
 * - web：`apps/web/src/openui/library.tsx`；RN：`apps/mobile-rn/src/openui/library.tsx`
 *   各自把同名组件映射到 DOM / 原生 View。
 * - 助手侧提示词由 `apps/web/scripts/gen-openui-prompt.ts` 从这里生成，
 *   写入 `skills/generative-ui/SKILL.md`。改这里之后要重跑生成脚本。
 * - 一致性由 `apps/web/src/openui/spec.parity.test.ts` 守护。
 *
 * 兼容规则（已存消息是按位置解析的）：只在末尾加参数，不要重排/删除参数。
 */

import {
  action,
  createLibrary,
  defineComponent,
  type ComponentRenderer,
} from "@openuidev/react-lang";
import { z } from "zod";

/** 消息正文里承载 OpenUI 程序的围栏语言名。`openui-lang` 是 OpenUI inline mode 的默认名。 */
export const OPENUI_FENCE_LANGS = ["openui-lang", "openui"] as const;

export function isOpenUiLang(lang: string | null | undefined): boolean {
  if (!lang) return false;
  return (OPENUI_FENCE_LANGS as readonly string[]).includes(String(lang).toLowerCase());
}

export const textProps = z.object({
  content: z.string().describe("要显示的文字（纯文本，不要写 Markdown）"),
  variant: z
    .enum(["body", "heading", "caption"])
    .optional()
    .describe("heading=小标题；caption=次要说明；默认 body"),
});

export const buttonProps = z.object({
  label: z.string().describe("按钮文字，简短"),
  action: action()
    .optional()
    .describe('点击动作；通常是 @ToAssistant("用户说的话") 或 @OpenUrl(url)'),
  variant: z.enum(["primary", "secondary"]).optional(),
});

export const tableProps = z.object({
  headers: z.array(z.string()).describe("表头"),
  rows: z.array(z.array(z.string())).describe("每行的单元格文本，列数与表头一致"),
});

export const listProps = z.object({
  items: z.array(z.string()).describe("列表项文本"),
  ordered: z.boolean().optional(),
});

export const fieldProps = z.object({
  label: z.string().describe("字段标签"),
  value: z.string().describe('字段值（已格式化好的文本，例如 "¥1,200"）'),
});

export const inputProps = z.object({
  name: z.string().describe("字段名（英文标识），提交时作为 key"),
  label: z.string(),
  placeholder: z.string().optional(),
});

export const selectProps = z.object({
  name: z.string().describe("字段名（英文标识），提交时作为 key"),
  label: z.string(),
  options: z.array(z.string()).describe("可选项文本"),
});

export type TextProps = z.infer<typeof textProps>;
export type ButtonProps = z.infer<typeof buttonProps>;
export type TableProps = z.infer<typeof tableProps>;
export type ListProps = z.infer<typeof listProps>;
export type FieldProps = z.infer<typeof fieldProps>;
export type InputProps = z.infer<typeof inputProps>;
export type SelectProps = z.infer<typeof selectProps>;
// 容器类组件的 props 含子节点，类型由 createOpenBotLibrary 内部推导。
export type ContainerRenderer = ComponentRenderer<any>;

/** 每个平台提供同名组件的渲染器。 */
export type OpenBotRenderers = {
  Card: ContainerRenderer;
  Text: ComponentRenderer<TextProps>;
  Button: ComponentRenderer<ButtonProps>;
  Buttons: ContainerRenderer;
  Table: ComponentRenderer<TableProps>;
  List: ComponentRenderer<ListProps>;
  Field: ComponentRenderer<FieldProps>;
  Form: ContainerRenderer;
  Input: ComponentRenderer<InputProps>;
  Select: ComponentRenderer<SelectProps>;
};

/** 不渲染任何东西的渲染器表：用于生成提示词 / 测试解析。 */
export const NULL_RENDERERS: OpenBotRenderers = {
  Card: () => null,
  Text: () => null,
  Button: () => null,
  Buttons: () => null,
  Table: () => null,
  List: () => null,
  Field: () => null,
  Form: () => null,
  Input: () => null,
  Select: () => null,
};

export function createOpenBotLibrary(r: OpenBotRenderers) {
  const Text = defineComponent({
    name: "Text",
    description: '一段文字。标题用 variant="heading"。',
    props: textProps,
    component: r.Text,
  });
  const Button = defineComponent({
    name: "Button",
    description: "可点击按钮。点击后用 @ToAssistant 把用户的选择发回对话。",
    props: buttonProps,
    component: r.Button,
  });
  const Buttons = defineComponent({
    name: "Buttons",
    description: "一行按钮（选项 / 快捷回复 / 下一步）。",
    props: z.object({ buttons: z.array(Button.ref) }),
    component: r.Buttons,
  });
  const Table = defineComponent({
    name: "Table",
    description: "简单表格：对比、清单、多列数据。",
    props: tableProps,
    component: r.Table,
  });
  const List = defineComponent({
    name: "List",
    description: "要点列表；ordered=true 为有序步骤。",
    props: listProps,
    component: r.List,
  });
  const Field = defineComponent({
    name: "Field",
    description: "一行「标签: 值」，用于摘要、订单、指标。",
    props: fieldProps,
    component: r.Field,
  });
  const Input = defineComponent({
    name: "Input",
    description: "单行文本输入，只能放在 Form 里。",
    props: inputProps,
    component: r.Input,
  });
  const Select = defineComponent({
    name: "Select",
    description: "单选下拉，只能放在 Form 里。",
    props: selectProps,
    component: r.Select,
  });
  const Form = defineComponent({
    name: "Form",
    description: "表单：收集用户输入。提交按钮的 @ToAssistant 会把所有字段值一起发回对话。",
    props: z.object({
      name: z.string().describe("表单标识（英文）"),
      fields: z.array(z.union([Input.ref, Select.ref])),
      submit: Button.ref,
    }),
    component: r.Form,
  });
  const Card = defineComponent({
    name: "Card",
    description: "顶层卡片容器，竖向排列子组件。每段 UI 的 root 必须是 Card。",
    props: z.object({
      children: z.array(z.union([Text.ref, Buttons.ref, Table.ref, List.ref, Field.ref, Form.ref])),
      title: z.string().optional(),
    }),
    component: r.Card,
  });

  return createLibrary({
    id: "open-bot",
    root: "Card",
    components: [Card, Text, Button, Buttons, Table, List, Field, Form, Input, Select],
  });
}

export type OpenBotLibrary = ReturnType<typeof createOpenBotLibrary>;

/**
 * 生成提示词时用的选项。
 *
 * 不用 OpenUI 自带的 inlineMode：它的文案面向「整页 dashboard 增量编辑」，
 * 会让模型只输出改动语句；我们的场景是聊天回复里嵌一段独立 UI，所以自己写规则。
 */
export const OPENUI_PROMPT_OPTIONS = {
  preamble:
    "Your replies are Markdown. When structured or interactive UI clearly helps, you may embed ONE OpenUI Lang program in a fenced code block tagged openui-lang. The client renders it as native UI on web and mobile; text outside the fence stays Markdown.",
  additionalRules: [
    "Only use OpenUI when interactive or structured UI clearly helps (choices, forms, comparisons, summaries). Otherwise reply in normal Markdown.",
    "Put OpenUI Lang inside a ```openui-lang fence. Keep explanations as Markdown outside the fence.",
    "At most one openui-lang fence per reply.",
    "The fence body is OpenUI Lang statements (`name = Component(...)`, first line `root = Card(...)`), NEVER JSON, YAML or HTML. Only the components listed above exist.",
    "If the UI already contains a table or summary, do not repeat the same table in Markdown outside the fence.",
    'Buttons that continue the conversation must use @ToAssistant("<what the user is saying>"), written in the user\'s language.',
  ],
  examples: [
    `root = Card([intro, tbl, pick], "耳机对比")
intro = Text("三款旗舰降噪耳机核心参数：")
tbl = Table(["型号", "价格", "续航"], [["A", "¥1,899", "6 小时"], ["B", "¥2,999", "30 小时"]])
pick = Buttons([p1, p2])
p1 = Button("选 A", @ToAssistant("我选 A"), "primary")
p2 = Button("选 B", @ToAssistant("我选 B"))`,
    `root = Card([q, opts], "选择套餐")
q = Text("你更看重哪一点？")
opts = Buttons([b1, b2])
b1 = Button("价格优先", @ToAssistant("我更看重价格"), "primary")
b2 = Button("性能优先", @ToAssistant("我更看重性能"))`,
    `root = Card([f], "预约信息")
f = Form("booking", [name, slot], submit)
name = Input("name", "姓名")
slot = Select("slot", "时段", ["上午", "下午"])
submit = Button("提交", @ToAssistant("提交预约信息"), "primary")`,
  ],
} as const;
