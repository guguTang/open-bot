import * as React from "react"
import { Input as HeroInput } from "@heroui/react"
import { cn } from "cn"

/** HeroUI Input（Uber 主题）；保留原生 input 的 props 与 onChange 事件签名。 */
function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <HeroInput
      data-slot="input"
      className={cn("w-full min-w-0", className)}
      {...(props as React.ComponentProps<typeof HeroInput>)}
    />
  )
}

export { Input }
