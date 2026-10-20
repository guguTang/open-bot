#!/usr/bin/env node
// 从 design/tokens.json 生成 web 与 RN 共享的设计 token。
//   node scripts/gen-design-tokens.mjs          写入生成文件
//   node scripts/gen-design-tokens.mjs --check  只校验（CI/测试用），有漂移时退出码 1
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const t = JSON.parse(readFileSync(join(root, "design/tokens.json"), "utf8"));
const HEADER = "由 scripts/gen-design-tokens.mjs 从 design/tokens.json 生成，请勿手改";

const colorVars = (scheme, indent) =>
  Object.entries(t.color[scheme]).map(([k, v]) => `${indent}--ob-color-${k}: ${v};`).join("\n");

const webCss = `/* ${HEADER} */
:root {
${colorVars("light", "  ")}
${Object.entries(t.radius).map(([k, v]) => `  --ob-radius-${k}: ${v}px;`).join("\n")}
${Object.entries(t.space).map(([k, v]) => `  --ob-space-${k}: ${v}px;`).join("\n")}
  --ob-motion-fast: ${t.motion.fast}ms;
  --ob-motion-base: ${t.motion.base}ms;
  --ob-motion-slow: ${t.motion.slow}ms;
  --ob-easing: ${t.motion.easing};
  --ob-touch-min: ${t.touchTarget.min}px;
  --ob-composer-max-h: min(${t.composer.maxViewportRatio * 100}dvh, ${t.composer.maxHeight}px);
  --ob-font-sans: ${t.font.sans};
}

/* 暗色 token 只在显式 data-theme="dark" 时生效，不自动跟随系统，避免未适配的页面变色。 */
[data-theme="dark"] {
${colorVars("dark", "  ")}
}

@media (prefers-reduced-motion: reduce) {
  /* 减少动效：保留短促的颜色/透明度过渡作为状态反馈，统一压到 fast */
  :root {
    --ob-motion-base: ${t.motion.fast}ms;
    --ob-motion-slow: ${t.motion.fast}ms;
  }
}
`;

// RN：heroui-native 主题变量映射（只覆盖品牌色与焦点色；danger/success 等沿用库内已校验对比度的默认值），写进 global.css 的标记区块。
const heroMap = (scheme, indent) => {
  const c = t.color[scheme];
  return [
    ["accent", c.primary],
    ["accent-foreground", c["primary-foreground"]],
    ["focus", c.ring],
  ].map(([k, v]) => `${indent}--${k}: ${v};`).join("\n");
};
const rnBlock = `/* BEGIN design-tokens（${HEADER}） */
@layer theme {
  :root {
    @variant light {
${heroMap("light", "      ")}
    }

    @variant dark {
${heroMap("dark", "      ")}
    }
  }
}
/* END design-tokens */`;

const rnTs = `// ${HEADER}
export const designTokens = ${JSON.stringify(
  { color: t.color, radius: t.radius, space: t.space, motion: t.motion, touchTarget: t.touchTarget, composer: t.composer },
  null,
  2,
)} as const;

/** 最小可点区域（iOS HIG 44pt），用于 hitSlop / minHeight。 */
export const TOUCH_MIN = ${t.touchTarget.min};

/** 把视觉尺寸补足到 44pt 的 hitSlop。 */
export function hitSlopFor(size: number) {
  const pad = Math.max(0, Math.ceil((TOUCH_MIN - size) / 2));
  return { top: pad, bottom: pad, left: pad, right: pad };
}
`;

const outputs = [];
outputs.push([join(root, "apps/web/src/styles/tokens.css"), webCss]);
outputs.push([join(root, "apps/mobile-rn/src/theme/tokens.ts"), rnTs]);

const rnCssPath = join(root, "apps/mobile-rn/src/global.css");
const rnCss = readFileSync(rnCssPath, "utf8");
const re = /\/\* BEGIN design-tokens[\s\S]*?\/\* END design-tokens \*\//;
if (!re.test(rnCss)) throw new Error("global.css 缺少 BEGIN/END design-tokens 标记");
outputs.push([rnCssPath, rnCss.replace(re, rnBlock)]);

const check = process.argv.includes("--check");
let drift = 0;
for (const [p, content] of outputs) {
  const cur = existsSync(p) ? readFileSync(p, "utf8") : null;
  if (cur === content) continue;
  if (check) { drift++; console.error(`design tokens 漂移: ${p}`); }
  else { writeFileSync(p, content); console.log(`wrote ${p.slice(root.length + 1)}`); }
}
if (check && drift) process.exit(1);
