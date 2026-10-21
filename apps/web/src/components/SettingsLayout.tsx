import type { ReactNode } from "react";
import { Card } from "@heroui/react";
import { cn } from "@/lib/utils";

/** Outer wrapper for every Settings tab body. */
export function SettingsPage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("settings-page", className)}>{children}</div>;
}

/** Short helper / intro under the page title. */
export function SettingsHint({ children }: { children: ReactNode }) {
  return <p className="settings-hint">{children}</p>;
}

/** Labeled block: section title + optional right-side actions + card/content. */
export function SettingsSection({
  title,
  actions,
  children,
  className,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("settings-section", className)}>
      {title || actions ? (
        <div className="settings-section-head">
          {title ? <h3 className="settings-section-label">{title}</h3> : <span />}
          {actions ? <div className="settings-section-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function SettingsCard({
  children,
  className,
  padded,
}: {
  children: ReactNode;
  className?: string;
  /** Extra padding for free-form content (forms, prose). */
  padded?: boolean;
}) {
  return (
    <Card
      variant="secondary"
      className={cn("settings-card shadow-none", padded && "settings-card-padded", className)}
    >
      <Card.Content className="p-0">{children}</Card.Content>
    </Card>
  );
}

/** Centered empty-state line inside a card or section. */
export function SettingsEmpty({ children }: { children: ReactNode }) {
  return <div className="settings-empty">{children}</div>;
}
