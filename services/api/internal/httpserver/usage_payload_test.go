package httpserver

import "testing"

func TestUsageFromDonePayloadLegacy(t *testing.T) {
	u := usageFromDonePayload(map[string]any{
		"usage": map[string]any{"prompt_tokens": 10.0, "completion_tokens": 5.0},
	})
	if u.PromptTokens != 10 || u.CompletionTokens != 5 || u.TotalTokens != 15 {
		t.Fatalf("%+v", u)
	}
	if u.FromCalls || len(u.Calls) != 1 || u.Calls[0].UsageSource != "provider" {
		t.Fatalf("legacy call: %+v", u)
	}
}

func TestUsageCallsAreNotAddedTwice(t *testing.T) {
	u := usageFromDonePayload(map[string]any{
		"usage": map[string]any{"prompt_tokens": 100.0, "completion_tokens": 100.0, "total_tokens": 200.0},
		"usage_calls": []any{
			map[string]any{"call_kind": "chat", "usage_source": "provider", "prompt_tokens": 10.0, "completion_tokens": 4.0, "total_tokens": 14.0, "model": "gpt-4o-mini"},
			map[string]any{"call_kind": "compress", "usage_source": "estimated", "prompt_tokens": 3.0, "completion_tokens": 2.0, "total_tokens": 5.0, "model": "gpt-4o-mini"},
			map[string]any{"call_kind": "vision", "usage_source": "provider", "prompt_tokens": 8.0, "completion_tokens": 1.0, "total_tokens": 9.0, "model": "gpt-4o"},
			map[string]any{"call_kind": "embedding", "usage_source": "estimated", "prompt_tokens": 4.0, "completion_tokens": 0.0, "total_tokens": 4.0, "model": "bge-m3"},
			map[string]any{"call_kind": "decision", "usage_source": "provider", "prompt_tokens": 6.0, "completion_tokens": 1.0, "total_tokens": 7.0, "model": "microsoft/microsoft-decision-1"},
		},
	})
	if u.TotalTokens != 39 || u.PromptTokens != 31 {
		t.Fatalf("double count or drop: %+v", u)
	}
	if !u.FromCalls || len(u.Calls) != 5 {
		t.Fatalf("calls=%d from=%v", len(u.Calls), u.FromCalls)
	}
	kinds := map[string]bool{}
	for _, c := range u.Calls {
		kinds[c.CallKind] = true
	}
	for _, kind := range []string{"chat", "compress", "vision", "embedding", "decision"} {
		if !kinds[kind] {
			t.Fatalf("missing %s in %+v", kind, u.Calls)
		}
	}
}

func TestMissingUsageIsUnknownNotOfficialZero(t *testing.T) {
	u := usageFromDonePayload(map[string]any{"ok": true})
	if len(u.Calls) != 1 || u.Calls[0].UsageSource != "unknown" || u.TotalTokens != 0 {
		t.Fatalf("%+v", u)
	}
}

func TestWaitingApprovalRecordsCallsOnce(t *testing.T) {
	withCalls := usageFromDonePayload(map[string]any{
		"ok": false, "waiting_approval": true,
		"usage_calls": []any{map[string]any{
			"call_kind": "chat", "usage_source": "provider",
			"prompt_tokens": 4.0, "completion_tokens": 1.0, "total_tokens": 5.0,
		}},
	})
	if withCalls.Skip || withCalls.TotalTokens != 5 {
		t.Fatalf("parked calls should be billed: %+v", withCalls)
	}
	reconnect := usageFromDonePayload(map[string]any{"ok": false, "waiting_approval": true})
	if !reconnect.Skip {
		t.Fatal("reconnect without calls should not create a zero run")
	}
	empty := usageFromDonePayload(map[string]any{"ok": true, "usage_calls": []any{}})
	if !empty.Skip {
		t.Fatal("explicit empty call list should not fall back to a synthetic zero")
	}
}

func TestCancelledDoneIsSkipped(t *testing.T) {
	u := usageFromDonePayload(map[string]any{
		"ok": false, "cancelled": true,
		"usage_calls": []any{map[string]any{"call_kind": "chat", "usage_source": "provider", "prompt_tokens": 3.0, "total_tokens": 3.0}},
	})
	if !u.Skip {
		t.Fatal("cancel should not be recorded")
	}
}
