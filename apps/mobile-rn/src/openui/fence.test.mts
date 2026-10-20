// 运行：pnpm --dir apps/mobile-rn test（node --test；.mts 不进 tsc/Metro）
import assert from "node:assert/strict";
import { test } from "node:test";

import { hasOpenUiFence, splitOpenUi } from "./fence.ts";

test("plain markdown stays one text segment", () => {
  assert.deepEqual(splitOpenUi("hello **world**"), [{ kind: "text", text: "hello **world**" }]);
  assert.equal(hasOpenUiFence("```js\nx\n```"), false);
});

test("closed fence is extracted between text", () => {
  const md = '前言\n\n```openui-lang\nroot = Card([t])\nt = Text("hi")\n```\n\n结尾';
  const segs = splitOpenUi(md);
  assert.equal(segs.length, 3);
  assert.deepEqual(segs[1], {
    kind: "openui",
    source: 'root = Card([t])\nt = Text("hi")',
    pending: false,
  });
  assert.equal(segs[0]!.kind, "text");
  assert.equal(segs[2]!.kind, "text");
  assert.equal(hasOpenUiFence(md), true);
});

test("unclosed fence is pending (streaming)", () => {
  const segs = splitOpenUi("稍等\n```openui\nroot = Card([");
  assert.deepEqual(segs[1], { kind: "openui", source: "root = Card([", pending: true });
});

test("tilde fences and longer closers", () => {
  const segs = splitOpenUi("~~~~openui-lang\nroot = Card([])\n~~~~~\n");
  assert.deepEqual(segs[0], { kind: "openui", source: "root = Card([])", pending: false });
});

test("other fences are untouched", () => {
  const md = "```mermaid\ngraph TD\n```";
  assert.deepEqual(splitOpenUi(md), [{ kind: "text", text: md }]);
});
