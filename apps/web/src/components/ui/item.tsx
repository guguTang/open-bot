import * as React from "react";
import { cn } from "@/lib/utils";

function ItemGroup({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="item-group"
      className={cn("group/item-group flex w-full min-w-0 list-none flex-col p-0", className)}
      {...props}
    />
  );
}

function Item({
  className,
  selected,
  ...props
}: React.ComponentProps<"li"> & { selected?: boolean }) {
  return (
    <li
      data-slot="item"
      data-selected={selected ? "true" : undefined}
      className={cn("group/item relative flex w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 py-2 text-sm", className)}
      {...props}
    />
  );
}

function ItemMedia({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="item-media" className={cn("flex shrink-0 items-center", className)} {...props} />;
}

function ItemContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-content"
      className={cn("flex min-w-0 flex-1 items-center gap-2.5", className)}
      {...props}
    />
  );
}

function ItemTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="item-title" className={cn("truncate text-sm font-medium leading-snug", className)} {...props} />;
}

function ItemDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="item-description" className={cn("truncate text-xs text-muted", className)} {...props} />;
}

function ItemActions({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="item-actions" className={cn("flex shrink-0 items-center gap-0.5", className)} {...props} />;
}

function ItemSeparator({ className, ...props }: React.ComponentProps<"div">) {
  return <div role="separator" data-slot="item-separator" className={cn("my-0 h-px bg-border", className)} {...props} />;
}

export { Item, ItemMedia, ItemContent, ItemActions, ItemGroup, ItemSeparator, ItemTitle, ItemDescription };
