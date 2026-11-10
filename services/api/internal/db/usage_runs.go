package db

import (
	"database/sql"
	"strings"
	"time"

	"github.com/tangxin/open-bot/services/api/internal/billing"
)

type UsageRunDay struct {
	Day                string `json:"day"`
	OrgID              string `json:"org_id,omitempty"`
	UserID             string `json:"user_id,omitempty"`
	Username           string `json:"username,omitempty"`
	AgentID            string `json:"agent_id,omitempty"`
	AgentName          string `json:"agent_name,omitempty"`
	Model              string `json:"model,omitempty"`
	Provider           string `json:"provider,omitempty"`
	RunCount           int64  `json:"run_count"`
	PromptTokens       int64  `json:"prompt_tokens"`
	CompletionTokens   int64  `json:"completion_tokens"`
	CachedTokens       int64  `json:"cached_tokens"`
	ReasoningTokens    int64  `json:"reasoning_tokens"`
	TotalTokens        int64  `json:"total_tokens"`
	EstimatedCostMinor *int64 `json:"estimated_cost_minor"`
	Currency           string `json:"currency"`
	UsageSource        string `json:"usage_source"`
	ProviderTokens     int64  `json:"provider_tokens"`
	EstimatedTokens    int64  `json:"estimated_tokens"`
	UnknownTokens      int64  `json:"unknown_tokens"`
	UnpricedTokens     int64  `json:"unpriced_tokens"`
	PricedCalls        int64  `json:"priced_calls"`
	UnpricedCalls      int64  `json:"unpriced_calls"`
}

type OrgUsageDetailed struct {
	OrgID              string        `json:"org_id"`
	MemberCount        int           `json:"member_count"`
	ConversationCount  int           `json:"conversation_count"`
	MessageCount       int           `json:"message_count"`
	AgentCount         int           `json:"agent_count"`
	RunCount           int64         `json:"run_count"`
	PromptTokens       int64         `json:"prompt_tokens"`
	CompletionTokens   int64         `json:"completion_tokens"`
	CachedTokens       int64         `json:"cached_tokens"`
	ReasoningTokens    int64         `json:"reasoning_tokens"`
	TotalTokens        int64         `json:"total_tokens"`
	EstimatedCostMinor *int64        `json:"estimated_cost_minor"`
	Currency           string        `json:"currency"`
	UsageSource        string        `json:"usage_source"`
	ProviderTokens     int64         `json:"provider_tokens"`
	EstimatedTokens    int64         `json:"estimated_tokens"`
	UnknownTokens      int64         `json:"unknown_tokens"`
	UnpricedTokens     int64         `json:"unpriced_tokens"`
	PricedCalls        int64         `json:"priced_calls"`
	UnpricedCalls      int64         `json:"unpriced_calls"`
	ByDay              []UsageRunDay `json:"by_day,omitempty"`
	ByUser             []UsageRunDay `json:"by_user,omitempty"`
	ByBot              []UsageRunDay `json:"by_bot,omitempty"`
	ByModel            []UsageRunDay `json:"by_model,omitempty"`
}

type PlatformOrgSummary struct {
	OrgID             string `json:"org_id"`
	Slug              string `json:"slug"`
	Name              string `json:"name"`
	MemberCount       int    `json:"member_count"`
	ConversationCount int    `json:"conversation_count"`
	MessageCount      int    `json:"message_count"`
	AgentCount        int    `json:"agent_count"`
	RunCount          int64  `json:"run_count"`
	PromptTokens      int64  `json:"prompt_tokens"`
	CompletionTokens  int64  `json:"completion_tokens"`
	TotalTokens       int64  `json:"total_tokens"`
	CreatedAt         string `json:"created_at"`
}

