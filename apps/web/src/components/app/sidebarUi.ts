/**
 * Sidebar chrome helpers.
 *
 * Pro Sidebar (Provider / Rail / Mobile sheet) is NOT wrapping the app shell:
 * AppAuthenticatedShell drives Tauri/Capacitor via `.app.mobile-*` + `.shell-narrow`
 * and safe-area CSS. A full Sidebar.Provider would fight that layout. Conversation
 * rows use @heroui-pro/react ListView inside this aside instead.
 */
import { cn } from "@/lib/utils";

/** Scrollport class — paired with global scrollbar rules in styles.css */
export const SIDEBAR_SCROLL = "sidebar-scroll";

export function sidebarAsideClass(opts: { sheetForm: boolean; hideOnMobileChat: boolean }) {
  return cn(
    "sidebar flex min-h-0 flex-col overflow-hidden overscroll-none bg-[var(--bg-elevated)]",
    opts.hideOnMobileChat && "hidden",
    opts.sheetForm
      ? "m-0 h-full max-h-full gap-0 rounded-none p-0 shadow-none"
      : "my-2.5 ml-2.5 mr-0 h-[calc(100%-20px)] max-h-[calc(100%-20px)] gap-2.5 rounded-2xl p-2.5 shadow-[var(--shadow-md)]",
  );
}

export function sidebarIconBtnClass(opts: { sheetPlus?: boolean } = {}) {
  return cn(
    "grid size-9 shrink-0 cursor-pointer place-items-center rounded-[var(--radius-pill)] border-0 bg-[var(--bg-soft)] text-[var(--muted)]",
    "hover:bg-[var(--bg-hover)] hover:text-[var(--text)]",
    "[&_svg]:shrink-0 [&_svg]:opacity-55",
    "[-webkit-tap-highlight-color:transparent] focus:outline-none focus-visible:outline-none focus:shadow-none",
    opts.sheetPlus &&
      "size-11 min-h-11 min-w-11 rounded-full p-0 active:brightness-[0.96] [data-theme=dark]:bg-white/10",
  );
}

export function sidebarSectionLabelClass(sheetForm: boolean) {
  return cn(
    "shrink-0 text-[11px] uppercase tracking-[0.06em] text-[var(--muted)]",
    sheetForm ? "px-4 pt-1" : "px-2.5 pt-1",
  );
}

export function sidebarListClass(sheetForm: boolean) {
  return cn(
    SIDEBAR_SCROLL,
    "flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain",
    sheetForm ? "gap-0" : "gap-0.5",
  );
}

export function sidebarConvRowClass(opts: { sheetForm: boolean; active: boolean; channel?: boolean }) {
  return cn(
    "group relative flex w-full cursor-pointer items-center overflow-visible border-0 bg-transparent text-left text-inherit",
    "[content-visibility:auto] [contain-intrinsic-size:auto_72px]",
    opts.sheetForm ? "min-h-16 gap-3 rounded-none px-3.5 py-2.5" : "gap-2.5 rounded-xl px-2.5 py-2",
    !opts.channel && "hover:bg-[var(--bg-soft)]",
    opts.active && "bg-[var(--bg-hover)]",
    opts.channel && "cursor-default opacity-[0.92] hover:bg-transparent",
  );
}

/** Floating action cluster on the right of a conversation row (parent must be `relative`). */
export function sidebarConvActionsFloatClass(opts: { active?: boolean; touchOrSheet?: boolean } = {}) {
  return cn(
    "absolute right-1.5 top-1/2 z-1 flex -translate-y-1/2 items-center gap-0.5 pl-4",
    // Soft fade so ellipsized text doesn't collide with visible controls
    "bg-gradient-to-l from-55% to-transparent group-hover:from-[var(--bg-soft)]",
    opts.active ? "from-[var(--bg-hover)]" : "from-[var(--bg-elevated)]",
    opts.touchOrSheet
      ? "right-2"
      : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100",
  );
}

export function sidebarConvActionClass(opts: { touchOrSheet: boolean; variant: "settings" | "clone" | "del" }) {
  const base = cn(
    "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-[var(--muted)]",
    opts.touchOrSheet ? "size-11 min-h-11 min-w-11 p-0 opacity-100" : "p-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
  );
  if (opts.variant === "del") {
    return cn(
      base,
      "text-base leading-none px-1.5 py-0.5",
      opts.touchOrSheet && "opacity-0 group-hover:opacity-0 group-focus-within:opacity-0 focus-visible:opacity-100",
      "hover:bg-red-600/10 hover:text-[var(--danger)]",
    );
  }
  return cn(base, "hover:bg-[var(--bg-soft)] hover:text-[var(--text)]");
}

export function sidebarSectionFoldHeadClass() {
  return cn(
    "flex w-full shrink-0 cursor-pointer items-center justify-between gap-2 border-0 bg-transparent px-4 pb-1.5 pt-2.5",
    "min-h-10 text-left text-[13px] font-semibold tracking-[0.02em] text-[var(--muted)]",
    "active:bg-[var(--bg-soft)]",
    "[-webkit-tap-highlight-color:transparent] focus:outline-none",
  );
}

export const channelMemberStackClass = cn(
  "mr-1.5 inline-flex shrink-0 items-center",
  "[&_.agent-avatar-wrap]:-ml-1.5 [&_.agent-avatar-wrap]:overflow-visible",
  "[&_.agent-avatar-wrap:first-child]:ml-0",
);

export function runBusyDotClass() {
  return "ml-1.5 inline-block size-[7px] animate-pulse rounded-full bg-emerald-400 align-middle";
}
