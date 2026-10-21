# 群 Auto 选人 · Current user intent 联合判定（设计）

日期：2026-10-12 · 状态：**已实现 v1**（确定性联合，零额外 LLM）  
对照：`docs/群Auto选人.md` §4 B 档；实现入口 `currentUserIntentSummary` / `buildAutoPickDecisionPayload` / `recentMessagesSynopsis`  
实现：`currentUserIntentSummary(userText, synopsis)` / `currentUserIntentJoin` → `follow_up|new|soft|none`；log `auto_pick=decision intent_join=`  
触发：Langfuse peek/obs `c5c3d672118c5d06` · trace `0cdcdd00dfed9e940078a653b6e8e83c` · 2026-10-12 18:57:36 CST

---

## 1. 现场复盘（peek）

| 项 | 值 |
|---|---|
| Observation | `c5c3d672118c5d06` · `open-bot.decision` · GENERATION |
| Trace | `0cdcdd00dfed9e940078a653b6e8e83c` |
| Provider / model | legacy `unsloth` / `laya`（metadata `laya-multilingual`；现等价于 Admin 选 **自定义** 或 Laya + `http://localhost:8888`） |
| Latency | ~3.5s |
| Session / conversation | `3851dce7-cabc-478c-bfa7-02cfbb0b0af4` |
| 期望 | **仅 coding bot（m1 代码）** |
| 实得 | **choice=`all` → 文章 + 代码双跑**（随后 `open-bot.run` 两条：`cb6df594…` 与 `b82b2fbe…`） |

### 1.1 Utterance / Intent / Recent

```
User message:
修改下，换成动物的表情

Current user intent (authoritative this turn — newest ask wins …):
用户想：修改下，换成动物的表情          ← 与 User message 同文复述

Member capability profiles:
- m0: 文章 — 写东西与改稿…
- m1: 代码 — 写代码与排障…

Recent context:
User: 给我写个html页面，选择不同的心情。生成不同的表情，用canvas，不要用svg
| User: 谁能写代码
| Last answered by: 文章 — …, 代码 — …
```

### 1.2 Choice / probs / count

```json
{
  "pick": {
    "choice": "all",
    "probabilities": { "all": 0.4121, "m0": 0.2239, "m1": 0.364 },
    "confidence": 0.0276
  },
  "count": { "noul": 0.9947 }
}
```

- `confidence` 字段极低，但现有抬置信逻辑吃 `probs[all]`（≥θ）→ **未** fail-open 到 heuristic。
- `choice=all` + full-roster count → 映射全员 + `LeadFallback`（真 all-hands 路径）→ 双 bot 必答。
- `probs[all]=0.41 ≥ 0.20` 的 count-expand / all 信任门槛也压不住误判（本例直接 choice=all，无需 underpick 展开）。

### 1.3 根因（decide prompt / state 缺口）

1. **`Current user intent` = 本轮原文 clip**（`currentUserIntentSummary` 无 LLM、不读 synopsis）——标注「authoritative」，却**不含**会话近期任务。
2. Prompt 要求 **「Classify from Current user intent first」**；FOLLOW-UP 仅当模型自己判断 intent「是短追问」才去看 Recent。短句「修改下，换成动物的表情」单独看既不像 ALL-HANDS，也不自带专长锚点，模型易漂向「全员 / 含糊」或被 **Last answered by 双人** 带偏到 `all`。
3. Recent 里混有上一轮 **WHO-CAN「谁能写代码」** 与 **双人 Last answered by**，在 intent 未声明「继续改 HTML canvas 心情页」时，对 SystemOne 是强干扰。
4. 与产品目标冲突：**用户意图 = 会话最新摘要 ⊕ 当前问题** 联合判定；现状是「当前问题单飞 + Recent 旁路参考」。

同类已修过「新专长打断」形态（peek `38529ebd` 「通过选择不同心情生成不同 svg」），靠 intent 原文 + INTERRUPT 教学；**本例是短追问缺少任务锚点**，INTERRUPT 帮不上，需要 **联合意图**。

---

## 2. 目标行为

