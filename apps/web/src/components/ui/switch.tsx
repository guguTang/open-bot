"use client";

import * as React from "react";
import { cn } from "cn";
import { Switch as SwitchPrimitive } from "radix-ui";

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default";
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer inline-flex shrink-0 items-center rounded-full border border-transparent outline-none transition-colors",
        "focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "data-[state=checked]:bg-primary data-[state=unchecked]:bg-[var(--default)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-4 w-7" : "h-5 w-9",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-full bg-background shadow-sm ring-0 transition-transform",
          size === "sm"
            ? "size-3 data-[state=checked]:translate-x-3 data-[state=unchecked]:translate-x-0.5"
            : "size-4 data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0.5",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
