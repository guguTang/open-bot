import { cn } from "@/lib/utils";

/** ≥44px controls on touch-ui / panel-compact (was --diagram-hit in styles.css). */
const diagramTouchHit = cn(
  "max-[720px]:h-11 max-[720px]:min-w-11",
  "[html.touch-ui_&]:h-11 [html.touch-ui_&]:min-w-11",
);

/** Root card shell (Mermaid / HTML / image). */
export const diagramCardClass = cn(
  "relative my-2 max-w-full min-w-0 rounded-xl border text-[13px] text-[var(--text)]",
  "bg-[#f8fafc] border-[var(--border)]",
  "[data-theme=dark]:bg-[#1f1f1f] [data-theme=dark]:border-white/10 [data-theme=dark]:text-[#e5e5e5]",
  "[&+&]:mt-3",
);

export const diagramToolbarClass = cn(
  "flex h-8 shrink-0 items-center gap-1.5 border-b border-[var(--border)] px-0.5 pl-2",
  "rounded-t-[11px] [data-theme=dark]:border-white/10",
  diagramTouchHit,
  "max-[720px]:h-11 [html.touch-ui_&]:h-11",
);

export const diagramFsToolbarClass = cn(
  diagramToolbarClass,
  "h-9 shrink-0 rounded-none px-1 pl-3",
  "max-md:h-[calc(36px+var(--safe-top,0px))] max-md:pt-[var(--safe-top,0px)] max-md:px-0.5 max-md:pl-2",
  "[html.touch-ui_&]:max-md:h-[calc(44px+var(--safe-top,0px))] max-[720px]:max-md:h-[calc(44px+var(--safe-top,0px))]",
);

export const diagramPillClass = cn(
  "shrink-0 select-none rounded-full px-2 py-px text-[11px] font-medium leading-[18px]",
  "bg-slate-900/[0.06] text-[var(--muted)]",
  "[data-theme=dark]:bg-white/[0.08] [data-theme=dark]:text-[#a1a1aa]",
);

export const diagramToolbarExtraClass = "flex min-w-0 items-center";

export const diagramActionsClass = "ml-auto flex items-center gap-0";

export const diagramActionsInlineClass = (collapsed: boolean) =>
  cn(
    "flex items-center gap-0",
    collapsed && "pointer-events-none invisible absolute left-0 top-0 w-max",
  );

export const diagramActionsMoreClass = (visible: boolean) =>
  cn("flex items-center", !visible && "hidden!");

export const diagramBtnClass = cn(
  "inline-flex cursor-pointer items-center justify-center gap-0.5 border-0 bg-transparent p-0",
  "h-8 min-w-8 rounded-lg text-xs leading-none text-[var(--muted)]",
  diagramTouchHit,
  "[-webkit-tap-highlight-color:transparent]",
  "hover:enabled:bg-slate-900/[0.06] hover:enabled:text-[var(--text)]",
  "focus-visible:outline-none focus-visible:bg-slate-900/[0.06] focus-visible:text-[var(--text)]",
  "[data-theme=dark]:hover:enabled:text-[#f5f5f5] [data-theme=dark]:focus-visible:text-[#f5f5f5]",
  "disabled:cursor-not-allowed disabled:opacity-45",
  "aria-pressed:text-[var(--text)]",
  "[&_svg]:size-4 [&_svg]:shrink-0",
);

export const diagramBtnTextClass = cn(diagramBtnClass, "px-2 max-md:px-1.5");

export const diagramBtnIconClass = diagramBtnClass;

export const diagramBtnDownloadClass = cn(
  diagramBtnIconClass,
  "[&_svg+svg]:size-2",
);

export const diagramMenuWrapClass = "relative";

export const diagramMenuClass = cn(
  "absolute right-0 top-[calc(100%+2px)] z-30 min-w-24 rounded-[10px] border p-1",
  "border-[var(--border)] bg-[var(--bg-elevated)] shadow-[var(--shadow-md)]",
  "[data-theme=dark]:border-white/[0.12] [data-theme=dark]:bg-[#262626]",
);

export const diagramOverflowMenuClass = cn(diagramMenuClass, "min-w-32");

export const diagramMenuItemClass = cn(
  "block h-8 w-full cursor-pointer rounded-md border-0 bg-transparent px-2.5 text-left text-[12.5px] text-inherit",
  "hover:bg-slate-900/[0.06] focus-visible:outline-none focus-visible:bg-slate-900/[0.06]",
  "[data-theme=dark]:hover:bg-white/[0.08] [data-theme=dark]:focus-visible:bg-white/[0.08]",
  "max-[720px]:h-auto max-[720px]:min-h-11 max-[720px]:py-2.5",
  "[html.touch-ui_&]:h-auto [html.touch-ui_&]:min-h-11 [html.touch-ui_&]:py-2.5",
);

export const diagramZoomBadgeClass = cn(
  "m-0 cursor-pointer rounded-full border-0 bg-transparent px-1.5 py-px text-[11px] text-[var(--muted)]",
  "hover:bg-slate-900/[0.06] [data-theme=dark]:hover:bg-white/[0.08]",
);

export const diagramBodyClass = cn(
  "max-h-[360px] overflow-auto overscroll-contain rounded-b-[11px] [scrollbar-width:thin]",
  "max-md:max-h-60",
);

export const diagramBodyRenderClass = cn(diagramBodyClass, "cursor-default");

