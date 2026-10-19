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
	"host.clipboard.read":  {},
	"host.clipboard.write": {},
	"host.shell.run":       {},
	"device.contacts":      {},
	"device.mic":           {},
	"device.geo":           {},
}

type MicroApp struct {
	ID          string `json:"id"`
	UserID      string `json:"user_id"`
	AgentID     string `json:"agent_id,omitempty"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Icon        string `json:"icon,omitempty"`
	Kind        string `json:"kind"`
	Status      string `json:"status"`
	Version     int    `json:"version"`
	BundleKey   string `json:"bundle_key,omitempty"`
	BundleHash  string `json:"bundle_hash,omitempty"`
	Entrypoint  string `json:"entrypoint,omitempty"`
	SkillSlug   string `json:"skill_slug,omitempty"`
	RoutineID   string `json:"routine_id,omitempty"`
	// RoutineConfig (Phase 3, kind=routine): schedule/trigger recipe; materialized on pin.
	RoutineConfig        *MicroAppRoutineConfig `json:"routine_config,omitempty"`
	Capabilities         []string               `json:"capabilities"`
	SourceConversationID string                 `json:"source_conversation_id,omitempty"`
	SourceMessageID      string                 `json:"source_message_id,omitempty"`
	ConfirmedAt          *time.Time             `json:"confirmed_at,omitempty"`
	ConfirmedBy          string                 `json:"confirmed_by,omitempty"`
	CreatedAt            time.Time              `json:"created_at"`
	UpdatedAt            time.Time              `json:"updated_at"`
	Placements           []MicroAppPlacement    `json:"placements,omitempty"`
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
	ID         string `json:"id"`
	UserID     string `json:"user_id"`
	MicroAppID string `json:"micro_app_id"`
	Capability string `json:"capability"`
	MachineID  string `json:"machine_id,omitempty"`
	Decision   string `json:"decision"`
	// CommandAllowlist (Phase 3, host.shell.run only): command prefixes auto-allowed
	// under always_allow. Empty = any (non hard-denied) command; others re-prompt.
	CommandAllowlist []string   `json:"command_allowlist"`
	ExpiresAt        *time.Time `json:"expires_at,omitempty"`
	UpdatedAt        time.Time  `json:"updated_at"`
	CreatedAt        time.Time  `json:"created_at"`
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
	RoutineConfig        *MicroAppRoutineConfig
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
	// RoutineConfig replaces the recipe when non-nil (kind=routine).
	RoutineConfig *MicroAppRoutineConfig
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

-- Phase 3: kind=routine recipe + host.shell.run per-grant command allowlist.
ALTER TABLE micro_apps ADD COLUMN IF NOT EXISTS routine_config_json TEXT NOT NULL DEFAULT '';
ALTER TABLE micro_app_grants ADD COLUMN IF NOT EXISTS command_allowlist_json TEXT NOT NULL DEFAULT '[]';
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
	case MicroAppGrantAlwaysAllow, "allow_always":
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
  confirmed_at, COALESCE(confirmed_by,''), created_at, updated_at,
  COALESCE(routine_config_json,'')
 FROM micro_apps`

func scanMicroApp(scanner interface {
	Scan(dest ...any) error
}) (*MicroApp, error) {
	var a MicroApp
	var capsJSON string
	var routineCfgJSON string
	var confirmedAt sql.NullTime
	if err := scanner.Scan(
		&a.ID, &a.UserID, &a.AgentID, &a.Title, &a.Description, &a.Icon,
		&a.Kind, &a.Status, &a.Version, &a.BundleKey, &a.BundleHash, &a.Entrypoint,
		&a.SkillSlug, &a.RoutineID, &capsJSON,
		&a.SourceConversationID, &a.SourceMessageID,
		&confirmedAt, &a.ConfirmedBy, &a.CreatedAt, &a.UpdatedAt,
		&routineCfgJSON,
	); err != nil {
		return nil, err
	}
	a.Capabilities = decodeCapabilitiesJSON(capsJSON)
	a.RoutineConfig = decodeRoutineConfigJSON(routineCfgJSON)
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
	if in.RoutineConfig != nil && kind != MicroAppKindRoutine {
		return nil, errors.New("routine_config only allowed for kind=routine")
	}
	if err := ValidateMicroAppRoutineConfig(in.RoutineConfig); err != nil {
		return nil, err
	}
	if rid := strings.TrimSpace(in.RoutineID); rid != "" && kind == MicroAppKindRoutine {
		if _, err := d.GetRoutine(userID, rid); err != nil {
			if errors.Is(err, ErrNotFound) {
				return nil, fmt.Errorf("routine %q not found for this account", rid)
			}
			return nil, err
		}
	}
	routineCfgJSON, err := encodeRoutineConfigJSON(in.RoutineConfig)
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
  source_conversation_id, source_message_id, created_at, updated_at, routine_config_json
) VALUES (
  $1,$2,$3,$4,$5,$6,$7,$8,1,
  $9,$10,$11,$12,$13,$14,
  $15,$16,$17,$17,$18
)`,
		id, userID, strings.TrimSpace(in.AgentID), title, strings.TrimSpace(in.Description),
		strings.TrimSpace(in.Icon), kind, MicroAppStatusDraft,
		bundleKey, strings.TrimSpace(in.BundleHash), entrypoint,
		strings.TrimSpace(in.SkillSlug), strings.TrimSpace(in.RoutineID), capsJSON,
		strings.TrimSpace(in.SourceConversationID), strings.TrimSpace(in.SourceMessageID), now,
		routineCfgJSON,
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
	routineCfg := cur.RoutineConfig
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
	if in.RoutineConfig != nil {
		if NormalizeMicroAppKind(cur.Kind) != MicroAppKindRoutine {
			return nil, errors.New("routine_config only allowed for kind=routine")
		}
		if err := ValidateMicroAppRoutineConfig(in.RoutineConfig); err != nil {
			return nil, err
		}
		// Phase 4: pinned routine apps keep routines row in sync; fail before saving if sync fails.
		effective := *cur
		effective.Title = title
		effective.RoutineID = routineID
		effective.AgentID = cur.AgentID
		if err := d.syncPinnedRoutineFromConfig(userID, &effective, in.RoutineConfig); err != nil {
			return nil, err
		}
		routineCfg = in.RoutineConfig
	}
	routineCfgJSON, err := encodeRoutineConfigJSON(routineCfg)
	if err != nil {
		return nil, err
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
  skill_slug = $7, routine_id = $8, capabilities_json = $9, updated_at = $10,
  routine_config_json = $11
 WHERE id = $1 AND user_id = $2`,
		id, userID, title, desc, icon, entrypoint, skillSlug, routineID, capsJSON, now, routineCfgJSON,
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

// PinMicroAppOptions controls extra surfaces written on pin (hub always).
type PinMicroAppOptions struct {
	// ChatPin adds surface=chat_pin (account-wide when ContextID empty).
	ChatPin   bool
	ContextID string
	// Surfaces (Phase 3): extra in-app entry surfaces chosen in the pin dialog,
	// e.g. desktop_shortcut / mobile_shortcut. hub is always written.
	Surfaces []string
}

// PinMicroApp promotes draft→pinned after explicit user confirm intent.
// Writes confirmed_* and ensures a hub placement.
// kind=skill: enables skill_slug on account (+ agent_id bot when set).
func (d *DB) PinMicroApp(userID, id, confirmedBy string, opts *PinMicroAppOptions) (*MicroApp, error) {
	cur, err := d.GetMicroApp(userID, id)
	if err != nil {
		return nil, err
	}
	if cur.Status == MicroAppStatusArchived {
		return nil, errors.New("cannot pin archived micro-app")
	}
	if opts == nil {
		opts = &PinMicroAppOptions{}
	}
	now := Now()
	confirmedBy = strings.TrimSpace(confirmedBy)
	if confirmedBy == "" {
		confirmedBy = userID
	}
	extraSurfaces := make([]string, 0, len(opts.Surfaces))
	for _, raw := range opts.Surfaces {
		surf, serr := NormalizeMicroAppSurface(raw)
		if serr != nil {
			return nil, serr
		}
		if surf == MicroAppSurfaceHub {
			continue
		}
		extraSurfaces = append(extraSurfaces, surf)
	}
	// kind=routine: bind / materialize the routine before flipping to pinned.
	routineID := cur.RoutineID
	if NormalizeMicroAppKind(cur.Kind) == MicroAppKindRoutine {
		rid, rerr := d.syncRoutineOnPin(userID, cur)
		if rerr != nil {
			return nil, rerr
		}
		routineID = rid
	}
	_, err = d.SQL.Exec(`
UPDATE micro_apps SET
  status = $3, confirmed_at = $4, confirmed_by = $5, updated_at = $4,
  version = CASE WHEN status = $6 THEN version + 1 ELSE version END,
  routine_id = $7
 WHERE id = $1 AND user_id = $2`,
		id, userID, MicroAppStatusPinned, now, confirmedBy, MicroAppStatusDraft, routineID,
	)
	if err != nil {
		return nil, err
	}
	if err := d.EnsureMicroAppPlacement(id, MicroAppSurfaceHub, "", 0, true); err != nil {
		return nil, err
	}
	if opts.ChatPin {
		if err := d.EnsureMicroAppPlacement(id, MicroAppSurfaceChatPin, opts.ContextID, 0, true); err != nil {
			return nil, err
		}
	}
	for _, surf := range extraSurfaces {
		ctxID := ""
		if surf == MicroAppSurfaceChatPin {
			ctxID = opts.ContextID
		}
		if err := d.EnsureMicroAppPlacement(id, surf, ctxID, 0, true); err != nil {
			return nil, err
		}
	}
	if err := d.syncSkillOnPin(userID, cur); err != nil {
		return nil, err
	}
	return d.GetMicroApp(userID, id)
}

// syncSkillOnPin enables the bound skill for kind=skill micro-apps.
func (d *DB) syncSkillOnPin(userID string, app *MicroApp) error {
	if app == nil || NormalizeMicroAppKind(app.Kind) != MicroAppKindSkill {
		return nil
	}
	slug := strings.TrimSpace(app.SkillSlug)
	if slug == "" {
		return errors.New("kind=skill requires skill_slug")
	}
	if _, err := d.SetUserSkillEnabled(userID, slug, true); err != nil {
		if errors.Is(err, ErrNotFound) {
			return fmt.Errorf("skill %q not found in account catalog", slug)
		}
		return err
	}
	agentID := strings.TrimSpace(app.AgentID)
	if agentID == "" {
		return nil
	}
	if _, err := d.SetAgentSkillEnabled(userID, agentID, slug, true); err != nil {
		if errors.Is(err, ErrNotFound) {
			return fmt.Errorf("skill %q not available for agent %s", slug, agentID)
		}
		return err
	}
	return nil
}

// ListMicroAppsForSurface returns pinned apps with an enabled placement on surface
// (and optional context_id match: empty context matches only global pins).
func (d *DB) ListMicroAppsForSurface(userID, surface, contextID string) ([]*MicroApp, error) {
	return d.ListMicroApps(userID, surface, MicroAppStatusPinned)
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
	app, err := d.GetMicroApp(userID, id)
	if err != nil {
		return nil, err
	}
	// kind=routine: pause (never delete) the bound routine.
	d.pauseRoutineOnArchive(userID, app)
	return app, nil
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
SELECT id, user_id, micro_app_id, capability, COALESCE(machine_id,''), decision, expires_at, created_at, updated_at,
  COALESCE(command_allowlist_json,'[]')
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
		g, err := scanMicroAppGrant(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *g)
	}
	if out == nil {
		out = []MicroAppGrant{}
	}
	return out, rows.Err()
}

