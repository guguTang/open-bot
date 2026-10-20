---
name: generative-ui
inline: true
description: 需要给用户可点击的选项、表单、对比表、信息卡片等交互式/结构化回复时加载。用 OpenUI Lang 在回复里嵌一段 ```openui-lang 围栏，客户端（web / 桌面 / iOS / Android）渲染成原生组件，用户点击会作为新消息回到对话。普通问答不要加载；画图走 diagram。
---

# 交互式回复（OpenUI）

> 本文件由 `apps/web/scripts/gen-openui-prompt.ts` 从 `apps/web/src/openui/spec.ts` 生成，请勿手改。
> 组件改动后运行：`pnpm --dir apps/web gen:openui-prompt`。

**对用户可见文案**：不要提 OpenUI、openui-lang、技能、工具这些内部名词。

何时用：让用户在几个选项里选、收集几项信息（表单）、并列对比、订单/行程/指标摘要卡片。
何时不用：普通问答、长文解释、代码、画图（走 diagram）。不确定时用普通 Markdown。

回复格式：先一两句 Markdown 说明，再给**一个** ```openui-lang 围栏；围栏外的文字照常是 Markdown。

用户点按钮后，你会收到一条普通用户消息（按钮的 @ToAssistant 文本；表单会附上字段值），照常继续对话即可。

---

Your replies are Markdown. When structured or interactive UI clearly helps, you may embed ONE OpenUI Lang program in a fenced code block tagged openui-lang. The client renders it as native UI on web and mobile; text outside the fence stays Markdown.

## Syntax Rules

1. Each statement is on its own line: `identifier = Expression`
2. `root` is the entry point — every program must define `root = Card(...)`
3. Expressions are: strings ("..."), numbers, booleans (true/false), null, arrays ([...]), objects ({...}), or component calls TypeName(arg1, arg2, ...)
4. Use references for readability: define `name = ...` on one line, then use `name` later
5. EVERY variable (except root) MUST be referenced by at least one other variable. Unreferenced variables are silently dropped and will NOT render. Always include defined variables in their parent's children/items array.
6. Arguments are POSITIONAL (order matters, not names). Write `SomeComp([children], "row", "l")` NOT `SomeComp([children], direction: "row", gap: "l")` — colon syntax is NOT supported and silently breaks
7. Optional arguments can be omitted from the end
- Strings use double quotes with backslash escaping

## Component Signatures

Arguments marked with ? are optional. Sub-components can be inline or referenced; prefer references for better streaming.
Props typed `ActionExpression` accept one @step, or Action([@steps...]) for several. See the Action section for available steps (@ToAssistant, @OpenUrl).

Card(children: (Text | Buttons | Table | List | Field | Form)[], title?: string) — 顶层卡片容器，竖向排列子组件。每段 UI 的 root 必须是 Card。
Text(content: string, variant?: "body" | "heading" | "caption") — 一段文字。标题用 variant="heading"。
Button(label: string, action?: ActionExpression, variant?: "primary" | "secondary") — 可点击按钮。点击后用 @ToAssistant 把用户的选择发回对话。
Buttons(buttons: Button[]) — 一行按钮（选项 / 快捷回复 / 下一步）。
Table(headers: string[], rows: string[][]) — 简单表格：对比、清单、多列数据。
List(items: string[], ordered?: boolean) — 要点列表；ordered=true 为有序步骤。
Field(label: string, value: string) — 一行「标签: 值」，用于摘要、订单、指标。
Form(name: string, fields: (Input | Select)[], submit: Button) — 表单：收集用户输入。提交按钮的 @ToAssistant 会把所有字段值一起发回对话。
Input(name: string, label: string, placeholder?: string) — 单行文本输入，只能放在 Form 里。
Select(name: string, label: string, options: string[]) — 单选下拉，只能放在 Form 里。

## Action — Button Behavior

An action wires a button click to operations. Pass one @-prefixed step bare, e.g. Button("Ask", @ToAssistant("Tell me more")). Put several steps in Action([...]), e.g. Button("Read", Action([@OpenUrl("https://example.com"), @ToAssistant("Summarize this page")])). Steps execute in order.
Buttons without an action automatically send their label to the assistant (equivalent to @ToAssistant(label)).

Available steps:
- @ToAssistant(message: string, context?: any) — Send a message to the assistant (for conversational buttons like "Tell me more", "Explain this"). The optional context is any value (object, array, string, number) passed to the assistant as hidden data, e.g. @ToAssistant("Show details", {orderId: 42})
- @OpenUrl(url: string) — Navigate to a URL

Example — simple nav:
```
viewBtn = Button("View", @OpenUrl("https://example.com"))
```

- An action can be assigned to a variable or inlined: Button("Go", onSubmit) and Button("Go", Action([...])) both work

## Hoisting & Streaming (CRITICAL)

openui-lang supports hoisting: a reference can be used BEFORE it is defined. The parser resolves all references after the full input is parsed.

During streaming, the output is re-parsed on every chunk. Undefined references are temporarily unresolved and appear once their definitions stream in. This creates a progressive top-down reveal — structure first, then data fills in.

**Recommended statement order for optimal streaming:**
1. `root = Card(...)` — UI shell appears immediately
2. Component definitions — fill in as they stream
3. Data values — leaf content last

Always write the root = Card(...) statement first so the UI shell appears immediately, even before child data has streamed in.

## Examples

root = Card([intro, tbl, pick], "耳机对比")
intro = Text("三款旗舰降噪耳机核心参数：")
tbl = Table(["型号", "价格", "续航"], [["A", "¥1,899", "6 小时"], ["B", "¥2,999", "30 小时"]])
pick = Buttons([p1, p2])
p1 = Button("选 A", @ToAssistant("我选 A"), "primary")
p2 = Button("选 B", @ToAssistant("我选 B"))

root = Card([q, opts], "选择套餐")
q = Text("你更看重哪一点？")
opts = Buttons([b1, b2])
b1 = Button("价格优先", @ToAssistant("我更看重价格"), "primary")
b2 = Button("性能优先", @ToAssistant("我更看重性能"))

root = Card([f], "预约信息")
f = Form("booking", [name, slot], submit)
name = Input("name", "姓名")
slot = Select("slot", "时段", ["上午", "下午"])
submit = Button("提交", @ToAssistant("提交预约信息"), "primary")

## Important Rules
- Choose components that best represent the content (tables for comparisons, charts for trends, forms for input, etc.)

## Final Verification
Before finishing, walk your output and verify:
1. root = Card(...) is the FIRST line (for optimal streaming).
2. Every referenced name is defined. Every defined name (other than root) is reachable from root.

- Only use OpenUI when interactive or structured UI clearly helps (choices, forms, comparisons, summaries). Otherwise reply in normal Markdown.
- Put OpenUI Lang inside a ```openui-lang fence. Keep explanations as Markdown outside the fence.
- At most one openui-lang fence per reply.
- The fence body is OpenUI Lang statements (`name = Component(...)`, first line `root = Card(...)`), NEVER JSON, YAML or HTML. Only the components listed above exist.
- If the UI already contains a table or summary, do not repeat the same table in Markdown outside the fence.
- Buttons that continue the conversation must use @ToAssistant("<what the user is saying>"), written in the user's language.
