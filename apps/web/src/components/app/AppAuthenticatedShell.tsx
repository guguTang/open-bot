import type { ReactNode } from "react";
import { useIsNarrowLayout, useSheetFormUi } from "../useIsTouchUi";
import { useShellStore } from "../../stores/shell";

export function AppAuthenticatedShell({ children }: { children: ReactNode }) {
  const isNarrowLayout = useIsNarrowLayout();
  const mobileView = useShellStore((s) => s.mobileView);
  const sheetForm = useSheetFormUi();

  return (
    <div className={`app${isNarrowLayout ? ` mobile-${mobileView}` : ""}${sheetForm ? " shell-narrow" : ""}`}>
      {children}
    </div>
  );
}
