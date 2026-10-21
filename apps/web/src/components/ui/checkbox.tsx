import * as React from "react"
import { cn } from "cn"
import { CheckIcon } from "lucide-react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

/** HeroUI Checkbox 外观（.checkbox / .checkbox__control，读 aria-checked），行为仍是 Radix。 */
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn("checkbox checkbox--primary shrink-0 border-0 bg-transparent p-0", className)}
      {...props}
    >
      <span className="checkbox__control">
        <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="checkbox__indicator grid place-content-center">
          <CheckIcon className="size-3" strokeWidth={3} />
        </CheckboxPrimitive.Indicator>
      </span>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
