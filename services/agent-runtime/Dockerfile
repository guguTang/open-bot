# Production image for the Python agent runtime.
#
# Build from the repository root. The tree under
# /opt/open-bot/services/agent-runtime matches the repo so app.main can resolve
# its parents[3] dotenv root. Skills are copied to /opt/open-bot/skills.
#
#   make image-runtime
#   docker build -f services/agent-runtime/Dockerfile -t openbot-agent-runtime:dev .

FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    OPEN_BOT_ROOT=/opt/open-bot \
    SKILLS_DIR=/opt/open-bot/skills

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 --shell /usr/sbin/nologin openbot

WORKDIR /opt/open-bot/services/agent-runtime

COPY services/agent-runtime/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY services/agent-runtime/app ./app
COPY skills /opt/open-bot/skills

RUN mkdir -p /opt/open-bot/services/agent-runtime/data \
    && chown -R openbot:openbot /opt/open-bot

USER openbot
EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/healthz', timeout=3)"]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001", "--timeout-keep-alive", "30"]
