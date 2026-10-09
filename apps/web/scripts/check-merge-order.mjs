/**
 * Smoke-check chronological insert used by mergeIncomingMessage.
 * Run: node apps/web/scripts/check-merge-order.mjs
 */
function insertKeepingStreamLast(prev, msg) {
  let streamAt = prev.length;
  while (streamAt > 0 && prev[streamAt - 1].streaming && prev[streamAt - 1].role === "assistant") {
    streamAt -= 1;
  }
  const sealed = prev.slice(0, streamAt);
  const trailing = prev.slice(streamAt);
  const incomingAt = msg.created_at ? Date.parse(msg.created_at) : Number.NaN;
  let insertAt = sealed.length;
  if (!Number.isNaN(incomingAt)) {
    for (let i = 0; i < sealed.length; i++) {
      const raw = sealed[i].created_at;
      const t = raw ? Date.parse(String(raw)) : Number.NaN;
      if (!Number.isNaN(t) && t > incomingAt) {
        insertAt = i;
        break;
      }
    }
  }
  const next = sealed.slice();
  next.splice(insertAt, 0, { ...msg, streaming: false });
  return trailing.length ? next.concat(trailing) : next;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const t0 = "2026-10-09T12:00:00.000Z";
const t1 = "2026-10-09T12:00:01.000Z";
const t2 = "2026-10-09T12:00:02.000Z";

// Mid ack while final still streaming → ack before stream placeholder.
let list = [
  { id: "u1", role: "user", content: "hi", created_at: t0 },
  { id: "local-stream", role: "assistant", content: "", streaming: true },
];
list = insertKeepingStreamLast(list, {
  id: "ack",
  role: "assistant",
  content: "先做一步",
  created_at: t1,
});
assert(list.map((m) => m.id).join(",") === "u1,ack,local-stream", `got ${list.map((m) => m.id)}`);

// Late mid after final sealed → still before final by created_at.
list = [
  { id: "u1", role: "user", content: "hi", created_at: t0 },
  { id: "final", role: "assistant", content: "结论", created_at: t2 },
];
list = insertKeepingStreamLast(list, {
  id: "ack",
  role: "assistant",
  content: "先做一步",
  created_at: t1,
});
assert(list.map((m) => m.id).join(",") === "u1,ack,final", `got ${list.map((m) => m.id)}`);

console.log("check-merge-order: ok");
