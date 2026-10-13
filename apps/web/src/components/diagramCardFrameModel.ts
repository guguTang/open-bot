export type DiagramKind = "mermaid" | "html" | "image";

export const KIND_LABEL: Record<DiagramKind, string> = {
  mermaid: "Mermaid",
  html: "HTML",
  image: "图片",
};

/** Flat items shown in the toolbar ⋯ menu when inline actions do not fit. */
export type DiagramOverflowItem = {
  key: string;
  label: string;
  disabled?: boolean;
  onClick: () => void;
};
