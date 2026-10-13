import type { DiagramOverflowItem } from "../diagramCardFrameModel";

/** Build ⋯ overflow items; skips undefined entries. */
export function diagramOverflowItems(
  ...items: Array<DiagramOverflowItem | false | null | undefined>
): DiagramOverflowItem[] {
  return items.filter((item): item is DiagramOverflowItem => Boolean(item));
}
