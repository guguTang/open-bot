package db

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/tangxin/open-bot/services/api/internal/billing"
)

func (d *DB) migrateUsageLedger() error {
	if _, err := d.SQL.Exec(`
ALTER TABLE usage_runs ADD COLUMN IF NOT EXISTS cached_tokens BIGINT NOT NULL DEFAULT 0;
ALTER TABLE usage_runs ADD COLUMN IF NOT EXISTS reasoning_tokens BIGINT NOT NULL DEFAULT 0;
ALTER TABLE usage_runs ADD COLUMN IF NOT EXISTS estimated_cost_minor BIGINT;
ALTER TABLE usage_runs ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'CNY';
ALTER TABLE usage_runs ADD COLUMN IF NOT EXISTS usage_source TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE usage_runs ADD COLUMN IF NOT EXISTS priced_calls INT NOT NULL DEFAULT 0;
ALTER TABLE usage_runs ADD COLUMN IF NOT EXISTS unpriced_calls INT NOT NULL DEFAULT 0;
ALTER TABLE usage_runs ADD COLUMN IF NOT EXISTS provider_tokens BIGINT NOT NULL DEFAULT 0;
ALTER TABLE usage_runs ADD COLUMN IF NOT EXISTS estimated_tokens BIGINT NOT NULL DEFAULT 0;
ALTER TABLE usage_runs ADD COLUMN IF NOT EXISTS unknown_tokens BIGINT NOT NULL DEFAULT 0;
ALTER TABLE usage_runs ADD COLUMN IF NOT EXISTS unpriced_tokens BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS usage_calls (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES usage_runs(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL DEFAULT '',
  agent_id TEXT NOT NULL DEFAULT '',
  conversation_id TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  llm_connection_id TEXT NOT NULL DEFAULT '',
  prompt_tokens BIGINT NOT NULL DEFAULT 0,
  completion_tokens BIGINT NOT NULL DEFAULT 0,
  cached_tokens BIGINT NOT NULL DEFAULT 0,
  reasoning_tokens BIGINT NOT NULL DEFAULT 0,
  total_tokens BIGINT NOT NULL DEFAULT 0,
  usage_source TEXT NOT NULL DEFAULT 'unknown',
  call_kind TEXT NOT NULL DEFAULT 'chat',
  estimated_cost_minor BIGINT,
  currency TEXT NOT NULL DEFAULT 'CNY',
  price_id BIGINT,
  input_per_million_minor BIGINT,
  output_per_million_minor BIGINT,
  cached_per_million_minor BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_usage_calls_run ON usage_calls(run_id);
CREATE INDEX IF NOT EXISTS idx_usage_calls_user_created ON usage_calls(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_calls_org_created ON usage_calls(org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS model_prices (
  id BIGSERIAL PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL,
  match_kind TEXT NOT NULL DEFAULT 'exact',
  input_per_million_minor BIGINT NOT NULL,
  output_per_million_minor BIGINT NOT NULL,
  cached_per_million_minor BIGINT,
  currency TEXT NOT NULL DEFAULT 'CNY',
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to TIMESTAMPTZ,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_model_prices_lookup ON model_prices(org_id, model, effective_from DESC);
`); err != nil {
		return err
	}
	if _, err := d.SQL.Exec(`
DO $$ BEGIN
  ALTER TABLE usage_calls
    ADD CONSTRAINT usage_calls_price_id_fkey
    FOREIGN KEY (price_id) REFERENCES model_prices(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
`); err != nil {
		return err
	}
	return d.seedModelPrices()
}

// seedNote marks rows as editable defaults, not a live vendor price feed.
const seedNote = "seed: editable platform default, not a live vendor quote. Empty cached price bills cached tokens at the input rate."

type seedPrice struct {
	provider string
	model    string
	kind     string
	in       int64
	out      int64
	cached   *int64
}

