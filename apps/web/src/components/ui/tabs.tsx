import * as React from "react";
import { Tabs as HeroTabs } from "@heroui/react";
import { cn } from "@/lib/utils";
import type { Key } from "react-aria-components";

type TabsProps = {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  orientation?: "horizontal" | "vertical";
  className?: string;
  children?: React.ReactNode;
  variant?: "primary" | "secondary";
};

function Tabs({
  value,
  defaultValue,
  onValueChange,
  orientation = "horizontal",
  className,
  children,
  variant = "secondary",
}: TabsProps) {
  return (
    <HeroTabs
      selectedKey={value}
      defaultSelectedKey={defaultValue}
      onSelectionChange={(key: Key) => onValueChange?.(String(key))}
      orientation={orientation}
      variant={variant}
      className={cn(
        "group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
        className,
      )}
    >
      {children}
    </HeroTabs>
  );
}

function TabsList({
  className,
  variant: _variant,
  children,
  ...props
}: React.ComponentProps<"div"> & { variant?: "default" | "line" }) {
  return (
    <HeroTabs.ListContainer className={cn("w-full", className)}>
      <HeroTabs.List
        aria-label={(props as { "aria-label"?: string })["aria-label"] || "选项"}
        className={cn(
          "inline-flex w-full items-stretch gap-0.5 rounded-lg p-0",
          "group-data-[orientation=vertical]/tabs:flex-col",
        )}
      >
        {children}
      </HeroTabs.List>
    </HeroTabs.ListContainer>
  );
}

function TabsTrigger({
  className,
  value,
  children,
  disabled,
  ...props
}: React.ComponentProps<"button"> & { value: string }) {
  return (
    <HeroTabs.Tab
      id={value}
      isDisabled={disabled}
      className={cn(
        "relative inline-flex h-auto flex-none items-center justify-start gap-2.5 rounded-md px-3 py-2 text-sm font-medium outline-none",
        "text-muted data-[selected=true]:bg-default data-[selected=true]:text-foreground",
        "hover:text-foreground",
        className,
      )}
      {...(props as object)}
    >
      {children}
      <HeroTabs.Indicator />
    </HeroTabs.Tab>
  );
}

function TabsContent({
  className,
  value,
  children,
  forceMount,
  ...props
}: React.ComponentProps<"div"> & { value: string; forceMount?: boolean }) {
  void forceMount;
  void props;
  return (
    <HeroTabs.Panel id={value} className={cn("flex-1 outline-none", className)}>
      {children}
    </HeroTabs.Panel>
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
