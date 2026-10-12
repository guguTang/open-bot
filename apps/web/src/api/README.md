# Web API client

`../api.ts` is currently a single module that wraps HTTP calls for the whole app.

Planned domain split (P4-3, documentation only — no migration yet):

- **agents** — bots, skills, onboarding, avatars
- **chat** — conversations, messages, runs, reactions, feedback
- **llm** — models and provider configuration
- **mcp** — MCP server registry and tool calls
- **sandbox** — sandbox settings and execution
- **machines** — host machines and registration
- **auth** — login, session, OIDC

New endpoints should stay in `api.ts` until that split lands; this folder holds notes and future modules.
