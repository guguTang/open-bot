import { cn } from "@/lib/utils";
import {
  CAPABILITY_LABELS,
  capabilityMatrix,
  type CapabilityAvailability,
} from "../lib/microApp/capabilities";
import type { ClientContext } from "../lib/clientEnv";

type Props = {
  capabilities: string[];
  client?: ClientContext | null;
  compact?: boolean;
  className?: string;
};

export function MicroAppCapabilityMatrix({ capabilities, client, compact, className }: Props) {
  const rows = capabilityMatrix(capabilities || [], client);
  if (rows.length === 0) {
    return (
      <p className={cn("text-xs text-[var(--muted)]", className)}>未声明能力</p>
    );
  }
  return (
    <ul
      className={cn(
        "flex flex-col gap-1",
        compact ? "text-[11px]" : "text-xs",
        className,
      )}
      aria-label="能力矩阵"
    >
      {rows.map((row) => (
        <CapabilityRow key={row.capability} row={row} compact={compact} />
      ))}
    </ul>
  );
}

function CapabilityRow({ row, compact }: { row: CapabilityAvailability; compact?: boolean }) {
  const label = CAPABILITY_LABELS[row.capability] || row.capability;
  return (
    <li
      className={cn(
        "flex items-start gap-2 rounded-md px-2 py-1.5",
        row.available ? "bg-[var(--bg-soft)]/60" : "bg-[var(--bg-soft)] opacity-70",
      )}
    >
      <span
        className={cn(
          "mt-0.5 size-2 shrink-0 rounded-full",
          row.available ? "bg-emerald-500" : "bg-[var(--muted)]",
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "font-medium",
            !row.available && "text-[var(--muted)] line-through decoration-[var(--muted)]",
          )}
        >
          {label}
        </span>
        <code className="ml-1 text-[10px] text-[var(--muted)]">{row.capability}</code>
        {!row.available && row.reason ? (
          <span className={cn("mt-0.5 block text-[var(--muted)]", compact && "leading-snug")}>
            {row.reason}
          </span>
        ) : null}
        {row.available && row.host_required ? (
          <span className="mt-0.5 block text-[10px] text-[var(--muted)]">桌面 host</span>
        ) : null}
        {row.available && row.device_required ? (
          <span className="mt-0.5 block text-[10px] text-[var(--muted)]">移动原生</span>
        ) : null}
      </span>
      <span className="shrink-0 text-[10px] text-[var(--muted)]">
        {row.available ? "可用" : "不可用"}
      </span>
    </li>
  );
}
