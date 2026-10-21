import * as React from "react"
import { TextArea as HeroTextArea } from "@heroui/react"
import { cn } from "cn"

/** HeroUI TextArea（Uber 主题）；保留原生 textarea 的 props。 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <HeroTextArea
      data-slot="textarea"
      variant="secondary"
      className={cn("w-full min-h-16", className)}
      {...(props as React.ComponentProps<typeof HeroTextArea>)}
    />
  )
}

export { Textarea }
