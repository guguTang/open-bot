/**
 * Image diagram card — design bot-diagram-card-design-v2 §2.
 * Auth attachment GET via ?access_token= on <img>; toolbar: copy URL · download · fullscreen.
 * Fullscreen lightbox: open at fit-contain, then Ctrl/Cmd+wheel / pinch / toolbar zoom,
 * drag or scroll to pan. No fake generated images — only real urls / attachments.
 * Interaction chrome from `./diagram`.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "@/lib/toast";
import {
  attachmentCopyUrl,
  attachmentDisplayUrl,
  fetchAttachmentBlob,
  imageDownloadFilename,
} from "../api";
import { cn } from "@/lib/utils";
import { DiagramCardFrame } from "./DiagramCardFrame";
import { type DiagramOverflowItem } from "./diagramCardFrameModel";
import {
  copyDiagramText,
  DIAGRAM_IMAGE_FULLSCREEN_ZOOM,
  DiagramCopyButton,
  DiagramDownloadIconButton,
  DiagramExpandButton,
  DiagramFullscreenShell,
  DiagramIconMinus,
  DiagramIconPlus,
  diagramOverflowItems,
  useDiagramCardChrome,
  useDiagramZoom,
} from "./diagram";
import {
  diagramBodyImageClass,
  diagramBodyImageFailClass,
  diagramBtnTextClass,
  diagramFsBodyClass,
  diagramImageFailClass,
  diagramImageImgClass,
  diagramImageImgFsClass,
  diagramImageSkeletonClass,
  diagramZoomFitClass,
  diagramZoomGroupClass,
  diagramZoomStepClass,
  diagramZoomValueClass,
} from "./diagram/diagramUi";

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

/** Pointer drag → scrollLeft/Top so zoomed images can pan without relying on scrollbars. */
function useImageDragPan(el: HTMLElement | null) {
  useEffect(() => {
    if (!el) return;
    let dragging = false;
    let pid: number | null = null;
    let x = 0;
    let y = 0;

    const overflows = () =>
      el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || !overflows()) return;
      dragging = true;
      pid = e.pointerId;
      x = e.clientX;
      y = e.clientY;
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== pid) return;
      const dx = e.clientX - x;
      const dy = e.clientY - y;
      x = e.clientX;
      y = e.clientY;
      el.scrollLeft -= dx;
      el.scrollTop -= dy;
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      dragging = false;
      pid = null;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, [el]);
}

