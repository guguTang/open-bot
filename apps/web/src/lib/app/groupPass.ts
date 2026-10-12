/** Group silence token from server PASS / empty skip (mirror isGroupPassReply). */
export function isGroupPassContent(content: string): boolean {
  let t = (content || "").trim();
  if (!t) return true;
  for (let i = 0; i < 8; i++) {
    const prev = t;
    t = t.trim().replace(/^[`\s"'*_~]+|[`\s"'*_~]+$/gu, "").trim();
    const pairs: [string, string][] = [
      ["[", "]"],
      ["【", "】"],
      ["（", "）"],
      ["(", ")"],
      ["「", "」"],
      ["『", "』"],
      ["<", ">"],
      ["《", "》"],
    ];
    for (const [a, b] of pairs) {
      if (t.startsWith(a) && t.endsWith(b) && t.length >= a.length + b.length) {
        t = t.slice(a.length, t.length - b.length).trim();
      }
    }
    t = t.replace(/[。.!！…]+$/u, "").trim();
    if (t === prev) break;
  }
  return /^pass$/i.test(t);
}