// UpsertMicroAppGrant writes the tri-state decision. commandAllowlist (host.shell.run only):
// nil keeps the stored list; non-nil replaces it (empty slice clears = any command).
func (d *DB) UpsertMicroAppGrant(userID, microAppID, capability, machineID, decision string, expiresAt *time.Time, commandAllowlist *[]string) (*MicroAppGrant, error) {
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
	allowJSON := "[]"
	replaceAllow := false
	if commandAllowlist != nil {
		list, aerr := NormalizeMicroAppShellAllowlist(*commandAllowlist)
		if aerr != nil {
			return nil, aerr
		}
		if len(list) > 0 && capability != MicroAppShellCapability {
			return nil, fmt.Errorf("command_allowlist only applies to %s", MicroAppShellCapability)
		}
		allowJSON = encodeStringListJSON(list)
		replaceAllow = true
	}
	machineID = strings.TrimSpace(machineID)
	now := Now()
	id := uuid.NewString()
	allowUpdate := ""
	if replaceAllow {
		allowUpdate = ",\n  command_allowlist_json = EXCLUDED.command_allowlist_json"
	}
	_, err = d.SQL.Exec(`
INSERT INTO micro_app_grants (id, user_id, micro_app_id, capability, machine_id, decision, expires_at, created_at, updated_at, command_allowlist_json)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9)
ON CONFLICT (user_id, micro_app_id, capability, machine_id) DO UPDATE SET
  decision = EXCLUDED.decision,
  expires_at = EXCLUDED.expires_at,
  updated_at = EXCLUDED.updated_at`+allowUpdate,
		id, userID, microAppID, capability, machineID, dec, expiresAt, now, allowJSON,
	)
	if err != nil {
		return nil, err
	}
	row := d.SQL.QueryRow(`
SELECT id, user_id, micro_app_id, capability, COALESCE(machine_id,''), decision, expires_at, created_at, updated_at,
  COALESCE(command_allowlist_json,'[]')
 FROM micro_app_grants
 WHERE user_id = $1 AND micro_app_id = $2 AND capability = $3 AND machine_id = $4`,
		userID, microAppID, capability, machineID,
	)
	return scanMicroAppGrant(row)
}

