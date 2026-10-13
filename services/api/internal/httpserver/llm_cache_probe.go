package httpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// LLMPromptCacheProbeResult is returned by POST /v1/llm/probe-cache (and admin twin).
// Mode mirrors runtime OPENBOT_PROMPT_CACHE auto resolution: blocks | key | none | error.
type LLMPromptCacheProbeResult struct {
	OK                  bool   `json:"ok"`
	SupportsPromptCache bool   `json:"supports_prompt_cache"`
	Mode                string `json:"mode"` // blocks | key | none | error
	Detail              string `json:"detail"`
	Hint                string `json:"hint,omitempty"`
	Error               string `json:"error,omitempty"`
	HTTPStatus          int    `json:"http_status,omitempty"`
	HeuristicMode       string `json:"heuristic_mode,omitempty"` // blocks | key | off before live probe
}

func isPromptCacheRejectBody(body string) bool {
	m := strings.ToLower(body)
	needles := []string{
		"cache_control",
		"prompt_cache_key",
		"unknown field",
		"unrecognized field",
		"extra inputs are not permitted",
		"additional properties",
		"unexpected keyword",
		"unexpected field",
	}
	hit := false
	for _, n := range needles {
		if strings.Contains(m, n) {
			hit = true
			break
		}
	}
	if !hit {
		return false
	}
	return strings.Contains(m, "cache") || strings.Contains(m, "prompt_cache")
}

// resolvePromptCacheHeuristic mirrors services/agent-runtime resolve_prompt_cache_mode(auto).
func resolvePromptCacheHeuristic(model, baseURL string) string {
	u := strings.ToLower(strings.TrimSpace(baseURL))
	m := strings.ToLower(strings.TrimSpace(model))
	if strings.Contains(u, "anthropic.com") || strings.Contains(u, "claude") {
		return "blocks"
	}
	if strings.Contains(u, "moonshot.cn") || strings.Contains(u, "kimi") {
		return "key"
	}
	if strings.Contains(m, "claude") {
		if strings.Contains(u, "openrouter") || strings.Contains(u, "litellm") || strings.Contains(u, "anthropic") {
			return "blocks"
		}
		// Claude ids on unknown gateways: still try Anthropic-style blocks.
		return "blocks"
	}
	if strings.Contains(u, "api.openai.com") {
		return "key"
	}
	// GPT / o-series style names on OpenAI-compatible hosts often accept prompt_cache_key.
	// Match runtime detect_family → openai_chat / openai_reasoning → key.
	if strings.HasPrefix(m, "gpt-") || strings.HasPrefix(m, "o1") || strings.HasPrefix(m, "o3") ||
		strings.HasPrefix(m, "o4") || strings.Contains(m, "chatgpt") ||
		strings.Contains(m, "luna") || strings.Contains(m, "reasoning") ||
		strings.HasPrefix(m, "kimi") || strings.Contains(m, "moonshot") {
		return "key"
	}
	return "off"
}

func probeCacheBlocksPayload(model string) map[string]any {
	return map[string]any{
		"model":  model,
		"stream": false,
		"messages": []map[string]any{
			{
				"role": "system",
				"content": []map[string]any{
					{
						"type":          "text",
						"text":          "openbot-cache-probe-static",
						"cache_control": map[string]any{"type": "ephemeral"},
					},
					{"type": "text", "text": "openbot-cache-probe-dynamic"},
				},
			},
			{"role": "user", "content": "ping"},
		},
	}
}

func probeCacheKeyPayload(model string) map[string]any {
	return map[string]any{
		"model":            model,
		"stream":           false,
		"messages":         []map[string]any{{"role": "user", "content": "ping"}},
		"prompt_cache_key": "ob-cache-probe",
	}
}

