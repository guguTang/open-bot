// Package decision is a Go client for System One style decision-scoring APIs
// (POST .../systemone), first targeting Microsoft-Decision-1 on OpenRouter and
// Azure AI Foundry.
//
// Decision models are NOT chat models: the request carries a `state` (text or
// JSON) plus typed `questions` (noul | choice | score) and the response is
// calibrated probabilities only — no prose, no rationale. Keep this package
// independent of chat-completions code (internal LLM connections / runtime).
package decision

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	ProviderOpenRouter   = "openrouter"
	ProviderAzureFoundry = "azure_foundry"

	// AuthAPIKey: OpenRouter → Authorization: Bearer <key>; Azure → api-key: <key>.
	AuthAPIKey = "api_key"
	// AuthBearer: Azure Microsoft Entra ID access token → Authorization: Bearer <token>.
	// (Static token; the caller is responsible for refreshing it.)
	AuthBearer = "bearer"

	DefaultOpenRouterBaseURL = "https://openrouter.ai/api/v1"
	DefaultOpenRouterModel   = "microsoft/microsoft-decision-1"

	DefaultTimeout = 10 * time.Second
	MinTimeout     = 1 * time.Second
	MaxTimeout     = 60 * time.Second

	// InputUSDPerMillionTokens is Microsoft-Decision-1 list price (output tokens are free).
	// Used only to estimate cost when the provider omits usage.cost.
	InputUSDPerMillionTokens = 0.042

	maxChoiceOptions = 255
	minScoreLevels   = 2
	maxScoreLevels   = 10
	maxResponseBytes = 1 << 20
)

// QuestionType is one of noul | choice | score.
type QuestionType string

const (
	TypeNoul   QuestionType = "noul"
	TypeChoice QuestionType = "choice"
	TypeScore  QuestionType = "score"
)

// Question is one typed question. Criteria is map[string]string for choice
// (option key → description) and []string for score (ordered levels, low→high).
type Question struct {
	Type         QuestionType `json:"type"`
	Instructions string       `json:"instructions"`
	Criteria     any          `json:"criteria,omitempty"`
}

func NoulQuestion(instructions string) Question {
	return Question{Type: TypeNoul, Instructions: instructions}
}

func ChoiceQuestion(instructions string, options map[string]string) Question {
	return Question{Type: TypeChoice, Instructions: instructions, Criteria: options}
}

func ScoreQuestion(instructions string, levels []string) Question {
	return Question{Type: TypeScore, Instructions: instructions, Criteria: levels}
}

// Request is the systemone request body.
type Request struct {
	Model     string              `json:"model"`
	State     any                 `json:"state"`
	Questions map[string]Question `json:"questions"`
}

// Answer is one typed answer. Only the fields for Type are set.
type Answer struct {
	Type QuestionType `json:"type"`
	// noul: probability the answer is "yes" in [0,1].
	Noul *float64 `json:"noul,omitempty"`
	// choice: winning option key.
	Choice string `json:"choice,omitempty"`
	// score: winning level (number when numeric; ScoreLabel keeps the raw text form).
	Score      *float64 `json:"score,omitempty"`
	ScoreLabel string   `json:"score_label,omitempty"`
	// choice / score: probability per option / level (list form is keyed "0","1",…).
	Probabilities map[string]float64 `json:"probabilities,omitempty"`
	Confidence    *float64           `json:"confidence,omitempty"`
	// Raw is the provider's answer object as returned (for consumers that want
	// fields this struct does not model).
	Raw map[string]any `json:"-"`
}

// TopProbability is max(confidence, probabilities[choice]) for choice answers,
// the noul for noul, and max(confidence, max level prob) for score. ok=false when
// the provider returned nothing usable.
func (a Answer) TopProbability() (float64, bool) {
	best, have := 0.0, false
	if a.Confidence != nil {
		best, have = *a.Confidence, true
	}
	switch a.Type {
	case TypeNoul:
		if a.Noul != nil {
			return *a.Noul, true
		}
	case TypeChoice:
		if p, ok := a.Probabilities[a.Choice]; ok && (!have || p > best) {
			best, have = p, true
		}
	case TypeScore:
		for _, p := range a.Probabilities {
			if !have || p > best {
				best, have = p, true
			}
		}
	}
	return best, have
}

