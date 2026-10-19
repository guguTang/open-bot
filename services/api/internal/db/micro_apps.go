package db

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Micro-app lifecycle: draft → pinned → archived.
// Pin is never silent: callers must pass user confirm intent (see httpserver).
const (
	MicroAppStatusDraft    = "draft"
	MicroAppStatusPinned   = "pinned"
	MicroAppStatusArchived = "archived"

	MicroAppKindUI      = "ui"
	MicroAppKindSkill   = "skill"
	MicroAppKindRoutine = "routine"

	MicroAppSurfaceHub             = "hub"
	MicroAppSurfaceChatPin         = "chat_pin"
	MicroAppSurfaceDesktopShortcut = "desktop_shortcut"
	MicroAppSurfaceMobileShortcut  = "mobile_shortcut"

	MicroAppGrantAllowOnce   = "allow_once"
	MicroAppGrantAlwaysAllow = "always_allow"
	MicroAppGrantDeny        = "deny"
)

// Known capabilities (catalog). Phase 0: schema/API only; host bridge is Phase 1+.
// host.shell.run is declarable; gate = declaration ∩ host capability ∩ Grant tri-state;
// high-sens default allow_once (not permanently closed).
var MicroAppKnownCapabilities = map[string]struct{}{
	"host.screenshot":      {},
	"host.clipboard.read":  {},
	"host.clipboard.write": {},
	"host.fs.read":         {},
	"host.fs.write":        {},
	"host.fs.workspace":    {},
	"host.app.find":        {},
	"host.app.open":        {},
	"host.shell.run":       {},
	"cloud.http":           {},
	"ui.notify":            {},
	"chat.attach":          {},
	"account.profile":      {},
	"agent.invoke":         {},
	"skill.toggle":         {},
	"routine.manage":       {},
	"device.notify":        {},
	"device.camera":        {},
	"device.mic":           {},
	"device.geo":           {},
	"device.share":         {},
}

// High-sensitivity capabilities: default Grant decision suggestion is allow_once.
var MicroAppHighSensitivityCapabilities = map[string]struct{}{
	"host.clipboard.read": {},
	"host.shell.run":      {},
	"device.contacts":     {},
	"device.mic":          {},
}

type MicroApp struct {
	ID                   string              `json:"id"`
	UserID               string              `json:"user_id"`
	AgentID              string              `json:"agent_id,omitempty"`
	Title                string              `json:"title"`
	Description          string              `json:"description"`
	Icon                 string              `json:"icon,omitempty"`
	Kind                 string              `json:"kind"`
	Status               string              `json:"status"`
	Version              int                 `json:"version"`
	BundleKey            string              `json:"bundle_key,omitempty"`
	BundleHash           string              `json:"bundle_hash,omitempty"`
	Entrypoint           string              `json:"entrypoint,omitempty"`
	SkillSlug            string              `json:"skill_slug,omitempty"`
	RoutineID            string              `json:"routine_id,omitempty"`
	Capabilities         []string            `json:"capabilities"`
	SourceConversationID string              `json:"source_conversation_id,omitempty"`
	SourceMessageID      string              `json:"source_message_id,omitempty"`
	ConfirmedAt          *time.Time          `json:"confirmed_at,omitempty"`
	ConfirmedBy          string              `json:"confirmed_by,omitempty"`
	CreatedAt            time.Time           `json:"created_at"`
	UpdatedAt            time.Time           `json:"updated_at"`
	Placements           []MicroAppPlacement `json:"placements,omitempty"`
	// BundleURL is filled by API for get (Phase 0: empty / placeholder).
	BundleURL string `json:"bundle_url,omitempty"`
}

