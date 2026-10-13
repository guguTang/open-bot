# Web API client

Domain modules under this folder implement the HTTP client. `../api.ts` is the **public barrel** — keep importing from `../api` / `./api` so existing call sites stay stable.

## Layout (P4-3 landed)

| Module | Responsibility |
|--------|----------------|
| `client.ts` | Shared HTTP/session helpers: `API_BASE`, auth headers, token/session, health probe, attachment URL helpers, download helpers (**internal** imports from domains; only previously public symbols are re-exported via the barrel) |
| `auth.ts` | Login, register, session user settings, OIDC |
| `agents.ts` | Bots, skills, onboarding, clone, avatars/presence types, routines, inbound hooks, bot secrets |
| `chat.ts` | Conversations, messages, runs, reactions, feedback/lessons, streaming, channels, agent bus, tool allowlist, host confirms |
| `llm.ts` | Models and provider configuration / probes |
| `mcp.ts` | MCP server registry and tool calls |
| `sandbox.ts` | Sandbox settings and execution |
| `machines.ts` | Host machines and registration (`hostExecWebSocketUrl`) |

New endpoints should go in the matching domain module and be re-exported from `../api.ts`.
