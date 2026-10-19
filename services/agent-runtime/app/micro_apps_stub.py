"""Micro App runtime tools — still stub through Phase 3 (HTTP path is live).

Go API (Phase 0–1) already enforces:
  POST /v1/micro-apps        requires user_intent (save|pin_agree|…)
  POST /v1/micro-apps/{id}/pin requires user_intent
  Bundle/runtime/RPC under /v1/micro-apps/{id}/…

Web: MicroAppShell + openbot.micro SDK + Host Bridge (see docs/micro-app-architecture-v1.md).

Phase 3 (HTTP only, still no runtime tools):
  - kind=routine: POST /v1/micro-apps with routine_config; pin materializes a /v1/routines row
  - pin accepts surfaces[] (desktop_shortcut / mobile_shortcut, in-app shortcuts)
  - host.shell.run grants carry command_allowlist; host Auto-review hard deny still wins

Future TOOL_DEFS (not registered yet):
  - draft_micro_app  — only after user save intent OR bot asked + user agreed
  - pin_micro_app    — never silent; only after explicit user confirm

Never create draft/pin from model narration alone.
"""

DRAFT_MICRO_APP_TOOL = "draft_micro_app"
PIN_MICRO_APP_TOOL = "pin_micro_app"