func (d *DB) migrateUsageRuns() error {
	_, err := d.SQL.Exec(`
CREATE TABLE IF NOT EXISTS usage_runs (
  id BIGSERIAL PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL DEFAULT '',
  agent_id TEXT NOT NULL DEFAULT '',
  conversation_id TEXT NOT NULL DEFAULT '',
  day DATE NOT NULL DEFAULT (CURRENT_DATE),
  prompt_tokens BIGINT NOT NULL DEFAULT 0,
  completion_tokens BIGINT NOT NULL DEFAULT 0,
  total_tokens BIGINT NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'chat',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_runs_org_day ON usage_runs(org_id, day DESC);
CREATE INDEX IF NOT EXISTS idx_usage_runs_user_day ON usage_runs(user_id, day DESC);
CREATE INDEX IF NOT EXISTS idx_usage_runs_agent_day ON usage_runs(agent_id, day DESC);
`)
	return err
}

func (d *DB) GetOrgUsageDetailed(orgID string, days int) (*OrgUsageDetailed, error) {
	if days <= 0 || days > 366 {
		days = 30
	}
	base, err := d.GetOrgUsage(orgID)
	if err != nil {
		return nil, err
	}
	out := &OrgUsageDetailed{
		OrgID:             base.OrgID,
		MemberCount:       base.MemberCount,
		ConversationCount: base.ConversationCount,
		MessageCount:      base.MessageCount,
		AgentCount:        base.AgentCount,
		Currency:          billing.DefaultCurrency,
		UsageSource:       billing.SourceUnknown,
	}
	var cost sql.NullInt64
	_ = d.SQL.QueryRow(`
SELECT COALESCE(SUM(1),0), COALESCE(SUM(prompt_tokens),0),
       COALESCE(SUM(completion_tokens),0), COALESCE(SUM(cached_tokens),0),
       COALESCE(SUM(reasoning_tokens),0), COALESCE(SUM(total_tokens),0),
       CASE WHEN COUNT(estimated_cost_minor) = 0 THEN NULL ELSE SUM(estimated_cost_minor) END,
       COALESCE(SUM(provider_tokens),0), COALESCE(SUM(estimated_tokens),0),
       COALESCE(SUM(unknown_tokens),0), COALESCE(SUM(unpriced_tokens),0),
       COALESCE(SUM(priced_calls),0), COALESCE(SUM(unpriced_calls),0)
FROM usage_runs WHERE org_id = $1 AND day >= (CURRENT_DATE - ($2::int || ' days')::interval)
`, orgID, days).Scan(
		&out.RunCount, &out.PromptTokens, &out.CompletionTokens, &out.CachedTokens,
		&out.ReasoningTokens, &out.TotalTokens, &cost,
		&out.ProviderTokens, &out.EstimatedTokens, &out.UnknownTokens, &out.UnpricedTokens,
		&out.PricedCalls, &out.UnpricedCalls,
	)
	out.EstimatedCostMinor = nullPtr(cost)
	out.UsageSource = usageSourceOf(out.ProviderTokens, out.EstimatedTokens, out.UnknownTokens)

	out.ByDay, _ = d.queryUsageGrouped(`
SELECT to_char(day, 'YYYY-MM-DD'), '', '', '', '', '', '',
`+usageAggSelect+`
FROM usage_runs WHERE org_id = $1 AND day >= (CURRENT_DATE - ($2::int || ' days')::interval)
GROUP BY day ORDER BY day DESC
`, orgID, days)

	out.ByUser, _ = d.queryUsageGrouped(`
SELECT '', r.user_id, COALESCE(u.username, ''), '', '', '', '',
`+usageAggSelectR+`
FROM usage_runs r
LEFT JOIN users u ON u.id = r.user_id
WHERE r.org_id = $1 AND r.day >= (CURRENT_DATE - ($2::int || ' days')::interval)
GROUP BY r.user_id, u.username
ORDER BY COUNT(*) DESC
LIMIT 50
`, orgID, days)

	out.ByBot, _ = d.queryUsageGrouped(`
SELECT '', '', '', r.agent_id, COALESCE(a.name, r.agent_id), '', '',
`+usageAggSelectR+`
FROM usage_runs r
LEFT JOIN agents a ON a.id = r.agent_id AND a.deleted_at IS NULL
WHERE r.org_id = $1 AND r.day >= (CURRENT_DATE - ($2::int || ' days')::interval)
GROUP BY r.agent_id, a.name
ORDER BY COUNT(*) DESC
LIMIT 50
`, orgID, days)

	out.ByModel, _ = d.queryUsageGrouped(`
SELECT '', '', '', '', '', c.model, COALESCE(c.provider, ''),
       COUNT(*), COALESCE(SUM(c.prompt_tokens),0), COALESCE(SUM(c.completion_tokens),0),
       COALESCE(SUM(c.cached_tokens),0), COALESCE(SUM(c.reasoning_tokens),0), COALESCE(SUM(c.total_tokens),0),
       CASE WHEN COUNT(c.estimated_cost_minor) = 0 THEN NULL ELSE SUM(c.estimated_cost_minor) END,
       COALESCE(SUM(c.total_tokens) FILTER (WHERE c.usage_source = 'provider'),0),
       COALESCE(SUM(c.total_tokens) FILTER (WHERE c.usage_source = 'estimated'),0),
       COALESCE(SUM(c.total_tokens) FILTER (WHERE c.usage_source = 'unknown'),0),
       COALESCE(SUM(c.total_tokens) FILTER (WHERE c.estimated_cost_minor IS NULL),0),
       COALESCE(SUM(CASE WHEN c.estimated_cost_minor IS NULL THEN 0 ELSE 1 END),0),
       COALESCE(SUM(CASE WHEN c.estimated_cost_minor IS NULL THEN 1 ELSE 0 END),0)
FROM usage_calls c
JOIN usage_runs r ON r.id = c.run_id
WHERE r.org_id = $1 AND r.day >= (CURRENT_DATE - ($2::int || ' days')::interval)
GROUP BY c.model, c.provider
ORDER BY COALESCE(SUM(c.total_tokens),0) DESC
LIMIT 50
`, orgID, days)

	return out, nil
}

