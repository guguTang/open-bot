package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/tangxin/open-bot/services/api/internal/db"
	"github.com/tangxin/open-bot/services/api/internal/decision"
)

const msFakeKey = "sk-or-fake-not-real"

// fakeMSDecision serves POST /api/v1/systemone and returns respond(questions).
func fakeMSDecision(t *testing.T, status int, respond func(q map[string]any) map[string]any) (*httptest.Server, *int32) {
	t.Helper()
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		if r.URL.Path != "/api/v1/systemone" || r.Header.Get("Authorization") != "Bearer "+msFakeKey {
			http.Error(w, `{"error":{"message":"bad path or auth"}}`, http.StatusUnauthorized)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		var req struct {
			Model     string         `json:"model"`
			State     any            `json:"state"`
			Questions map[string]any `json:"questions"`
		}
		_ = json.Unmarshal(raw, &req)
		if req.Model != decision.DefaultOpenRouterModel {
			http.Error(w, `{"error":"bad model"}`, http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		if status >= 300 {
			_, _ = io.WriteString(w, `{"error":{"message":"upstream overloaded"}}`)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"model":    "microsoft/microsoft-decision-1-20261009",
			"answers":  respond(req.Questions),
			"usage":    map[string]any{"input_tokens": 420, "output_tokens": 2, "cost": 1.764e-05},
			"provider": "Azure",
		})
	}))
	t.Cleanup(srv.Close)
	return srv, &calls
}

func msBinding(t *testing.T, baseURL string, threshold float64) *msDecisionBinding {
	t.Helper()
	c, err := decision.New(decision.Config{Provider: "openrouter", BaseURL: baseURL + "/api/v1", APIKey: msFakeKey})
	if err != nil {
		t.Fatal(err)
	}
	return &msDecisionBinding{Client: c, Threshold: threshold}
}

func coderPick(conf float64) func(map[string]any) map[string]any {
	return func(q map[string]any) map[string]any {
		pick, _ := q["pick"].(map[string]any)
		if pick["type"] != "choice" {
			return nil
		}
		return map[string]any{
			"pick": map[string]any{
				"type": "choice", "choice": "m1", "confidence": conf,
				"probabilities": map[string]any{"all": 0.02, "m0": 0.05, "m1": conf, "m2": 0.03},
			},
			"count": map[string]any{"type": "noul", "noul": 0.02},
		}
	}
}

func TestAutoPickMicrosoftDecisionPicksCoder(t *testing.T) {
	members, agents := testGroupAgents()
	srv, calls := fakeMSDecision(t, 200, coderPick(0.9))
	ms := msBinding(t, srv.URL, 0.6)
	deps := &autoPickDecisionDeps{Provider: "microsoft", Microsoft: true, Decide: microsoftAutoPickDecide(ms)}
	got := runAutoPickByMode(db.AutoPickDecision, "帮我写代码修 bug", members, agents, "lead", 1, "", deps)
	if got.Method != "decision" || len(got.AgentIDs) != 1 || got.AgentIDs[0] != "coder" {
		t.Fatalf("got %#v", got)
	}
	if atomic.LoadInt32(calls) != 1 {
		t.Fatalf("calls=%d", *calls)
	}
}