export const diagramCanvasClass = (opts?: { enter?: boolean; fullscreen?: boolean }) =>
  cn(
    "box-border flex w-max min-w-full justify-center p-3",
    "[&_svg]:block [&_svg]:max-w-none [&_svg]:shrink-0",
    opts?.fullscreen ? "min-h-full items-center p-4" : "items-start",
    opts?.enter &&
      "motion-safe:animate-[diagram-enter_180ms_ease-out] motion-reduce:animate-none",
  );

export const diagramSourceClass = cn(
  "m-0 whitespace-pre bg-transparent px-3 py-2.5 font-mono text-[12.5px] leading-normal text-inherit [tab-size:2]",
);

export const diagramSourceFsClass = cn(diagramSourceClass, "px-4 py-3.5");

export const diagramBodyPendingClass = cn(diagramBodyClass, "flex flex-col overflow-hidden");

export const diagramPendingLabelClass = cn(
  "flex items-center gap-1.5 px-3 pt-2 text-xs text-[var(--muted)]",
  "[data-theme=dark]:text-[#a1a1aa]",
);

export const diagramPendingDotClass = cn(
  "size-1.5 shrink-0 rounded-full bg-[var(--accent)]",
  "motion-safe:animate-[diagram-pulse_1.2s_ease-in-out_infinite] motion-reduce:animate-none",
);

export const diagramSourceTailClass = cn(
  diagramSourceClass,
  "max-h-40 overflow-auto text-[var(--muted)] [scrollbar-width:thin] max-md:max-h-[120px]",
  "[data-theme=dark]:text-[#a1a1aa]",
);

export const diagramWarningClass = cn(
  "mx-3 mt-2.5 rounded-lg px-2.5 py-1.5 text-[12.5px] leading-snug",
  "bg-amber-500/14 text-[#a16207]",
  "[data-theme=dark]:bg-amber-400/16 [data-theme=dark]:text-[#facc15]",
);

export const diagramFsBackdropClass = cn(
  "fixed inset-0 z-[90] grid place-items-center bg-slate-900/55",
);

export const diagramFsBackdropImageClass = "bg-black/[0.82]";

export const diagramFsShellClass = cn(
  "flex flex-col overflow-hidden rounded-xl border text-[var(--text)] shadow-[var(--shadow-lg)]",
  "h-[85vh] w-[90vw] bg-[#f8fafc] border-[var(--border)]",
  "[data-theme=dark]:bg-[#1f1f1f] [data-theme=dark]:border-white/10 [data-theme=dark]:text-[#e5e5e5]",
  "max-md:h-dvh max-md:h-screen max-md:w-screen max-md:rounded-none max-md:border-none",
);

export const diagramFsShellImageClass = cn(
  diagramFsShellClass,
  "border-white/[0.12] bg-[#111] text-[#e5e5e5]",
);

export const diagramZoomGroupClass = cn(
  "ml-2 flex items-center max-md:ml-0.5",
);

export const diagramZoomValueClass = cn(diagramBtnTextClass, "min-w-[52px] tabular-nums");

export const diagramZoomStepClass = cn(diagramBtnIconClass, "max-md:hidden");

export const diagramZoomFitClass = cn(diagramBtnTextClass, "max-md:hidden");

export const diagramFsBodyClass = (opts?: { source?: boolean; html?: boolean; image?: boolean }) =>
  cn(
    "min-h-0 flex-1 overflow-auto overscroll-contain touch-pan-x touch-pan-y",
    opts?.html && "flex flex-col p-0",
    opts?.image && "grid place-items-center bg-[#0a0a0a] p-4 touch-pan-x touch-pan-y",
  );

export const diagramBodyHtmlClass = cn(
  diagramBodyClass,
  "h-[360px] max-h-[360px] overflow-hidden p-0 max-md:h-60 max-md:max-h-60",
);

export const diagramHtmlIframeClass = "block size-full border-0 bg-transparent [color-scheme:inherit]";

export const diagramHtmlIframeFsClass = cn(
  diagramHtmlIframeClass,
  "min-h-0 flex-1",
);

export const diagramBodyImageClass = cn(
  diagramBodyClass,
  "relative flex min-h-20 items-center justify-center overflow-auto bg-[#f8fafc] p-2",
  "[data-theme=dark]:bg-[#1f1f1f]",
);

export const diagramBodyImageFailClass = cn(diagramBodyImageClass, "min-h-[100px]");

export const diagramImageImgClass = cn(
  "block max-h-[calc(360px-16px)] max-w-full cursor-zoom-in rounded object-contain",
  "max-md:max-h-[calc(240px-16px)]",
  "group-[.is-loading]/img:pointer-events-none group-[.is-loading]/img:absolute group-[.is-loading]/img:size-px group-[.is-loading]/img:opacity-0",
);

export const diagramImageSkeletonClass = cn(
  "h-[140px] w-full max-w-[280px] rounded-lg bg-[length:200%_100%]",
  "bg-[linear-gradient(90deg,rgba(15,23,42,0.06)_0%,rgba(15,23,42,0.12)_50%,rgba(15,23,42,0.06)_100%)]",
  "[data-theme=dark]:bg-[linear-gradient(90deg,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0.16)_50%,rgba(255,255,255,0.08)_100%)]",
  "motion-safe:animate-[diagram-image-shimmer_1.2s_ease-in-out_infinite] motion-reduce:animate-none",
);

export const diagramImageFailClass = cn(
  "flex flex-col items-center gap-2 p-4 text-[13px] text-[var(--muted)]",
  "[data-theme=dark]:text-[#a1a1aa]",
);

export const diagramImageImgFsClass = cn(
  "block max-h-full max-w-full cursor-default object-contain transition-transform duration-[50ms] ease-linear",
  "motion-reduce:transition-none",
);
