# open-bot local dev helpers
.PHONY: compose-up compose-all compose-postgres compose-down compose-langfuse compose-langfuse-down compose-casdoor compose-casdoor-down dev-api dev-api-air dev-runtime dev-backend dev-worker dev-web dev-admin dev-desktop build-desktop build-desktop-windows build-desktop-macos build-desktop-linux check-desktop \
	build-web build-admin sync-mobile build-android build-android-debug build-android-release dev-mobile-ios open-mobile-android build-ios \
	dev-mobile-rn dev-mobile-rn-clear check-mobile-rn \
	sandbox-image sandbox-image-desktop \
	stop-api stop-runtime stop-web stop-worker stop-dev \
	e2e-install e2e e2e-web e2e-admin backfill-embeddings dream-user

API_ADDR ?= :18080
AGENT_RUNTIME_URL ?= http://127.0.0.1:8001

# Ports used by stop-* (API_ADDR may be ":18080" or "127.0.0.1:18080")
API_PORT ?= 18080
RUNTIME_PORT ?= 8001

# Cross-platform venv activate script
ifeq ($(OS),Windows_NT)
  VENV_ACTIVATE := .venv/Scripts/activate
  AIR_CONFIG := .air.windows.toml
else
  VENV_ACTIVATE := .venv/bin/activate
  AIR_CONFIG := .air.toml
endif


# Single compose entry: deploy/compose.yaml (profiles: casdoor, langfuse)
COMPOSE ?= docker compose -f deploy/compose.yaml --project-directory deploy

compose-up:
	$(COMPOSE) up -d

# Core + Casdoor + Langfuse in one shot (Docker only; not API/web)
compose-all:
	@if [ ! -f deploy/langfuse/.env ]; then \
	  cp deploy/langfuse/.env.example deploy/langfuse/.env; \
	  echo "created deploy/langfuse/.env from .env.example — review secrets"; \
	fi
	env -u DATABASE_URL $(COMPOSE) --profile casdoor --profile langfuse --env-file deploy/langfuse/.env up -d

compose-postgres:
	$(COMPOSE) up -d postgres

compose-down:
	$(COMPOSE) --profile casdoor --profile langfuse down

compose-langfuse:
	@if [ ! -f deploy/langfuse/.env ]; then \
	  cp deploy/langfuse/.env.example deploy/langfuse/.env; \
	  echo "created deploy/langfuse/.env from .env.example — review secrets"; \
	fi
	# env -u DATABASE_URL so repo-root .env cannot override Langfuse DB URL interpolation
	env -u DATABASE_URL $(COMPOSE) --profile langfuse --env-file deploy/langfuse/.env up -d

compose-langfuse-down:
	env -u DATABASE_URL $(COMPOSE) --profile langfuse --env-file deploy/langfuse/.env stop \
	  langfuse-web langfuse-worker langfuse-postgres langfuse-redis langfuse-minio clickhouse
	-$(COMPOSE) rm -f langfuse-web langfuse-worker langfuse-postgres langfuse-redis langfuse-minio clickhouse

compose-casdoor:
	env -u DATABASE_URL $(COMPOSE) --profile casdoor up -d

compose-casdoor-down:
	env -u DATABASE_URL $(COMPOSE) --profile casdoor stop casdoor casdoor-postgres
	-$(COMPOSE) rm -f casdoor casdoor-postgres

dev-api:
	cd services/api && \
	  set -a && [ -f ../../.env ] && . ../../.env; set +a && \
	  OPEN_BOT_ROOT=$$(cd ../.. && pwd) API_ADDR=$(API_ADDR) AGENT_RUNTIME_URL=$(AGENT_RUNTIME_URL) go run ./cmd/api

# Live-reload API (no global air install). Config: services/api/.air.toml or .air.windows.toml.
AIR_VERSION ?= v1.67.4

dev-api-air:
	cd services/api && \
	  set -a && [ -f ../../.env ] && . ../../.env; set +a && \
	  OPEN_BOT_ROOT=$$(cd ../.. && pwd) API_ADDR=$(API_ADDR) AGENT_RUNTIME_URL=$(AGENT_RUNTIME_URL) \
	  go run github.com/air-verse/air@$(AIR_VERSION) -c $(AIR_CONFIG)

# Routines worker (optional). Set ROUTINES_INPROCESS=0 on API to avoid double-fire.
dev-worker:
	cd services/api && \
	  set -a && [ -f ../../.env ] && . ../../.env; set +a && \
	  OPEN_BOT_ROOT=$$(cd ../.. && pwd) go run ./cmd/worker

dev-runtime:
	cd services/agent-runtime && \
	  set -a && [ -f ../../.env ] && . ../../.env; set +a && \
	  . $(VENV_ACTIVATE) && \
	  uvicorn app.main:app --reload --host 127.0.0.1 --port 8001

