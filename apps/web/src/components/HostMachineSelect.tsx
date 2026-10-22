import type { Machine } from "../api";
import { machinePresenceLabel } from "../lib/machineRoster";
import { Label } from "@/components/ui/label";
import { Select, SELECT_EMPTY, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
        <Select
          value={value || SELECT_EMPTY}
          disabled={disabled}
          onValueChange={(next) => onChange(next === SELECT_EMPTY ? "" : next)}
        >
          <SelectTrigger id={fieldId} className={cn(sheetForm && "min-h-11 text-base")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SELECT_EMPTY}>不指定（在你发消息的那台电脑上运行）</SelectItem>
            {machines.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {(m.label || m.id) + " · " + machinePresenceLabel(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
