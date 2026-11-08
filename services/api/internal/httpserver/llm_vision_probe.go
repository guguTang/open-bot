package httpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

// LLMVisionProbeResult is returned by POST /v1/llm/probe-vision.
// Shape follows POST /v1/llm/probe-tools: a tiny non-streaming chat, then a
// plain-text chat when the image request is rejected.
type LLMVisionProbeResult struct {
	OK             bool   `json:"ok"`
	SupportsVision bool   `json:"supports_vision"`
	Detail         string `json:"detail"`
	Hint           string `json:"hint,omitempty"`
	Error          string `json:"error,omitempty"`
	HTTPStatus     int    `json:"http_status,omitempty"`
}

// visionProbeUnconfirmedHint is shown when save cannot tell whether the model sees images.
const visionProbeUnconfirmedHint = "未能确认视觉能力，附图将仅文本提及"

// 1x1 PNG. Small enough for a capability probe, valid for image_url data URLs.
const visionProbePNGBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

func visionProbeDataURL() string {
	return "data:image/png;base64," + visionProbePNGBase64
}

func visionUnconfirmed(detail, errText string, status int) LLMVisionProbeResult {
	return LLMVisionProbeResult{
		OK:             false,
		SupportsVision: false,
		Detail:         detail,
		Hint:           visionProbeUnconfirmedHint,
		Error:          errText,
		HTTPStatus:     status,
	}
}

func clipProbeBody(body string, n int) string {
	body = strings.TrimSpace(body)
	if n <= 0 || len(body) <= n {
		return body
	}
	return body[:n] + "…"
}

// isVisionInputReject mirrors agent-runtime host_vision.is_vision_input_reject.
// True when an upstream error is about image input, not a generic schema failure.
func isVisionInputReject(message string) bool {
	raw := message
	folded := strings.ToLower(raw)
	if strings.Contains(folded, "image_url") || strings.Contains(folded, "image url") {
		return true
	}
	if strings.Contains(folded, "does not support image") || strings.Contains(folded, "doesn't support image") {
		return true
	}
	if strings.Contains(folded, "do not support image") || strings.Contains(folded, "don't support image") {
		return true
	}
	if strings.Contains(folded, "not support image") || strings.Contains(folded, "unsupported image") {
		return true
	}
	visionUnsupported := strings.Contains(folded, "vision") &&
		(strings.Contains(folded, "not support") || strings.Contains(folded, "unsupported") || strings.Contains(folded, "does not support"))
	if visionUnsupported {
		return true
	}
	if strings.Contains(folded, "multimodal") &&
		(strings.Contains(folded, "not support") || strings.Contains(folded, "unsupported")) {
		return true
	}
	for _, phrase := range []string{
		"不支持图像", "不支持图片", "不支持视觉", "不支持多模态",
		"无法处理图像", "无法处理图片", "不接受图像", "不接受图片",
		"不支持看图",
	} {
		if strings.Contains(raw, phrase) {
			return true
		}
	}
	return false
}

// probeLLMVision sends one tiny non-streaming chat with a text part plus a 1x1 PNG.
// Chat works but the image is rejected → SupportsVision false and OK true.
// Connection or total upstream failure → OK false (caller may still save).
func probeLLMVision(ctx context.Context, baseURL, apiKey, model string) LLMVisionProbeResult {
	baseURL = normalizeLLMBaseURL(baseURL)
	model = strings.TrimSpace(model)
	if baseURL == "" || model == "" {
		return visionUnconfirmed("需要 base_url 和 model", "需要 base_url 和 model", 0)
	}
	payload := map[string]any{
		"model":  model,
		"stream": false,
		"messages": []map[string]any{
			{
				"role": "user",
				"content": []any{
					map[string]any{"type": "text", "text": "Reply with the single word ok."},
					map[string]any{
						"type": "image_url",
						"image_url": map[string]any{
							"url": visionProbeDataURL(),
						},
					},
				},
			},
		},
	}
	img, err := postUpstreamChat(ctx, baseURL, apiKey, payload)
	if err != nil {
		return visionUnconfirmed("无法连接上游："+err.Error(), err.Error(), 0)
	}
	if img.status > 0 && img.status < 300 {
		return LLMVisionProbeResult{
			OK:             true,
			SupportsVision: true,
			Detail:         "上游接受了带图像的聊天请求。",
			HTTPStatus:     img.status,
		}
	}
	// 5xx is an upstream failure, not proof the model is text-only.
	if img.status >= 500 || img.status == 0 {
		return visionUnconfirmed(
			fmt.Sprintf("上游聊天接口失败（HTTP %d）", img.status),
			clipProbeBody(img.body, 400),
			img.status,
		)
	}

	plain, err := postUpstreamChat(ctx, baseURL, apiKey, map[string]any{
		"model":    model,
		"stream":   false,
		"messages": []map[string]any{{"role": "user", "content": "ping"}},
	})
	if err != nil {
		return visionUnconfirmed("无法连接上游："+err.Error(), err.Error(), img.status)
	}
	if plain.status >= 300 || plain.status == 0 {
		return visionUnconfirmed(
			fmt.Sprintf("上游聊天接口失败（HTTP %d）", plain.status),
			clipProbeBody(plain.body, 400),
			plain.status,
		)
	}
	detail := "上游能聊天，但不接受图像输入。"
	if isVisionInputReject(img.body) {
		detail = "上游能聊天，但拒绝图像输入。"
	}
	if clip := clipProbeBody(img.body, 280); clip != "" {
		detail = fmt.Sprintf("%s（HTTP %d）%s", detail, img.status, clip)
	}
	return LLMVisionProbeResult{
		OK:             true,
		SupportsVision: false,
		Detail:         detail,
		HTTPStatus:     img.status,
	}
}

func (s *Server) probeVisionForSave(ctx context.Context, baseURL, apiKey, model string) LLMVisionProbeResult {
	if strings.TrimSpace(baseURL) == "" || strings.TrimSpace(model) == "" || strings.TrimSpace(apiKey) == "" {
		return visionUnconfirmed("缺少 base_url、model 或 api_key，未探测视觉能力", "缺少探测所需的连接信息", 0)
	}
	return probeLLMVision(ctx, baseURL, apiKey, model)
}

type llmSavedBody struct {
	db.LLMConnectionPublic
	VisionProbe LLMVisionProbeResult `json:"vision_probe"`
}

func writeLLMSaved(w http.ResponseWriter, status int, c *db.LLMConnection, probe LLMVisionProbeResult) {
	if c == nil {
		writeJSON(w, status, map[string]any{"vision_probe": probe})
		return
	}
	writeJSON(w, status, llmSavedBody{LLMConnectionPublic: c.Public(), VisionProbe: probe})
}

func (s *Server) handleProbeLLMVision(w http.ResponseWriter, r *http.Request) {
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
	writeJSON(w, http.StatusOK, probeLLMVision(r.Context(), baseURL, apiKey, model))
}

func (s *Server) handleAdminProbeLLMVision(w http.ResponseWriter, r *http.Request) {
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
	writeJSON(w, http.StatusOK, probeLLMVision(r.Context(), baseURL, apiKey, model))
}