const usageAggSelect = `
       COUNT(*), COALESCE(SUM(prompt_tokens),0), COALESCE(SUM(completion_tokens),0),
       COALESCE(SUM(cached_tokens),0), COALESCE(SUM(reasoning_tokens),0), COALESCE(SUM(total_tokens),0),
       CASE WHEN COUNT(estimated_cost_minor) = 0 THEN NULL ELSE SUM(estimated_cost_minor) END,
       COALESCE(SUM(provider_tokens),0), COALESCE(SUM(estimated_tokens),0),
       COALESCE(SUM(unknown_tokens),0), COALESCE(SUM(unpriced_tokens),0),
       COALESCE(SUM(priced_calls),0), COALESCE(SUM(unpriced_calls),0)`

const usageAggSelectR = `
       COUNT(*), COALESCE(SUM(r.prompt_tokens),0), COALESCE(SUM(r.completion_tokens),0),
       COALESCE(SUM(r.cached_tokens),0), COALESCE(SUM(r.reasoning_tokens),0), COALESCE(SUM(r.total_tokens),0),
       CASE WHEN COUNT(r.estimated_cost_minor) = 0 THEN NULL ELSE SUM(r.estimated_cost_minor) END,
       COALESCE(SUM(r.provider_tokens),0), COALESCE(SUM(r.estimated_tokens),0),
       COALESCE(SUM(r.unknown_tokens),0), COALESCE(SUM(r.unpriced_tokens),0),
       COALESCE(SUM(r.priced_calls),0), COALESCE(SUM(r.unpriced_calls),0)`

func usageSourceOf(provider, estimated, unknown int64) string {
	n := 0
	if provider > 0 {
		n++
	}
	if estimated > 0 {
		n++
	}
	if unknown > 0 {
		n++
	}
	if n == 0 {
		return billing.SourceUnknown
	}
	if n > 1 {
		return billing.SourceMixed
	}
	if provider > 0 {
		return billing.SourceProvider
	}
	if estimated > 0 {
		return billing.SourceEstimated
	}
	return billing.SourceUnknown
}

func nullPtr(v sql.NullInt64) *int64 {
	if !v.Valid {
		return nil
	}
	n := v.Int64
	return &n
}

