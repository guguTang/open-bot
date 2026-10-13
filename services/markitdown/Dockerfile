# Lean official-package image: PDF + DOCX + XLSX + XLS + PPTX.
# Not installed: outlook, audio, youtube, Azure document intelligence, OCR.
# magika (a MarkItDown dependency) pulls onnxruntime; libgomp1 is the slim-image
# runtime it needs. First start loads that model from the wheel, not the network.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    CONVERT_TIMEOUT_SECONDS=60 \
    MAX_UPLOAD_BYTES=20971520 \
    PORT=8010

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 --shell /usr/sbin/nologin markitdown

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .

USER markitdown
EXPOSE 8010

HEALTHCHECK --interval=10s --timeout=3s --start-period=25s --retries=5 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8010/health', timeout=2)"]

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8010", "--timeout-keep-alive", "5"]
