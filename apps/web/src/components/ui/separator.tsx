import * as React from "react"
import { Separator as HeroSeparator } from "@heroui/react"

/** HeroUI Separator；保留 orientation / className 接口（decorative 由 HeroUI 处理语义）。 */
function Separator({
  className,
  orientation = "horizontal",
  decorative: _decorative,
  ...props
}: { className?: string; orientation?: "horizontal" | "vertical"; decorative?: boolean } & Omit<
  React.HTMLAttributes<HTMLElement>,
  "children"
>) {
  return (
    <HeroSeparator
      data-slot="separator"
      orientation={orientation}
      className={className}
      {...(props as Record<string, unknown>)}
    />
  )
}

export { Separator }
