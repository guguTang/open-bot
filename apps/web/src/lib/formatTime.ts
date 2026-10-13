import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/zh-cn";

dayjs.extend(relativeTime);
dayjs.locale("zh-cn");

/** Absolute: 2026-10-13 14:11 */
export function formatDateTime(iso?: string | null): string {
  if (!iso) return "";
  const d = dayjs(iso);
  if (!d.isValid()) return "";
  return d.format("YYYY-MM-DD HH:mm");
}

/** Relative: 几分钟前 / 2 小时前 — for "最近 …" labels */
export function formatRelativeTime(iso?: string | null): string {
  if (!iso) return "";
  const d = dayjs(iso);
  if (!d.isValid()) return "";
  return d.fromNow();
}
