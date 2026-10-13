"""HTTP contract tests. Integration cases call real MarkItDown when it is installed."""

from __future__ import annotations

import io
import unittest
import zipfile
from unittest import mock

import app as sidecar


def _text_pdf(text: str) -> bytes:
    stream = f"BT /F1 24 Tf 72 720 Td ({text}) Tj ET"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for i, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out.extend(f"{i} 0 obj\n{body}\nendobj\n".encode("latin1"))
    xref_at = len(out)
    lines = ["xref\n", f"0 {len(objects)+1}\n", "0000000000 65535 f \n"]
    lines.extend(f"{off:010d} 00000 n \n" for off in offsets[1:])
    out.extend("".join(lines).encode("latin1"))
    out.extend(
        f"trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n".encode("latin1")
    )
    return bytes(out)


def _docx_with_text(text: str) -> bytes:
    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>
"""
    rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
"""
    document = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body>
</w:document>
"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", rels)
        zf.writestr("word/document.xml", document)
    return buf.getvalue()


class ConvertAPITest(unittest.TestCase):
    def setUp(self) -> None:
        from fastapi.testclient import TestClient

        self.client = TestClient(sidecar.app)

    def test_health(self) -> None:
        res = self.client.get("/health")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "ok")

    def test_convert_success_shape(self) -> None:
        with mock.patch.object(sidecar, "_convert_bytes", return_value="你好 markdown"):
            res = self.client.post(
                "/convert",
                files={"file": ("notes.docx", b"PK fake", "application/octet-stream")},
            )
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(body["markdown"], "你好 markdown")
        self.assertEqual(body["filename"], "notes.docx")
        self.assertEqual(body["char_count"], len("你好 markdown"))
        self.assertFalse(body["truncated"])

    def test_convert_empty_markdown(self) -> None:
        with mock.patch.object(sidecar, "_convert_bytes", return_value="  \n"):
            res = self.client.post("/convert", files={"file": ("scan.pdf", b"%PDF", "application/pdf")})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["markdown"], "")

    def test_unsupported_extension(self) -> None:
        res = self.client.post("/convert", files={"file": ("notes.zip", b"PK", "application/zip")})
        self.assertEqual(res.status_code, 415)
        self.assertIn("error", res.json())

    def test_timeout(self) -> None:
        def _slow(*_a, **_k):
            import time

            time.sleep(2)
            return "late"

        with mock.patch.dict("os.environ", {"CONVERT_TIMEOUT_SECONDS": "0.2"}):
            with mock.patch.object(sidecar, "_convert_bytes", _slow):
                res = self.client.post(
                    "/convert",
                    files={"file": ("slow.pdf", b"%PDF-1.4", "application/pdf")},
                )
        self.assertEqual(res.status_code, 504)
        self.assertEqual(res.json()["error"], "conversion timed out")

    def test_real_pdf(self) -> None:
        if sidecar._md is None:
            self.skipTest("markitdown not installed")
        text = sidecar._convert_bytes(_text_pdf("Hello PDF fixture"), "hello.pdf", "application/pdf", ".pdf")
        self.assertIn("Hello PDF fixture", text)

    def test_real_docx(self) -> None:
        if sidecar._md is None:
            self.skipTest("markitdown not installed")
        raw = _docx_with_text("Hello from docx fixture")
        text = sidecar._convert_bytes(
            raw,
            "hello.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ".docx",
        )
        self.assertIn("Hello from docx fixture", text)


    def test_convert_respects_form_timeout(self) -> None:
        def _slow(*_a, **_k):
            import time

            time.sleep(2)
            return "late"

        with mock.patch.object(sidecar, "_convert_bytes", _slow):
            res = self.client.post(
                "/convert",
                files={"file": ("slow.pdf", b"%PDF-1.4", "application/pdf")},
                data={"timeout_seconds": "0.2"},
            )
        self.assertEqual(res.status_code, 504)
        self.assertEqual(res.json()["error"], "conversion timed out")

    def test_xls_extension_allowed(self) -> None:
        with mock.patch.object(sidecar, "_convert_bytes", return_value="sheet markdown"):
            res = self.client.post(
                "/convert",
                files={"file": ("legacy.xls", b"\xd0\xcf\x11\xe0", "application/vnd.ms-excel")},
            )
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()["markdown"], "sheet markdown")

    def test_xlsx_extension_allowed(self) -> None:
        with mock.patch.object(sidecar, "_convert_bytes", return_value="xlsx markdown"):
            res = self.client.post(
                "/convert",
                files={
                    "file": (
                        "sheet.xlsx",
                        b"PK fake",
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    )
                },
            )
        self.assertEqual(res.status_code, 200, res.text)
        self.assertIn("xlsx markdown", res.json()["markdown"])


if __name__ == "__main__":
    unittest.main()