func (d *DB) queryUsageGrouped(q string, orgID string, days int) ([]UsageRunDay, error) {
	rows, err := d.SQL.Query(q, orgID, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []UsageRunDay
	for rows.Next() {
		var r UsageRunDay
		var cost sql.NullInt64
		if err := rows.Scan(
			&r.Day, &r.UserID, &r.Username, &r.AgentID, &r.AgentName, &r.Model, &r.Provider,
			&r.RunCount, &r.PromptTokens, &r.CompletionTokens,
			&r.CachedTokens, &r.ReasoningTokens, &r.TotalTokens, &cost,
			&r.ProviderTokens, &r.EstimatedTokens, &r.UnknownTokens, &r.UnpricedTokens,
			&r.PricedCalls, &r.UnpricedCalls,
		); err != nil {
			return nil, err
		}
		r.EstimatedCostMinor = nullPtr(cost)
		r.Currency = billing.DefaultCurrency
		r.UsageSource = usageSourceOf(r.ProviderTokens, r.EstimatedTokens, r.UnknownTokens)
		out = append(out, r)
	}
	return out, rows.Err()
}

// UserMonthUsage is one user's own month. It is not an invoice.
type UserMonthUsage struct {
	Month              string        `json:"month"`
	UserID             string        `json:"user_id"`
	PromptTokens       int64         `json:"prompt_tokens"`
	CompletionTokens   int64         `json:"completion_tokens"`
	CachedTokens       int64         `json:"cached_tokens"`
	ReasoningTokens    int64         `json:"reasoning_tokens"`
	TotalTokens        int64         `json:"total_tokens"`
	EstimatedCostMinor *int64        `json:"estimated_cost_minor"`
	Currency           string        `json:"currency"`
	UsageSource        string        `json:"usage_source"`
	ProviderTokens     int64         `json:"provider_tokens"`
	EstimatedTokens    int64         `json:"estimated_tokens"`
	UnknownTokens      int64         `json:"unknown_tokens"`
	UnpricedTokens     int64         `json:"unpriced_tokens"`
	PricedCalls        int64         `json:"priced_calls"`
	UnpricedCalls      int64         `json:"unpriced_calls"`
	ByAgent            []UsageRunDay `json:"by_agent"`
	Note               string        `json:"note,omitempty"`
}

func (d *DB) GetUserMonthUsage(userID, month string) (*UserMonthUsage, error) {
	userID = strings.TrimSpace(userID)
	start, end, label, err := monthWindow(month)
	if err != nil {
		return nil, err
	}
	out := &UserMonthUsage{
		Month:       label,
		UserID:      userID,
		Currency:    billing.DefaultCurrency,
		UsageSource: billing.SourceUnknown,
		ByAgent:     []UsageRunDay{},
	}
	var cost sql.NullInt64
	err = d.SQL.QueryRow(`
SELECT COALESCE(SUM(prompt_tokens),0), COALESCE(SUM(completion_tokens),0),
       COALESCE(SUM(cached_tokens),0), COALESCE(SUM(reasoning_tokens),0), COALESCE(SUM(total_tokens),0),
       CASE WHEN COUNT(estimated_cost_minor) = 0 THEN NULL ELSE SUM(estimated_cost_minor) END,
       COALESCE(SUM(provider_tokens),0), COALESCE(SUM(estimated_tokens),0),
       COALESCE(SUM(unknown_tokens),0), COALESCE(SUM(unpriced_tokens),0),
       COALESCE(SUM(priced_calls),0), COALESCE(SUM(unpriced_calls),0)
FROM usage_runs
WHERE user_id = $1 AND day >= $2::date AND day < $3::date
`, userID, start, end).Scan(
		&out.PromptTokens, &out.CompletionTokens, &out.CachedTokens, &out.ReasoningTokens, &out.TotalTokens,
		&cost, &out.ProviderTokens, &out.EstimatedTokens, &out.UnknownTokens, &out.UnpricedTokens,
		&out.PricedCalls, &out.UnpricedCalls,
	)
	if err != nil {
		return nil, err
	}
	out.EstimatedCostMinor = nullPtr(cost)
	out.UsageSource = usageSourceOf(out.ProviderTokens, out.EstimatedTokens, out.UnknownTokens)
	out.Note = usageNote(out.ProviderTokens, out.EstimatedTokens, out.UnknownTokens, out.UnpricedTokens)
	rows, err := d.SQL.Query(`
SELECT '', r.user_id, '', r.agent_id, COALESCE(a.name, r.agent_id), '', '',
`+usageAggSelectR+`
FROM usage_runs r
LEFT JOIN agents a ON a.id = r.agent_id AND a.deleted_at IS NULL
WHERE r.user_id = $1 AND r.day >= $2::date AND r.day < $3::date
GROUP BY r.user_id, r.agent_id, a.name
ORDER BY COALESCE(SUM(r.total_tokens),0) DESC
`, userID, start, end)
	if err != nil {
		return out, nil
	}
	defer rows.Close()
	for rows.Next() {
		var r UsageRunDay
		var rowCost sql.NullInt64
		if err := rows.Scan(
			&r.Day, &r.UserID, &r.Username, &r.AgentID, &r.AgentName, &r.Model, &r.Provider,
			&r.RunCount, &r.PromptTokens, &r.CompletionTokens,
			&r.CachedTokens, &r.ReasoningTokens, &r.TotalTokens, &rowCost,
			&r.ProviderTokens, &r.EstimatedTokens, &r.UnknownTokens, &r.UnpricedTokens,
			&r.PricedCalls, &r.UnpricedCalls,
		); err != nil {
			return out, nil
		}
		r.EstimatedCostMinor = nullPtr(rowCost)
		r.Currency = billing.DefaultCurrency
		r.UsageSource = usageSourceOf(r.ProviderTokens, r.EstimatedTokens, r.UnknownTokens)
		out.ByAgent = append(out.ByAgent, r)
	}
	return out, nil
}

func monthWindow(month string) (start, end, label string, err error) {
	month = strings.TrimSpace(month)
	var t time.Time
	if month == "" {
		now := time.Now().In(time.Local)
		t = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.Local)
	} else {
		t, err = time.ParseInLocation("2006-01", month, time.Local)
		if err != nil {
			return "", "", "", err
		}
	}
	next := t.AddDate(0, 1, 0)
	return t.Format("2006-01-02"), next.Format("2006-01-02"), t.Format("2006-01"), nil
}

