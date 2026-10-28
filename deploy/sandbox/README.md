# open-bot sandbox images

## What this is

Docker images for open-bot’s product **sandbox computer** (`SANDBOX_IMAGE` /
`SANDBOX_DESKTOP_IMAGE`). Tools are baked into `/usr/local` and `/opt/micromamba`
so they remain after the container is recreated.

This is **not** the Grok Bot / Cursor “assistant computer” (sand/anyrun) image.
That host image is built and published by Cursor infrastructure; agents cannot
rebuild or push it from a running box. After “Update Bot’s Computer”, only what
was in that host image (plus persisted user files) comes back.

## Stocked in `openbot-sandbox:dev`

| Tool | Location |
|------|----------|
| node / npm | `/usr/local` (Node 20 LTS) |
| pnpm / yarn | via corepack |
| bun / bunx | `/usr/local/bin` |
| python3 / pip3 / venv | Debian + `/usr/local/bin/python` shim |
| uv / uvx | `/usr/local/bin` |
| micromamba (+ `conda` / `mamba` shims) | `/usr/local/bin`, root `/opt/micromamba` |
| env `py312` | `micromamba run -n py312 python` |

Desktop image `openbot-sandbox-desktop:dev` **FROM**s the CLI image, then adds
Xvfb / fluxbox / x11vnc / noVNC.

## Rebuild (local)

From repo root (needs Docker Desktop):

```bash
make sandbox-image            # openbot-sandbox:dev
make sandbox-image-verify     # smoke-check tooling
make sandbox-image-desktop    # builds CLI first, then desktop
```

Override tag:

```bash
make sandbox-image SANDBOX_IMAGE=openbot-sandbox:tooling
```

Multi-arch note: build on the machine that will run the containers (Apple Silicon
→ `linux/arm64`; CI amd64 hosts → `linux/amd64`). For both:

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -t YOUR_REGISTRY/openbot-sandbox:dev \
  -f deploy/sandbox/Dockerfile deploy/sandbox --push
```

## Publish

`make sandbox-image` only tags locally. A published GitHub Release pushes
**linux/amd64** images to GHCR (see [docs/release.md](../../docs/release.md)):

- `ghcr.io/<owner>/openbot-sandbox:<version>` and `:latest` (stable releases)
- `ghcr.io/<owner>/openbot-sandbox-desktop:<version>` (built `FROM` that CLI tag)

`<owner>` is the GitHub repository owner, lowercased. arm64 is not published by
CI; build that on the machine that will run the containers.

To push some other tag yourself:

1. Tag for your registry, e.g. `ghcr.io/<org>/openbot-sandbox:dev`
2. `docker login` to that registry
3. `docker push …`
4. Set `SANDBOX_IMAGE` / `SANDBOX_DESKTOP_IMAGE` in `.env` (or deploy config) to
   the pushed tags and restart the API

No registry push is performed by the default Makefile targets.

## Related

- API: `services/api/internal/sandbox/docker.go` (`DefaultImage`)
- Docs: `docs/沙箱电脑.md`
- Desktop entrypoint: `deploy/sandbox-desktop/entrypoint.sh`
