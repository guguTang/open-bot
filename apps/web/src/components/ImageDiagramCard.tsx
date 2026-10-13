/**
 * Image diagram card — design bot-diagram-card-design-v2 §2.
 * Auth attachment GET via ?access_token= on <img>; toolbar: copy URL · download · fullscreen.
 * No fake generated images — only real urls / attachments.
 * Interaction chrome from `./diagram`.
 */
import { clamp } from "es-toolkit";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { toast } from "sonner";
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
  DiagramCopyButton,
  DiagramDownloadIconButton,
  DiagramExpandButton,
  DiagramFullscreenShell,
  diagramOverflowItems,
  useDiagramCardChrome,
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

function useImageFullscreenZoom(bodyRef: RefObject<HTMLDivElement | null>) {
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);
  useLayoutEffect(() => {
    scaleRef.current = scale;
  });

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setScale((s) => clamp(s * Math.exp(-e.deltaY * 0.0015), 0.25, 4));
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
      setScale(clamp(start.scale * (dist(e.touches) / start.dist), 0.25, 4));
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
  }, [bodyRef]);

  return { scale, setScale };
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
  const bodyRef = useRef<HTMLDivElement>(null);
  const { scale, setScale } = useImageFullscreenZoom(bodyRef);

  return (
    <DiagramFullscreenShell
      label="图片"
      ariaLabel="图片"
      variant="image"
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
      bodyRef={bodyRef}
      bodyClassName={diagramFsBodyClass({ image: true })}
      onBodyDoubleClick={() => setScale(1)}
      onClose={onClose}
    >
      <img
        className={diagramImageImgFsClass}
        src={src}
        alt={alt || name || "图片"}
        style={{ transform: `scale(${scale})` }}
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
