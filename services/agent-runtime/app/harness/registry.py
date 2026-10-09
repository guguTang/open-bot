"""Lightweight in-process extension registry (tools / sections / hooks)."""

from __future__ import annotations

from typing import Any, Awaitable, Callable, Literal

HookName = Literal["beforeTool", "afterTool", "onYield"]
HookFn = Callable[..., Awaitable[Any] | Any]


class ExtensionRegistry:
    """Register tools, prompt sections, and lifecycle hooks by name."""

    def __init__(self) -> None:
        self._tools: dict[str, dict[str, Any]] = {}
        self._sections: dict[str, str] = {}
        self._hooks: dict[HookName, list[tuple[str, HookFn]]] = {
            "beforeTool": [],
            "afterTool": [],
            "onYield": [],
        }
        self._selected: list[str] = []

    def register_tool(self, name: str, spec: dict[str, Any]) -> None:
        self._tools[name] = spec

    def register_section(self, name: str, text: str) -> None:
        self._sections[name] = text

    def register_hook(self, hook: HookName, name: str, fn: HookFn) -> None:
        self._hooks.setdefault(hook, []).append((name, fn))

    def select(self, names: list[str] | None) -> None:
        self._selected = [n for n in (names or []) if n]

    @property
    def selected(self) -> list[str]:
        return list(self._selected)

    def tool_defs(self, names: list[str] | None = None) -> list[dict[str, Any]]:
        want = set(names if names is not None else self._selected or self._tools.keys())
        return [self._tools[n] for n in want if n in self._tools]

    def sections_text(self, names: list[str] | None = None) -> str:
        want = names if names is not None else (self._selected or list(self._sections))
        parts = [self._sections[n] for n in want if n in self._sections]
        return "\n\n".join(parts)

    async def run_hooks(self, hook: HookName, **kwargs: Any) -> list[Any]:
        out: list[Any] = []
        for name, fn in self._hooks.get(hook) or []:
            if self._selected and name not in self._selected and name != "*":
                continue
            res = fn(**kwargs)
            if hasattr(res, "__await__"):
                res = await res
            out.append(res)
        return out


_global: ExtensionRegistry | None = None


def get_registry() -> ExtensionRegistry:
    global _global
    if _global is None:
        _global = ExtensionRegistry()
        _bootstrap_builtins(_global)
    return _global


def _bootstrap_builtins(reg: ExtensionRegistry) -> None:
    """Adapt existing skill/MCP surface as named extensions (process-local)."""
    try:
        from ..llm import TOOL_DEFS

        for td in TOOL_DEFS or []:
            fn = (td.get("function") or {}) if isinstance(td, dict) else {}
            name = str(fn.get("name") or "")
            if name:
                reg.register_tool(name, td)
    except Exception:  # noqa: BLE001
        pass
    reg.register_section("harness", "Durable LangGraph harness with journal + inbox.")
