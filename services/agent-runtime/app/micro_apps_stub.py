"""Micro App runtime tools — Phase 0 stub (do not half-build).

Phase 0 gate is enforced by Go API:
  POST /v1/micro-apps        requires user_intent (save|pin_agree|…)
  POST /v1/micro-apps/{id}/pin requires user_intent

Phase 1 will add TOOL_DEFS (not registered yet):
  - draft_micro_app  — only after user save intent OR bot asked + user agreed
  - pin_micro_app    — never silent; only after explicit user confirm

Never create draft/pin from model narration alone.
See docs/micro-app-architecture-v1.md §8 / §10.
"""

# Placeholder names for future registration in llm.TOOL_DEFS (Phase 1).
DRAFT_MICRO_APP_TOOL = "draft_micro_app"
PIN_MICRO_APP_TOOL = "pin_micro_app"
