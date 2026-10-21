import * as React from "react";
import { cn } from "@/lib/utils";

function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="scroll-area"
      className={cn("relative overflow-hidden", className)}
      {...props}
    >
      <div
        data-slot="scroll-area-viewport"
        className="size-full max-h-[inherit] overflow-x-hidden overflow-y-auto overscroll-contain outline-none"
      >
        {children}
      </div>
    </div>
  );
}

function ScrollBar(_props: { orientation?: "vertical" | "horizontal"; className?: string }) {
  return null;
}

export { ScrollArea, ScrollBar };