func TestAutoPickMicrosoftDecisionFallbacks(t *testing.T) {
	members, agents := testGroupAgents()

	t.Run("low_confidence_does_not_use_systemone_failopens_heuristic", func(t *testing.T) {
		srv, _ := fakeMSDecision(t, 200, coderPick(0.4))
		var legacyCalls int32
		legacy := func(ctx context.Context, state any, q map[string]any) (map[string]any, error) {
			atomic.AddInt32(&legacyCalls, 1)
			return map[string]any{"pick": map[string]any{"type": "choice", "choice": "m1", "confidence": 0.8}}, nil
		}
		// Even if a legacy fn is accidentally composed, exclusive microsoftAutoPickDecide must not call it.
		_ = legacy
		deps := &autoPickDecisionDeps{Provider: "microsoft", Microsoft: true, Decide: microsoftAutoPickDecide(msBinding(t, srv.URL, 0.6))}
		got := runAutoPickByMode(db.AutoPickDecision, "帮我写代码修 bug", members, agents, "lead", 1, "", deps)
		if legacyCalls != 0 || got.Method != "decision->heuristic" || got.AgentIDs[0] != "coder" {
			t.Fatalf("legacy=%d got=%#v", legacyCalls, got)
		}
	})

	t.Run("http_error_failopens_heuristic_not_systemone", func(t *testing.T) {
		srv, _ := fakeMSDecision(t, 503, nil)
		var legacyCalls int32
		_ = legacyCalls
		deps := &autoPickDecisionDeps{Provider: "microsoft", Microsoft: true, Decide: microsoftAutoPickDecide(msBinding(t, srv.URL, 0))}
		got := runAutoPickByMode(db.AutoPickDecision, "帮我写代码修 bug", members, agents, "lead", 1, "", deps)
		if got.Method != "decision->heuristic" || got.AgentIDs[0] != "coder" {
			t.Fatalf("got %#v", got)
		}
	})

	t.Run("compose_ignores_legacy_when_ms_bound", func(t *testing.T) {
		srv, _ := fakeMSDecision(t, 500, nil)
		var legacyCalls int32
		legacy := func(ctx context.Context, state any, q map[string]any) (map[string]any, error) {
			atomic.AddInt32(&legacyCalls, 1)
			return map[string]any{"pick": map[string]any{"type": "choice", "choice": "m1", "confidence": 0.8}}, nil
		}
		fn := composeAutoPickDecide(msBinding(t, srv.URL, 0), legacy)
		_, err := fn(context.Background(), "s", map[string]any{
			"pick": map[string]any{"type": "choice", "instructions": "who", "criteria": map[string]string{"m1": "coder"}},
		})
		if err == nil || legacyCalls != 0 {
			t.Fatalf("err=%v legacy=%d (must not fall through to System One)", err, legacyCalls)
		}
	})

	t.Run("no_threshold_accepts_low_conf_answer", func(t *testing.T) {
		srv, _ := fakeMSDecision(t, 200, coderPick(0.7))
		_, _, err := msBinding(t, srv.URL, 0).decideAnswers(context.Background(), "s", map[string]any{
			"pick": map[string]any{"type": "choice", "instructions": "who", "criteria": map[string]string{"m1": "coder"}},
		}, autoPickDecisionQKey)
		if err != nil {
			t.Fatal(err)
		}
	})

	t.Run("threshold_error_is_typed", func(t *testing.T) {
		srv, _ := fakeMSDecision(t, 200, coderPick(0.3))
		_, resp, err := msBinding(t, srv.URL, 0.5).decideAnswers(context.Background(), "s", map[string]any{
			"pick": map[string]any{"type": "choice", "instructions": "who", "criteria": map[string]string{"m1": "coder"}},
		}, autoPickDecisionQKey)
		if !errors.Is(err, errMSDecisionLowConfidence) || resp == nil || resp.Usage.InputTokens != 420 {
			t.Fatalf("err=%v resp=%v", err, resp)
		}
	})
}

func TestComposeAutoPickDecideExclusive(t *testing.T) {
	if composeAutoPickDecide(nil, nil) != nil {
		t.Fatal("nil ms + nil legacy must stay nil (fail-open unchanged)")
	}
	called := false
	legacy := func(ctx context.Context, state any, q map[string]any) (map[string]any, error) {
		called = true
		return nil, nil
	}
	_, _ = composeAutoPickDecide(nil, legacy)(context.Background(), "s", nil)
	if !called {
		t.Fatal("legacy-only path must still work when microsoft is not selected")
	}
	if microsoftAutoPickDecide(nil) != nil {
		t.Fatal("nil microsoft binding must stay nil")
	}
}

func TestMSDecisionConfigFromSettings(t *testing.T) {
	thr := 0.55
	tmo := 4000
	s := &db.OrgSettings{
		DecisionProvider:  "microsoft",
		MSDecisionEnabled: true, MSDecisionProvider: "openrouter", MSDecisionAPIKey: msFakeKey,
		MSDecisionConfidenceThreshold: &thr, MSDecisionTimeoutMS: &tmo,
	}
	cfg, gotThr, ok := msDecisionConfigFromSettings(s)
	if !ok || gotThr != 0.55 || cfg.Model != decision.DefaultOpenRouterModel || cfg.Timeout.Milliseconds() != 4000 {
		t.Fatalf("cfg=%+v thr=%v ok=%v", cfg, gotThr, ok)
	}
	// Parallel/legacy flag alone must NOT bind when provider is System One.
	s.DecisionProvider = "laya"
	s.MSDecisionEnabled = true
	if _, _, ok := msDecisionConfigFromSettings(s); ok {
		t.Fatal("ms_decision_enabled with System One provider must not bind (exclusive)")
	}
	s.DecisionProvider = "microsoft"
	s.MSDecisionAPIKey = ""
	if _, _, ok := msDecisionConfigFromSettings(s); ok {
		t.Fatal("missing key must not bind")
	}
	az := &db.OrgSettings{DecisionProvider: "microsoft", MSDecisionEnabled: true, MSDecisionProvider: "azure_foundry", MSDecisionAPIKey: msFakeKey, MSDecisionModel: "dep"}
	if _, _, ok := msDecisionConfigFromSettings(az); ok {
		t.Fatal("azure without endpoint must not bind")
	}
	if _, _, ok := msDecisionConfigFromSettings(&db.OrgSettings{}); ok {
		t.Fatal("zero settings must not bind")
	}
}

func TestMSDecisionBodyNormalize(t *testing.T) {
	bad := 1.5
	if _, _, err := (msDecisionBody{ConfidenceThreshold: &bad}).normalize(""); err == nil {
		t.Fatal("threshold >1 must fail")
	}
	tmo := 10
	if _, _, err := (msDecisionBody{TimeoutMS: &tmo}).normalize(""); err == nil {
		t.Fatal("timeout too small must fail")
	}
	if _, _, err := (msDecisionBody{Provider: "openai"}).normalize(""); err == nil {
		t.Fatal("unknown provider must fail")
	}
	upd, cfg, err := (msDecisionBody{Enabled: true, Provider: "azure", BaseURL: "https://r.services.ai.azure.com/", Model: "dep", AuthMode: "entra"}).normalize("stored")
	if err != nil {
		t.Fatal(err)
	}
	if upd.Provider != decision.ProviderAzureFoundry || upd.AuthMode != decision.AuthBearer || upd.APIKey != "" || cfg.APIKey != "stored" {
		t.Fatalf("upd=%+v cfg=%+v", upd, cfg)
	}
	if err := cfg.Validate(); err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(cfg.Endpoint(), "/providers/microsoft/v1/systemone") {
		t.Fatal(cfg.Endpoint())
	}
}

func TestMSDecisionProbeHandler(t *testing.T) {
	srv, _ := fakeMSDecision(t, 200, func(q map[string]any) map[string]any {
		return map[string]any{
			"ok":   map[string]any{"type": "noul", "noul": 0.97},
			"kind": map[string]any{"type": "choice", "choice": "test", "probabilities": map[string]any{"test": 0.99, "support": 0.01}, "confidence": 0.98},
		}
	})
	s := &Server{}
	rec := httptest.NewRecorder()
	s.runMSDecisionProbe(rec, context.Background(), decision.Config{Provider: "openrouter", BaseURL: srv.URL + "/api/v1", APIKey: msFakeKey})
	if rec.Code != 200 {
		t.Fatalf("code=%d body=%s", rec.Code, rec.Body.String())
	}
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out["ok"] != true || out["upstream_provider"] != "Azure" {
		t.Fatalf("out=%v", out)
	}
	if strings.Contains(rec.Body.String(), msFakeKey) {
		t.Fatal("key leaked in probe response")
	}

	bad, _ := fakeMSDecision(t, 503, nil)
	rec = httptest.NewRecorder()
	s.runMSDecisionProbe(rec, context.Background(), decision.Config{Provider: "openrouter", BaseURL: bad.URL + "/api/v1", APIKey: msFakeKey})
	if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "overloaded") {
		t.Fatalf("code=%d body=%s", rec.Code, rec.Body.String())
	}
}
