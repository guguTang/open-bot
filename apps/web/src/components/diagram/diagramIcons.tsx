import { ChevronDown, Download, Maximize2, Minus, Plus, X } from "lucide-react";

const diagramIcon = {
  size: 16,
  strokeWidth: 1.5,
  "aria-hidden": true as const,
  focusable: false as const,
};

export const DiagramIconDownload = () => <Download {...diagramIcon} />;
export const DiagramIconCaret = () => (
  <ChevronDown size={8} strokeWidth={1.3} aria-hidden focusable={false} />
);
export const DiagramIconExpand = () => <Maximize2 {...diagramIcon} />;
export const DiagramIconClose = () => <X {...diagramIcon} />;
export const DiagramIconMinus = () => <Minus {...diagramIcon} />;
export const DiagramIconPlus = () => <Plus {...diagramIcon} />;