function ImageFullscreen({
  src,
  alt,
  name,
  onCopy,
  onDownload,
  downloading,
  onClose,
}: {
  src: string;
  alt: string;
  name?: string;
  onCopy: () => void;
  onDownload: () => void;
  downloading: boolean;
  onClose: () => void;
}) {
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const { scale, setScale } = useDiagramZoom(bodyEl, {
    ...DIAGRAM_IMAGE_FULLSCREEN_ZOOM,
    enabled: Boolean(nat),
    pinch: true,
  });
  useImageDragPan(bodyEl);

  const fitScale = useCallback(() => {
    if (!bodyEl || !nat) return 1;
    const pad = 32; // body p-4
    const sw = (bodyEl.clientWidth - pad) / nat.w;
    const sh = (bodyEl.clientHeight - pad) / nat.h;
    // Contain: entire image visible; do not upscale past 100% natural.
    return Math.min(1, sw, sh);
  }, [bodyEl, nat]);

  // Capture natural size (cached images may already be complete).
  useLayoutEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const apply = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        setNat({ w: img.naturalWidth, h: img.naturalHeight });
      }
    };
    apply();
    img.addEventListener("load", apply);
    return () => img.removeEventListener("load", apply);
  }, [src]);

  // On open: fit entire image in view (object-fit: contain equivalent).
  // Gate sized layout until fit runs so we never flash at 100% natural on large shots.
  const [fitReady, setFitReady] = useState(false);
  useLayoutEffect(() => {
    if (fitReady || !bodyEl || !nat) return;
    setScale(fitScale());
    setFitReady(true);
  }, [bodyEl, nat, fitScale, setScale, fitReady]);

  const sized = Boolean(nat && fitReady);
  const displayW = sized && nat ? Math.max(1, Math.round(nat.w * scale)) : undefined;
  const displayH = sized && nat ? Math.max(1, Math.round(nat.h * scale)) : undefined;

  return (
    <DiagramFullscreenShell
      label="图片"
      ariaLabel="图片"
      variant="image"
      toolbarCenter={
        <div className={diagramZoomGroupClass} aria-label="缩放">
          <button
            type="button"
            className={diagramZoomStepClass}
            aria-label="缩小"
            title="缩小"
            disabled={!nat}
            onClick={() => setScale((s) => s / 1.25)}
          >
            <DiagramIconMinus />
          </button>
          <button
            type="button"
            className={diagramZoomValueClass}
            title="重置为 100%"
            disabled={!nat}
            onClick={() => setScale(1)}
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            type="button"
            className={diagramZoomStepClass}
            aria-label="放大"
            title="放大"
            disabled={!nat}
            onClick={() => setScale((s) => s * 1.25)}
          >
            <DiagramIconPlus />
          </button>
          <button
            type="button"
            className={diagramZoomFitClass}
            title="适应窗口"
            disabled={!nat}
            onClick={() => setScale(fitScale())}
          >
            适应
          </button>
        </div>
      }
      actions={
        <>
          <DiagramCopyButton onClick={onCopy} />
          <DiagramDownloadIconButton
            ariaLabel="下载原图"
            title="下载原图"
            disabled={downloading}
            onClick={onDownload}
          />
        </>
      }
      bodyRef={setBodyEl}
      bodyClassName={diagramFsBodyClass({ image: true })}
      onBodyDoubleClick={() => setScale(fitScale())}
      onClose={onClose}
    >
      <img
        ref={imgRef}
        className={diagramImageImgFsClass}
        src={src}
        alt={alt || name || "图片"}
        width={displayW}
        height={displayH}
        style={
          sized
            ? { width: displayW, height: displayH }
            : { maxWidth: "100%", maxHeight: "100%" }
        }
        draggable={false}
      />
    </DiagramFullscreenShell>
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
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    setStatus(displaySrc ? "loading" : "error");
  }, [displaySrc, retryKey]);

  const ready = status === "ok" && Boolean(displaySrc);
  const { fullscreen, openFullscreen, closeFullscreen } = useDiagramCardChrome({ ready });

  const onCopy = useCallback(() => {
    copyDiagramText(copyTarget, {
      emptyMessage: "暂不可复制",
      failMessage: "复制失败",
    });
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

  const actions = (
    <>
      <DiagramCopyButton
        onClick={onCopy}
        disabled={!copyTarget}
        title={copyTarget ? "复制图片地址" : "暂不可复制"}
      />
      <DiagramDownloadIconButton
        ariaLabel="下载原图"
        title={ready || displaySrc ? "下载原图" : "图片就绪后可下载"}
        disabled={!displaySrc || downloading}
        onClick={onDownload}
      />
      <DiagramExpandButton
        ready={ready}
        onClick={openFullscreen}
        disabledTitle="图片就绪后可全屏"
      />
    </>
  );

  const overflowItems: DiagramOverflowItem[] = diagramOverflowItems(
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
      onClick: openFullscreen,
    },
  );

  let body: ReactNode;
  if (!displaySrc || status === "error") {
    body = (
      <div className={diagramBodyImageFailClass}>
        <div className={diagramImageFailClass} role="status">
          <span>图片加载失败</span>
          {displaySrc ? (
            <button
              type="button"
              className={diagramBtnTextClass}
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
        className={cn(diagramBodyImageClass, status === "loading" && "is-loading group/img")}
        aria-busy={status === "loading"}
      >
        {status === "loading" ? (
          <div className={diagramImageSkeletonClass} aria-hidden="true" />
        ) : null}
        <img
          key={`${displaySrc}#${retryKey}`}
          className={diagramImageImgClass}
          src={displaySrc}
          alt={alt || name || "图片"}
          onLoad={() => setStatus("ok")}
          onError={() => setStatus("error")}
          role={status === "ok" ? "button" : undefined}
          tabIndex={status === "ok" ? 0 : undefined}
          onClick={() => {
            if (status === "ok") openFullscreen();
          }}
          onKeyDown={(e) => {
            if (status !== "ok") return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openFullscreen();
            }
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
          onCopy={onCopy}
          onDownload={onDownload}
          downloading={downloading}
          onClose={closeFullscreen}
        />
      ) : null}
    </>
  );
}