func usageNote(provider, estimated, unknown, unpriced int64) string {
	var parts []string
	if estimated > 0 {
		parts = append(parts, "部分为估算")
	}
	if unpriced > 0 {
		parts = append(parts, "部分模型未定价")
	}
	if unknown > 0 && provider == 0 && estimated == 0 {
		parts = append(parts, "有调用未能估算用量")
	}
	return strings.Join(parts, "；")
}

func (d *DB) ListOrgs() ([]Org, error) {
	rows, err := d.SQL.Query(`SELECT id, slug, name, created_at FROM orgs ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Org
	for rows.Next() {
		var o Org
		if err := rows.Scan(&o.ID, &o.Slug, &o.Name, &o.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func (d *DB) PlatformOrgSummaries(days int) ([]PlatformOrgSummary, error) {
	if days <= 0 || days > 366 {
		days = 30
	}
	orgs, err := d.ListOrgs()
	if err != nil {
		return nil, err
	}
	out := make([]PlatformOrgSummary, 0, len(orgs))
	for _, o := range orgs {
		u, _ := d.GetOrgUsage(o.ID)
		s := PlatformOrgSummary{
			OrgID:     o.ID,
			Slug:      o.Slug,
			Name:      o.Name,
			CreatedAt: o.CreatedAt.UTC().Format(time.RFC3339),
		}
		if u != nil {
			s.MemberCount = u.MemberCount
			s.ConversationCount = u.ConversationCount
			s.MessageCount = u.MessageCount
			s.AgentCount = u.AgentCount
		}
		_ = d.SQL.QueryRow(`
SELECT COALESCE(SUM(1),0), COALESCE(SUM(prompt_tokens),0),
       COALESCE(SUM(completion_tokens),0), COALESCE(SUM(total_tokens),0)
FROM usage_runs WHERE org_id = $1 AND day >= (CURRENT_DATE - ($2::int || ' days')::interval)
`, o.ID, days).Scan(&s.RunCount, &s.PromptTokens, &s.CompletionTokens, &s.TotalTokens)
		out = append(out, s)
	}
	return out, nil
}