func (d *DB) seedModelPrices() error {
	var n int
	if err := d.SQL.QueryRow(`SELECT COUNT(*) FROM model_prices WHERE org_id = ''`).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	cached75 := int64(75)
	cached1250 := int64(1250)
	cached100 := int64(100)
	cached500 := int64(500)
	cached300 := int64(300)
	rows := []seedPrice{
		{model: "gpt-4o-mini", kind: billing.MatchExact, in: 150, out: 600, cached: &cached75},
		{model: "gpt-4o", kind: billing.MatchExact, in: 2500, out: 10000, cached: &cached1250},
		{model: "gpt-4.1-mini", kind: billing.MatchExact, in: 400, out: 1600, cached: &cached100},
		{model: "gpt-4.1", kind: billing.MatchExact, in: 2000, out: 8000, cached: &cached500},
		{model: "claude-3-5-sonnet", kind: billing.MatchPrefix, in: 3000, out: 15000, cached: &cached300},
		{model: "claude-sonnet-4", kind: billing.MatchPrefix, in: 3000, out: 15000, cached: &cached300},
		{model: "deepseek-chat", kind: billing.MatchExact, in: 100, out: 200},
		{model: "deepseek-reasoner", kind: billing.MatchExact, in: 400, out: 1600},
		{model: "qwen-plus", kind: billing.MatchPrefix, in: 80, out: 200},
		{model: "qwen2.5", kind: billing.MatchPrefix, in: 80, out: 200},
		{model: "glm-4-flash", kind: billing.MatchPrefix, in: 10, out: 10},
		{model: "gemini-2.0-flash", kind: billing.MatchPrefix, in: 75, out: 300},
		{model: "bge-m3", kind: billing.MatchExact, in: 10, out: 0},
		{model: "text-embedding-3-small", kind: billing.MatchExact, in: 20, out: 0},
		{model: "text-embedding-3-large", kind: billing.MatchExact, in: 130, out: 0},
		{provider: "openrouter", model: "microsoft/microsoft-decision-1", kind: billing.MatchExact, in: 30, out: 0},
		{model: "Microsoft-Decision-1", kind: billing.MatchExact, in: 30, out: 0},
	}
	now := Now()
	for _, row := range rows {
		if _, err := d.SQL.Exec(`
INSERT INTO model_prices (
  org_id, provider, model, match_kind,
  input_per_million_minor, output_per_million_minor, cached_per_million_minor,
  currency, effective_from, note, created_at, updated_at
) VALUES ('', $1, $2, $3, $4, $5, $6, 'CNY', $7, $8, $7, $7)
`, row.provider, row.model, row.kind, row.in, row.out, row.cached, now, seedNote); err != nil {
			return err
		}
	}
	return nil
}

// ModelPrice is an admin-facing price row. CachedPerMillionMinor nil means
// "bill cached tokens at the input rate" (applied at write time, then snapshotted).
type ModelPrice struct {
	ID                    int64      `json:"id"`
	OrgID                 string     `json:"org_id"`
	Provider              string     `json:"provider"`
	Model                 string     `json:"model"`
	MatchKind             string     `json:"match_kind"`
	InputPerMillionMinor  int64      `json:"input_per_million_minor"`
	OutputPerMillionMinor int64      `json:"output_per_million_minor"`
	CachedPerMillionMinor *int64     `json:"cached_per_million_minor"`
	Currency              string     `json:"currency"`
	EffectiveFrom         time.Time  `json:"effective_from"`
	EffectiveTo           *time.Time `json:"effective_to"`
	Note                  string     `json:"note"`
	CachedPolicy          string     `json:"cached_policy"`
}

func (p ModelPrice) billing() billing.Price {
	return billing.Price{
		ID:                    p.ID,
		OrgID:                 p.OrgID,
		Provider:              p.Provider,
		Model:                 p.Model,
		MatchKind:             p.MatchKind,
		InputPerMillionMinor:  p.InputPerMillionMinor,
		OutputPerMillionMinor: p.OutputPerMillionMinor,
		CachedPerMillionMinor: p.CachedPerMillionMinor,
		Currency:              p.Currency,
		EffectiveFrom:         p.EffectiveFrom,
		EffectiveTo:           p.EffectiveTo,
	}
}

