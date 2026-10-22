import * as React from "react";
import { cn } from "@/lib/utils";

function Message({
  className,
  from,
  ...props
}: React.ComponentProps<"div"> & { from: "user" | "assistant" }) {
  return (
    <div
      data-slot="message"
      data-from={from}
      className={cn("group/message flex w-full flex-col", className)}
      {...props}
    />
  );
}

/** Bubble chrome. Pass existing bubble-* classes; layout stays in styles.css. */
function Bubble({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="bubble" className={cn(className)} {...props} />;
}

function MessageContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="message-content" className={cn(className)} {...props} />;
}

function MessageBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="message-body" className={cn(className)} {...props} />;
}

function MessageAvatar({
  className,
  show = true,
  alt: _alt,
  ...props
}: React.ComponentProps<"span"> & { show?: boolean; alt?: string }) {
  if (!show) return null;
  return <span data-slot="message-avatar" className={cn("shrink-0", className)} {...props} />;
}

export { Message, Bubble, MessageContent, MessageBody, MessageAvatar };
