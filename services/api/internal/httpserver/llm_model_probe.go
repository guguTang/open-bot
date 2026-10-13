package httpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// LLMModelProbeResult is returned by POST /v1/llm/probe-model (and admin twin).
// A minimal chat/completions round-trip proves the selected model id is usable.
type LLMModelProbeResult struct {
	OK         bool   `json:"ok"`
	Detail     string `json:"detail"`
	Hint       string `json:"hint,omitempty"`
	Error      string `json:"error,omitempty"`
	HTTPStatus int    `json:"http_status,omitempty"`
	LatencyMs  int    `json:"latency_ms,omitempty"`
	Model      string `json:"model,omitempty"`
	Reply      string `json:"reply,omitempty"` // short clip of assistant content when ok
}

func clipProbeText(s string, max int) string {
	s = strings.TrimSpace(s)
	if max <= 0 || len(s) <= max {
		return s
	}
	return s[:max] + "…"
}

// probeLLMModel sends a tiny non-streaming chat/completions request with the given model.
func probeLLMModel(ctx context.Context, baseURL, apiKey, model string) LLMModelProbeResult {
	baseURL = normalizeLLMBaseURL(baseURL)
	model = strings.TrimSpace(model)
	if baseURL == "" || model == "" {
		return LLMModelProbeResult{
			OK: false, Detail: "需要 base_url 和 model", Error: "需要 base_url 和 model",
		}
	}
	if strings.TrimSpace(apiKey) == "" {
		return LLMModelProbeResult{
			OK: false, Detail: "需要 api_key", Error: "需要 api_key", Model: model,
		}
	}

	started := time.Now()
	payload := map[string]any{
		"model":  model,
		"stream": false,
		"messages": []map[string]any{
			{"role": "user", "content": "Reply with exactly: ok"},
		},
	}
	r, err := postUpstreamChat(ctx, baseURL, apiKey, payload)
	latency := int(time.Since(started).Milliseconds())
	if err != nil {
		return LLMModelProbeResult{
			OK: false, Model: model, LatencyMs: latency,
			Detail: "无法连接上游：" + err.Error(),
			Error:  err.Error(),
		}
	}
	if r.status >= 300 {
		clip := clipProbeText(r.body, 400)
		return LLMModelProbeResult{
			OK: false, Model: model, LatencyMs: latency, HTTPStatus: r.status,
			Detail: fmt.Sprintf("模型不可用（HTTP %d）", r.status),
			Error:  clip,
			Hint:   "检查模型名是否在上游可用，以及密钥是否有该模型权限。",
		}
	}
	if r.parseError != "" {
		return LLMModelProbeResult{
			OK: false, Model: model, LatencyMs: latency, HTTPStatus: r.status,
			Detail: "上游返回了无法解析的聊天响应",
			Error:  r.parseError,
		}
	}
	reply := clipProbeText(r.content, 80)
	detail := fmt.Sprintf("模型可用（%s · %dms）", model, latency)
	if reply != "" {
		detail = fmt.Sprintf("模型可用（%s · %dms）：%s", model, latency, reply)
	}
	return LLMModelProbeResult{
		OK: true, Model: model, LatencyMs: latency, HTTPStatus: r.status,
		Detail: detail, Reply: reply,
	}
}

func (s *Server) handleProbeLLMModel(w http.ResponseWriter, r *http.Request) {
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
	result := probeLLMModel(r.Context(), baseURL, apiKey, model)
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleAdminProbeLLMModel(w http.ResponseWriter, r *http.Request) {
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
	result := probeLLMModel(r.Context(), baseURL, apiKey, model)
	writeJSON(w, http.StatusOK, result)
}
