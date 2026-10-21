package decision

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

const fakeKey = "test-key-not-real-1234"

type captured struct {
	mu      sync.Mutex
	path    string
	headers http.Header
	body    map[string]any
}

func fakeSystemOne(t *testing.T, status int, respBody string) (*httptest.Server, *captured) {
	t.Helper()
	c := &captured{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		c.mu.Lock()
		c.path = r.URL.Path
		c.headers = r.Header.Clone()
		_ = json.Unmarshal(raw, &c.body)
		c.mu.Unlock()
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, respBody)
	}))
	t.Cleanup(srv.Close)
	return srv, c
}

const choiceResp = `{"model":"microsoft/microsoft-decision-1-20261009","answers":{"team":{"type":"choice","choice":"payments","probabilities":{"account":0.0038,"frontend":0.2679,"payments":0.7283},"confidence":0.5924}},"usage":{"input_tokens":75,"output_tokens":1,"cost":3.15e-06},"provider":"Azure"}`

func teamQuestions() map[string]Question {
	return map[string]Question{
		"team": ChoiceQuestion("Which team?", map[string]string{
			"account": "Login and account", "frontend": "UI bugs", "payments": "Charges",
		}),
	}
}

func TestDecideOpenRouterChoice(t *testing.T) {
	srv, cap := fakeSystemOne(t, 200, choiceResp)
	c, err := New(Config{Provider: "openrouter", BaseURL: srv.URL + "/api/v1", APIKey: fakeKey})
	if err != nil {
		t.Fatal(err)
	}
	resp, err := c.Decide(context.Background(), "My card was charged twice", teamQuestions())
	if err != nil {
		t.Fatal(err)
	}
	if cap.path != "/api/v1/systemone" {
		t.Fatalf("path=%s", cap.path)
	}
	if got := cap.headers.Get("Authorization"); got != "Bearer "+fakeKey {
		t.Fatalf("auth=%q", got)
	}
	if cap.headers.Get("api-key") != "" {
		t.Fatal("openrouter must not send api-key header")
	}
	if cap.body["model"] != DefaultOpenRouterModel {
		t.Fatalf("model=%v", cap.body["model"])
	}
	q := cap.body["questions"].(map[string]any)["team"].(map[string]any)
	if q["type"] != "choice" || q["instructions"] != "Which team?" {
		t.Fatalf("question=%v", q)
	}
	a := resp.Answers["team"]
	if a.Type != TypeChoice || a.Choice != "payments" || math.Abs(a.Probabilities["payments"]-0.7283) > 1e-9 {
		t.Fatalf("answer=%+v", a)
	}
	if a.Confidence == nil || math.Abs(*a.Confidence-0.5924) > 1e-9 {
		t.Fatalf("confidence=%v", a.Confidence)
	}
	if top, ok := a.TopProbability(); !ok || math.Abs(top-0.7283) > 1e-9 {
		t.Fatalf("top=%v", top)
	}
	if resp.Usage.InputTokens != 75 || resp.Usage.OutputTokens != 1 || resp.Usage.Cost != 3.15e-06 || resp.Usage.CostEstimated {
		t.Fatalf("usage=%+v", resp.Usage)
	}
	if resp.Provider != "Azure" || resp.Model != "microsoft/microsoft-decision-1-20261009" {
		t.Fatalf("meta=%s %s", resp.Provider, resp.Model)
	}
	m := resp.AnswersMap()["team"].(map[string]any)
	if m["choice"] != "payments" || m["confidence"].(float64) != 0.5924 {
		t.Fatalf("answers map=%v", m)
	}
}

func TestDecideAzureAPIKeyAndBearer(t *testing.T) {
	resp := `{"model":"microsoft-decision-1","answers":{"urgent":{"type":"noul","noul":0.91},"sev":{"type":"score","score":3,"probabilities":[0.01,0.04,0.15,0.8]}},"usage":{"input_tokens":1000000,"output_tokens":2}}`
	srv, cap := fakeSystemOne(t, 200, resp)
	qs := map[string]Question{
		"urgent": NoulQuestion("Is this urgent?"),
		"sev":    ScoreQuestion("Severity?", []string{"low", "mid", "high", "critical"}),
	}
	c, err := New(Config{Provider: "azure_foundry", BaseURL: srv.URL + "/", APIKey: fakeKey, Model: "my-decision-deploy"})
	if err != nil {
		t.Fatal(err)
	}
	out, err := c.Decide(context.Background(), map[string]any{"ticket": "API 500s"}, qs)
	if err != nil {
		t.Fatal(err)
	}
	if cap.path != "/providers/microsoft/v1/systemone" {
		t.Fatalf("path=%s", cap.path)
	}
	if cap.headers.Get("api-key") != fakeKey || cap.headers.Get("Authorization") != "" {
		t.Fatalf("azure api-key headers=%v", cap.headers)
	}
	if cap.body["model"] != "my-decision-deploy" {
		t.Fatalf("model=%v", cap.body["model"])
	}
	if st, ok := cap.body["state"].(map[string]any); !ok || st["ticket"] != "API 500s" {
		t.Fatalf("json state=%v", cap.body["state"])
	}
	if n := out.Answers["urgent"].Noul; n == nil || *n != 0.91 {
		t.Fatalf("noul=%v", n)
	}
	sev := out.Answers["sev"]
	if sev.Score == nil || *sev.Score != 3 || sev.Probabilities["3"] != 0.8 {
		t.Fatalf("score=%+v", sev)
	}
	if !out.Usage.CostEstimated || math.Abs(out.Usage.Cost-0.042) > 1e-12 {
		t.Fatalf("estimated cost=%+v", out.Usage)
	}

	c2, _ := New(Config{Provider: "azure", BaseURL: srv.URL, APIKey: fakeKey, Model: "d", AuthMode: "entra"})
	if _, err := c2.Decide(context.Background(), "x", qs); err != nil {
		t.Fatal(err)
	}
	if cap.headers.Get("Authorization") != "Bearer "+fakeKey || cap.headers.Get("api-key") != "" {
		t.Fatalf("bearer headers=%v", cap.headers)
	}
}

