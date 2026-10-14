/** 贴底策略。滚动元素的写入留在持有 DOM 的 module。 */

export const NEAR_BOTTOM_PX = 80;

export type ScrollStick = {
  stickToBottom: boolean;
  showScrollBottom: boolean;
};

export function stickFromScrollMetrics(scrollHeight: number, scrollTop: number, clientHeight: number): ScrollStick {
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
  const near = distanceFromBottom < NEAR_BOTTOM_PX;
  return { stickToBottom: near, showScrollBottom: !near };
}

/** 反向列滚动容器：0 是底部，往上翻 scrollTop 变成负数。 */
export function stickFromReverseScroll(scrollTop: number): ScrollStick {
  const distanceFromBottom = scrollTop < 0 ? -scrollTop : 0;
  const near = distanceFromBottom < NEAR_BOTTOM_PX;
  return { stickToBottom: near, showScrollBottom: !near };
}

export function pinStick(): ScrollStick {
  return { stickToBottom: true, showScrollBottom: false };
}

/** 消息或运行状态变了之后：贴着就跟着滚，离开了就露出回到底部。 */
export function stickAfterContentChange(stickToBottom: boolean): { scroll: boolean; showScrollBottom: boolean } {
  if (!stickToBottom) return { scroll: false, showScrollBottom: true };
  return { scroll: true, showScrollBottom: false };
}