// Usage is token usage + cost (USD). CostEstimated is true when the provider
// omitted cost and it was derived from InputUSDPerMillionTokens.
type Usage struct {
	InputTokens   int64   `json:"input_tokens"`
	OutputTokens  int64   `json:"output_tokens"`
	Cost          float64 `json:"cost"`
	CostEstimated bool    `json:"cost_estimated,omitempty"`
}

// Response is the parsed systemone response.
type Response struct {
	Model    string            `json:"model"`
	Answers  map[string]Answer `json:"answers"`
	Usage    Usage             `json:"usage"`
	Provider string            `json:"provider,omitempty"` // upstream provider reported by the gateway (e.g. "Azure")
	Latency  time.Duration     `json:"-"`
}

// AnswersMap returns answers in the loose map form used by existing decision
// consumers (same shape agent-runtime /v1/decision/decide returns).
func (r *Response) AnswersMap() map[string]any {
	out := make(map[string]any, len(r.Answers))
	for k, a := range r.Answers {
		m := map[string]any{"type": string(a.Type)}
		switch a.Type {
		case TypeNoul:
			if a.Noul != nil {
				m["noul"] = *a.Noul
			}
		case TypeChoice:
			m["choice"] = a.Choice
			m["probabilities"] = probsAny(a.Probabilities)
		case TypeScore:
			if a.Score != nil {
				m["score"] = *a.Score
			} else if a.ScoreLabel != "" {
				m["score"] = a.ScoreLabel
			}
			m["probabilities"] = probsAny(a.Probabilities)
		}
		if a.Confidence != nil {
			m["confidence"] = *a.Confidence
		}
		out[k] = m
	}
	return out
}

func probsAny(p map[string]float64) map[string]any {
	out := make(map[string]any, len(p))
	for k, v := range p {
		out[k] = v
	}
	return out
}

// APIError is a non-2xx response from the decision endpoint.
type APIError struct {
	StatusCode int
	Message    string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("decision api %d: %s", e.StatusCode, e.Message)
}

// Config selects provider, endpoint, credentials and timeout.
type Config struct {
	Provider string // openrouter | azure_foundry
	// BaseURL: OpenRouter defaults to https://openrouter.ai/api/v1; Azure is the
	// Foundry resource endpoint (https://<resource>.services.ai.azure.com). A full
	// .../systemone URL is used as-is.
	BaseURL  string
	APIKey   string
	AuthMode string // api_key (default) | bearer (Azure Entra token)
	// Model: OpenRouter model id (default microsoft/microsoft-decision-1) or the
	// Azure deployment name (required).
	Model      string
	Timeout    time.Duration
	HTTPClient *http.Client
}

// NormalizeProvider maps aliases to openrouter | azure_foundry; "" when unknown.
func NormalizeProvider(p string) string {
	switch strings.ToLower(strings.TrimSpace(p)) {
	case "openrouter", "open_router", "open-router":
		return ProviderOpenRouter
	case "azure_foundry", "azure-foundry", "azure", "foundry", "azure_ai", "azure-ai":
		return ProviderAzureFoundry
	default:
		return ""
	}
}

// NormalizeAuthMode returns api_key | bearer.
func NormalizeAuthMode(m string) string {
	switch strings.ToLower(strings.TrimSpace(m)) {
	case "bearer", "entra", "entra_id", "aad", "token":
		return AuthBearer
	default:
		return AuthAPIKey
	}
}

// ClampTimeout returns DefaultTimeout for <=0 and clamps into [MinTimeout, MaxTimeout].
func ClampTimeout(d time.Duration) time.Duration {
	if d <= 0 {
		return DefaultTimeout
	}
	if d < MinTimeout {
		return MinTimeout
	}
	if d > MaxTimeout {
		return MaxTimeout
	}
	return d
}

// WithDefaults normalizes provider/auth, trims and fills vendor defaults.
func (c Config) WithDefaults() Config {
	c.Provider = NormalizeProvider(c.Provider)
	c.AuthMode = NormalizeAuthMode(c.AuthMode)
	c.BaseURL = strings.TrimRight(strings.TrimSpace(c.BaseURL), "/")
	c.APIKey = strings.TrimSpace(c.APIKey)
	c.Model = strings.TrimSpace(c.Model)
	if c.Provider == ProviderOpenRouter {
		if c.BaseURL == "" {
			c.BaseURL = DefaultOpenRouterBaseURL
		}
		if c.Model == "" {
			c.Model = DefaultOpenRouterModel
		}
		c.AuthMode = AuthAPIKey
	}
	c.Timeout = ClampTimeout(c.Timeout)
	return c
}

// Validate reports missing provider / endpoint / model / credential.
func (c Config) Validate() error {
	c = c.WithDefaults()
	switch c.Provider {
	case ProviderOpenRouter, ProviderAzureFoundry:
	default:
		return errors.New("provider must be openrouter or azure_foundry")
	}
	if c.BaseURL == "" {
		return errors.New("Azure Foundry 需要资源 endpoint（base_url）")
	}
	if !strings.HasPrefix(c.BaseURL, "http://") && !strings.HasPrefix(c.BaseURL, "https://") {
		return errors.New("base_url 必须以 http:// 或 https:// 开头")
	}
	if c.Model == "" {
		return errors.New("Azure Foundry 需要部署名（model）")
	}
	if c.APIKey == "" {
		return errors.New("缺少 API key")
	}
	return nil
}

var azureRouteSuffix = regexp.MustCompile(`(/api/projects/[^/]+)?(/openai/v1|/openai|/models|/v1)?$`)

// Endpoint resolves the full POST URL for systemone.
func (c Config) Endpoint() string {
	c = c.WithDefaults()
	base := c.BaseURL
	if strings.HasSuffix(base, "/systemone") {
		return base
	}
	switch c.Provider {
	case ProviderAzureFoundry:
		if strings.HasSuffix(base, "/providers/microsoft/v1") {
			return base + "/systemone"
		}
		if strings.HasSuffix(base, "/providers/microsoft") {
			return base + "/v1/systemone"
		}
		// Project-scoped / OpenAI-compat bases → trim back to the resource host.
		base = strings.TrimRight(azureRouteSuffix.ReplaceAllString(base, ""), "/")
		return base + "/providers/microsoft/v1/systemone"
	default: // openrouter (or any gateway following its layout)
		if strings.HasSuffix(base, "/v1") {
			return base + "/systemone"
		}
		if strings.HasSuffix(base, "/api") {
			return base + "/v1/systemone"
		}
		if !strings.Contains(strings.TrimPrefix(strings.TrimPrefix(base, "https://"), "http://"), "/") {
			return base + "/api/v1/systemone"
		}
		return base + "/v1/systemone"
	}
}

// Client calls one configured decision endpoint.
type Client struct {
	cfg  Config
	http *http.Client
}

// New validates cfg and returns a client.
func New(cfg Config) (*Client, error) {
	cfg = cfg.WithDefaults()
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	hc := cfg.HTTPClient
	if hc == nil {
		hc = &http.Client{}
	}
	return &Client{cfg: cfg, http: hc}, nil
}

func (c *Client) Config() Config { return c.cfg }

