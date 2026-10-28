# deploy — local Docker dependencies

Single Compose entry: **`compose.yaml`** (Compose Spec + profiles).

```bash
# from repo root
make compose-up            # core only: postgres / redis / minio / markitdown
make compose-all           # core + casdoor + langfuse
make compose-casdoor       # + Casdoor IAM
make compose-langfuse      # + Langfuse v4 (needs langfuse/.env)
make compose-down          # stop & remove all services in this project
```

Equivalent raw commands:

```bash
COMPOSE='docker compose -f deploy/compose.yaml --project-directory deploy'
$COMPOSE up -d
$COMPOSE --profile casdoor up -d
env -u DATABASE_URL $COMPOSE --profile langfuse --env-file deploy/langfuse/.env up -d
```

Fragments live under `compose/` (`core.yaml`, `casdoor.yaml`, `langfuse.yaml`); do not point `docker compose -f` at those alone unless debugging.

Sandbox images (`sandbox/`, `sandbox-desktop/`) are Dockerfiles only — not part of the default compose project. CLI image bakes node/python/micromamba/uv/pnpm/yarn/bun into `/usr/local` + `/opt/micromamba`; see `sandbox/README.md`. Build with `make sandbox-image` / `make sandbox-image-desktop`.

Profile `app` (`compose/app.yaml`) runs the published API, routines worker, and agent-runtime images next to core Postgres / MarkItDown. It stays off for `make compose-up`. Set `OPENBOT_IMAGE_PREFIX=ghcr.io/<owner>` (owner lowercased). Release tags and the unsigned client packages are described in [docs/release.md](../docs/release.md).

## Profiles & ports

| Profile | Services | Host ports |
|---------|----------|------------|
| *(default / always)* | `postgres`, `redis`, `minio`, `markitdown` | `5432`, `6379`, `9000`/`9001`, `8010` |
| `casdoor` | `casdoor-postgres`, `casdoor` | `5434`, `8000` |
| `langfuse` | `langfuse-postgres`, `langfuse-redis`, `langfuse-minio`, `clickhouse`, `langfuse-web`, `langfuse-worker` | `5433`, `6380`, `9090`/`9091`, `8123`, `3100`, `3030` |

`markitdown` is built from `services/markitdown` (not a public image). `make dev-api` reaches it at `http://127.0.0.1:8010` (`DOC_PARSE_URL`). Port 8001 stays the agent runtime. See [docs/附件文档解析-MarkItDown.md](../docs/附件文档解析-MarkItDown.md).

## Keep beside compose

| Path | Role |
|------|------|
| `casdoor/conf/` | Casdoor `app.conf` (DB host = `casdoor-postgres`) |
| `casdoor/README.md` | OIDC setup notes |
| `langfuse/.env` / `.env.example` | Langfuse secrets; `LANGFUSE_DATABASE_URL` must use host `langfuse-postgres` |

## Migration from old multi-compose layout

Previously three projects:

| Old | New |
|-----|-----|
| `deploy/docker-compose.yml` (project ≈ `deploy`) | default services in `compose.yaml` |
| `deploy/casdoor/docker-compose.yml` (project `casdoor`) | `--profile casdoor` |
| `deploy/langfuse/docker-compose.yml` (project `langfuse`) | `--profile langfuse` |

**Core volumes** (`deploy_openbot_pg`, `deploy_openbot_minio`) keep the same project name (`deploy`) and should reuse automatically.

**Casdoor / Langfuse** used separate project names, so old volumes (`casdoor_casdoor_pg`, `langfuse_langfuse_*`) are **not** attached to the new `deploy_*` volumes. For local DX, easiest is recreate:

```bash
# stop old stacks if still running
docker compose --project-directory deploy/casdoor -f deploy/casdoor/docker-compose.yml down 2>/dev/null || true
docker compose --project-directory deploy/langfuse -f deploy/langfuse/docker-compose.yml down 2>/dev/null || true

make compose-casdoor     # fresh casdoor_pg under project deploy
make compose-langfuse    # fresh langfuse_* under project deploy
# Re-do Casdoor app client setup / accept Langfuse headless init again if volumes were discarded.
```

To keep old data, copy or re-attach volumes manually (`docker volume` inspect / `external: true`) — not covered here.
