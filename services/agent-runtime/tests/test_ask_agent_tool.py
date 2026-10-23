from app.llm import TOOL_DEFS, iter_tool_defs


def test_ask_agent_is_defined():
    names = {str((t.get("function") or {}).get("name") or "") for t in TOOL_DEFS}
    assert "ask_agent" in names
    ask = next(t for t in TOOL_DEFS if (t.get("function") or {}).get("name") == "ask_agent")
    required = set((ask.get("function") or {}).get("parameters", {}).get("required") or [])
    assert required == {"to_agent_id", "question"}


def test_ask_agent_hidden_unless_allowed():
    hidden = {str((t.get("function") or {}).get("name") or "") for t in iter_tool_defs()}
    shown = {str((t.get("function") or {}).get("name") or "") for t in iter_tool_defs(allow_ask_agent=True)}
    assert "ask_agent" not in hidden
    assert "send_to_agent" in hidden
    assert "ask_agent" in shown


def test_send_vs_ask_tool_descriptions_distinguish_ownership():
    """Handoff (transfer ownership) vs consult (keep ownership) — no phrase tables."""
    by_name = {
        str((t.get("function") or {}).get("name") or ""): t.get("function") or {}
        for t in TOOL_DEFS
    }
    send = by_name["send_to_agent"]
    ask = by_name["ask_agent"]
    send_desc = str(send.get("description") or "").lower()
    ask_desc = str(ask.get("description") or "").lower()
    assert "hand off" in send_desc or "ownership" in send_desc or "take over" in send_desc
    assert "ask_agent" in send_desc  # points away from consult substitute
    assert "priority" in send_desc
    assert "consult" in ask_desc or "question" in ask_desc or "ownership" in ask_desc
    assert "send_to_agent" in ask_desc  # points to handoff tool for transfer

