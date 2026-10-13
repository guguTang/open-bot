import type { Machine } from "../api";
import { machinePresenceLabel } from "../lib/machineRoster";
import { cn } from "@/lib/utils";

type Props = {
  value: string;
  onChange: (machineId: string) => void;
  machines: Machine[];
  disabled?: boolean;
  /** Larger touch targets on sheet / mobile forms. */
  sheetForm?: boolean;
  id?: string;
  label?: string;
  emptyHint?: string;
  helpHint?: string;
};

const fieldClass =
  "flex flex-col gap-1.5 text-[13px] text-(--muted) [&_select]:rounded-md [&_select]:border [&_select]:border-border [&_select]:bg-(--bg-soft) [&_select]:px-3 [&_select]:py-2.5 [&_select]:text-(--text) [&_select]:outline-none";

/**
 * 「优先电脑」picker — shared by create-bot and Bot avatar settings.
 */
export function HostMachineSelect({
  value,
  onChange,
  machines,
  disabled,
  sheetForm,
  id,
  label = "优先电脑",
  emptyHint = "还没有已连接的电脑。手机不能当作优先电脑。",
  helpHint = "读文件、跑命令会在你当前发消息的电脑上执行。这里只是可选的默认优先机。",
}: Props) {
  return (
    <>
      <label
        className={cn(fieldClass, sheetForm && "[&_select]:min-h-11 [&_select]:text-base")}
        htmlFor={id}
      >
        {label}
        <select
          id={id}
          className="mt-1 w-full rounded-lg border border-border bg-(--bg-elevated,#fff) px-2.5 py-2 font-inherit text-inherit outline-none focus:border-(--accent,#457b9d)"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        >
          <option value="">不指定（在你发消息的那台电脑上运行）</option>
          {machines.map((m) => (
            <option key={m.id} value={m.id}>
              {(m.label || m.id) + " · " + machinePresenceLabel(m)}
            </option>
          ))}
        </select>
      </label>
      {machines.length === 0 ? (
        <div className="text-xs text-(--muted)">{emptyHint}</div>
      ) : (
        <div className="text-xs leading-[1.45] whitespace-normal text-(--muted) wrap-anywhere">
          {helpHint}
        </div>
      )}
    </>
  );
}