func probeLLMPromptCache(ctx context.Context, baseURL, apiKey, model string) LLMPromptCacheProbeResult {
	baseURL = normalizeLLMBaseURL(baseURL)
	model = strings.TrimSpace(model)
	if baseURL == "" || model == "" {
		return LLMPromptCacheProbeResult{
			OK: false, Mode: "error", Detail: "需要 base_url 和 model",
			Error: "需要 base_url 和 model",
		}
	}
	if strings.TrimSpace(apiKey) == "" {
		return LLMPromptCacheProbeResult{
			OK: false, Mode: "error", Detail: "需要 api_key",
			Error: "需要 api_key",
		}
	}

	heuristic := resolvePromptCacheHeuristic(model, baseURL)
	if heuristic == "off" {
		return LLMPromptCacheProbeResult{
			OK: true, SupportsPromptCache: false, Mode: "none",
			HeuristicMode: "off",
			Detail:        "按模型/端点启发式，运行时（OPENBOT_PROMPT_CACHE=auto）不会注入缓存字段。",
			Hint:          "若网关实际支持 cache_control 或 prompt_cache_key，可在运行时设置 OPENBOT_PROMPT_CACHE=blocks 或 key。",
		}
	}

	var payload map[string]any
	switch heuristic {
	case "blocks":
		payload = probeCacheBlocksPayload(model)
	default:
		payload = probeCacheKeyPayload(model)
		heuristic = "key"
	}

	r, err := postUpstreamChat(ctx, baseURL, apiKey, payload)
	if err != nil {
		return LLMPromptCacheProbeResult{
			OK: false, Mode: "error", HeuristicMode: heuristic,
			Detail: "无法连接上游：" + err.Error(),
			Error:  err.Error(),
		}
	}
	if r.status < 300 {
		detail := "上游接受 prompt_cache_key；运行时可启用 OpenAI 风格提示缓存键。"
		if heuristic == "blocks" {
			detail = "上游接受 cache_control 内容块；运行时可启用 Anthropic 风格提示缓存。"
		}
		return LLMPromptCacheProbeResult{
			OK: true, SupportsPromptCache: true, Mode: heuristic,
			HeuristicMode: heuristic, Detail: detail, HTTPStatus: r.status,
		}
	}

	if r.status >= 400 && isPromptCacheRejectBody(r.body) {
		clip := r.body
		if len(clip) > 280 {
			clip = clip[:280] + "…"
		}
		return LLMPromptCacheProbeResult{
			OK: true, SupportsPromptCache: false, Mode: "none",
			HeuristicMode: heuristic,
			Detail:        fmt.Sprintf("上游拒绝缓存字段（HTTP %d）：%s", r.status, clip),
			Hint:          "运行时会在遇拒后自动去掉缓存字段并重试。",
			HTTPStatus:    r.status,
		}
	}

	// Unrelated failure (auth, model not found, etc.) — still prove plain chat if possible.
	rPlain, errPlain := postUpstreamChat(ctx, baseURL, apiKey, map[string]any{
		"model":    model,
		"stream":   false,
		"messages": []map[string]any{{"role": "user", "content": "ping"}},
	})
	if errPlain == nil && rPlain.status < 300 {
		clip := r.body
		if len(clip) > 280 {
			clip = clip[:280] + "…"
		}
		return LLMPromptCacheProbeResult{
			OK: true, SupportsPromptCache: false, Mode: "none",
			HeuristicMode: heuristic,
			Detail: fmt.Sprintf(
				"上游能聊天，但带缓存字段的请求失败（HTTP %d）：%s", r.status, clip,
			),
			Hint:       "视为不支持 prompt cache；运行时会按需降级。",
			HTTPStatus: r.status,
		}
	}

	clip := r.body
	if len(clip) > 400 {
		clip = clip[:400] + "…"
	}
	return LLMPromptCacheProbeResult{
		OK: false, Mode: "error", HeuristicMode: heuristic,
		Detail:     fmt.Sprintf("上游聊天接口失败（HTTP %d）", r.status),
		Error:      clip,
		HTTPStatus: r.status,
	}
}

func (s *Server) handleProbeLLMPromptCache(w http.ResponseWriter, r *http.Request) {
	var body llmProbeBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	baseURL, apiKey, model, err := s.resolveProbeCredentials(r, body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if strings.TrimSpace(apiKey) == "" && strings.TrimSpace(body.ConnectionID) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "需要 api_key，或提供已有 connection_id 以复用密钥"})
		return
	}
	if strings.TrimSpace(apiKey) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "该连接没有保存 api_key"})
		return
	}
	result := probeLLMPromptCache(r.Context(), baseURL, apiKey, model)
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleAdminProbeLLMPromptCache(w http.ResponseWriter, r *http.Request) {
	u, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	var body llmProbeBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	baseURL := strings.TrimSpace(body.BaseURL)
	apiKey := strings.TrimSpace(body.APIKey)
	model := strings.TrimSpace(body.Model)
	if apiKey == "" || baseURL == "" || model == "" {
		settings, serr := s.db.GetOrgSettings(u.OrgID)
		if serr != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": serr.Error()})
			return
		}
		if baseURL == "" {
			baseURL = settings.LLMBaseURL
		}
		if model == "" {
			model = settings.LLMModel
		}
		if apiKey == "" {
			apiKey = settings.LLMAPIKey
		}
	}
	if apiKey == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "需要 api_key，或组织里已保存密钥"})
		return
	}
	result := probeLLMPromptCache(r.Context(), baseURL, apiKey, model)
	writeJSON(w, http.StatusOK, result)
}
