package db

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/robfig/cron/v3"
)

// Phase 3 helpers: kind=routine recipe + host.shell.run per-grant command allowlist.

// MicroAppRoutineConfig is a fixed schedule/trigger recipe stored on a kind=routine
// micro-app. On pin (user_intent gated) it materializes into a real `routines` row
// (reusing the in-process scheduler + webhook triggers) unless routine_id already binds one.
type MicroAppRoutineConfig struct {
	Name           string           `json:"name,omitempty"`
	Prompt         string           `json:"prompt"`
	ScheduleCron   string           `json:"schedule_cron,omitempty"`
	Timezone       string           `json:"timezone,omitempty"`
	AgentID        string           `json:"agent_id,omitempty"`
	Triggers       []RoutineTrigger `json:"triggers,omitempty"`
	Enabled        *bool            `json:"enabled,omitempty"`
	QuietUnchanged bool             `json:"quiet_unchanged,omitempty"`
	MaxRetries     *int             `json:"max_retries,omitempty"`
}

var microAppCronParser = cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow)

var microAppRoutineTriggerSources = map[string]struct{}{"slack": {}, "github": {}, "http": {}}

// ValidateMicroAppRoutineConfig checks a recipe without touching the DB.
// Rules mirror POST /v1/routines: prompt required, 5-field cron or ≥1 trigger, IANA timezone.
func ValidateMicroAppRoutineConfig(cfg *MicroAppRoutineConfig) error {
	if cfg == nil {
		return nil
	}
	if strings.TrimSpace(cfg.Prompt) == "" {
		return errors.New("routine_config.prompt required")
	}
	if len([]rune(cfg.Prompt)) > 8000 {
		return errors.New("routine_config.prompt too long (max 8000)")
	}
	expr := strings.TrimSpace(cfg.ScheduleCron)
	if expr == "" && len(cfg.Triggers) == 0 {
		return errors.New("routine_config needs schedule_cron or triggers")
	}
	if expr != "" {
		if _, err := microAppCronParser.Parse(expr); err != nil {
			return fmt.Errorf("routine_config.schedule_cron invalid (need 5 fields min hour dom month dow): %w", err)
		}
	}
	if NormalizeTimezone(cfg.Timezone) == "" {
		return errors.New("routine_config.timezone invalid (need IANA name, e.g. Asia/Shanghai)")
	}
	if len(cfg.Triggers) > 10 {
		return errors.New("routine_config.triggers: at most 10")
	}
	for i, tr := range cfg.Triggers {
		src := strings.ToLower(strings.TrimSpace(tr.Source))
		if _, ok := microAppRoutineTriggerSources[src]; !ok {
			return fmt.Errorf("routine_config.triggers[%d].source must be slack|github|http", i)
		}
		if strings.TrimSpace(tr.Type) == "" {
			return fmt.Errorf("routine_config.triggers[%d].type required", i)
		}
	}
	if cfg.MaxRetries != nil && (*cfg.MaxRetries < 0 || *cfg.MaxRetries > 10) {
		return errors.New("routine_config.max_retries must be 0..10")
	}
	return nil
}

func encodeRoutineConfigJSON(cfg *MicroAppRoutineConfig) (string, error) {
	if cfg == nil {
		return "", nil
	}
	b, err := json.Marshal(cfg)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func decodeRoutineConfigJSON(raw string) *MicroAppRoutineConfig {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "null" {
		return nil
	}
	var cfg MicroAppRoutineConfig
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return nil
	}
	return &cfg
}

// syncRoutineOnPin binds/creates the routine for kind=routine before the app flips to pinned.
// Returns the routine id to persist (may equal app.RoutineID).
func (d *DB) syncRoutineOnPin(userID string, app *MicroApp) (string, error) {
	if app == nil || NormalizeMicroAppKind(app.Kind) != MicroAppKindRoutine {
		return "", nil
	}
	if rid := strings.TrimSpace(app.RoutineID); rid != "" {
		if _, err := d.GetRoutine(userID, rid); err != nil {
			if errors.Is(err, ErrNotFound) {
				return "", fmt.Errorf("routine %q not found for this account", rid)
			}
			return "", err
		}
		return rid, nil
	}
	cfg := app.RoutineConfig
	if cfg == nil {
		return "", errors.New("kind=routine requires routine_id or routine_config")
	}
	if err := ValidateMicroAppRoutineConfig(cfg); err != nil {
		return "", err
	}
	name := strings.TrimSpace(cfg.Name)
	if name == "" {
		name = app.Title
	}
	agentID := strings.TrimSpace(cfg.AgentID)
	if agentID == "" {
		agentID = strings.TrimSpace(app.AgentID)
	}
	enabled := true
	if cfg.Enabled != nil {
		enabled = *cfg.Enabled
	}
	maxRetries := 2
	if cfg.MaxRetries != nil {
		maxRetries = *cfg.MaxRetries
	}
	triggersJSON, err := EncodeTriggersJSON(cfg.Triggers)
	if err != nil {
		return "", err
	}
	rt, err := d.CreateRoutine(userID, name, cfg.Prompt, cfg.ScheduleCron, enabled, agentID,
		cfg.Timezone, "", triggersJSON, maxRetries, cfg.QuietUnchanged)
	if err != nil {
		return "", fmt.Errorf("create routine from routine_config: %w", err)
	}
	return rt.ID, nil
}


// syncPinnedRoutineFromConfig pushes recipe fields into the bound routines row when a
// pinned kind=routine app is PATCHed with routine_config. Fails loudly (no silent skip)
// if UpdateRoutine errors — callers must not pretend the recipe and scheduler agree.
func (d *DB) syncPinnedRoutineFromConfig(userID string, app *MicroApp, cfg *MicroAppRoutineConfig) error {
	if app == nil || cfg == nil {
		return nil
	}
	if NormalizeMicroAppKind(app.Kind) != MicroAppKindRoutine {
		return nil
	}
	if app.Status != MicroAppStatusPinned {
		return nil
	}
	rid := strings.TrimSpace(app.RoutineID)
	if rid == "" {
		return nil
	}
	if err := ValidateMicroAppRoutineConfig(cfg); err != nil {
		return err
	}
	name := strings.TrimSpace(cfg.Name)
	if name == "" {
		name = strings.TrimSpace(app.Title)
	}
	agentID := strings.TrimSpace(cfg.AgentID)
	if agentID == "" {
		agentID = strings.TrimSpace(app.AgentID)
	}
	triggersJSON, err := EncodeTriggersJSON(cfg.Triggers)
	if err != nil {
		return fmt.Errorf("sync UpdateRoutine: encode triggers: %w", err)
	}
	upd := RoutineUpdate{
		Prompt:         &cfg.Prompt,
		ScheduleCron:   &cfg.ScheduleCron,
		Timezone:       &cfg.Timezone,
		TriggersJSON:   &triggersJSON,
		QuietUnchanged: &cfg.QuietUnchanged,
	}
	if name != "" {
		upd.Name = &name
	}
	if agentID != "" {
		upd.AgentID = &agentID
	}
	if cfg.Enabled != nil {
		upd.Enabled = cfg.Enabled
	}
	if cfg.MaxRetries != nil {
		upd.MaxRetries = cfg.MaxRetries
	}
	if _, err := d.UpdateRoutine(userID, rid, upd); err != nil {
		return fmt.Errorf("sync UpdateRoutine for micro-app %s routine %s: %w", app.ID, rid, err)
	}
	return nil
}

// pauseRoutineOnArchive disables (never deletes) the bound routine when a routine app is archived.
func (d *DB) pauseRoutineOnArchive(userID string, app *MicroApp) {
	if app == nil || NormalizeMicroAppKind(app.Kind) != MicroAppKindRoutine {
		return
	}
	rid := strings.TrimSpace(app.RoutineID)
	if rid == "" {
		return
	}
	off := false
	_, _ = d.UpdateRoutine(userID, rid, RoutineUpdate{Enabled: &off})
}

// ---- host.shell.run allowlist ----

const (
	MicroAppShellCapability       = "host.shell.run"
	microAppShellAllowlistMax     = 50
	microAppShellAllowlistItemMax = 200
)

// microAppShellCompoundChars: any of these makes a command "compound" — never auto-allowed by prefix.
const microAppShellCompoundChars = ";&|`<>\n\r"

// MicroAppShellCommandIsCompound reports chaining / substitution / redirection syntax.
func MicroAppShellCommandIsCompound(cmd string) bool {
	if strings.ContainsAny(cmd, microAppShellCompoundChars) {
		return true
	}
	return strings.Contains(cmd, "$(")
}

func collapseSpaces(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

// NormalizeMicroAppShellAllowlist trims, de-dupes and validates allowlist entries.
// Entries are command prefixes matched on word boundary ("git status" matches
// "git status -s" but not "git statusx"). "*" means any non-compound command.
func NormalizeMicroAppShellAllowlist(entries []string) ([]string, error) {
	out := make([]string, 0, len(entries))
	seen := map[string]struct{}{}
	for _, e := range entries {
		e = collapseSpaces(e)
		if e == "" {
			continue
		}
		if len(e) > microAppShellAllowlistItemMax {
			return nil, fmt.Errorf("allowlist entry too long (max %d)", microAppShellAllowlistItemMax)
		}
		if e != "*" && MicroAppShellCommandIsCompound(e) {
			return nil, fmt.Errorf("allowlist entry %q must not contain ; & | ` < > $( or newlines", e)
		}
		if _, ok := seen[e]; ok {
			continue
		}
		seen[e] = struct{}{}
		out = append(out, e)
	}
	if len(out) > microAppShellAllowlistMax {
		return nil, fmt.Errorf("allowlist: at most %d entries", microAppShellAllowlistMax)
	}
	return out, nil
}

// MicroAppShellCommandAllowed: true when cmd matches one allowlist entry.
// Compound commands never match (they always fall back to a prompt).
func MicroAppShellCommandAllowed(allowlist []string, cmd string) bool {
	cmd = collapseSpaces(cmd)
	if cmd == "" || MicroAppShellCommandIsCompound(cmd) {
		return false
	}
	for _, e := range allowlist {
		e = collapseSpaces(e)
		if e == "" {
			continue
		}
		if e == "*" || cmd == e || strings.HasPrefix(cmd, e+" ") {
			return true
		}
	}
	return false
}

func encodeStringListJSON(list []string) string {
	if list == nil {
		list = []string{}
	}
	b, err := json.Marshal(list)
	if err != nil {
		return "[]"
	}
	return string(b)
}

// DeleteMicroAppGrant resets a capability to "ask every time" (allow_once prompt).
func (d *DB) DeleteMicroAppGrant(userID, microAppID, capability, machineID string) error {
	if _, err := d.GetMicroApp(userID, microAppID); err != nil {
		return err
	}
	_, err := d.SQL.Exec(`DELETE FROM micro_app_grants
 WHERE user_id = $1 AND micro_app_id = $2 AND capability = $3 AND machine_id = $4`,
		userID, microAppID, strings.TrimSpace(capability), strings.TrimSpace(machineID))
	return err
}
