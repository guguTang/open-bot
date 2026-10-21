"use client"

import * as React from "react"
import { cn } from "cn"
import { Switch as SwitchPrimitive } from "radix-ui"

/**
 * HeroUI Switch 外观（.switch / .switch__control / .switch__thumb，读 aria-checked），
 * 行为仍是 Radix（保留 id + <label htmlFor>、checked/onCheckedChange 接口）。
 */
function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn("switch", size === "sm" ? "switch--sm" : "switch--md", "shrink-0 border-0 bg-transparent p-0", className)}
      {...props}
    >
      <span className="switch__control">
        <SwitchPrimitive.Thumb data-slot="switch-thumb" className="switch__thumb" />
      </span>
    </SwitchPrimitive.Root>
  )
}

export { Switch }
