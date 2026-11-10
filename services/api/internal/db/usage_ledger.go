package db

import (
	"database/sql"
	"strings"
	"time"

	"github.com/tangxin/open-bot/services/api/internal/billing"
)

// UsageLedgerMeta identifies the run that owns a batch of calls.
type UsageLedgerMeta struct {
	OrgID          string
	UserID         string
	AgentID        string
	ConversationID string
	Source         string
}

// RecordUsageLedger prices each call, inserts usage_calls, and writes one
// usage_runs row whose tokens and estimated amount are the sum of those calls.
// It does not add any separate done.usage total on top.
// A successful run with no calls is stored as one unknown call so the row is
// not presented as a complete zero-cost ledger.
func (d *DB) RecordUsageLedger(meta UsageLedgerMeta, calls []billing.Call) error {
	meta.UserID = strings.TrimSpace(meta.UserID)
	if meta.UserID == "" {
		return nil
	}
	meta.OrgID = strings.TrimSpace(meta.OrgID)
	if meta.OrgID == "" {
		if u, err := d.GetUserByID(meta.UserID); err == nil && u != nil {
			meta.OrgID = u.OrgID
		}
	}
	meta.AgentID = strings.TrimSpace(meta.AgentID)
	meta.ConversationID = strings.TrimSpace(meta.ConversationID)
	meta.Source = strings.TrimSpace(meta.Source)
	if meta.Source == "" {
		meta.Source = "chat"
	}
	if len(calls) == 0 {
		calls = []billing.Call{{
			CallKind:    billing.KindChat,
			UsageSource: billing.SourceUnknown,
		}}
	}
	prices, err := d.loadPrices()
	if err != nil {
		return err
	}
	at := time.Now()
	priced := make([]billing.PricedCall, 0, len(calls))
	for _, c := range calls {
		priced = append(priced, billing.PriceCall(c, prices, meta.OrgID, at))
	}
	totals := billing.Rollup(priced)
	day := time.Now().In(time.Local).Format("2006-01-02")
	tx, err := d.SQL.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	var runID int64
	err = tx.QueryRow(`
INSERT INTO usage_runs (
  org_id, user_id, agent_id, conversation_id, day,
  prompt_tokens, completion_tokens, total_tokens, source, created_at,
  cached_tokens, reasoning_tokens, estimated_cost_minor, currency, usage_source,
  priced_calls, unpriced_calls, provider_tokens, estimated_tokens, unknown_tokens, unpriced_tokens
) VALUES (
  $1,$2,$3,$4,$5::date,
  $6,$7,$8,$9,$10,
  $11,$12,$13,$14,$15,
  $16,$17,$18,$19,$20,$21
) RETURNING id
`, meta.OrgID, meta.UserID, meta.AgentID, meta.ConversationID, day,
		totals.PromptTokens, totals.CompletionTokens, totals.TotalTokens, meta.Source, Now(),
		totals.CachedTokens, totals.ReasoningTokens, nullInt(totals.EstimatedCostMinor), totals.Currency, totals.UsageSource,
		totals.PricedCalls, totals.UnpricedCalls, totals.ProviderTokens, totals.EstimatedTokens, totals.UnknownTokens, totals.UnpricedTokens,
	).Scan(&runID)
	if err != nil {
		return err
	}
	for _, c := range priced {
		if _, err := tx.Exec(`
INSERT INTO usage_calls (
  run_id, org_id, user_id, agent_id, conversation_id,
  model, provider, llm_connection_id,
  prompt_tokens, completion_tokens, cached_tokens, reasoning_tokens, total_tokens,
  usage_source, call_kind, estimated_cost_minor, currency, price_id,
  input_per_million_minor, output_per_million_minor, cached_per_million_minor, created_at
) VALUES (
  $1,$2,$3,$4,$5,
  $6,$7,$8,
  $9,$10,$11,$12,$13,
  $14,$15,$16,$17,$18,
  $19,$20,$21,$22
)`, runID, meta.OrgID, meta.UserID, meta.AgentID, meta.ConversationID,
			c.Model, c.Provider, c.LLMConnectionID,
			c.PromptTokens, c.CompletionTokens, c.CachedTokens, c.ReasoningTokens, c.TotalTokens,
			c.UsageSource, c.CallKind, nullInt(c.EstimatedCostMinor), currencyOr(c.Currency), nullInt(c.PriceID),
			nullInt(c.InputPerMillionMinor), nullInt(c.OutputPerMillionMinor), nullInt(c.CachedPerMillionMinor), Now(),
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func nullInt(v *int64) sql.NullInt64 {
	if v == nil {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: *v, Valid: true}
}

func currencyOr(v string) string {
	v = strings.ToUpper(strings.TrimSpace(v))
	if v == "" {
		return billing.DefaultCurrency
	}
	return v
}

// RecordUsageRun is the legacy single-total writer. Positive tokens are one
// provider chat call. All-zero totals are unknown, not a priced zero.
func (d *DB) RecordUsageRun(orgID, userID, agentID, conversationID, source string, promptTokens, completionTokens, totalTokens int64) error {
	src := billing.SourceProvider
	if promptTokens <= 0 && completionTokens <= 0 && totalTokens <= 0 {
		src = billing.SourceUnknown
	}
	return d.RecordUsageLedger(UsageLedgerMeta{
		OrgID: orgID, UserID: userID, AgentID: agentID, ConversationID: conversationID, Source: source,
	}, []billing.Call{{
		CallKind:         billing.KindChat,
		UsageSource:      src,
		PromptTokens:     promptTokens,
		CompletionTokens: completionTokens,
		TotalTokens:      totalTokens,
	}})
}