# API (air hot reload, dev-api-air) + agent-runtime (uvicorn --reload) in one terminal.
# Does not start web, admin, or the desktop app. Ctrl+C stops both.
# FREE_PORTS=1 时先关掉占用 API_PORT / RUNTIME_PORT 的监听进程，再启动。
# 例: make dev-backend FREE_PORTS=1
dev-backend:
	@set -m; \
	case "$(FREE_PORTS)" in \
	  1|true|yes|on) \
	    echo "dev-backend: freeing :$(API_PORT) and :$(RUNTIME_PORT)"; \
	    $(MAKE) --no-print-directory stop-api stop-runtime; \
	    i=0; \
	    while [ $$i -lt 25 ]; do \
	      left=""; \
	      for port in $(API_PORT) $(RUNTIME_PORT); do \
	        p=$$(lsof -tiTCP:$$port -sTCP:LISTEN 2>/dev/null || true); \
	        if [ -n "$$p" ]; then left="$$left $$p"; fi; \
	      done; \
	      left=$$(echo $$left | xargs); \
	      if [ -z "$$left" ]; then break; fi; \
	      if [ $$i -eq 15 ]; then \
	        echo "dev-backend: ports still busy, kill -9 $$left"; \
	        kill -9 $$left 2>/dev/null || true; \
	      fi; \
	      i=$$((i+1)); \
	      sleep 0.1; \
	    done ;; \
	esac; \
	cleanup() { \
	  trap - INT TERM EXIT; \
	  kill -TERM -$$pid_api -$$pid_rt 2>/dev/null || true; \
	  wait 2>/dev/null || true; \
	}; \
	trap cleanup INT TERM EXIT; \
	$(MAKE) --no-print-directory dev-api-air & pid_api=$$!; \
	$(MAKE) --no-print-directory dev-runtime & pid_rt=$$!; \
	echo "dev-backend: API $(API_ADDR) + runtime :$(RUNTIME_PORT) (Ctrl+C stops both)"; \
	wait

dev-web:
	pnpm --dir apps/web dev

dev-admin:
	pnpm --dir apps/admin dev

build-admin:
	pnpm --dir apps/admin build

# Desktop (Tauri 2)：复用 apps/web。需先 make dev-api + make dev-runtime（及 Postgres）。
# API 默认 http://127.0.0.1:18080；可用 VITE_API_BASE 覆盖（传给 web vite）。
dev-desktop:
	set -a && [ -f .env ] && . ./.env; set +a && \
	  pnpm --dir apps/desktop tauri dev

build-desktop:
	set -a && [ -f .env ] && . ./.env; set +a && \
	  pnpm --dir apps/desktop tauri build

# Platform-specific desktop builds (Tauri targets)
build-desktop-windows:
	set -a && [ -f .env ] && . ./.env; set +a && \
	  pnpm --dir apps/desktop tauri build --target x86_64-pc-windows-msvc

build-desktop-macos:
	set -a && [ -f .env ] && . ./.env; set +a && \
	  pnpm --dir apps/desktop tauri build --target x86_64-apple-darwin

build-desktop-linux:
	set -a && [ -f .env ] && . ./.env; set +a && \
	  pnpm --dir apps/desktop tauri build --target x86_64-unknown-linux-gnu

check-desktop:
	cd apps/desktop/src-tauri && cargo check

# Web 构建（桌面 / 移动壳共用 dist）
build-web:
	pnpm --dir apps/web build

# Capacitor：把 apps/web/dist 同步进 ios/android 原生工程
# 可选 live reload：CAP_LIVE_RELOAD=1 CAP_SERVER_URL=http://127.0.0.1:5173 make sync-mobile
# CocoaPods 需要 UTF-8 locale
sync-mobile: build-web
	export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 && \
	  cd apps/mobile && npx cap sync

# 打开 Xcode（需先 sync）。可选：CAP_LIVE_RELOAD=1 后先 sync 再打开。
# 完整跑模拟器：另开 make dev-web + make dev-api + make dev-runtime，再 Xcode Run，
# 或：cd apps/mobile && npx cap run ios
dev-mobile-ios: sync-mobile
	export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 && \
	  cd apps/mobile && npx cap open ios

open-mobile-android: sync-mobile
	cd apps/mobile && npx cap open android

# React Native / Expo 原生移动端（apps/mobile-rn）
# 后端需先起：make dev-runtime + make dev-api
# 真机需先改 apps/mobile-rn/.env 的 EXPO_PUBLIC_OPENBOT_API_BASE 为局域网 IP
dev-mobile-rn:
	cd apps/mobile-rn && pnpm start

# 改过 .env 后用这个，会清 Metro 缓存并重新注入环境变量
dev-mobile-rn-clear:
	cd apps/mobile-rn && pnpm start --clear

check-mobile-rn:
	cd apps/mobile-rn && pnpm typecheck && pnpm lint

