import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type NativeSelectProps = Omit<React.ComponentProps<"select">, "size"> & {
  size?: "sm" | "default";
};

/**
 * Native `<select>` with shadcn chrome.
 * Children should be `<NativeSelectOption>` / `<option>`.
 */
const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(
  ({ className, size = "default", children, style, ...props }, ref) => {
    return (
      <div className="relative w-full min-w-0" data-slot="native-select-wrapper">
        <select
          ref={ref}
          data-slot="native-select"
          data-size={size}
          className={cn(
            "h-9 w-full min-w-0 appearance-none rounded-md border border-input bg-[var(--field-background)] ps-3 pe-9 text-sm text-foreground shadow-xs outline-none",
            "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
            "disabled:cursor-not-allowed disabled:opacity-50",
            size === "sm" && "h-8 text-sm",
            className,
          )}
          style={{ paddingInlineEnd: "2.25rem", ...style }}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
      </div>
    );
  },
);
NativeSelect.displayName = "NativeSelect";

function NativeSelectOption({ className, ...props }: React.ComponentProps<"option">) {
  return <option data-slot="native-select-option" className={className} {...props} />;
}

export { NativeSelect, NativeSelectOption };