func TestDecideHTTPErrorRedactsKey(t *testing.T) {
	srv, _ := fakeSystemOne(t, 401, `{"error":{"message":"invalid key `+fakeKey+`","code":401}}`)
	c, _ := New(Config{Provider: "openrouter", BaseURL: srv.URL, APIKey: fakeKey})
	_, err := c.Decide(context.Background(), "s", teamQuestions())
	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.StatusCode != 401 {
		t.Fatalf("err=%v", err)
	}
	if strings.Contains(err.Error(), fakeKey) {
		t.Fatalf("key leaked: %v", err)
	}
}

func TestDecideTimeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(3 * time.Second):
		}
	}))
	defer srv.Close()
	c, _ := New(Config{Provider: "openrouter", BaseURL: srv.URL, APIKey: fakeKey, Timeout: time.Second})
	start := time.Now()
	_, err := c.Decide(context.Background(), "s", teamQuestions())
	if err == nil || !strings.Contains(err.Error(), "timeout") {
		t.Fatalf("err=%v", err)
	}
	if time.Since(start) > 2500*time.Millisecond {
		t.Fatal("timeout not honored")
	}
}

func TestDecideBadResponses(t *testing.T) {
	for name, body := range map[string]string{
		"no_answers":   `{"model":"m","answers":{}}`,
		"not_json":     `<html>oops</html>`,
		"choice_empty": `{"answers":{"team":{"type":"choice","probabilities":{}}}}`,
	} {
		t.Run(name, func(t *testing.T) {
			srv, _ := fakeSystemOne(t, 200, body)
			c, _ := New(Config{Provider: "openrouter", BaseURL: srv.URL, APIKey: fakeKey})
			if _, err := c.Decide(context.Background(), "s", teamQuestions()); err == nil {
				t.Fatal("want error")
			}
		})
	}
}

func TestValidateQuestionsAndConfig(t *testing.T) {
	bad := []map[string]Question{
		nil,
		{"a": {Type: "chat", Instructions: "x"}},
		{"a": {Type: TypeNoul}},
		{"a": ChoiceQuestion("x", map[string]string{})},
		{"a": ScoreQuestion("x", []string{"only"})},
	}
	for i, q := range bad {
		if err := ValidateQuestions(q); err == nil {
			t.Fatalf("case %d should fail", i)
		}
	}
	if _, err := New(Config{Provider: "openrouter"}); err == nil {
		t.Fatal("missing key should fail")
	}
	if _, err := New(Config{Provider: "azure_foundry", APIKey: fakeKey, Model: "d"}); err == nil {
		t.Fatal("azure without endpoint should fail")
	}
	if _, err := New(Config{Provider: "azure_foundry", APIKey: fakeKey, BaseURL: "https://r.services.ai.azure.com"}); err == nil {
		t.Fatal("azure without deployment should fail")
	}
	if _, err := New(Config{Provider: "openai", APIKey: fakeKey}); err == nil {
		t.Fatal("unknown provider should fail")
	}
}

func TestEndpointResolution(t *testing.T) {
	cases := []struct {
		cfg  Config
		want string
	}{
		{Config{Provider: "openrouter"}, "https://openrouter.ai/api/v1/systemone"},
		{Config{Provider: "openrouter", BaseURL: "https://openrouter.ai"}, "https://openrouter.ai/api/v1/systemone"},
		{Config{Provider: "openrouter", BaseURL: "https://openrouter.ai/api/"}, "https://openrouter.ai/api/v1/systemone"},
		{Config{Provider: "openrouter", BaseURL: "https://gw.example/api/v1/systemone"}, "https://gw.example/api/v1/systemone"},
		{Config{Provider: "azure_foundry", BaseURL: "https://r.services.ai.azure.com"}, "https://r.services.ai.azure.com/providers/microsoft/v1/systemone"},
		{Config{Provider: "azure_foundry", BaseURL: "https://r.services.ai.azure.com/api/projects/p1/openai/v1"}, "https://r.services.ai.azure.com/providers/microsoft/v1/systemone"},
		{Config{Provider: "azure_foundry", BaseURL: "https://r.services.ai.azure.com/models"}, "https://r.services.ai.azure.com/providers/microsoft/v1/systemone"},
		{Config{Provider: "azure_foundry", BaseURL: "https://r.services.ai.azure.com/providers/microsoft"}, "https://r.services.ai.azure.com/providers/microsoft/v1/systemone"},
	}
	for _, tc := range cases {
		if got := tc.cfg.Endpoint(); got != tc.want {
			t.Errorf("%+v: got %s want %s", tc.cfg, got, tc.want)
		}
	}
}

func TestQuestionsFromMap(t *testing.T) {
	qs, err := QuestionsFromMap(map[string]any{
		"pick":  map[string]any{"type": "choice", "instructions": "who", "criteria": map[string]string{"m0": "a", "all": "everyone"}},
		"count": map[string]any{"type": "noul", "instructions": "how many"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := ValidateQuestions(qs); err != nil {
		t.Fatal(err)
	}
	if qs["pick"].Type != TypeChoice || qs["count"].Type != TypeNoul {
		t.Fatalf("%+v", qs)
	}
}
