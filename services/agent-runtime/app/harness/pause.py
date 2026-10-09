"""Distinguish a human approval interrupt from a scheduled next node."""

from __future__ import annotations

from typing import Any


def is_approval_pause(tasks: Any) -> bool:
    """True only when a checkpoint task is waiting on interrupt().

    LangGraph also puts the next node (llm, tools, …) in ``tasks`` whenever a
    run stopped between steps. Those have empty ``interrupts`` and must be
    resumed, not treated as waiting_approval.
    """
    for task in tasks or ():
        if getattr(task, "interrupts", None):
            return True
    return False
