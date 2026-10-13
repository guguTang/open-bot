import { toast } from "sonner";
import { copyText } from "../../lib/diagramExport";

/** Clipboard helper with the shared toast UX used by all diagram cards. */
export function copyDiagramText(
  text: string | null | undefined,
  opts?: { emptyMessage?: string; failMessage?: string },
): void {
  if (!text) {
    toast.message(opts?.emptyMessage ?? "暂不可复制", { duration: 1500 });
    return;
  }
  void copyText(text).then(
    () => toast.success("已复制", { duration: 1500 }),
    () => toast.error(opts?.failMessage ?? "复制失败，请手动选择源码复制"),
  );
}
