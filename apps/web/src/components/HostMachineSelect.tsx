import { type ChangeEvent } from "react";
import type { Machine } from "../api";
import { machinePresenceLabel } from "../lib/machineRoster";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
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
  const fieldId = id || "host-machine-select";
  return (
    <>
      <div className={cn("flex flex-col gap-1.5", sheetForm && "text-base")}>
        <Label htmlFor={fieldId}>{label}</Label>
        <NativeSelect
          id={fieldId}
          value={value}
          disabled={disabled}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
        >
          <NativeSelectOption value="">不指定（在你发消息的那台电脑上运行）</NativeSelectOption>
          {machines.map((m) => (
            <NativeSelectOption key={m.id} value={m.id}>
              {(m.label || m.id) + " · " + machinePresenceLabel(m)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
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
