package db

import (
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

// OAuthConnection stores encrypted provider tokens (e.g. Gmail).
// Public status never exposes ciphertext.
type OAuthConnection struct {
	ID               string
	UserID           string
	Provider         string
	AccountEmail     string
	Scopes           string
	AccessTokenCT    string
	RefreshTokenCT   string
	TokenExpiry      *time.Time
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

type OAuthConnectionStatus struct {
	Provider     string `json:"provider"`
	Connected    bool   `json:"connected"`
	Email        string `json:"email,omitempty"`
	Scopes       string `json:"scopes,omitempty"`
	UpdatedAt    string `json:"updated_at,omitempty"`
}

func (d *DB) migrateOAuthConnections() error {
	_, err := d.SQL.Exec(`
CREATE TABLE IF NOT EXISTS oauth_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  account_email TEXT NOT NULL DEFAULT '',
  scopes TEXT NOT NULL DEFAULT '',
  access_token_ct TEXT NOT NULL DEFAULT '',
  refresh_token_ct TEXT NOT NULL DEFAULT '',
  token_expiry TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_oauth_connections_user ON oauth_connections(user_id);
`)
	return err
}

func (d *DB) UpsertOAuthConnection(
	userID, provider, email, scopes, accessCT, refreshCT string,
	expiry *time.Time,
) (*OAuthConnection, error) {
	userID = strings.TrimSpace(userID)
	provider = strings.ToLower(strings.TrimSpace(provider))
	email = strings.TrimSpace(email)
	if userID == "" || provider == "" {
		return nil, errors.New("user_id and provider required")
	}
	if strings.TrimSpace(accessCT) == "" {
		return nil, errors.New("access token required")
	}
	now := Now()
	id := uuid.NewString()
	_, err := d.SQL.Exec(
		`INSERT INTO oauth_connections
		   (id, user_id, provider, account_email, scopes, access_token_ct, refresh_token_ct, token_expiry, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
		 ON CONFLICT (user_id, provider) DO UPDATE SET
		   account_email=EXCLUDED.account_email,
		   scopes=EXCLUDED.scopes,
		   access_token_ct=EXCLUDED.access_token_ct,
		   refresh_token_ct=CASE
		     WHEN EXCLUDED.refresh_token_ct <> '' THEN EXCLUDED.refresh_token_ct
		     ELSE oauth_connections.refresh_token_ct
		   END,
		   token_expiry=EXCLUDED.token_expiry,
		   updated_at=EXCLUDED.updated_at`,
		id, userID, provider, email, strings.TrimSpace(scopes), accessCT, strings.TrimSpace(refreshCT), expiry, now,
	)
	if err != nil {
		return nil, err
	}
	return d.GetOAuthConnection(userID, provider)
}

func (d *DB) GetOAuthConnection(userID, provider string) (*OAuthConnection, error) {
	userID = strings.TrimSpace(userID)
	provider = strings.ToLower(strings.TrimSpace(provider))
	row := d.SQL.QueryRow(
		`SELECT id, user_id, provider, account_email, scopes, access_token_ct, refresh_token_ct, token_expiry, created_at, updated_at
		 FROM oauth_connections WHERE user_id=$1 AND provider=$2`,
		userID, provider,
	)
	var c OAuthConnection
	var expiry sql.NullTime
	err := row.Scan(
		&c.ID, &c.UserID, &c.Provider, &c.AccountEmail, &c.Scopes,
		&c.AccessTokenCT, &c.RefreshTokenCT, &expiry, &c.CreatedAt, &c.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if expiry.Valid {
		t := expiry.Time
		c.TokenExpiry = &t
	}
	return &c, nil
}

func (d *DB) DeleteOAuthConnection(userID, provider string) error {
	userID = strings.TrimSpace(userID)
	provider = strings.ToLower(strings.TrimSpace(provider))
	res, err := d.SQL.Exec(
		`DELETE FROM oauth_connections WHERE user_id=$1 AND provider=$2`,
		userID, provider,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (d *DB) OAuthConnectionStatus(userID, provider string) OAuthConnectionStatus {
	c, err := d.GetOAuthConnection(userID, provider)
	if err != nil || c == nil {
		return OAuthConnectionStatus{Provider: provider, Connected: false}
	}
	return OAuthConnectionStatus{
		Provider:  c.Provider,
		Connected: true,
		Email:     c.AccountEmail,
		Scopes:    c.Scopes,
		UpdatedAt: FormatTime(c.UpdatedAt),
	}
}

func (d *DB) UpdateOAuthTokens(userID, provider, accessCT, refreshCT string, expiry *time.Time) error {
	userID = strings.TrimSpace(userID)
	provider = strings.ToLower(strings.TrimSpace(provider))
	now := Now()
	if strings.TrimSpace(refreshCT) != "" {
		_, err := d.SQL.Exec(
			`UPDATE oauth_connections SET access_token_ct=$3, refresh_token_ct=$4, token_expiry=$5, updated_at=$6
			 WHERE user_id=$1 AND provider=$2`,
			userID, provider, accessCT, refreshCT, expiry, now,
		)
		return err
	}
	_, err := d.SQL.Exec(
		`UPDATE oauth_connections SET access_token_ct=$3, token_expiry=$4, updated_at=$5
		 WHERE user_id=$1 AND provider=$2`,
		userID, provider, accessCT, expiry, now,
	)
	return err
}
