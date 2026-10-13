# markitdown sidecar

Small HTTP wrapper around [Microsoft MarkItDown](https://github.com/microsoft/markitdown). The Go API posts stored PDF/DOCX/XLSX/PPTX bytes here and inlines the returned Markdown. No RAG, no OCR.

## API

`GET /health` → `{"status":"ok"}`

`POST /convert` multipart field `file`:

```json
{
  "markdown": "# title\n\nbody",
  "filename": "notes.docx",
  "char_count": 12,
  "truncated": false
}
```

`char_count` is the full Unicode length before the response cap. `truncated` is true when `markdown` was cut to `MAX_RETURN_BYTES` (default 200 KiB). Empty `markdown` with HTTP 200 means conversion ran but no text was extracted (typical scanned PDF).

Errors are JSON `{"error":"..."}`: `415` unsupported type, `413` over 20 MB, `422` conversion failed or empty file, `503` dependency missing or busy, `504` timed out (`CONVERT_TIMEOUT_SECONDS`, default 60).

Only `convert_stream` is called. The service does not accept URLs.

## Run

Compose (from the repo root): `make compose-up`. Host port **8010** (8001 is the agent runtime).

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt httpx
uvicorn app:app --host 127.0.0.1 --port 8010
```

Image extras: `markitdown[pdf,docx,xlsx,pptx]`. Not installed: `[xls]`, `[outlook]`, audio/youtube, Azure Document Intelligence, `markitdown-ocr`.

## Tests

```bash
pip install -r requirements.txt httpx
python -m unittest test_app.py
```
