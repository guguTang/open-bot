package httpserver

import (
	"encoding/json"
	"strings"

	"github.com/tangxin/open-bot/services/api/internal/billing"
	"github.com/tangxin/open-bot/services/api/internal/db"
)

// runtimeUsage is what proxyRuntimeRun returns to the ledger writer.
// When FromCalls is set, totals are the sum of Calls and must not be added
// to a separate done.usage aggregate.
type runtimeUsage struct {
	PromptTokens     int64
	CompletionTokens int64
	CachedTokens     int64
	ReasoningTokens  int64
	TotalTokens      int64
	Calls            []billing.Call
	FromCalls        bool
	Skip             bool
}

func usageFromDonePayload(payload map[string]any) runtimeUsage {
	var u runtimeUsage
	if payload == nil {
		u.Calls = []billing.Call{{CallKind: billing.KindChat, UsageSource: billing.SourceUnknown}}
		return u
	}
	if asString(payload["mode"]) == "echo" {
		u.Skip = true
		return u
	}
	waiting := truthy(payload["waiting_approval"])
	if truthy(payload["idempotent"]) || truthy(payload["cancelled"]) {
		u.Skip = true
	}
	if ok, has := payload["ok"].(bool); has && !ok && !waiting {
		u.Skip = true
	}
	if rawCalls, ok := payload["usage_calls"].([]any); ok {
		if len(rawCalls) == 0 {
			u.Skip = true
			return u
		}
		for _, item := range rawCalls {
			m, _ := item.(map[string]any)
			if m == nil {
				continue
			}
			u.Calls = append(u.Calls, callFromMap(m))
		}
		if len(u.Calls) == 0 {
			u.Calls = []billing.Call{{CallKind: billing.KindChat, UsageSource: billing.SourceUnknown}}
		}
		for _, c := range u.Calls {
			u.PromptTokens += c.PromptTokens
			u.CompletionTokens += c.CompletionTokens
			u.CachedTokens += c.CachedTokens
			u.ReasoningTokens += c.ReasoningTokens
			u.TotalTokens += c.TotalTokens
		}
		u.FromCalls = true
		// done.usage is the same sum (or a legacy accumulator). Do not add it.
		return u
	}
	if waiting {
		// Pause with no new calls (reconnect or interrupt). The calls already
		// made were recorded on the frame that first parked the run.
		u.Skip = true
		return u
	}
	raw, _ := payload["usage"].(map[string]any)
	if raw == nil {
		raw, _ = payload["usage_details"].(map[string]any)
	}
	if raw == nil {
		u.Calls = []billing.Call{{CallKind: billing.KindChat, UsageSource: billing.SourceUnknown}}
		return u
	}
	c := callFromMap(map[string]any{
		"call_kind":         billing.KindChat,
		"usage_source":      billing.SourceProvider,
		"prompt_tokens":     raw["prompt_tokens"],
		"completion_tokens": raw["completion_tokens"],
		"total_tokens":      raw["total_tokens"],
		"cached_tokens":     firstPresent(raw, "cached_tokens", "cache_read_input_tokens"),
		"reasoning_tokens":  raw["reasoning_tokens"],
	})
	if c.PromptTokens == 0 {
		if n := asInt64(raw["input_tokens"]); n > 0 {
			c.PromptTokens = n
		}
	}
	if c.CompletionTokens == 0 {
		if n := asInt64(raw["output_tokens"]); n > 0 {
			c.CompletionTokens = n
		}
	}
	if c.TotalTokens <= 0 && (c.PromptTokens > 0 || c.CompletionTokens > 0) {
		c.TotalTokens = c.PromptTokens + c.CompletionTokens
	}
	if c.PromptTokens == 0 && c.CompletionTokens == 0 && c.TotalTokens == 0 {
		c.UsageSource = billing.SourceUnknown
	}
	u.Calls = []billing.Call{c}
	u.PromptTokens = c.PromptTokens
	u.CompletionTokens = c.CompletionTokens
	u.CachedTokens = c.CachedTokens
	u.ReasoningTokens = c.ReasoningTokens
	u.TotalTokens = c.TotalTokens
	return u
}

