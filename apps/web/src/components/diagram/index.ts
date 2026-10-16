/**
 * Diagram interaction module — shared chrome for Mermaid / HTML / image cards.
 *
 * Public surface (adapters should prefer these over reaching into diagramUi):
 * - useDiagramCardChrome — source toggle + fullscreen open/close
 * - DiagramFullscreenShell — portal backdrop / Escape / focus restore
 * - diagram toolbar helpers — copy / expand / download / source toggle / overflow
 * - DiagramPendingBody / DiagramSourceBody — pending & source/error shells
 * - useDiagramZoom — Mermaid SVG zoom (inline + fullscreen)
 * - copyDiagramText — clipboard + toast
 *
 * diagramUi class strings are internal styling tokens for this package.
 */

export { useDiagramCardChrome } from "./useDiagramCardChrome";
export type { DiagramCardChrome, UseDiagramCardChromeOptions } from "./useDiagramCardChrome";

export { DiagramFullscreenShell } from "./DiagramFullscreenShell";
export type { DiagramFullscreenShellProps } from "./DiagramFullscreenShell";

export {
  DiagramPendingBody,
  DiagramSourceBody,
  useDiagramSourceTailScroll,
} from "./diagramBody";

export {
  DiagramCopyButton,
  DiagramDownloadIconButton,
  DiagramDownloadMenu,
  DiagramExpandButton,
  DiagramIconButton,
  DiagramSourceToggleButton,
  DiagramTextButton,
} from "./diagramToolbar";

export { diagramOverflowItems } from "./diagramToolbarModel";

export {
  DIAGRAM_FULLSCREEN_ZOOM,
  DIAGRAM_IMAGE_FULLSCREEN_ZOOM,
  DIAGRAM_INLINE_ZOOM,
  useDiagramZoom,
} from "./useDiagramZoom";

export { copyDiagramText } from "./diagramCopy";

export {
  DiagramIconClose,
  DiagramIconDownload,
  DiagramIconExpand,
  DiagramIconMinus,
  DiagramIconPlus,
} from "./diagramIcons";
