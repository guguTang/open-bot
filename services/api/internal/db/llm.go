package db

import (
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

type LLMConnection struct {
	ID             string    `json:"id"`
	UserID         string    `json:"user_id"`
	Name           string    `json:"name"`
	BaseURL        string    `json:"base_url"`
	APIKey         string    `json:"-"`
	Model          string    `json:"model"`
	EnableTools    bool      `json:"enable_tools"`
	SupportsVision bool      `json:"supports_vision"`
	IsDefault      bool      `json:"is_default"`
	ContextWindow  *int      `json:"context_window,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type LLMConnectionPublic struct {
	ID             string `json:"id"`
	UserID         string `json:"user_id"`
	Name           string `json:"name"`
	BaseURL        string `json:"base_url"`
	Model          string `json:"model"`
	EnableTools    bool   `json:"enable_tools"`
	SupportsVision bool   `json:"supports_vision"`
	IsDefault      bool   `json:"is_default"`
	ContextWindow  *int   `json:"context_window"`
	APIKeySet      bool   `json:"api_key_set"`
	APIKeyHint     string `json:"api_key_hint,omitempty"`
	CreatedAt      string `json:"created_at"`
	UpdatedAt      string `json:"updated_at"`
}

func (c *LLMConnection) Public() LLMConnectionPublic {
	hint := ""
	set := c.APIKey != ""
	if set {
		if len(c.APIKey) <= 4 {
			hint = "****"
		} else {
			hint = "****" + c.APIKey[len(c.APIKey)-4:]
		}
	}
	return LLMConnectionPublic{
		ID:             c.ID,
		UserID:         c.UserID,
		Name:           c.Name,
		BaseURL:        c.BaseURL,
		Model:          c.Model,
		EnableTools:    c.EnableTools,
		SupportsVision: c.SupportsVision,
		IsDefault:      c.IsDefault,
		ContextWindow:  c.ContextWindow,
		APIKeySet:      set,
		APIKeyHint:     hint,
		CreatedAt:      FormatTime(c.CreatedAt),
		UpdatedAt:      FormatTime(c.UpdatedAt),
	}
}

func scanLLM(row interface{ Scan(dest ...any) error }) (*LLMConnection, error) {
	var c LLMConnection
	var cw sql.NullInt64
	if err := row.Scan(
		&c.ID, &c.UserID, &c.Name, &c.BaseURL, &c.APIKey, &c.Model,
		&c.EnableTools, &c.IsDefault, &cw, &c.CreatedAt, &c.UpdatedAt, &c.SupportsVision,
	); err != nil {
		return nil, err
	}
	if cw.Valid && cw.Int64 > 0 {
		v := int(cw.Int64)
		c.ContextWindow = &v
	}
	return &c, nil
}

func llmContextWindowArg(cw *int) any {
	if cw != nil && *cw > 0 {
		return *cw
	}
	return nil
}

func (d *DB) CreateLLMConnection(userID string, name, baseURL, apiKey, model string, enableTools, isDefault bool, contextWindow *int) (*LLMConnection, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "默认连接"
	}
	now := Now()
	var cw *int
	if contextWindow != nil && *contextWindow > 0 {
		v := *contextWindow
		cw = &v
	}
	c := &LLMConnection{
		ID:            uuid.NewString(),
		UserID:        userID,
		Name:          name,
		BaseURL:       strings.TrimSpace(baseURL),
		APIKey:        apiKey,
		Model:         strings.TrimSpace(model),
		EnableTools:   enableTools,
		IsDefault:     isDefault,
		ContextWindow: cw,
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	tx, err := d.SQL.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	if isDefault {
		if _, err := tx.Exec(`UPDATE llm_connections SET is_default = FALSE WHERE user_id = $1`, userID); err != nil {
			return nil, err
		}
	}
	_, err = tx.Exec(
		`INSERT INTO llm_connections
		 (id, user_id, name, base_url, api_key, model, enable_tools, is_default, context_window, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
		c.ID, c.UserID, c.Name, c.BaseURL, c.APIKey, c.Model, c.EnableTools, c.IsDefault,
		llmContextWindowArg(c.ContextWindow), c.CreatedAt, c.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return c, nil
}

const llmSelectCols = `id, user_id, name, base_url, api_key, model, enable_tools, is_default, context_window, created_at, updated_at, supports_vision`

func (d *DB) ListLLMConnections(userID string) ([]*LLMConnection, error) {
	rows, err := d.SQL.Query(
		`SELECT `+llmSelectCols+`
		 FROM llm_connections WHERE user_id = $1
		 ORDER BY is_default DESC, created_at ASC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*LLMConnection
	for rows.Next() {
		c, err := scanLLM(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (d *DB) GetLLMConnection(userID, id string) (*LLMConnection, error) {
	row := d.SQL.QueryRow(
		`SELECT `+llmSelectCols+`
		 FROM llm_connections WHERE id = $1 AND user_id = $2`,
		id, userID,
	)
	c, err := scanLLM(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return c, nil
}

func (d *DB) GetDefaultLLM(userID string) (*LLMConnection, error) {
	row := d.SQL.QueryRow(
		`SELECT `+llmSelectCols+`
		 FROM llm_connections WHERE user_id = $1 AND is_default = TRUE LIMIT 1`,
		userID,
	)
	c, err := scanLLM(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			row2 := d.SQL.QueryRow(
				`SELECT `+llmSelectCols+`
				 FROM llm_connections WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1`,
				userID,
			)
			c2, err2 := scanLLM(row2)
			if err2 != nil {
				if errors.Is(err2, sql.ErrNoRows) {
					return nil, nil
				}
				return nil, err2
			}
			return c2, nil
		}
		return nil, err
	}
	return c, nil
}

type LLMUpdate struct {
	Name             *string
	BaseURL          *string
	APIKey           *string
	Model            *string
	EnableTools      *bool
	SupportsVision   *bool
	IsDefault        *bool
	ContextWindow    *int
	SetContextWindow bool
}

func (d *DB) UpdateLLMConnection(userID, id string, upd LLMUpdate) (*LLMConnection, error) {
	c, err := d.GetLLMConnection(userID, id)
	if err != nil {
		return nil, err
	}
	if upd.Name != nil {
		n := strings.TrimSpace(*upd.Name)
		if n != "" {
			c.Name = n
		}
	}
	if upd.BaseURL != nil {
		c.BaseURL = strings.TrimSpace(*upd.BaseURL)
	}
	if upd.APIKey != nil {
		c.APIKey = *upd.APIKey
	}
	if upd.Model != nil {
		c.Model = strings.TrimSpace(*upd.Model)
	}
	if upd.EnableTools != nil {
		c.EnableTools = *upd.EnableTools
	}
	if upd.SupportsVision != nil {
		c.SupportsVision = *upd.SupportsVision
	}
	if upd.SetContextWindow {
		if upd.ContextWindow != nil && *upd.ContextWindow > 0 {
			v := *upd.ContextWindow
			c.ContextWindow = &v
		} else {
			c.ContextWindow = nil
		}
	}
	wantDefault := c.IsDefault
	if upd.IsDefault != nil {
		wantDefault = *upd.IsDefault
	}
	c.UpdatedAt = Now()

	tx, err := d.SQL.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	if wantDefault {
		if _, err := tx.Exec(`UPDATE llm_connections SET is_default = FALSE WHERE user_id = $1`, userID); err != nil {
			return nil, err
		}
		c.IsDefault = true
	} else if upd.IsDefault != nil && !*upd.IsDefault {
		c.IsDefault = false
	}

	_, err = tx.Exec(
		`UPDATE llm_connections SET name=$1, base_url=$2, api_key=$3, model=$4,
		 enable_tools=$5, is_default=$6, context_window=$7, supports_vision=$8, updated_at=$9
		 WHERE id=$10 AND user_id=$11`,
		c.Name, c.BaseURL, c.APIKey, c.Model, c.EnableTools, c.IsDefault,
		llmContextWindowArg(c.ContextWindow), c.SupportsVision, c.UpdatedAt, id, userID,
	)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return c, nil
}

func (d *DB) DeleteLLMConnection(userID, id string) error {
	res, err := d.SQL.Exec(`DELETE FROM llm_connections WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (d *DB) SetDefaultLLM(userID, id string) (*LLMConnection, error) {
	c, err := d.GetLLMConnection(userID, id)
	if err != nil {
		return nil, err
	}
	tx, err := d.SQL.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(`UPDATE llm_connections SET is_default = FALSE WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}
	now := Now()
	if _, err := tx.Exec(
		`UPDATE llm_connections SET is_default = TRUE, updated_at = $1 WHERE id = $2 AND user_id = $3`,
		now, id, userID,
	); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	c.IsDefault = true
	c.UpdatedAt = now
	return c, nil
}

// ResolveEffectiveLLM picks the LLM for a user run:
//  1. user's personal default (is_default), else first personal connection
//  2. org_settings default LLM (when configured)
//  3. nil (none available)
//
// Soft-deleted users still resolve org LLM: requireAuth should reject them, but
// JWT-only middleware historically allowed deleted tokens through. Falling through
// to agent-runtime env OPENAI_MODEL then picked stale MiniMax and returned 503.
func (d *DB) ResolveEffectiveLLM(userID string) (*LLMConnection, error) {
	conn, err := d.GetDefaultLLM(userID)
	if err != nil {
		return nil, err
	}
	if conn != nil {
		return conn, nil
	}
	u, err := d.GetUserByID(userID)
	if err != nil {
		if !errors.Is(err, ErrNotFound) {
			return nil, err
		}
		// Soft-deleted (or purged-from-auth-view) user: still use org LLM if any.
		u, err = d.GetUserByIDIncludingDeleted(userID)
		if err != nil {
			return nil, err
		}
	}
	if strings.TrimSpace(u.OrgID) == "" {
		return nil, nil
	}
	settings, err := d.GetOrgSettings(u.OrgID)
	if err != nil {
		return nil, err
	}
	return OrgSettingsAsLLM(settings, userID), nil
}

// OrgSettingsAsLLM builds an ephemeral LLMConnection from org_settings.
// Returns nil when the org default is not configured.
//
// Model is required: a base_url/api_key without llm_model used to produce an
// override with model="" and agent-runtime then fell back to env OPENAI_MODEL
// (e.g. MiniMax), silently ignoring the admin LLM page.
func OrgSettingsAsLLM(s *OrgSettings, userID string) *LLMConnection {
	if s == nil {
		return nil
	}
	base := strings.TrimSpace(s.LLMBaseURL)
	model := strings.TrimSpace(s.LLMModel)
	key := s.LLMAPIKey
	// Model is the admin-selected chat id; required so we never attach an llm
	// override with model="" (runtime would then use env OPENAI_MODEL).
	if model == "" {
		return nil
	}
	name := strings.TrimSpace(s.LLMName)
	if name == "" {
		name = "组织默认连接"
	}
	return &LLMConnection{
		ID:          "org-default:" + s.OrgID,
		UserID:      userID,
		Name:        name,
		BaseURL:     base,
		APIKey:      key,
		Model:       model,
		EnableTools: s.LLMEnableTools,
		// Org default is not probe-persisted; personal connections carry supports_vision.
		SupportsVision: false,
		IsDefault:      true,
		ContextWindow:  s.LLMContextWindow,
		CreatedAt:      s.UpdatedAt,
		UpdatedAt:      s.UpdatedAt,
	}
}