type MicroAppPlacement struct {
	ID         string    `json:"id"`
	MicroAppID string    `json:"micro_app_id"`
	Surface    string    `json:"surface"`
	ContextID  string    `json:"context_id,omitempty"`
	SortRank   int       `json:"sort_rank"`
	Enabled    bool      `json:"enabled"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type MicroAppGrant struct {
	ID         string     `json:"id"`
	UserID     string     `json:"user_id"`
	MicroAppID string     `json:"micro_app_id"`
	Capability string     `json:"capability"`
	MachineID  string     `json:"machine_id,omitempty"`
	Decision   string     `json:"decision"`
	ExpiresAt  *time.Time `json:"expires_at,omitempty"`
	UpdatedAt  time.Time  `json:"updated_at"`
	CreatedAt  time.Time  `json:"created_at"`
}

type MicroAppCreateInput struct {
	Title                string
	Description          string
	Icon                 string
	Kind                 string
	AgentID              string
	Capabilities         []string
	BundleKey            string
	BundleHash           string
	Entrypoint           string
	SkillSlug            string
	RoutineID            string
	SourceConversationID string
	SourceMessageID      string
}

type MicroAppPatchInput struct {
	Title        *string
	Description  *string
	Icon         *string
	Entrypoint   *string
	SkillSlug    *string
	RoutineID    *string
	Capabilities *[]string
}

func (d *DB) migrateMicroApps() error {
	_, err := d.SQL.Exec(`
CREATE TABLE IF NOT EXISTS micro_apps (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'ui',
  status TEXT NOT NULL DEFAULT 'draft',
  version INT NOT NULL DEFAULT 1,
  bundle_key TEXT NOT NULL DEFAULT '',
  bundle_hash TEXT NOT NULL DEFAULT '',
  entrypoint TEXT NOT NULL DEFAULT 'index.html',
  skill_slug TEXT NOT NULL DEFAULT '',
  routine_id TEXT NOT NULL DEFAULT '',
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  source_conversation_id TEXT NOT NULL DEFAULT '',
  source_message_id TEXT NOT NULL DEFAULT '',
  confirmed_at TIMESTAMPTZ,
  confirmed_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_micro_apps_user_status ON micro_apps(user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_micro_apps_user_kind ON micro_apps(user_id, kind);

CREATE TABLE IF NOT EXISTS micro_app_placements (
  id TEXT PRIMARY KEY,
  micro_app_id TEXT NOT NULL REFERENCES micro_apps(id) ON DELETE CASCADE,
  surface TEXT NOT NULL,
  context_id TEXT NOT NULL DEFAULT '',
  sort_rank INT NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_micro_app_placements_uniq
  ON micro_app_placements(micro_app_id, surface, context_id);
CREATE INDEX IF NOT EXISTS idx_micro_app_placements_surface
  ON micro_app_placements(surface, enabled);

CREATE TABLE IF NOT EXISTS micro_app_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  micro_app_id TEXT NOT NULL REFERENCES micro_apps(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,
  machine_id TEXT NOT NULL DEFAULT '',
  decision TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_micro_app_grants_uniq
  ON micro_app_grants(user_id, micro_app_id, capability, machine_id);
CREATE INDEX IF NOT EXISTS idx_micro_app_grants_app ON micro_app_grants(micro_app_id);
`)
	return err
}

// MicroAppObjectKey returns the MinIO/object-storage key prefix for a micro-app bundle.
// Phase 0: placeholder path only; upload/download lands in Phase 1.
func MicroAppObjectKey(ownerID, appID string) string {
	return fmt.Sprintf("micro-apps/%s/%s/", strings.TrimSpace(ownerID), strings.TrimSpace(appID))
}

func encodeCapabilitiesJSON(caps []string) (string, error) {
	if caps == nil {
		caps = []string{}
	}
	cleaned := make([]string, 0, len(caps))
	seen := map[string]struct{}{}
	for _, c := range caps {
		c = strings.TrimSpace(c)
		if c == "" {
			continue
		}
		if _, ok := seen[c]; ok {
			continue
		}
		seen[c] = struct{}{}
		cleaned = append(cleaned, c)
	}
	b, err := json.Marshal(cleaned)
	if err != nil {
		return "[]", err
	}
	return string(b), nil
}

func decodeCapabilitiesJSON(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "null" {
		return []string{}
	}
	var out []string
	if err := json.Unmarshal([]byte(raw), &out); err != nil || out == nil {
		return []string{}
	}
	return out
}

func NormalizeMicroAppKind(kind string) string {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case MicroAppKindSkill:
		return MicroAppKindSkill
	case MicroAppKindRoutine:
		return MicroAppKindRoutine
	default:
		return MicroAppKindUI
	}
}

func NormalizeMicroAppGrantDecision(d string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(d)) {
	case MicroAppGrantAllowOnce:
		return MicroAppGrantAllowOnce, nil
	case MicroAppGrantAlwaysAllow:
		return MicroAppGrantAlwaysAllow, nil
	case MicroAppGrantDeny:
		return MicroAppGrantDeny, nil
	default:
		return "", errors.New("decision must be allow_once, always_allow, or deny")
	}
}

func NormalizeMicroAppSurface(surface string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(surface)) {
	case MicroAppSurfaceHub:
		return MicroAppSurfaceHub, nil
	case MicroAppSurfaceChatPin:
		return MicroAppSurfaceChatPin, nil
	case MicroAppSurfaceDesktopShortcut:
		return MicroAppSurfaceDesktopShortcut, nil
	case MicroAppSurfaceMobileShortcut:
		return MicroAppSurfaceMobileShortcut, nil
	default:
		return "", fmt.Errorf("invalid surface %q", surface)
	}
}

func DefaultGrantDecisionForCapability(capability string) string {
	if _, ok := MicroAppHighSensitivityCapabilities[capability]; ok {
		return MicroAppGrantAllowOnce
	}
	return MicroAppGrantAllowOnce
}

func ValidateMicroAppCapabilities(caps []string) error {
	for _, c := range caps {
		c = strings.TrimSpace(c)
		if c == "" {
			continue
		}
		if _, ok := MicroAppKnownCapabilities[c]; !ok {
			return fmt.Errorf("unknown capability %q", c)
		}
	}
	return nil
}

const microAppSelect = `SELECT id, user_id, COALESCE(agent_id,''), title, description, COALESCE(icon,''),
  kind, status, version, COALESCE(bundle_key,''), COALESCE(bundle_hash,''), COALESCE(entrypoint,''),
  COALESCE(skill_slug,''), COALESCE(routine_id,''), COALESCE(capabilities_json,'[]'),
  COALESCE(source_conversation_id,''), COALESCE(source_message_id,''),
  confirmed_at, COALESCE(confirmed_by,''), created_at, updated_at
 FROM micro_apps`

func scanMicroApp(scanner interface {
	Scan(dest ...any) error
}) (*MicroApp, error) {
	var a MicroApp
	var capsJSON string
	var confirmedAt sql.NullTime
	if err := scanner.Scan(
		&a.ID, &a.UserID, &a.AgentID, &a.Title, &a.Description, &a.Icon,
		&a.Kind, &a.Status, &a.Version, &a.BundleKey, &a.BundleHash, &a.Entrypoint,
		&a.SkillSlug, &a.RoutineID, &capsJSON,
		&a.SourceConversationID, &a.SourceMessageID,
		&confirmedAt, &a.ConfirmedBy, &a.CreatedAt, &a.UpdatedAt,
	); err != nil {
		return nil, err
	}
	a.Capabilities = decodeCapabilitiesJSON(capsJSON)
	if confirmedAt.Valid {
		t := confirmedAt.Time
		a.ConfirmedAt = &t
	}
	return &a, nil
}

func (d *DB) CreateMicroApp(userID string, in MicroAppCreateInput) (*MicroApp, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, errors.New("user_id required")
	}
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return nil, errors.New("title required")
	}
	kind := NormalizeMicroAppKind(in.Kind)
	if err := ValidateMicroAppCapabilities(in.Capabilities); err != nil {
		return nil, err
	}
	capsJSON, err := encodeCapabilitiesJSON(in.Capabilities)
	if err != nil {
		return nil, err
	}
	id := uuid.NewString()
	bundleKey := strings.TrimSpace(in.BundleKey)
	if bundleKey == "" {
		bundleKey = MicroAppObjectKey(userID, id)
	}
	entrypoint := strings.TrimSpace(in.Entrypoint)
	if entrypoint == "" {
		entrypoint = "index.html"
	}
	now := Now()
	_, err = d.SQL.Exec(`
INSERT INTO micro_apps (
  id, user_id, agent_id, title, description, icon, kind, status, version,
  bundle_key, bundle_hash, entrypoint, skill_slug, routine_id, capabilities_json,
  source_conversation_id, source_message_id, created_at, updated_at
) VALUES (
  $1,$2,$3,$4,$5,$6,$7,$8,1,
  $9,$10,$11,$12,$13,$14,
  $15,$16,$17,$17
)`,
		id, userID, strings.TrimSpace(in.AgentID), title, strings.TrimSpace(in.Description),
		strings.TrimSpace(in.Icon), kind, MicroAppStatusDraft,
		bundleKey, strings.TrimSpace(in.BundleHash), entrypoint,
		strings.TrimSpace(in.SkillSlug), strings.TrimSpace(in.RoutineID), capsJSON,
		strings.TrimSpace(in.SourceConversationID), strings.TrimSpace(in.SourceMessageID), now,
	)
	if err != nil {
		return nil, err
	}
	return d.GetMicroApp(userID, id)
}

func (d *DB) GetMicroApp(userID, id string) (*MicroApp, error) {
	row := d.SQL.QueryRow(microAppSelect+` WHERE id = $1 AND user_id = $2`, id, userID)
	a, err := scanMicroApp(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	placements, err := d.ListMicroAppPlacements(a.ID)
	if err != nil {
		return nil, err
	}
	a.Placements = placements
	return a, nil
}

func (d *DB) ListMicroApps(userID, surface, status string) ([]*MicroApp, error) {
	userID = strings.TrimSpace(userID)
	surface = strings.TrimSpace(surface)
	status = strings.TrimSpace(status)

	var (
		rows *sql.Rows
		err  error
	)
	if surface != "" {
		surf, nerr := NormalizeMicroAppSurface(surface)
		if nerr != nil {
			return nil, nerr
		}
		q := microAppSelect + `
 WHERE user_id = $1
   AND status <> $2
   AND id IN (
     SELECT micro_app_id FROM micro_app_placements
     WHERE surface = $3 AND enabled = TRUE
   )`
		args := []any{userID, MicroAppStatusArchived, surf}
		if status != "" {
			q += ` AND status = $4`
			args = append(args, status)
		}
		q += ` ORDER BY updated_at DESC`
		rows, err = d.SQL.Query(q, args...)
	} else {
		q := microAppSelect + ` WHERE user_id = $1`
		args := []any{userID}
		if status != "" {
			q += ` AND status = $2`
			args = append(args, status)
		} else {
			q += ` AND status <> $2`
			args = append(args, MicroAppStatusArchived)
		}
		q += ` ORDER BY updated_at DESC`
		rows, err = d.SQL.Query(q, args...)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*MicroApp
	for rows.Next() {
		a, err := scanMicroApp(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if out == nil {
		out = []*MicroApp{}
	}
	for _, a := range out {
		placements, err := d.ListMicroAppPlacements(a.ID)
		if err != nil {
			return nil, err
		}
		a.Placements = placements
	}
	return out, nil
}

func (d *DB) PatchMicroApp(userID, id string, in MicroAppPatchInput) (*MicroApp, error) {
	cur, err := d.GetMicroApp(userID, id)
	if err != nil {
		return nil, err
	}
	if cur.Status == MicroAppStatusArchived {
		return nil, errors.New("archived micro-app cannot be patched")
	}
	title := cur.Title
	desc := cur.Description
	icon := cur.Icon
	entrypoint := cur.Entrypoint
	skillSlug := cur.SkillSlug
	routineID := cur.RoutineID
	caps := cur.Capabilities
	if in.Title != nil {
		title = strings.TrimSpace(*in.Title)
		if title == "" {
			return nil, errors.New("title required")
		}
	}
	if in.Description != nil {
		desc = strings.TrimSpace(*in.Description)
	}
	if in.Icon != nil {
		icon = strings.TrimSpace(*in.Icon)
	}
	if in.Entrypoint != nil {
		entrypoint = strings.TrimSpace(*in.Entrypoint)
	}
	if in.SkillSlug != nil {
		skillSlug = strings.TrimSpace(*in.SkillSlug)
	}
	if in.RoutineID != nil {
		routineID = strings.TrimSpace(*in.RoutineID)
	}
	if in.Capabilities != nil {
		if err := ValidateMicroAppCapabilities(*in.Capabilities); err != nil {
			return nil, err
		}
		caps = *in.Capabilities
	}
	capsJSON, err := encodeCapabilitiesJSON(caps)
	if err != nil {
		return nil, err
	}
	now := Now()
	res, err := d.SQL.Exec(`
UPDATE micro_apps SET
  title = $3, description = $4, icon = $5, entrypoint = $6,
  skill_slug = $7, routine_id = $8, capabilities_json = $9, updated_at = $10
 WHERE id = $1 AND user_id = $2`,
		id, userID, title, desc, icon, entrypoint, skillSlug, routineID, capsJSON, now,
	)
	if err != nil {
		return nil, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, ErrNotFound
	}
	return d.GetMicroApp(userID, id)
}

// PinMicroApp promotes draft→pinned after explicit user confirm intent.
// Writes confirmed_* and ensures a hub placement.
func (d *DB) PinMicroApp(userID, id, confirmedBy string) (*MicroApp, error) {
	cur, err := d.GetMicroApp(userID, id)
	if err != nil {
		return nil, err
	}
	if cur.Status == MicroAppStatusArchived {
		return nil, errors.New("cannot pin archived micro-app")
	}
	now := Now()
	confirmedBy = strings.TrimSpace(confirmedBy)
	if confirmedBy == "" {
		confirmedBy = userID
	}
	_, err = d.SQL.Exec(`
UPDATE micro_apps SET
  status = $3, confirmed_at = $4, confirmed_by = $5, updated_at = $4,
  version = CASE WHEN status = $6 THEN version + 1 ELSE version END
 WHERE id = $1 AND user_id = $2`,
		id, userID, MicroAppStatusPinned, now, confirmedBy, MicroAppStatusDraft,
	)
	if err != nil {
		return nil, err
	}
	if err := d.EnsureMicroAppPlacement(id, MicroAppSurfaceHub, "", 0, true); err != nil {
		return nil, err
	}
	return d.GetMicroApp(userID, id)
}

func (d *DB) ArchiveMicroApp(userID, id string) (*MicroApp, error) {
	now := Now()
	res, err := d.SQL.Exec(`
UPDATE micro_apps SET status = $3, updated_at = $4
 WHERE id = $1 AND user_id = $2 AND status <> $3`,
		id, userID, MicroAppStatusArchived, now,
	)
	if err != nil {
		return nil, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		// Distinguish not-found vs already archived.
		if _, gerr := d.GetMicroApp(userID, id); gerr != nil {
			return nil, gerr
		}
	}
	// Disable placements on archive.
	_, _ = d.SQL.Exec(`UPDATE micro_app_placements SET enabled = FALSE, updated_at = $2 WHERE micro_app_id = $1`, id, now)
	return d.GetMicroApp(userID, id)
}

func (d *DB) ListMicroAppPlacements(microAppID string) ([]MicroAppPlacement, error) {
	rows, err := d.SQL.Query(`
SELECT id, micro_app_id, surface, COALESCE(context_id,''), sort_rank, enabled, created_at, updated_at
 FROM micro_app_placements WHERE micro_app_id = $1 ORDER BY sort_rank ASC, created_at ASC`, microAppID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MicroAppPlacement
	for rows.Next() {
		var p MicroAppPlacement
		if err := rows.Scan(&p.ID, &p.MicroAppID, &p.Surface, &p.ContextID, &p.SortRank, &p.Enabled, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	if out == nil {
		out = []MicroAppPlacement{}
	}
	return out, rows.Err()
}

func (d *DB) EnsureMicroAppPlacement(microAppID, surface, contextID string, sortRank int, enabled bool) error {
	surf, err := NormalizeMicroAppSurface(surface)
	if err != nil {
		return err
	}
	contextID = strings.TrimSpace(contextID)
	now := Now()
	id := uuid.NewString()
	_, err = d.SQL.Exec(`
INSERT INTO micro_app_placements (id, micro_app_id, surface, context_id, sort_rank, enabled, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
ON CONFLICT (micro_app_id, surface, context_id) DO UPDATE SET
  sort_rank = EXCLUDED.sort_rank,
  enabled = EXCLUDED.enabled,
  updated_at = EXCLUDED.updated_at`,
		id, microAppID, surf, contextID, sortRank, enabled, now,
	)
	return err
}

func (d *DB) ReplaceMicroAppPlacements(userID, microAppID string, placements []MicroAppPlacement) ([]MicroAppPlacement, error) {
	if _, err := d.GetMicroApp(userID, microAppID); err != nil {
		return nil, err
	}
	tx, err := d.SQL.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(`DELETE FROM micro_app_placements WHERE micro_app_id = $1`, microAppID); err != nil {
		return nil, err
	}
	now := Now()
	for _, p := range placements {
		surf, err := NormalizeMicroAppSurface(p.Surface)
		if err != nil {
			return nil, err
		}
		id := uuid.NewString()
		if strings.TrimSpace(p.ID) != "" {
			id = strings.TrimSpace(p.ID)
		}
		enabled := p.Enabled
		_, err = tx.Exec(`
INSERT INTO micro_app_placements (id, micro_app_id, surface, context_id, sort_rank, enabled, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
			id, microAppID, surf, strings.TrimSpace(p.ContextID), p.SortRank, enabled, now,
		)
		if err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return d.ListMicroAppPlacements(microAppID)
}

func (d *DB) ListMicroAppGrants(userID, microAppID, machineID string) ([]MicroAppGrant, error) {
	if _, err := d.GetMicroApp(userID, microAppID); err != nil {
		return nil, err
	}
	q := `
SELECT id, user_id, micro_app_id, capability, COALESCE(machine_id,''), decision, expires_at, created_at, updated_at
 FROM micro_app_grants WHERE user_id = $1 AND micro_app_id = $2`
	args := []any{userID, microAppID}
	if mid := strings.TrimSpace(machineID); mid != "" {
		q += ` AND (machine_id = $3 OR machine_id = '')`
		args = append(args, mid)
	}
	q += ` ORDER BY capability ASC, machine_id ASC`
	rows, err := d.SQL.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MicroAppGrant
	for rows.Next() {
		var g MicroAppGrant
		var exp sql.NullTime
		if err := rows.Scan(&g.ID, &g.UserID, &g.MicroAppID, &g.Capability, &g.MachineID, &g.Decision, &exp, &g.CreatedAt, &g.UpdatedAt); err != nil {
			return nil, err
		}
		if exp.Valid {
			t := exp.Time
			g.ExpiresAt = &t
		}
		out = append(out, g)
	}
	if out == nil {
		out = []MicroAppGrant{}
	}
	return out, rows.Err()
}

func (d *DB) UpsertMicroAppGrant(userID, microAppID, capability, machineID, decision string, expiresAt *time.Time) (*MicroAppGrant, error) {
	app, err := d.GetMicroApp(userID, microAppID)
	if err != nil {
		return nil, err
	}
	capability = strings.TrimSpace(capability)
	if capability == "" {
		return nil, errors.New("capability required")
	}
	// Gate: capability must be declared on the app (declaration ∩ …).
	declared := false
	for _, c := range app.Capabilities {
		if c == capability {
			declared = true
			break
		}
	}
	if !declared {
		return nil, fmt.Errorf("capability_not_declared: %s", capability)
	}
	if err := ValidateMicroAppCapabilities([]string{capability}); err != nil {
		return nil, err
	}
	dec, err := NormalizeMicroAppGrantDecision(decision)
	if err != nil {
		return nil, err
	}
	machineID = strings.TrimSpace(machineID)
	now := Now()
	id := uuid.NewString()
	_, err = d.SQL.Exec(`
INSERT INTO micro_app_grants (id, user_id, micro_app_id, capability, machine_id, decision, expires_at, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
ON CONFLICT (user_id, micro_app_id, capability, machine_id) DO UPDATE SET
  decision = EXCLUDED.decision,
  expires_at = EXCLUDED.expires_at,
  updated_at = EXCLUDED.updated_at`,
		id, userID, microAppID, capability, machineID, dec, expiresAt, now,
	)
	if err != nil {
		return nil, err
	}
	row := d.SQL.QueryRow(`
SELECT id, user_id, micro_app_id, capability, COALESCE(machine_id,''), decision, expires_at, created_at, updated_at
 FROM micro_app_grants
 WHERE user_id = $1 AND micro_app_id = $2 AND capability = $3 AND machine_id = $4`,
		userID, microAppID, capability, machineID,
	)
	var g MicroAppGrant
	var exp sql.NullTime
	if err := row.Scan(&g.ID, &g.UserID, &g.MicroAppID, &g.Capability, &g.MachineID, &g.Decision, &exp, &g.CreatedAt, &g.UpdatedAt); err != nil {
		return nil, err
	}
	if exp.Valid {
		t := exp.Time
		g.ExpiresAt = &t
	}
	return &g, nil
}
