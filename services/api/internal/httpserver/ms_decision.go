package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/tangxin/open-bot/services/api/internal/db"
	"github.com/tangxin/open-bot/services/api/internal/decision"
)

// Microsoft-Decision-1 (systemone) — org-level decision-scoring model called
// directly from the Go API (not via agent-runtime, not a chat model).
//
// Mutually exclusive with System One (jev|laya|custom): decision_provider must
// be "microsoft". On error / low confidence / incomplete config the caller
// fail-opens to heuristic (same as any other provider failure) — never to a
// competing System One provider the admin did not select.

const (
	msDecisionTimeoutMinMS = 1000
	msDecisionTimeoutMaxMS = 60000
)

// msDecisionBinding is a ready client plus optional confidence threshold.
type msDecisionBinding struct {
	Client    *decision.Client
	Threshold float64 // 0 → no extra threshold (auto-pick floor still applies)
}

// msDecisionConfigFromSettings builds the client config from org settings.
// ok=false when disabled or incomplete (missing key / endpoint / deployment).
func msDecisionConfigFromSettings(settings *db.OrgSettings) (decision.Config, float64, bool) {
	if settings == nil || !db.IsMicrosoftDecisionProvider(settings.DecisionProvider) {
		return decision.Config{}, 0, false
	}
	cfg := decision.Config{
		Provider: settings.MSDecisionProvider,
		BaseURL:  settings.MSDecisionBaseURL,
		APIKey:   settings.MSDecisionAPIKey,
		Model:    settings.MSDecisionModel,
		AuthMode: settings.MSDecisionAuthMode,
	}
	if settings.MSDecisionTimeoutMS != nil && *settings.MSDecisionTimeoutMS > 0 {
		cfg.Timeout = time.Duration(*settings.MSDecisionTimeoutMS) * time.Millisecond
	}
	cfg = cfg.WithDefaults()
	if err := cfg.Validate(); err != nil {
		return decision.Config{}, 0, false
	}
	thr := 0.0
	if settings.MSDecisionConfidenceThreshold != nil {
		thr = *settings.MSDecisionConfidenceThreshold
	}
	return cfg, thr, true
}

func (s *Server) msDecisionBindingFromSettings(settings *db.OrgSettings) *msDecisionBinding {
	cfg, thr, ok := msDecisionConfigFromSettings(settings)
	if !ok {
		return nil
	}
	if s != nil && s.client != nil {
		cfg.HTTPClient = s.client
	}
	c, err := decision.New(cfg)
	if err != nil {
		return nil
	}
	return &msDecisionBinding{Client: c, Threshold: thr}
}

var errMSDecisionLowConfidence = errors.New("microsoft decision below confidence threshold")

// decideAnswers converts loose questions, calls Decision-1, enforces the
// threshold on primaryKey (choice) and returns answers in map form.
func (b *msDecisionBinding) decideAnswers(ctx context.Context, state any, questions map[string]any, primaryKey string) (map[string]any, *decision.Response, error) {
	if b == nil || b.Client == nil {
		return nil, nil, errors.New("microsoft decision not configured")
	}
	qs, err := decision.QuestionsFromMap(questions)
	if err != nil {
		return nil, nil, err
	}
	resp, err := b.Client.Decide(ctx, state, qs)
	if err != nil {
		return nil, nil, err
	}
	if b.Threshold > 0 && primaryKey != "" {
		a, ok := resp.Answers[primaryKey]
		if !ok {
			return nil, resp, fmt.Errorf("microsoft decision missing answer %q", primaryKey)
		}
		top, have := a.TopProbability()
		if !have || top < b.Threshold {
			return nil, resp, fmt.Errorf("%w (%s=%.3f < %.3f)", errMSDecisionLowConfidence, primaryKey, top, b.Threshold)
		}
	}
	return resp.AnswersMap(), resp, nil
}

// microsoftAutoPickDecide wraps a Microsoft-Decision-1 binding for auto-pick / ask-route.
// Failures return the error so the caller can fail-open to heuristic; there is no
// fallthrough to a different decision_provider.
func microsoftAutoPickDecide(ms *msDecisionBinding) func(ctx context.Context, state any, questions map[string]any) (map[string]any, error) {
	if ms == nil {
		return nil
	}
	return func(ctx context.Context, state any, questions map[string]any) (map[string]any, error) {
		cfg := ms.Client.Config()
		answers, resp, err := ms.decideAnswers(ctx, state, questions, autoPickDecisionQKey)
		if resp != nil {
			log.Printf("auto_pick=decision provider=microsoft/%s model=%s upstream=%s latency_ms=%d input_tokens=%d output_tokens=%d cost_usd=%.8f estimated=%t",
				cfg.Provider, resp.Model, resp.Provider, resp.Latency.Milliseconds(),
				resp.Usage.InputTokens, resp.Usage.OutputTokens, resp.Usage.Cost, resp.Usage.CostEstimated)
		}
		if err != nil {
			log.Printf("auto_pick=decision provider=microsoft/%s note=ms_decision_failed_failopen_heuristic err=%v", cfg.Provider, err)
			return nil, err
		}
		return answers, nil
	}
}

// composeAutoPickDecide is kept as a thin alias for tests that still name it;
// microsoft and legacy are mutually exclusive — only one argument should be non-nil.
func composeAutoPickDecide(ms *msDecisionBinding, legacy func(ctx context.Context, state any, questions map[string]any) (map[string]any, error)) func(ctx context.Context, state any, questions map[string]any) (map[string]any, error) {
	if ms != nil {
		return microsoftAutoPickDecide(ms)
	}
	return legacy
}

// ---- Admin API ----

type msDecisionBody struct {
	Enabled             bool     `json:"enabled"`
	Provider            string   `json:"provider"`
	BaseURL             string   `json:"base_url"`
	APIKey              string   `json:"api_key"`
	ClearAPIKey         bool     `json:"clear_api_key"`
	Model               string   `json:"model"`
	AuthMode            string   `json:"auth_mode"`
	ConfidenceThreshold *float64 `json:"confidence_threshold"`
	TimeoutMS           *int     `json:"timeout_ms"`
}

// normalize validates ranges and fills vendor defaults. storedKey is used for
// completeness checks when api_key is left blank.
func (b msDecisionBody) normalize(storedKey string) (db.MSDecisionUpdate, decision.Config, error) {
	provider := decision.NormalizeProvider(b.Provider)
	if provider == "" {
		if strings.TrimSpace(b.Provider) != "" {
			return db.MSDecisionUpdate{}, decision.Config{}, errors.New("provider must be openrouter or azure_foundry")
		}
		provider = decision.ProviderOpenRouter
	}
	if b.ConfidenceThreshold != nil {
		v := *b.ConfidenceThreshold
		if v < 0 || v > 1 {
			return db.MSDecisionUpdate{}, decision.Config{}, errors.New("confidence_threshold must be between 0 and 1")
		}
		if v == 0 {
			b.ConfidenceThreshold = nil
		}
	}
	if b.TimeoutMS != nil {
		v := *b.TimeoutMS
		if v == 0 {
			b.TimeoutMS = nil
		} else if v < msDecisionTimeoutMinMS || v > msDecisionTimeoutMaxMS {
			return db.MSDecisionUpdate{}, decision.Config{}, fmt.Errorf("timeout_ms must be between %d and %d", msDecisionTimeoutMinMS, msDecisionTimeoutMaxMS)
		}
	}
	key := strings.TrimSpace(b.APIKey)
	effectiveKey := key
	if effectiveKey == "" && !b.ClearAPIKey {
		effectiveKey = storedKey
	}
	cfg := decision.Config{
		Provider: provider,
		BaseURL:  b.BaseURL,
		APIKey:   effectiveKey,
		Model:    b.Model,
		AuthMode: b.AuthMode,
	}
	if b.TimeoutMS != nil {
		cfg.Timeout = time.Duration(*b.TimeoutMS) * time.Millisecond
	}
	cfg = cfg.WithDefaults()
	upd := db.MSDecisionUpdate{
		Enabled:             b.Enabled,
		Provider:            cfg.Provider,
		BaseURL:             cfg.BaseURL,
		APIKey:              key,
		ClearAPIKey:         b.ClearAPIKey,
		Model:               cfg.Model,
		AuthMode:            cfg.AuthMode,
		ConfidenceThreshold: b.ConfidenceThreshold,
		TimeoutMS:           b.TimeoutMS,
	}
	return upd, cfg, nil
}

