import { type RefObject, useCallback, useLayoutEffect } from "react";

/**
 * 让 textarea 随内容自动增高（从 1 行起），超过 CSS max-height 后内部滚动。
 * 上限由样式决定（.composer textarea 的 max-height，来自 --ob-composer-max-h token），
 * 这里只读 computed max-height，便于不同壳（Tauri / Capacitor）各自调整。
 * 外层 .composer-wrap 的 ResizeObserver（useChatChromeOverlay）会同步消息流底部留白并保持贴底。
 */
export function resizeTextarea(el: HTMLTextAreaElement): void {
  const cs = window.getComputedStyle(el);
  const maxRaw = Number.parseFloat(cs.maxHeight);
  const max = Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : Number.POSITIVE_INFINITY;
  const borderY = (Number.parseFloat(cs.borderTopWidth) || 0) + (Number.parseFloat(cs.borderBottomWidth) || 0);
  // 先收缩到 auto 才能拿到删字后的真实 scrollHeight
  el.style.height = "auto";
  const content = el.scrollHeight + borderY;
  const next = Math.min(content, max);
  el.style.height = `${next}px`;
  el.style.overflowY = content > max ? "auto" : "hidden";
}

export function useAutoGrowTextarea(ref: RefObject<HTMLTextAreaElement | null>, value: string): () => void {
  const resize = useCallback(() => {
    const el = ref.current;
    if (el) resizeTextarea(el);
  }, [ref]);

  // value 变化（输入、粘贴、IME 上屏、发送后清空）都会走这里；layout effect 避免闪一帧
  useLayoutEffect(() => {
    resize();
  }, [value, resize]);

  useLayoutEffect(() => {
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(resize);
    };
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    // 宽度变化（侧栏收起、壳窗口拖动）也会改变换行
    const el = ref.current;
    const ro = typeof ResizeObserver !== "undefined" && el ? new ResizeObserver(schedule) : null;
    if (el && ro && el.parentElement) ro.observe(el.parentElement);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      ro?.disconnect();
    };
  }, [ref, resize]);

  return resize;
}
