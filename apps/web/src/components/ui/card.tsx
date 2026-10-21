import * as React from "react";
import { Card as HeroCard } from "@heroui/react";
import { cn } from "@/lib/utils";

function Card({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm" }) {
  return (
    <HeroCard
      variant="secondary"
      data-size={size}
      className={cn(
        "group/card flex flex-col gap-3 overflow-hidden shadow-none",
        size === "sm" && "gap-2 p-3",
        size === "default" && "p-4",
        className,
      )}
      {...(props as object)}
    >
      {children}
    </HeroCard>
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <HeroCard.Header className={cn("flex flex-col gap-1", className)} {...props} />;
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <HeroCard.Title className={cn("text-base font-medium leading-snug", className)} {...props} />;
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <HeroCard.Description className={cn("text-sm text-muted", className)} {...props} />;
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <HeroCard.Content className={cn("px-0", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <HeroCard.Footer className={cn("flex items-center gap-2 pt-1", className)} {...props} />;
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-action" className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)} {...props} />;
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent };
