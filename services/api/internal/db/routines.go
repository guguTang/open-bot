package db

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

type Routine struct {
	ID              string          `json:"id"`
	UserID          string          `json:"user_id"`
	Name            string          `json:"name"`
	Prompt          string          `json:"prompt"`
	ScheduleCron    string          `json:"schedule_cron"`
	Enabled         bool            `json:"enabled"`
	AgentID         string          `json:"agent_id"`
	Timezone        string          `json:"timezone"`
	ConversationID  string          `json:"conversation_id,omitempty"`
	TriggersJSON    string          `json:"triggers_json"`
	Triggers        []RoutineTrigger `json:"triggers,omitempty"`
	MaxRetries      int             `json:"max_retries"`
	FailCount       int             `json:"fail_count"`
	QuietUnchanged  bool            `json:"quiet_unchanged"`
	LastResultHash  string          `json:"last_result_hash,omitempty"`
	LastRunAt       *time.Time      `json:"last_run_at,omitempty"`
	NextRunAt       *time.Time      `json:"next_run_at,omitempty"`
	LastError       string          `json:"last_error,omitempty"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
	LastRun         *RoutineRun     `json:"last_run,omitempty"`
}

// RoutineTrigger is one event listener (Slack / GitHub / …). Cron stays in schedule_cron.
type RoutineTrigger struct {
	Source   string   `json:"source"`             // slack | github | http
	Type     string   `json:"type"`               // app_mention | keyword | pull_request | issues | check_suite | workflow_run | ping
	Keywords []string `json:"keywords,omitempty"` // slack keyword match
	Actions  []string `json:"actions,omitempty"`  // github action filter
	Repo     string   `json:"repo,omitempty"`     // owner/name or empty=*
}

type RoutineRun struct {
	ID         string    `json:"id"`
	RoutineID  string    `json:"routine_id"`
	Status     string    `json:"status"`
	ResultText string    `json:"result_text"`
	CreatedAt  time.Time `json:"created_at"`
}

const routineSelect = `SELECT id, user_id, name, prompt, schedule_cron, enabled,
		 COALESCE(agent_id,'open-bot'), COALESCE(timezone,'Asia/Shanghai'),
		 COALESCE(conversation_id,''), COALESCE(triggers_json,'[]'),
		 COALESCE(max_retries,2), COALESCE(fail_count,0), COALESCE(quiet_unchanged,FALSE),
		 COALESCE(last_result_hash,''),
		 last_run_at, next_run_at, COALESCE(last_error,''), created_at, updated_at
		 FROM routines`

func NormalizeTimezone(tz string) string {
	tz = strings.TrimSpace(tz)
	if tz == "" {
		return "Asia/Shanghai"
	}
	if _, err := time.LoadLocation(tz); err != nil {
		return ""
	}
	return tz
}

func ParseTriggersJSON(raw string) ([]RoutineTrigger, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "null" {
		return []RoutineTrigger{}, nil
	}
	var out []RoutineTrigger
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil, err
	}
	if out == nil {
		out = []RoutineTrigger{}
	}
	for i := range out {
		out[i].Source = strings.ToLower(strings.TrimSpace(out[i].Source))
		out[i].Type = strings.ToLower(strings.TrimSpace(out[i].Type))
		out[i].Repo = strings.TrimSpace(out[i].Repo)
	}
	return out, nil
}

func EncodeTriggersJSON(triggers []RoutineTrigger) (string, error) {
	if triggers == nil {
		triggers = []RoutineTrigger{}
	}
	b, err := json.Marshal(triggers)
	if err != nil {
		return "[]", err
	}
	return string(b), nil
}

func HashResultText(text string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(text)))
	return hex.EncodeToString(sum[:])
}

func (d *DB) CreateRoutine(userID, name, prompt, scheduleCron string, enabled bool, agentID, timezone, conversationID, triggersJSON string, maxRetries int, quietUnchanged bool) (*Routine, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("name required")
	}
	prompt = strings.TrimSpace(prompt)
	if prompt == "" {
		return nil, errors.New("prompt required")
	}
	scheduleCron = strings.TrimSpace(scheduleCron)
	// Empty cron is allowed when event triggers exist.
	triggersJSON = strings.TrimSpace(triggersJSON)
	if triggersJSON == "" {
		triggersJSON = "[]"
	}
	if _, err := ParseTriggersJSON(triggersJSON); err != nil {
		return nil, errors.New("invalid triggers_json")
	}
	tz := NormalizeTimezone(timezone)
	if tz == "" {
		return nil, errors.New("invalid timezone (need IANA name, e.g. Asia/Shanghai)")
	}
	if scheduleCron == "" {
		tr, _ := ParseTriggersJSON(triggersJSON)
		if len(tr) == 0 {
			scheduleCron = "0 9 * * *"
		}
	}
	agentID = strings.TrimSpace(agentID)
	if agentID == "" {
		id, aerr := d.FirstAgentID(userID)
		if aerr != nil {
			return nil, aerr
		}
		agentID = id
	} else {
		resolved, aerr := d.ResolveAgentID(userID, agentID)
		if aerr != nil {
			return nil, aerr
		}
		if _, err := d.GetAgent(userID, resolved); err != nil {
			return nil, err
		}
		agentID = resolved
	}
	if maxRetries < 0 {
		maxRetries = 0
	}
	if maxRetries > 10 {
		maxRetries = 10
	}
	now := Now()
	r := &Routine{
		ID:             uuid.NewString(),
		UserID:         userID,
		Name:           name,
		Prompt:         prompt,
		ScheduleCron:   scheduleCron,
		Enabled:        enabled,
		AgentID:        agentID,
		Timezone:       tz,
		ConversationID: strings.TrimSpace(conversationID),
		TriggersJSON:   triggersJSON,
		MaxRetries:     maxRetries,
		QuietUnchanged: quietUnchanged,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	_, err := d.SQL.Exec(
		`INSERT INTO routines (
		   id, user_id, name, prompt, schedule_cron, enabled, agent_id,
		   timezone, conversation_id, triggers_json, max_retries, quiet_unchanged,
		   created_at, updated_at
		 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
		r.ID, r.UserID, r.Name, r.Prompt, r.ScheduleCron, r.Enabled, r.AgentID,
		r.Timezone, r.ConversationID, r.TriggersJSON, r.MaxRetries, r.QuietUnchanged,
		r.CreatedAt, r.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return d.GetRoutine(userID, r.ID)
}

func scanRoutine(row interface{ Scan(dest ...any) error }) (*Routine, error) {
	var r Routine
	var last, next sql.NullTime
	if err := row.Scan(
		&r.ID, &r.UserID, &r.Name, &r.Prompt, &r.ScheduleCron, &r.Enabled,
		&r.AgentID, &r.Timezone, &r.ConversationID, &r.TriggersJSON,
		&r.MaxRetries, &r.FailCount, &r.QuietUnchanged, &r.LastResultHash,
		&last, &next, &r.LastError, &r.CreatedAt, &r.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if last.Valid {
		t := last.Time
		r.LastRunAt = &t
	}
	if next.Valid {
		t := next.Time
		r.NextRunAt = &t
	}
	if tr, err := ParseTriggersJSON(r.TriggersJSON); err == nil {
		r.Triggers = tr
	}
	return &r, nil
}

func (d *DB) ListRoutines(userID string) ([]*Routine, error) {
	rows, err := d.SQL.Query(routineSelect+` WHERE user_id = $1 ORDER BY created_at ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Routine
	for rows.Next() {
		r, err := scanRoutine(rows)
		if err != nil {
			return nil, err
		}
		if lr, lerr := d.LatestRoutineRun(r.ID); lerr == nil {
			r.LastRun = lr
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (d *DB) GetRoutine(userID, id string) (*Routine, error) {
	row := d.SQL.QueryRow(routineSelect+` WHERE id = $1 AND user_id = $2`, id, userID)
	r, err := scanRoutine(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if lr, lerr := d.LatestRoutineRun(r.ID); lerr == nil {
		r.LastRun = lr
	}
	return r, nil
}

func (d *DB) GetRoutineByID(id string) (*Routine, error) {
	row := d.SQL.QueryRow(routineSelect+` WHERE id = $1`, id)
	r, err := scanRoutine(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return r, nil
}

func (d *DB) GetRoutineByName(userID, name string) (*Routine, error) {
	name = strings.TrimSpace(name)
	row := d.SQL.QueryRow(routineSelect+` WHERE user_id = $1 AND lower(name) = lower($2) ORDER BY created_at ASC LIMIT 1`, userID, name)
	r, err := scanRoutine(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return r, nil
}

type RoutineUpdate struct {
	Name           *string
	Prompt         *string
	ScheduleCron   *string
	Enabled        *bool
	AgentID        *string
	Timezone       *string
	ConversationID *string
	TriggersJSON   *string
	MaxRetries     *int
	QuietUnchanged *bool
}

func (d *DB) UpdateRoutine(userID, id string, upd RoutineUpdate) (*Routine, error) {
	r, err := d.GetRoutine(userID, id)
	if err != nil {
		return nil, err
	}
	if upd.Name != nil {
		n := strings.TrimSpace(*upd.Name)
		if n == "" {
			return nil, errors.New("name required")
		}
		r.Name = n
	}
	if upd.Prompt != nil {
		p := strings.TrimSpace(*upd.Prompt)
		if p == "" {
			return nil, errors.New("prompt required")
		}
		r.Prompt = p
	}
	if upd.ScheduleCron != nil {
		r.ScheduleCron = strings.TrimSpace(*upd.ScheduleCron)
	}
	if upd.Enabled != nil {
		r.Enabled = *upd.Enabled
	}
	if upd.AgentID != nil {
		a := strings.TrimSpace(*upd.AgentID)
		if a == "" {
			var aerr error
			a, aerr = d.FirstAgentID(userID)
			if aerr != nil {
				return nil, aerr
			}
		} else {
			resolved, aerr := d.ResolveAgentID(userID, a)
			if aerr != nil {
				return nil, aerr
			}
			a = resolved
		}
		r.AgentID = a
	}
	if upd.Timezone != nil {
		tz := NormalizeTimezone(*upd.Timezone)
		if tz == "" {
			return nil, errors.New("invalid timezone (need IANA name, e.g. Asia/Shanghai)")
		}
		r.Timezone = tz
	}
	if upd.ConversationID != nil {
		r.ConversationID = strings.TrimSpace(*upd.ConversationID)
	}
	if upd.TriggersJSON != nil {
		tj := strings.TrimSpace(*upd.TriggersJSON)
		if tj == "" {
			tj = "[]"
		}
		if _, err := ParseTriggersJSON(tj); err != nil {
			return nil, errors.New("invalid triggers_json")
		}
		r.TriggersJSON = tj
	}
	if upd.MaxRetries != nil {
		v := *upd.MaxRetries
		if v < 0 {
			v = 0
		}
		if v > 10 {
			v = 10
		}
		r.MaxRetries = v
	}
	if upd.QuietUnchanged != nil {
		r.QuietUnchanged = *upd.QuietUnchanged
	}
	r.UpdatedAt = Now()
	_, err = d.SQL.Exec(
		`UPDATE routines SET name=$1, prompt=$2, schedule_cron=$3, enabled=$4, agent_id=$5,
		 timezone=$6, conversation_id=$7, triggers_json=$8, max_retries=$9, quiet_unchanged=$10, updated_at=$11
		 WHERE id=$12 AND user_id=$13`,
		r.Name, r.Prompt, r.ScheduleCron, r.Enabled, r.AgentID,
		r.Timezone, r.ConversationID, r.TriggersJSON, r.MaxRetries, r.QuietUnchanged, r.UpdatedAt,
		id, userID,
	)
	if err != nil {
		return nil, err
	}
	return d.GetRoutine(userID, id)
}

func (d *DB) SetRoutineConversationID(routineID, conversationID string) error {
	_, err := d.SQL.Exec(
		`UPDATE routines SET conversation_id = $1, updated_at = NOW() WHERE id = $2`,
		strings.TrimSpace(conversationID), routineID,
	)
	return err
}

func (d *DB) SetRoutineResultMeta(routineID, resultHash string, failCount int, lastErr string) error {
	_, err := d.SQL.Exec(
		`UPDATE routines SET last_result_hash = $1, fail_count = $2, last_error = $3, updated_at = NOW() WHERE id = $4`,
		resultHash, failCount, lastErr, routineID,
	)
	return err
}

func (d *DB) DeleteRoutine(userID, id string) error {
	res, err := d.SQL.Exec(`DELETE FROM routines WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (d *DB) ListEnabledRoutines() ([]*Routine, error) {
	rows, err := d.SQL.Query(routineSelect + ` WHERE enabled = TRUE`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Routine
	for rows.Next() {
		r, err := scanRoutine(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (d *DB) ClaimDueRoutines() ([]*Routine, error) {
	return d.ListEnabledRoutines()
}

// ListEnabledRoutinesForUser returns enabled routines for event matching.
func (d *DB) ListEnabledRoutinesForUser(userID string) ([]*Routine, error) {
	rows, err := d.SQL.Query(routineSelect+` WHERE user_id = $1 AND enabled = TRUE`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Routine
	for rows.Next() {
		r, err := scanRoutine(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (d *DB) MarkRoutineRun(routineID string, at time.Time) error {
	_, err := d.SQL.Exec(
		`UPDATE routines SET last_run_at = $1, updated_at = $1, last_error = '' WHERE id = $2`,
		at, routineID,
	)
	return err
}

func (d *DB) MarkRoutineSchedule(routineID string, lastRun, nextRun *time.Time, lastErr string) error {
	_, err := d.SQL.Exec(
		`UPDATE routines SET last_run_at = $1, next_run_at = $2, last_error = $3, updated_at = NOW() WHERE id = $4`,
		lastRun, nextRun, lastErr, routineID,
	)
	return err
}

func (d *DB) CreateRoutineRun(routineID, status, resultText string) (*RoutineRun, error) {
	if status == "" {
		status = "pending"
	}
	run := &RoutineRun{
		ID:         uuid.NewString(),
		RoutineID:  routineID,
		Status:     status,
		ResultText: resultText,
		CreatedAt:  Now(),
	}
	_, err := d.SQL.Exec(
		`INSERT INTO routine_runs (id, routine_id, status, result_text, created_at)
		 VALUES ($1,$2,$3,$4,$5)`,
		run.ID, run.RoutineID, run.Status, run.ResultText, run.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return run, nil
}

func (d *DB) UpdateRoutineRun(id, status, resultText string) error {
	_, err := d.SQL.Exec(
		`UPDATE routine_runs SET status = $1, result_text = $2 WHERE id = $3`,
		status, resultText, id,
	)
	return err
}

func (d *DB) LatestRoutineRun(routineID string) (*RoutineRun, error) {
	row := d.SQL.QueryRow(
		`SELECT id, routine_id, status, result_text, created_at
		 FROM routine_runs WHERE routine_id = $1
		 ORDER BY created_at DESC LIMIT 1`,
		routineID,
	)
	var run RoutineRun
	if err := row.Scan(&run.ID, &run.RoutineID, &run.Status, &run.ResultText, &run.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &run, nil
}

func (d *DB) ListRoutineRuns(userID, routineID string, limit int) ([]*RoutineRun, error) {
	if _, err := d.GetRoutine(userID, routineID); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 50 {
		limit = 10
	}
	rows, err := d.SQL.Query(
		`SELECT id, routine_id, status, result_text, created_at
		 FROM routine_runs WHERE routine_id = $1
		 ORDER BY created_at DESC LIMIT $2`,
		routineID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*RoutineRun
	for rows.Next() {
		var run RoutineRun
		if err := rows.Scan(&run.ID, &run.RoutineID, &run.Status, &run.ResultText, &run.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, &run)
	}
	return out, rows.Err()
}

// --- inbound webhook tokens ---

type InboundHook struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Provider  string    `json:"provider"`
	Token     string    `json:"token"`
	Secret    string    `json:"secret,omitempty"`
	Label     string    `json:"label"`
	CreatedAt time.Time `json:"created_at"`
}

func (d *DB) CreateInboundHook(userID, provider, label, secret string) (*InboundHook, error) {
	provider = strings.ToLower(strings.TrimSpace(provider))
	if provider == "" {
		return nil, errors.New("provider required")
	}
	h := &InboundHook{
		ID:        uuid.NewString(),
		UserID:    userID,
		Provider:  provider,
		Token:     uuid.NewString(),
		Secret:    strings.TrimSpace(secret),
		Label:     strings.TrimSpace(label),
		CreatedAt: Now(),
	}
	_, err := d.SQL.Exec(
		`INSERT INTO inbound_hooks (id, user_id, provider, token, secret, label, created_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		h.ID, h.UserID, h.Provider, h.Token, h.Secret, h.Label, h.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return h, nil
}

func (d *DB) GetInboundHookForUser(userID, id string) (*InboundHook, error) {
	userID = strings.TrimSpace(userID)
	id = strings.TrimSpace(id)
	if userID == "" || id == "" {
		return nil, ErrNotFound
	}
	row := d.SQL.QueryRow(
		`SELECT id, user_id, provider, token, COALESCE(secret,''), COALESCE(label,''), created_at
		 FROM inbound_hooks WHERE id = $1 AND user_id = $2`, id, userID,
	)
	var h InboundHook
	if err := row.Scan(&h.ID, &h.UserID, &h.Provider, &h.Token, &h.Secret, &h.Label, &h.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &h, nil
}

func (d *DB) GetInboundHookByToken(token string) (*InboundHook, error) {
	token = strings.TrimSpace(token)
	row := d.SQL.QueryRow(
		`SELECT id, user_id, provider, token, COALESCE(secret,''), COALESCE(label,''), created_at
		 FROM inbound_hooks WHERE token = $1`, token,
	)
	var h InboundHook
	if err := row.Scan(&h.ID, &h.UserID, &h.Provider, &h.Token, &h.Secret, &h.Label, &h.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &h, nil
}

func (d *DB) ListInboundHooks(userID string) ([]*InboundHook, error) {
	rows, err := d.SQL.Query(
		`SELECT id, user_id, provider, token, COALESCE(secret,''), COALESCE(label,''), created_at
		 FROM inbound_hooks WHERE user_id = $1 ORDER BY created_at ASC`, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*InboundHook
	for rows.Next() {
		var h InboundHook
		if err := rows.Scan(&h.ID, &h.UserID, &h.Provider, &h.Token, &h.Secret, &h.Label, &h.CreatedAt); err != nil {
			return nil, err
		}
		// never expose secret in list JSON callers should redact; keep for owner settings
		out = append(out, &h)
	}
	return out, rows.Err()
}

func (d *DB) DeleteInboundHook(userID, id string) error {
	res, err := d.SQL.Exec(`DELETE FROM inbound_hooks WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// EventMatch describes an inbound event for trigger matching.
type EventMatch struct {
	Source  string
	Type    string
	Text    string // message text for keyword
	Action  string // github action
	Repo    string // owner/name
}

func TriggerMatches(tr RoutineTrigger, ev EventMatch) bool {
	if strings.ToLower(tr.Source) != strings.ToLower(ev.Source) {
		return false
	}
	tt := strings.ToLower(tr.Type)
	et := strings.ToLower(ev.Type)
	if tt != "" && tt != et && !(tt == "keyword" && et == "message") {
		// allow type keyword to match slack message events
		if !(tt == "mention" && (et == "app_mention" || et == "mention")) {
			return false
		}
	}
	if len(tr.Actions) > 0 {
		ok := false
		act := strings.ToLower(strings.TrimSpace(ev.Action))
		for _, a := range tr.Actions {
			if strings.ToLower(strings.TrimSpace(a)) == act || strings.TrimSpace(a) == "*" {
				ok = true
				break
			}
		}
		if !ok {
			return false
		}
	}
	if repo := strings.TrimSpace(tr.Repo); repo != "" && repo != "*" {
		if !strings.EqualFold(repo, strings.TrimSpace(ev.Repo)) {
			return false
		}
	}
	if len(tr.Keywords) > 0 {
		text := strings.ToLower(ev.Text)
		ok := false
		for _, kw := range tr.Keywords {
			kw = strings.ToLower(strings.TrimSpace(kw))
			if kw != "" && strings.Contains(text, kw) {
				ok = true
				break
			}
		}
		if !ok {
			return false
		}
	}
	return true
}

func RoutineMatchesEvent(r *Routine, ev EventMatch) bool {
	if r == nil || !r.Enabled {
		return false
	}
	triggers := r.Triggers
	if len(triggers) == 0 {
		var err error
		triggers, err = ParseTriggersJSON(r.TriggersJSON)
		if err != nil {
			return false
		}
	}
	for _, tr := range triggers {
		if TriggerMatches(tr, ev) {
			return true
		}
	}
	return false
}