// ValidateQuestions checks types and criteria shapes before sending.
func ValidateQuestions(qs map[string]Question) error {
	if len(qs) == 0 {
		return errors.New("questions 不能为空")
	}
	keys := make([]string, 0, len(qs))
	for k := range qs {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		q := qs[k]
		if strings.TrimSpace(k) == "" {
			return errors.New("question 名称不能为空")
		}
		if strings.TrimSpace(q.Instructions) == "" {
			return fmt.Errorf("%s 缺少 instructions", k)
		}
		switch q.Type {
		case TypeNoul:
		case TypeChoice:
			n := criteriaLen(q.Criteria, true)
			if n < 1 {
				return fmt.Errorf("%s 的 choice 需要非空 criteria 对象", k)
			}
			if n > maxChoiceOptions {
				return fmt.Errorf("%s 的 choice 最多 %d 个选项", k, maxChoiceOptions)
			}
		case TypeScore:
			n := criteriaLen(q.Criteria, false)
			if n < minScoreLevels || n > maxScoreLevels {
				return fmt.Errorf("%s 的 score 需要 %d 到 %d 级 criteria", k, minScoreLevels, maxScoreLevels)
			}
		default:
			return fmt.Errorf("%s 的 type 必须是 noul、choice 或 score", k)
		}
	}
	return nil
}

func criteriaLen(v any, wantMap bool) int {
	switch t := v.(type) {
	case map[string]string:
		if wantMap {
			return len(t)
		}
	case map[string]any:
		if wantMap {
			return len(t)
		}
	case []string:
		if !wantMap {
			return len(t)
		}
	case []any:
		if !wantMap {
			return len(t)
		}
	}
	return -1
}

// QuestionsFromMap converts loose map questions (existing auto-pick payloads) to typed ones.
func QuestionsFromMap(raw map[string]any) (map[string]Question, error) {
	b, err := json.Marshal(raw)
	if err != nil {
		return nil, err
	}
	var out map[string]Question
	if err := json.Unmarshal(b, &out); err != nil {
		return nil, fmt.Errorf("questions: %w", err)
	}
	return out, nil
}

// Decide posts state + questions and parses typed answers.
func (c *Client) Decide(ctx context.Context, state any, questions map[string]Question) (*Response, error) {
	if c == nil {
		return nil, errors.New("decision client is nil")
	}
	if err := ValidateQuestions(questions); err != nil {
		return nil, err
	}
	if s, ok := state.(string); ok && strings.TrimSpace(s) == "" {
		return nil, errors.New("state 不能为空")
	}
	if state == nil {
		return nil, errors.New("state 不能为空")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	ctx, cancel := context.WithTimeout(ctx, c.cfg.Timeout)
	defer cancel()

	body, err := json.Marshal(Request{Model: c.cfg.Model, State: state, Questions: questions})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.Endpoint(), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	switch {
	case c.cfg.Provider == ProviderAzureFoundry && c.cfg.AuthMode == AuthAPIKey:
		req.Header.Set("api-key", c.cfg.APIKey)
	default:
		req.Header.Set("Authorization", "Bearer "+c.cfg.APIKey)
	}
	if c.cfg.Provider == ProviderOpenRouter {
		req.Header.Set("X-Title", "open-bot")
	}

	started := time.Now()
	resp, err := c.http.Do(req)
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return nil, fmt.Errorf("decision api timeout after %s", c.cfg.Timeout)
		}
		return nil, fmt.Errorf("decision api unreachable: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("decision api read: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, &APIError{StatusCode: resp.StatusCode, Message: errorMessage(raw, c.cfg.APIKey)}
	}
	out, err := ParseResponse(raw)
	if err != nil {
		return nil, err
	}
	out.Latency = time.Since(started)
	if out.Model == "" {
		out.Model = c.cfg.Model
	}
	return out, nil
}

func errorMessage(raw []byte, apiKey string) string {
	msg := ""
	var parsed map[string]any
	if json.Unmarshal(raw, &parsed) == nil {
		switch e := parsed["error"].(type) {
		case string:
			msg = e
		case map[string]any:
			if m, ok := e["message"].(string); ok {
				msg = m
			}
		}
		if msg == "" {
			if m, ok := parsed["message"].(string); ok {
				msg = m
			} else if m, ok := parsed["detail"].(string); ok {
				msg = m
			}
		}
	}
	if msg == "" {
		msg = strings.TrimSpace(string(raw))
	}
	msg = strings.ReplaceAll(msg, "\n", " ")
	if apiKey != "" {
		msg = strings.ReplaceAll(msg, apiKey, "****")
	}
	if r := []rune(msg); len(r) > 300 {
		msg = string(r[:300])
	}
	if msg == "" {
		msg = "empty error body"
	}
	return msg
}

