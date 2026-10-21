import * as React from "react";
import { NativeSelect as ProNativeSelect } from "@heroui-pro/react";
import { cn } from "@/lib/utils";

type NativeSelectProps = Omit<React.ComponentProps<"select">, "size"> & {
  size?: "sm" | "default";
};

/**
 * Drop-in native <select> that uses HeroUI Pro NativeSelect chrome.
 * Children should be <NativeSelectOption> / <option>.
 */
const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(
  ({ className, size = "default", children, ...props }, ref) => {
    return (
      <ProNativeSelect
        fullWidth
        className={cn("w-full", size === "sm" && "text-sm", className)}
        data-slot="native-select-wrapper"
      >
        <ProNativeSelect.Trigger
          ref={ref as never}
          className={cn(size === "sm" && "min-h-8 text-sm")}
          {...(props as object)}
        >
          {children}
          <ProNativeSelect.Indicator />
        </ProNativeSelect.Trigger>
      </ProNativeSelect>
    );
  },
);
NativeSelect.displayName = "NativeSelect";

function NativeSelectOption({ className, ...props }: React.ComponentProps<"option">) {
  return <ProNativeSelect.Option className={className} {...props} />;
}

export { NativeSelect, NativeSelectOption };
