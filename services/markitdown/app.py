"""MarkItDown sidecar.

POST /convert  multipart field ``file`` → JSON
    {"markdown": "...", "filename": "...", "char_count": 123, "truncated": false}

GET /health → {"status": "ok"}

The process only calls ``MarkItDown.convert_stream`` on the uploaded bytes.
It does not accept URLs and does not call ``convert()`` (which can fetch remote
resources). Plugins and OCR are off.
"""

from __future__ import annotations

import asyncio
import io
import logging
import os
from typing import Any

from fastapi import FastAPI, File, UploadFile
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
log = logging.getLogger("markitdown-sidecar")

MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(20 * 1024 * 1024)))
# Bound the JSON body so the Go client can read a complete document.
MAX_RETURN_BYTES = int(os.environ.get("MAX_RETURN_BYTES", str(200 * 1024)))
DEFAULT_TIMEOUT_SECONDS = 60.0
MAX_CONCURRENT = 2

ALLOWED_EXT = {".pdf", ".docx", ".xlsx", ".pptx"}
MIME_TO_EXT = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
}

app = FastAPI(title="open-bot markitdown", docs_url=None, redoc_url=None)
_sem = asyncio.Semaphore(MAX_CONCURRENT)

_import_error: str | None = None
_md: Any = None
try:
    from markitdown import (  # type: ignore
        FileConversionException,
        MarkItDown,
        MissingDependencyException,
        StreamInfo,
        UnsupportedFormatException,
    )

    _md = MarkItDown(enable_plugins=False)
except Exception as exc:  # pragma: no cover - image is broken if this trips
    _import_error = f"{type(exc).__name__}"
    FileConversionException = Exception  # type: ignore
    MissingDependencyException = Exception  # type: ignore
    UnsupportedFormatException = Exception  # type: ignore
    StreamInfo = None  # type: ignore
    log.exception("markitdown import failed")


def convert_timeout_seconds() -> float:
    raw = os.environ.get("CONVERT_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS))
    try:
        value = float(raw)
    except ValueError:
        return DEFAULT_TIMEOUT_SECONDS
    if value <= 0:
        return DEFAULT_TIMEOUT_SECONDS
    return value


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": message})


def safe_filename(name: str | None) -> str:
    raw = (name or "").replace("\\", "/").replace("\x00", "")
    base = os.path.basename(raw).strip()
    if base in {"", ".", ".."}:
        return "file"
    if len(base) > 120:
        base = base[:120]
    return base


def resolve_extension(filename: str, mime: str) -> str | None:
    ext = os.path.splitext(filename)[1].lower()
    if ext in ALLOWED_EXT:
        return ext
    return MIME_TO_EXT.get(mime)


def clip_markdown(text: str) -> tuple[str, bool]:
    raw = text.encode("utf-8")
    if len(raw) <= MAX_RETURN_BYTES:
        return text, False
    clipped = raw[:MAX_RETURN_BYTES].decode("utf-8", errors="ignore")
    return clipped, True


def _convert_bytes(data: bytes, filename: str, mime: str, ext: str) -> str:
    if _md is None or StreamInfo is None:
        raise RuntimeError(_import_error or "markitdown unavailable")
    info = StreamInfo(
        extension=ext,
        mimetype=mime or None,
        filename=filename,
    )
    result = _md.convert_stream(io.BytesIO(data), stream_info=info)
    text = getattr(result, "markdown", None)
    if text is None:
        text = getattr(result, "text_content", "") or ""
    return str(text)


@app.get("/health")
def health() -> JSONResponse:
    if _import_error is not None or _md is None:
        return JSONResponse(
            status_code=503,
            content={"status": "error", "error": "markitdown unavailable"},
        )
    return JSONResponse(status_code=200, content={"status": "ok"})


@app.post("/convert")
async def convert(file: UploadFile = File(...)) -> JSONResponse:
    if _import_error is not None or _md is None:
        return _error(503, "markitdown unavailable")

    filename = safe_filename(file.filename)
    mime = (file.content_type or "").split(";", 1)[0].strip().lower()
    ext = resolve_extension(filename, mime)
    if ext is None:
        return _error(415, "unsupported file type")
    if not os.path.splitext(filename)[1]:
        filename = filename + ext

    try:
        data = await file.read(MAX_UPLOAD_BYTES + 1)
    except Exception:
        log.exception("read upload failed name=%s", filename)
        return _error(400, "could not read upload")
    finally:
        await file.close()

    if len(data) > MAX_UPLOAD_BYTES:
        return _error(413, "file exceeds 20MB limit")
    if not data:
        return _error(422, "empty file")

    acquired = False
    try:
        await asyncio.wait_for(_sem.acquire(), timeout=1.0)
        acquired = True
    except TimeoutError:
        return _error(503, "converter busy")

    try:
        try:
            text = await asyncio.wait_for(
                asyncio.to_thread(_convert_bytes, data, filename, mime, ext),
                timeout=convert_timeout_seconds(),
            )
        except TimeoutError:
            log.warning("convert timed out name=%s bytes=%d", filename, len(data))
            return _error(504, "conversion timed out")
        except UnsupportedFormatException:
            log.info("unsupported format name=%s", filename)
            return _error(415, "unsupported file type")
        except MissingDependencyException:
            log.exception("missing markitdown dependency name=%s", filename)
            return _error(503, "converter dependency missing")
        except FileConversionException:
            log.exception("convert failed name=%s", filename)
            return _error(422, "conversion failed")
        except Exception:
            log.exception("convert failed name=%s", filename)
            return _error(422, "conversion failed")
    finally:
        if acquired:
            _sem.release()

    char_count = len(text)
    markdown, truncated = clip_markdown(text)
    if not markdown.strip():
        # Successful conversion with no extractable text (typical of scanned PDFs).
        return JSONResponse(
            status_code=200,
            content={
                "markdown": "",
                "filename": filename,
                "char_count": 0,
                "truncated": False,
            },
        )
    return JSONResponse(
        status_code=200,
        content={
            "markdown": markdown,
            "filename": filename,
            "char_count": char_count,
            "truncated": truncated,
        },
    )