// ParseResponse parses a systemone response body.
func ParseResponse(raw []byte) (*Response, error) {
	var env struct {
		Model    string                    `json:"model"`
		Answers  map[string]map[string]any `json:"answers"`
		Usage    map[string]any            `json:"usage"`
		Provider string                    `json:"provider"`
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if err := dec.Decode(&env); err != nil {
		return nil, fmt.Errorf("decision response parse: %w", err)
	}
	if len(env.Answers) == 0 {
		return nil, errors.New("decision response has no answers")
	}
	out := &Response{Model: env.Model, Provider: env.Provider, Answers: map[string]Answer{}}
	for k, a := range env.Answers {
		ans, err := parseAnswer(k, a)
		if err != nil {
			return nil, err
		}
		out.Answers[k] = ans
	}
	if env.Usage != nil {
		out.Usage.InputTokens = int64(num(env.Usage["input_tokens"]))
		out.Usage.OutputTokens = int64(num(env.Usage["output_tokens"]))
		if c, ok := optNum(env.Usage["cost"]); ok {
			out.Usage.Cost = c
		} else {
			out.Usage.Cost = EstimateCost(out.Usage.InputTokens)
			out.Usage.CostEstimated = true
		}
	}
	return out, nil
}

// EstimateCost returns USD for inputTokens at Decision-1 list price.
func EstimateCost(inputTokens int64) float64 {
	return float64(inputTokens) * InputUSDPerMillionTokens / 1e6
}

func parseAnswer(key string, raw map[string]any) (Answer, error) {
	a := Answer{Raw: raw}
	t := QuestionType(strings.ToLower(strings.TrimSpace(fmt.Sprint(raw["type"]))))
	if raw["type"] == nil {
		switch {
		case raw["noul"] != nil:
			t = TypeNoul
		case raw["choice"] != nil:
			t = TypeChoice
		case raw["score"] != nil:
			t = TypeScore
		}
	}
	a.Type = t
	if c, ok := optNum(raw["confidence"]); ok {
		a.Confidence = &c
	}
	switch t {
	case TypeNoul:
		v, ok := optNum(raw["noul"])
		if !ok {
			return a, fmt.Errorf("%s: noul answer missing value", key)
		}
		a.Noul = &v
	case TypeChoice:
		a.Choice = strings.TrimSpace(str(raw["choice"]))
		a.Probabilities = parseProbs(raw["probabilities"])
		if a.Choice == "" {
			return a, fmt.Errorf("%s: choice answer missing choice", key)
		}
	case TypeScore:
		if v, ok := optNum(raw["score"]); ok {
			a.Score = &v
		} else if s := strings.TrimSpace(str(raw["score"])); s != "" {
			a.ScoreLabel = s
		}
		a.Probabilities = parseProbs(raw["probabilities"])
	default:
		return a, fmt.Errorf("%s: unknown answer type %q", key, str(raw["type"]))
	}
	return a, nil
}

func parseProbs(v any) map[string]float64 {
	out := map[string]float64{}
	switch t := v.(type) {
	case map[string]any:
		for k, pv := range t {
			if f, ok := optNum(pv); ok {
				out[k] = f
			}
		}
	case []any:
		for i, pv := range t {
			if f, ok := optNum(pv); ok {
				out[strconv.Itoa(i)] = f
			}
		}
	}
	return out
}

func str(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprint(v)
}

func num(v any) float64 {
	f, _ := optNum(v)
	return f
}

func optNum(v any) (float64, bool) {
	switch t := v.(type) {
	case json.Number:
		f, err := t.Float64()
		return f, err == nil
	case float64:
		return t, true
	case int:
		return float64(t), true
	case int64:
		return float64(t), true
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(t), 64)
		return f, err == nil
	}
	return 0, false
}
