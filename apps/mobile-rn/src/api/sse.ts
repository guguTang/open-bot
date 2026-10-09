import type { StatusEvent, StreamHandlers } from "./types";

/**
 * SSE 解析。
 *
 * 逐行移植自 `apps/web/src/api.ts` 的 `readSSEStream`，两者的事件语义必须保持一致
 * （`token` / `meta` / `status` / `error` / `done`，空行重置 event name）。
 *
 * 唯一的区别是数据源：Web 用浏览器 `fetch` 的 `response.body`，这里用 `expo/fetch`。
 * React Native 内置的 fetch 是 XHR polyfill，拿不到 `res.body`，`expo/fetch` 才有真正的
 * ReadableStream。**不要改回全局 fetch**，否则整段代码会退化成一次性拿完整响应。
 */
export async function readSSEStream(
  body: ReadableStream<Uint8Array>,
  handlers: StreamHandlers
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  let sawDone = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const rawLine of parts) {
      const line = rawLine.replace(/\r$/, "");
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        const dataStr = line.slice(5).trim();
        let data: Record<string, unknown> = {};
        try {
          data = JSON.parse(dataStr) as Record<string, unknown>;
        } catch {
          data = { raw: dataStr };
        }
        if (eventName === "token" && typeof data.text === "string") {
          handlers.onToken(data.text);
        } else if (eventName === "meta") {
          if (data.phase === "agent_start" && typeof data.agent_id === "string") {
            handlers.onAgentStart?.({
              agent_id: data.agent_id,
              agent_name: typeof data.agent_name === "string" ? data.agent_name : undefined,
              index: typeof data.index === "number" ? data.index : undefined,
              total: typeof data.total === "number" ? data.total : undefined,
            });
          }
          handlers.onMeta?.(data);
        } else if (eventName === "status") {
          handlers.onStatus?.(data as StatusEvent);
        } else if (eventName === "error") {
          const msg =
            typeof data.message === "string"
              ? data.message
              : typeof data.raw === "string"
                ? data.raw
                : JSON.stringify(data);
          handlers.onError?.(msg);
        } else if (eventName === "done") {
          sawDone = true;
          handlers.onDone?.();
        }
      } else if (line === "") {
        eventName = "message";
      }
    }
  }
  if (!sawDone) handlers.onDone?.();
}