// SetMicroAppBundle updates object-storage key + content hash after upload.
func (d *DB) SetMicroAppBundle(userID, id, bundleKey, bundleHash, entrypoint string) (*MicroApp, error) {
	cur, err := d.GetMicroApp(userID, id)
	if err != nil {
		return nil, err
	}
	if cur.Status == MicroAppStatusArchived {
		return nil, errors.New("archived micro-app cannot accept bundle")
	}
	bundleKey = strings.TrimSpace(bundleKey)
	if bundleKey == "" {
		bundleKey = MicroAppObjectKey(userID, id)
	}
	entrypoint = strings.TrimSpace(entrypoint)
	if entrypoint == "" {
		entrypoint = cur.Entrypoint
	}
	if entrypoint == "" {
		entrypoint = "index.html"
	}
	now := Now()
	_, err = d.SQL.Exec(`
UPDATE micro_apps SET bundle_key = $3, bundle_hash = $4, entrypoint = $5,
  version = version + 1, updated_at = $6
 WHERE id = $1 AND user_id = $2`,
		id, userID, bundleKey, strings.TrimSpace(bundleHash), entrypoint, now,
	)
	if err != nil {
		return nil, err
	}
	return d.GetMicroApp(userID, id)
}

// GetMicroAppGrant looks up one grant row (exact machine, then machine-empty fallback).
func (d *DB) GetMicroAppGrant(userID, microAppID, capability, machineID string) (*MicroAppGrant, error) {
	machineID = strings.TrimSpace(machineID)
	capability = strings.TrimSpace(capability)
	row := d.SQL.QueryRow(`
SELECT id, user_id, micro_app_id, capability, COALESCE(machine_id,''), decision, expires_at, created_at, updated_at,
  COALESCE(command_allowlist_json,'[]')
 FROM micro_app_grants
 WHERE user_id = $1 AND micro_app_id = $2 AND capability = $3 AND machine_id = $4`,
		userID, microAppID, capability, machineID,
	)
	g, err := scanMicroAppGrant(row)
	if err == nil {
		return g, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if machineID == "" {
		return nil, ErrNotFound
	}
	row = d.SQL.QueryRow(`
SELECT id, user_id, micro_app_id, capability, COALESCE(machine_id,''), decision, expires_at, created_at, updated_at,
  COALESCE(command_allowlist_json,'[]')
 FROM micro_app_grants
 WHERE user_id = $1 AND micro_app_id = $2 AND capability = $3 AND machine_id = ''`,
		userID, microAppID, capability,
	)
	g, err = scanMicroAppGrant(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return g, nil
}

func scanMicroAppGrant(scanner interface {
	Scan(dest ...any) error
}) (*MicroAppGrant, error) {
	var g MicroAppGrant
	var exp sql.NullTime
	var allowJSON string
	if err := scanner.Scan(&g.ID, &g.UserID, &g.MicroAppID, &g.Capability, &g.MachineID, &g.Decision, &exp, &g.CreatedAt, &g.UpdatedAt, &allowJSON); err != nil {
		return nil, err
	}
	g.CommandAllowlist = decodeCapabilitiesJSON(allowJSON)
	if exp.Valid {
		t := exp.Time
		g.ExpiresAt = &t
	}
	return &g, nil
}

// ConsumeAllowOnceGrant expires an allow_once grant after one successful use.
func (d *DB) ConsumeAllowOnceGrant(userID, grantID string) error {
	now := Now()
	_, err := d.SQL.Exec(`
UPDATE micro_app_grants SET expires_at = $3, updated_at = $3
 WHERE id = $1 AND user_id = $2 AND decision = $4`,
		grantID, userID, now, MicroAppGrantAllowOnce,
	)
	return err
}

// EvaluateMicroAppGrant returns decision for capability, or empty if prompt needed.
// Expired grants are treated as missing.
func (d *DB) EvaluateMicroAppGrant(userID, microAppID, capability, machineID string) (decision string, grant *MicroAppGrant, err error) {
	g, err := d.GetMicroAppGrant(userID, microAppID, capability, machineID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return "", nil, nil
		}
		return "", nil, err
	}
	if g.ExpiresAt != nil && !g.ExpiresAt.After(Now()) {
		return "", nil, nil
	}
	return g.Decision, g, nil
}