func callFromMap(raw map[string]any) billing.Call {
	c := billing.Call{
		Model:            asString(raw["model"]),
		Provider:         asString(raw["provider"]),
		LLMConnectionID:  usageStringField(raw, "llm_connection_id", "connection_id"),
		CallKind:         asString(raw["call_kind"]),
		UsageSource:      asString(raw["usage_source"]),
		PromptTokens:     asInt64(raw["prompt_tokens"]),
		CompletionTokens: asInt64(raw["completion_tokens"]),
		CachedTokens:     asInt64(raw["cached_tokens"]),
		ReasoningTokens:  asInt64(raw["reasoning_tokens"]),
		TotalTokens:      asInt64(raw["total_tokens"]),
	}
	return billing.NormalizeCall(c)
}

func firstPresent(raw map[string]any, keys ...string) any {
	for _, k := range keys {
		if v, ok := raw[k]; ok && v != nil {
			return v
		}
	}
	return nil
}

func usageStringField(raw map[string]any, keys ...string) string {
	for _, k := range keys {
		if s := asString(raw[k]); s != "" {
			return s
		}
	}
	return ""
}

func truthy(v any) bool {
	b, ok := v.(bool)
	return ok && b
}

func asInt64(v any) int64 {
	switch t := v.(type) {
	case float64:
		return int64(t)
	case int64:
		return t
	case int:
		return int64(t)
	case json.Number:
		n, _ := t.Int64()
		return n
	default:
		return 0
	}
}

func (s *Server) recordDecisionUsage(userID, conversationID, model, provider, source string, prompt, completion int64) {
	if s == nil || s.db == nil || strings.TrimSpace(userID) == "" {
		return
	}
	_ = s.db.RecordUsageLedger(db.UsageLedgerMeta{
		UserID:         userID,
		ConversationID: conversationID,
		Source:         "decision",
	}, []billing.Call{{
		Model:            model,
		Provider:         provider,
		CallKind:         billing.KindDecision,
		UsageSource:      source,
		PromptTokens:     prompt,
		CompletionTokens: completion,
		TotalTokens:      prompt + completion,
	}})
}

func (s *Server) recordParsedDecision(userID, conversationID, fallbackModel, fallbackProvider string, state any, model, provider string, usage map[string]any) {
	if strings.TrimSpace(model) == "" {
		model = fallbackModel
	}
	if strings.TrimSpace(provider) == "" {
		provider = fallbackProvider
	}
	if usage == nil {
		usage = map[string]any{}
	}
	prompt := asInt64(usage["prompt_tokens"])
	if prompt == 0 {
		prompt = asInt64(usage["input_tokens"])
	}
	completion := asInt64(usage["completion_tokens"])
	if completion == 0 {
		completion = asInt64(usage["output_tokens"])
	}
	source := billing.SourceProvider
	if prompt == 0 && completion == 0 {
		est := billing.EstimateTokens(decisionStateText(state))
		if est > 0 {
			prompt = est
			source = billing.SourceEstimated
		} else {
			source = billing.SourceUnknown
		}
	}
	s.recordDecisionUsage(userID, conversationID, model, provider, source, prompt, completion)
}

func decisionStateText(state any) string {
	switch t := state.(type) {
	case string:
		return t
	case nil:
		return ""
	default:
		b, err := json.Marshal(state)
		if err != nil {
			return ""
		}
		return string(b)
	}
}

func recordRunUsage(s *Server, meta db.UsageLedgerMeta, usage runtimeUsage) {
	if s == nil || s.db == nil || usage.Skip {
		return
	}
	_ = s.db.RecordUsageLedger(meta, usage.Calls)
}