| 输入形态 | 联合意图应像 | 分类 | 选人 |
|---|---|---|---|
| 短追问 / 指代（「修改下」「换成动物表情」「再来个哭脸」）+ 近期有专长任务 | `用户想：继续完善「html canvas 心情表情页」：换成动物表情` | FOLLOW-UP / SPECIALTY | 匹配专长 mN（本例 m1 代码） |
| 自洽新专长问（长、自带任务词） | `用户想：<本轮原文>`（**不**绑旧任务） | SPECIALTY / WHO-CAN / ALL-HANDS | newest wins（INTERRUPT） |
| 真全员（介绍 / roast） | `用户想：都介绍下自己` 等 | ALL-HANDS | `choice=all` |
| 无 Recent | 退化为今日行为（仅本轮） | 同现网 | 同现网 |

约束（保持）：

- **不**恢复 SVG/HTML/哭脸 synonym 针表；联合意图是**结构化拼接 / 可选微调用**，不是角色关键词堆叠。
- INTERRUPT / newest wins 仍成立：新问不得被旧摘要绑死。
- 成本与延迟：decide 已是关键路径；默认方案 **零额外 LLM**。

---

## 3. 方案对比

### 方案 A — 确定性联合（推荐 v1）

在 API 组 decide state 时，用 `synopsis` 里**最近一条 prior USER 话** + 本轮 `userText` 模板拼接 `Current user intent`。

```
currentUserIntentSummary(userText, synopsis) →
  prior := 从 synopsis 抽取最近一条 "User: …"（已有 chronological parts）
  if prior 空:
      return clip(userText)                    # 与今日相同
  if looksLikeNewAsk(userText):               # 见 §3.1
      return clip(userText)                    # INTERRUPT：不绑旧任务
  if looksLikeFollowUp(userText):             # 见 §3.1
      return "继续完善「" + clip(prior, 60) + "」：" + clip(userText, 80)
  return "结合近期「" + clip(prior, 40) + "」，本轮：「" + clip(userText, 80) + "」"
```

本例拼接结果近似：

`用户想：继续完善「给我写个html页面，选择不同的心情。生成不同的表情，用canvas，不要用svg」：修改下，换成动物的表情`

| | |
|---|---|
| **谁生成** | `planSendTargets` 已算好的 `recentMessagesSynopsis`；`buildAutoPickDecisionPayload` 调用加参 |
| **INTERRUPT** | `looksLikeNewAsk` → intent 仅本轮（覆盖 38529ebd 类） |
| **FOLLOW-UP** | 短句 + 指代/修改类 → 强绑定 prior USER 任务 |
| **成本** | 0 token；延迟不变 |
| **风险** | 启发式边界（见 §3.1）；prior 抽到 WHO-CAN 句时需跳过（见 §3.2） |

### 方案 B — 意图微调用（可选 v2）

在 decide 前对同一 SystemOne / 组织决策模型多一次极短 choice/completion：

- 输入：prior USER（1～2）+ Last answered by + 本轮问 → 输出 ≤40 字「用户想：…」+ 可选标签 `{follow_up|new|all_hands|who_can}`。
- Fail-open：超时 / 低置信 → **回退方案 A**。
- 成本：+1 小调用（约 +1～3s）；仅 `auto_pick=decision` 且 synopsis 非空时开启；org flag 如 `auto_pick_intent_llm=1`。

适合 A 上线后仍有「改一下 / 那个」歧义误绑时再开。

### 方案 C — 取消独立 Intent 字段，改「Session+Ask」一块

把 state 改成：

```
Session task (prior USER): …
Current ask: …
Last answered by: …
```

Instructions 改为「联合阅读后分类」，不再写「Classify from Current user intent first」。

| | |
|---|---|
| 成本 | 0 |
| 风险 | 削弱「authoritative newest」信号；与现网 INTERRUPT 测试/文案大改；模型仍可能被双 Last-answered-by 带偏 |
| 结论 | **不单独做**；可与 A 并存为 state 排版微调（A 的联合句仍保留短字段） |

### 方案 D — 复用 runtime `[对话摘要]`

Agent-runtime compact 的会话摘要偏长窗、多 bot 混合，且常滞后于「上一条 USER 专长句」。**不作 AutoPick 主路径**；最多当 synopsis 为空时的弱 fallback（非本轮）。

---

## 3.1 轻量结构信号（非专长针表）

允许的**结构/指代**信号（中英通用功能词，不是 SVG/coding 专长表）：

**偏 FOLLOW-UP（可绑 prior）** — 短句（如 ≤40 字）且命中其一：

- 修改 / 改成 / 换成 / 改下 / 调整 / 继续 / 再来 / 再画 / 同上 / 那个 / 这个 / 刚才 / 上面
- `change it` / `make it` / `instead` / `again` / `same but` / `update the`