func (d *DB) ListModelPrices(activeOnly bool) ([]ModelPrice, error) {
	q := `
SELECT id, org_id, provider, model, match_kind,
       input_per_million_minor, output_per_million_minor, cached_per_million_minor,
       currency, effective_from, effective_to, note
FROM model_prices
`
	if activeOnly {
		q += `WHERE effective_from <= NOW() AND (effective_to IS NULL OR effective_to > NOW())
`
	}
	q += `ORDER BY org_id, model, effective_from DESC`
	rows, err := d.SQL.Query(q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ModelPrice
	for rows.Next() {
		p, err := scanModelPrice(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

type priceScanner interface {
	Scan(dest ...any) error
}

func scanModelPrice(s priceScanner) (ModelPrice, error) {
	var p ModelPrice
	var cached sql.NullInt64
	var effTo sql.NullTime
	err := s.Scan(
		&p.ID, &p.OrgID, &p.Provider, &p.Model, &p.MatchKind,
		&p.InputPerMillionMinor, &p.OutputPerMillionMinor, &cached,
		&p.Currency, &p.EffectiveFrom, &effTo, &p.Note,
	)
	if err != nil {
		return p, err
	}
	if cached.Valid {
		v := cached.Int64
		p.CachedPerMillionMinor = &v
	}
	if effTo.Valid {
		t := effTo.Time
		p.EffectiveTo = &t
	}
	if p.CachedPerMillionMinor == nil {
		p.CachedPolicy = "缓存 token 按输入单价计"
	} else {
		p.CachedPolicy = "缓存 token 使用表内缓存单价"
	}
	return p, nil
}

type ModelPriceInput struct {
	OrgID                 string
	Provider              string
	Model                 string
	MatchKind             string
	InputPerMillionMinor  int64
	OutputPerMillionMinor int64
	CachedPerMillionMinor *int64
	CachedSet             bool
	Currency              string
	Note                  string
}

func (in ModelPriceInput) validate() (ModelPriceInput, error) {
	in.OrgID = strings.TrimSpace(in.OrgID)
	in.Provider = strings.TrimSpace(in.Provider)
	in.Model = strings.TrimSpace(in.Model)
	in.MatchKind = strings.ToLower(strings.TrimSpace(in.MatchKind))
	in.Currency = strings.ToUpper(strings.TrimSpace(in.Currency))
	in.Note = strings.TrimSpace(in.Note)
	if in.Model == "" {
		return in, fmt.Errorf("model 不能为空")
	}
	if in.MatchKind == "" {
		in.MatchKind = billing.MatchExact
	}
	if in.MatchKind != billing.MatchExact && in.MatchKind != billing.MatchPrefix {
		return in, fmt.Errorf("match_kind 只能是 exact 或 prefix")
	}
	if in.Currency == "" {
		in.Currency = billing.DefaultCurrency
	}
	if len(in.Currency) != 3 {
		return in, fmt.Errorf("currency 需要 3 位币种代码")
	}
	if in.InputPerMillionMinor < 0 || in.OutputPerMillionMinor < 0 {
		return in, fmt.Errorf("单价不能为负")
	}
	if in.CachedPerMillionMinor != nil && *in.CachedPerMillionMinor < 0 {
		return in, fmt.Errorf("缓存单价不能为负")
	}
	return in, nil
}

func (d *DB) CreateModelPrice(in ModelPriceInput) (*ModelPrice, error) {
	in, err := in.validate()
	if err != nil {
		return nil, err
	}
	now := Now()
	var id int64
	err = d.SQL.QueryRow(`
INSERT INTO model_prices (
  org_id, provider, model, match_kind,
  input_per_million_minor, output_per_million_minor, cached_per_million_minor,
  currency, effective_from, note, created_at, updated_at
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$9,$9)
RETURNING id
`, in.OrgID, in.Provider, in.Model, in.MatchKind,
		in.InputPerMillionMinor, in.OutputPerMillionMinor, in.CachedPerMillionMinor,
		in.Currency, now, in.Note).Scan(&id)
	if err != nil {
		return nil, err
	}
	return d.GetModelPrice(id)
}

func (d *DB) GetModelPrice(id int64) (*ModelPrice, error) {
	row := d.SQL.QueryRow(`
SELECT id, org_id, provider, model, match_kind,
       input_per_million_minor, output_per_million_minor, cached_per_million_minor,
       currency, effective_from, effective_to, note
FROM model_prices WHERE id = $1
`, id)
	p, err := scanModelPrice(row)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// UpdateModelPrice changes the current row's rates. Historical usage_calls keep
// the minor amount and unit snapshot written earlier.
func (d *DB) UpdateModelPrice(id int64, in ModelPriceInput) (*ModelPrice, error) {
	cur, err := d.GetModelPrice(id)
	if err != nil {
		return nil, err
	}
	in, err = in.validate()
	if err != nil {
		return nil, err
	}
	cached := cur.CachedPerMillionMinor
	if in.CachedSet {
		cached = in.CachedPerMillionMinor
	}
	now := Now()
	_, err = d.SQL.Exec(`
UPDATE model_prices SET
  provider = $2,
  model = $3,
  match_kind = $4,
  input_per_million_minor = $5,
  output_per_million_minor = $6,
  cached_per_million_minor = $7,
  currency = $8,
  note = $9,
  updated_at = $10
WHERE id = $1
`, id, in.Provider, in.Model, in.MatchKind,
		in.InputPerMillionMinor, in.OutputPerMillionMinor, cached,
		in.Currency, in.Note, now)
	if err != nil {
		return nil, err
	}
	return d.GetModelPrice(id)
}

// ExpireModelPrice stops a row from matching future calls. It does not rewrite usage.
func (d *DB) ExpireModelPrice(id int64) error {
	_, err := d.SQL.Exec(`
UPDATE model_prices SET effective_to = NOW(), updated_at = NOW()
WHERE id = $1 AND (effective_to IS NULL OR effective_to > NOW())
`, id)
	return err
}

func (d *DB) loadPrices() ([]billing.Price, error) {
	rows, err := d.ListModelPrices(false)
	if err != nil {
		return nil, err
	}
	out := make([]billing.Price, 0, len(rows))
	for _, row := range rows {
		out = append(out, row.billing())
	}
	return out, nil
}