# Android APK builds (requires Android SDK + Gradle)
build-android: sync-mobile
	cd apps/mobile/android && ./gradlew assembleDebug
	@echo "APK: apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk"

build-android-debug: sync-mobile
	cd apps/mobile/android && ./gradlew assembleDebug
	@echo "APK: apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk"

build-android-release: sync-mobile
	cd apps/mobile/android && ./gradlew assembleRelease
	@echo "APK: apps/mobile/android/app/build/outputs/apk/release/app-release-unsigned.apk"

# iOS build (macOS only, requires Xcode)
build-ios: sync-mobile
	@if [ "$$(uname)" != "Darwin" ]; then \
		echo "iOS builds require macOS"; exit 1; \
	fi
	cd apps/mobile/ios/App && xcodebuild -scheme App -configuration Debug -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO
	@echo "iOS build complete"

# Phase-1 sandbox computer image (debian bookworm-slim + bash/curl/python3/git)
SANDBOX_IMAGE ?= openbot-sandbox:dev
sandbox-image:
	docker build -t $(SANDBOX_IMAGE) -f deploy/sandbox/Dockerfile deploy/sandbox

# Lightweight Xvfb+fluxbox+x11vnc+noVNC (port 6080). Does not need the CLI image.
# Alternative (pull): SANDBOX_DESKTOP_IMAGE=lscr.io/linuxserver/webtop:alpine-xfce SANDBOX_DESKTOP_PORT=3000
SANDBOX_DESKTOP_IMAGE ?= openbot-sandbox-desktop:dev
sandbox-image-desktop:
	docker build -t $(SANDBOX_DESKTOP_IMAGE) -f deploy/sandbox-desktop/Dockerfile deploy/sandbox-desktop

# Stop local dev processes. Web only kills Vite belonging to this repo (won't touch other apps on :5173).
stop-api:
	@PIDS=$$(lsof -tiTCP:$(API_PORT) -sTCP:LISTEN 2>/dev/null || true); \
	if [ -n "$$PIDS" ]; then kill $$PIDS 2>/dev/null || true; echo "stopped api on :$(API_PORT) ($$PIDS)"; \
	else echo "api not listening on :$(API_PORT)"; fi

stop-runtime:
	@PIDS=$$(lsof -tiTCP:$(RUNTIME_PORT) -sTCP:LISTEN 2>/dev/null || true); \
	if [ -n "$$PIDS" ]; then kill $$PIDS 2>/dev/null || true; echo "stopped runtime on :$(RUNTIME_PORT) ($$PIDS)"; \
	else echo "runtime not listening on :$(RUNTIME_PORT)"; fi

stop-web:
	@ROOT="$(CURDIR)"; PIDS=""; \
	for port in 5173 5174 5175; do \
	  for pid in $$(lsof -tiTCP:$$port -sTCP:LISTEN 2>/dev/null || true); do \
	    cwd=$$(lsof -a -p $$pid -d cwd 2>/dev/null | awk 'NR==2 {print $$NF}'); \
	    cmd=$$(ps -p $$pid -o command= 2>/dev/null || true); \
	    case "$$cwd $$cmd" in \
	      *"$$ROOT/apps/web"*|*"$$ROOT/apps/admin"*|*"$$ROOT"*"vite"*) PIDS="$$PIDS $$pid" ;; \
	    esac; \
	  done; \
	done; \
	PIDS=$$(echo $$PIDS | xargs); \
	if [ -n "$$PIDS" ]; then kill $$PIDS 2>/dev/null || true; echo "stopped open-bot web ($$PIDS)"; \
	else echo "no open-bot vite on :5173-:5175"; fi

stop-worker:
	@pkill -f 'go run ./cmd/worker' 2>/dev/null || true; echo "stopped worker (best-effort)"

stop-dev: stop-api stop-runtime stop-web stop-worker

# Playwright e2e (apps/web + apps/admin). Requires local stack; see docs/e2e.md
e2e-install:
	pnpm --dir e2e install
	pnpm --dir e2e install:browsers

e2e:
	pnpm --dir e2e e2e

e2e-web:
	pnpm --dir e2e e2e:web

e2e-admin:
	pnpm --dir e2e e2e:admin


# Backfill memories.embedding for rows missing vectors (idempotent).
backfill-embeddings:
	cd services/agent-runtime && \
	  set -a && [ -f ../../.env ] && . ../../.env; set +a && \
	  . $(VENV_ACTIVATE) && \
	  python -m app.backfill_embeddings $(BACKFILL_ARGS)

# Ops escape hatch: force one-shot local Dream (normal chat auto-runs when enabled).
# make dream-user USER_ID=...
dream-user:
	cd services/agent-runtime && \
	  set -a && [ -f ../../.env ] && . ../../.env; set +a && \
	  . $(VENV_ACTIVATE) && \
	  MEM0_DREAM_ENABLED=1 python -m app.dream --user-id "$(USER_ID)"