**偏 NEW ASK（INTERRUPT，不绑 prior）** — 任一条：

- `isWhoCanIntent(userText)` / 现有 all-hands 由模型分类，但若本轮已是长自洽句（如 ≥40 字且无上述指代）→ 当 new
- 本轮已 `userTextHitsRoleSynonym` **且** 无明显指代 → 当 new（自带专长锚点，同 38529ebd）

**ambiguous** → 软拼接（「结合近期…，本轮…」），仍把 prior 暴露给模型，但不写死「继续完善」。

明确 **不做**：按 html/svg/canvas/哭脸等任务词扩表。

## 3.2 Prior 抽取规则

从 `recentMessagesSynopsis` 的 `User: …` 段中，**自新向旧**取第一条：

1. 跳过 `isWhoCanIntent(prior)`（本例会跳过「谁能写代码」，落到「给我写个html页面…」）——否则联合意图会变成「继续谁能写代码：换成动物表情」。
2. 跳过过短无信息（<4 字）或纯寒暄（可选，后续再加）。
3. 仍没有 → intent = 仅本轮。

`Last answered by` **不**写入 intent 句（避免把 who-can 双人答又写进权威意图）；继续只放在 Recent。

---

## 4. Prompt / 映射配套（小改，随 A 一起）

1. Instructions / state 尾句：  
   `Classify from Current user intent` →  
   `Classify from Current user intent (may already bind prior session task when this turn is a short follow-up; if intent states a new self-contained ask, newest wins)`.
2. FOLLOW-UP 条强调：若 intent 已含「继续完善「…」」，**必须**当 FOLLOW-UP/SPECIALTY，**禁止**因 Last answered by 多人而 `choice=all`。
3. **不**改 who-can / all-hands 薄结构安全；本例误伤来自错误 `choice=all`，联合意图修好后 probs 应沉到 m1。
4. 可选观测：log `auto_pick=decision intent_join=follow_up|new|soft|none` + clip 后的 intent，便于对照 Langfuse state。

---

## 5. 推荐落地顺序

| 步 | 内容 | 工作量 |
|---|---|---|
| **0** | 本文档（设计） | 本提交 |
| **1** | ~~实现方案 A：`currentUserIntentSummary(userText, synopsis)` + prior 跳过 who-can + 单测（本 peek 形状；38529ebd INTERRUPT 不回退）~~ **已落地** | 小 |
| **2** | ~~Prompt 文案微调 §4 + log `intent_join=`~~ **已落地** | 极小 |
| **3** | 线上回放 / 新 peek：短追问 → 仅 coder；新长专长问 → 仍 newest wins | 验证 |
| **4** | 若仍有歧义短句 → 评估方案 B flag | 可选 |

**不做（本轮）**：全量重写 state 结构（C）、依赖 compact 摘要（D）、恢复专长 keyword 针表、推 remote。

---

## 6. 验收用例（实现时）

1. **本 peek 复现**：user=`修改下，换成动物的表情`，synopsis 含 html canvas 心情页 + `谁能写代码` + Last answered by 文章+代码 → state 中 intent 含 html/canvas 任务锚点且**不含**「谁能写代码」作 prior；mock/实模应趋向 m1，不得 `fallback=all`。
2. **INTERRUPT**：user=`通过选择不同心情生成不同svg`（长自洽）+ 同上 synopsis → intent **仅**本轮原文（或等价不绑「谁能写代码」）；保持现有 `TestBuildAutoPickDecisionPayloadCurrentUserIntentInterrupt` 语义。
3. **真 ALL-HANDS**：`都介绍下自己` + 任意 synopsis → intent 不错误绑成「继续完善…」；仍允许 `choice=all`。
4. **无 synopsis**：与现网一致，intent = clip(本轮)。
5. **Who-can 本轮**：`谁会写代码` → intent 不绑旧 html 任务（new ask）。

---

## 7. 与主文档关系

实现后回写 `docs/群Auto选人.md` §4 B「State」第二条：

> **Current user intent**：由 **会话最近 prior USER 任务摘要 ⊕ 本轮问题** 联合生成（短追问绑 prior；新问 / who-can / 自洽专长问仅本轮）；不再是本轮原文单飞。

v1 已落地；主文档 §4 B 已回写。方案 B（意图微调用）仍可选。
