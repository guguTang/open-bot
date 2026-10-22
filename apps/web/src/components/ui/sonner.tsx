"use client";

import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { resolveTheme, useThemePreference } from "@/lib/theme";

function Toaster({ ...props }: ToasterProps) {
  const pref = useThemePreference();
  const theme = resolveTheme(pref);
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      position="top-center"
      style={
        {
          "--normal-bg": "var(--overlay)",
          "--normal-text": "var(--overlay-foreground)",
          "--normal-border": "var(--border)",
        } as CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