func (s *Server) handleAdminGetMSDecision(w http.ResponseWriter, r *http.Request) {
	u, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	settings, err := s.db.GetOrgSettings(u.OrgID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, msDecisionPublicWithDefaults(settings))
}

// msDecisionPublicWithDefaults shows effective defaults (e.g. OpenRouter model id)
// so the admin form is pre-filled for a never-configured org.
func msDecisionPublicWithDefaults(settings *db.OrgSettings) db.MSDecisionSettingsPublic {
	pub := settings.MSDecisionPublic()
	cfg := decision.Config{Provider: pub.Provider, BaseURL: pub.BaseURL, Model: pub.Model, AuthMode: pub.AuthMode}.WithDefaults()
	if cfg.Provider == "" {
		cfg = decision.Config{Provider: decision.ProviderOpenRouter}.WithDefaults()
	}
	pub.Provider = cfg.Provider
	pub.BaseURL = cfg.BaseURL
	pub.Model = cfg.Model
	pub.AuthMode = cfg.AuthMode
	return pub
}

func (s *Server) handleAdminPutMSDecision(w http.ResponseWriter, r *http.Request) {
	u, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	var body msDecisionBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	cur, err := s.db.GetOrgSettings(u.OrgID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	upd, cfg, err := body.normalize(cur.MSDecisionAPIKey)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if upd.Enabled {
		if err := cfg.Validate(); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
	}
	settings, err := s.db.UpsertOrgMSDecision(u.OrgID, upd)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	pub := msDecisionPublicWithDefaults(settings)
	s.writeAudit(u.OrgID, u.ID, "org.ms_decision_update", "org_settings", u.OrgID, map[string]any{
		"enabled":              pub.Enabled,
		"provider":             pub.Provider,
		"base_url":             pub.BaseURL,
		"model":                pub.Model,
		"auth_mode":            pub.AuthMode,
		"confidence_threshold": pub.ConfidenceThreshold,
		"timeout_ms":           pub.TimeoutMS,
		"api_key_updated":      strings.TrimSpace(body.APIKey) != "" || body.ClearAPIKey,
	})
	writeJSON(w, http.StatusOK, pub)
}

// msDecisionProbeQuestions is the tiny connectivity probe (1 noul + 1 choice; ~100 input tokens).
func msDecisionProbeQuestions() map[string]decision.Question {
	return map[string]decision.Question{
		"ok": decision.NoulQuestion("Is this message a connectivity check?"),
		"kind": decision.ChoiceQuestion("What kind of message is this?", map[string]string{
			"test":    "A test / health check message",
			"support": "A customer support request",
		}),
	}
}

func (s *Server) handleAdminTestMSDecision(w http.ResponseWriter, r *http.Request) {
	u, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	var body msDecisionBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	cur, err := s.db.GetOrgSettings(u.OrgID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	body.ClearAPIKey = false // test never clears; blank key → stored key
	_, cfg, err := body.normalize(cur.MSDecisionAPIKey)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	s.runMSDecisionProbe(w, r.Context(), cfg)
}

func (s *Server) runMSDecisionProbe(w http.ResponseWriter, ctx context.Context, cfg decision.Config) {
	if s.client != nil {
		cfg.HTTPClient = s.client
	}
	c, err := decision.New(cfg)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	resp, err := c.Decide(ctx, "open-bot admin console: the administrator clicked “test connection” to verify the decision model endpoint.", msDecisionProbeQuestions())
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":                true,
		"provider":          c.Config().Provider,
		"endpoint":          c.Config().Endpoint(),
		"model":             c.Config().Model,
		"response_model":    resp.Model,
		"upstream_provider": resp.Provider,
		"latency_ms":        resp.Latency.Milliseconds(),
		"answers":           resp.AnswersMap(),
		"usage":             resp.Usage,
	})
}
