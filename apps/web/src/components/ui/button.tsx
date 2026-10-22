import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";
import { buttonVariants, type LegacyButtonSize, type LegacyButtonVariant } from "./buttonVariants";

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
  variant?: LegacyButtonVariant | null;
  size?: LegacyButtonSize | null;
  asChild?: boolean;
  /** Icon-only square. `size="sm"` maps to icon-sm. */
  isIconOnly?: boolean;
  isDisabled?: boolean;
  /** Disables the control and sets aria-busy (submit pending). */
  isPending?: boolean;
  fullWidth?: boolean;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  /** Same as onClick; kept so former HeroUI call sites compile. */
  onPress?: React.MouseEventHandler<HTMLButtonElement>;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      isIconOnly = false,
      isDisabled,
      isPending,
      fullWidth,
      disabled,
      type = "button",
      onClick,
      onPress,
      children,
      ...props
    },
    ref,
  ) => {
    const resolvedSize: LegacyButtonSize | null | undefined = isIconOnly
      ? size === "sm" || size === "icon-sm"
        ? "icon-sm"
        : size === "lg" || size === "icon-lg"
          ? "icon-lg"
          : "icon"
      : size;
    const isOff = Boolean(disabled || isDisabled || isPending);
    const handleClick: React.MouseEventHandler<HTMLButtonElement> = (event) => {
      onClick?.(event);
      onPress?.(event);
    };
    const classes = cn(buttonVariants({ variant, size: resolvedSize }), fullWidth && "w-full", className);
    if (asChild) {
      return (
        <Slot ref={ref} className={classes} {...props}>
          {children}
        </Slot>
      );
    }
    return (
      <button
        ref={ref}
        type={type}
        data-slot="button"
        data-variant={variant ?? "default"}
        data-size={resolvedSize ?? "default"}
        className={classes}
        disabled={isOff}
        aria-busy={isPending || undefined}
        onClick={handleClick}
        {...props}
      >
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";

export { Button };
