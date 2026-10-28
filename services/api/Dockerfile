# Production image for the Go API and the routines worker (same binaries).
#
# Build from the repository root (the image copies skills/):
#   make image-api
#   docker build -f services/api/Dockerfile -t openbot-api:dev .
#
# Worker, same image:
#   docker run --rm openbot-api:dev openbot-worker
#
# Sandbox control shells out to the docker CLI. The client is installed here.
# Mount /var/run/docker.sock and run as root only when SANDBOX_ENABLED=1.
# The default user is openbot and does not own the host socket.

FROM golang:1.26-bookworm AS build

WORKDIR /src
COPY services/api/go.mod services/api/go.sum ./services/api/
WORKDIR /src/services/api
RUN go mod download

WORKDIR /src
COPY services/api ./services/api
WORKDIR /src/services/api

ARG TARGETARCH
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
      amd64) GOARCH=amd64 ;; \
      arm64) GOARCH=arm64 ;; \
      *) echo "unsupported TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    CGO_ENABLED=0 GOOS=linux GOARCH="${GOARCH}" \
      go build -trimpath -ldflags="-s -w" -o /out/openbot-api ./cmd/api; \
    CGO_ENABLED=0 GOOS=linux GOARCH="${GOARCH}" \
      go build -trimpath -ldflags="-s -w" -o /out/openbot-worker ./cmd/worker

FROM alpine:3.22

RUN apk add --no-cache ca-certificates tzdata docker-cli \
    && adduser -D -u 10001 -h /home/openbot openbot \
    && mkdir -p /opt/open-bot/data

COPY --from=build /out/openbot-api /out/openbot-worker /usr/local/bin/
COPY --chown=openbot:openbot skills /opt/open-bot/skills
RUN chown openbot:openbot /opt/open-bot /opt/open-bot/data

ENV OPEN_BOT_ROOT=/opt/open-bot \
    SKILLS_DIR=/opt/open-bot/skills \
    API_ADDR=:18080

WORKDIR /opt/open-bot
USER openbot
EXPOSE 18080

# No HEALTHCHECK here: the worker uses this image and does not listen on 18080.
# Compose sets a check on the api service only.
CMD ["openbot-api"]
