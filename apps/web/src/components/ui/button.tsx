import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { Button as HeroButton } from "@heroui/react";
import { cn } from "@/lib/utils";
import { buttonVariants, heroSize, heroVariant, type LegacyButtonSize, type LegacyButtonVariant } from "./buttonVariants";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: LegacyButtonVariant | null;
  size?: LegacyButtonSize | null;
  asChild?: boolean;
}

/**
 * 应用内 Button：底层是 HeroUI Button（React Aria，Uber 主题）。
 * 保留原 shadcn 的 variant/size/onClick/disabled 接口，调用方无需改动；asChild 时只套 HeroUI 的类名。
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, disabled, type = "button", children, ...props }, ref) => {
    if (asChild) {
      return (
        <Slot ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props}>
          {children}
        </Slot>
      );
    }
    const { onClick, style, ...rest } = props;
    return (
      <HeroButton
        ref={ref}
        type={type as "button" | "submit" | "reset"}
        variant={heroVariant[variant ?? "default"]}
        size={heroSize[size ?? "default"]}
        isIconOnly={size === "icon"}
        isDisabled={disabled}
        className={className}
        style={style}
        onClick={onClick as React.MouseEventHandler<Element> | undefined}
        {...(rest as Record<string, unknown>)}
      >
        {children}
      </HeroButton>
    );
  },
);
Button.displayName = "Button";

export { Button };
