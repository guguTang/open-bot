/**
 * Image diagram card — design bot-diagram-card-design-v2 §2.
 * Auth attachment GET via ?access_token= on <img>; toolbar: copy URL · download · fullscreen.
 * No fake generated images — only real urls / attachments.
 */
import { Download, Maximize2, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  attachmentCopyUrl,
  attachmentDisplayUrl,
  fetchAttachmentBlob,
  imageDownloadFilename,
} from "../api";
import { copyText } from "../lib/diagramExport";
import { DiagramCardFrame, type DiagramOverflowItem } from "./DiagramCardFrame";

const diagramIcon = {
  size: 16,
  strokeWidth: 1.5,
  "aria-hidden": true as const,
  focusable: false as const,
};

const IconDownload = () => <Download {...diagramIcon} />;
const IconExpand = () => <Maximize2 {...diagramIcon} />;
const IconClose = () => <X {...diagramIcon} />;

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ImageFullscreen({
  src,
  alt,
  name,
  mime: _mime,
  onCopy,
  onDownload,
  downloading,
  onClose,
}: {
  src: string;
  alt: string;
  name?: string;
  mime?: string;
  onCopy: () => void;
  onDownload: () => void;
  downloading: boolean;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);
  scaleRef.current = scale;

  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prevFocus?.focus?.();
    };
  }, [onClose]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setScale((s) => Math.min(4, Math.max(0.25, s * Math.exp(-e.deltaY * 0.0015))));
    };
    let start: { dist: number; scale: number } | null = null;
    const dist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) start = { dist: dist(e.touches) || 1, scale: scaleRef.current };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      setScale(Math.min(4, Math.max(0.25, start.scale * (dist(e.touches) / start.dist))));
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) start = null;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  return createPortal(
    <div
      className="diagram-fs-backdrop diagram-fs-backdrop-image"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="diagram-fs diagram-fs-image" role="dialog" aria-modal="true" aria-label="图片">
        <div className="diagram-toolbar diagram-fs-toolbar">
          <span className="diagram-pill">图片</span>
          <div className="diagram-actions">
            <button type="button" className="diagram-btn diagram-btn-text" onClick={onCopy}>
              复制
            </button>
            <button
              type="button"
              className="diagram-btn diagram-btn-icon"
              aria-label="下载原图"
              title="下载原图"
              disabled={downloading}
              onClick={onDownload}
            >
              <IconDownload />
            </button>
            <button
              ref={closeRef}
              type="button"
              className="diagram-btn diagram-btn-icon"
              aria-label="关闭"
              title="关闭 (Esc)"
              onClick={onClose}
            >
              <IconClose />
            </button>
          </div>
        </div>
        <div
          ref={bodyRef}
          className="diagram-fs-body is-image"
          onDoubleClick={() => setScale(1)}
        >
          <img
            className="diagram-image-img diagram-image-img-fs"
            src={src}
            alt={alt || name || "图片"}
            style={{ transform: `scale(${scale})` }}
            draggable={false}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

export type ImageDiagramCardProps = {
  /** Relative attachment path, absolute URL, or blob:/data: (optimistic). */
  src: string;
  alt?: string;
  name?: string;
  mime?: string;
};

export function ImageDiagramCard({ src, alt, name, mime }: ImageDiagramCardProps) {
  const displaySrc = attachmentDisplayUrl(src);
  const copyTarget = attachmentCopyUrl(src);
  const [status, setStatus] = useState<"loading" | "ok" | "error">(
    displaySrc ? "loading" : "error",
  );
  const [retryKey, setRetryKey] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    setStatus(displaySrc ? "loading" : "error");
  }, [displaySrc, retryKey]);

  useEffect(() => {
    if (status !== "ok") setFullscreen(false);
  }, [status]);

  const onCopy = useCallback(() => {
    if (!copyTarget) {
      toast.message("暂不可复制", { duration: 1500 });
      return;
    }
    copyText(copyTarget).then(
      () => toast.success("已复制", { duration: 1500 }),
      () => toast.error("复制失败"),
    );
  }, [copyTarget]);

  const onDownload = useCallback(() => {
    if (!src) return;
    setDownloading(true);
    fetchAttachmentBlob(src)
      .then((blob) => {
        saveBlob(blob, imageDownloadFilename(name, mime || blob.type));
      })
      .catch(() => toast.error("下载失败"))
      .finally(() => setDownloading(false));
  }, [src, name, mime]);

  const ready = status === "ok" && Boolean(displaySrc);

  const actions = (
    <>
      <button
        type="button"
        className="diagram-btn diagram-btn-text"
        title={copyTarget ? "复制图片地址" : "暂不可复制"}
        disabled={!copyTarget}
        onClick={onCopy}
      >
        复制
      </button>
      <button
        type="button"
        className="diagram-btn diagram-btn-icon"
        aria-label="下载原图"
        title={ready || displaySrc ? "下载原图" : "图片就绪后可下载"}
        disabled={!displaySrc || downloading}
        onClick={onDownload}
      >
        <IconDownload />
      </button>
      <button
        type="button"
        className="diagram-btn diagram-btn-icon"
        aria-label="全屏"
        title={ready ? "全屏" : "图片就绪后可全屏"}
        disabled={!ready}
        onClick={() => setFullscreen(true)}
      >
        <IconExpand />
      </button>
    </>
  );

  const overflowItems: DiagramOverflowItem[] = [
    {
      key: "copy",
      label: "复制",
      disabled: !copyTarget,
      onClick: onCopy,
    },
    {
      key: "download",
      label: "下载",
      disabled: !displaySrc || downloading,
      onClick: onDownload,
    },
    {
      key: "fs",
      label: "全屏",
      disabled: !ready,
      onClick: () => setFullscreen(true),
    },
  ];

  let body: ReactNode;
  if (!displaySrc || status === "error") {
    body = (
      <div className="diagram-body diagram-body-image diagram-body-image-fail">
        <div className="diagram-image-fail" role="status">
          <span>图片加载失败</span>
          {displaySrc ? (
            <button
              type="button"
              className="diagram-btn diagram-btn-text"
              onClick={() => setRetryKey((k) => k + 1)}
            >
              重试
            </button>
          ) : null}
        </div>
      </div>
    );
  } else {
    body = (
      <div
        className={`diagram-body diagram-body-image${status === "loading" ? " is-loading" : ""}`}
        aria-busy={status === "loading"}
      >
        {status === "loading" ? <div className="diagram-image-skeleton" aria-hidden="true" /> : null}
        <img
          key={`${displaySrc}#${retryKey}`}
          className="diagram-image-img"
          src={displaySrc}
          alt={alt || name || "图片"}
          onLoad={() => setStatus("ok")}
          onError={() => setStatus("error")}
          onClick={() => {
            if (status === "ok") setFullscreen(true);
          }}
        />
      </div>
    );
  }

  return (
    <>
      <DiagramCardFrame
        kind="image"
        pending={status === "loading"}
        actions={actions}
        overflowItems={overflowItems}
      >
        {body}
      </DiagramCardFrame>
      {fullscreen && displaySrc && status === "ok" ? (
        <ImageFullscreen
          src={displaySrc}
          alt={alt || name || "图片"}
          name={name}
          mime={mime}
          onCopy={onCopy}
          onDownload={onDownload}
          downloading={downloading}
          onClose={() => setFullscreen(false)}
        />
      ) : null}
    </>
  );
}
