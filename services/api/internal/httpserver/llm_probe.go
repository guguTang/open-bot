package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// LLMToolsProbeResult is returned by POST /v1/llm/probe-tools.
type LLMToolsProbeResult struct {
	OK             bool   `json:"ok"`
	CanEnableTools bool   `json:"can_enable_tools"`
	SupportsTools  bool   `json:"supports_tools"`
	Mode           string `json:"mode"` // native | markup | forced_only | none | error
	Detail         string `json:"detail"`
	Hint           string `json:"hint,omitempty"`
	Error          string `json:"error,omitempty"`
	HTTPStatus     int    `json:"http_status,omitempty"`
}

type llmProbeBody struct {
	BaseURL      string `json:"base_url"`
	APIKey       string `json:"api_key"`
	Model        string `json:"model"`
	ConnectionID string `json:"connection_id"`
}

func normalizeLLMBaseURL(raw string) string {
	u := strings.TrimRight(strings.TrimSpace(raw), "/")
	if u == "" {
		return ""
	}
	return u
}

func isAutoToolChoiceUnsupportedBody(body string) bool {
	m := strings.ToLower(body)
	needles := []string{
		"enable-auto-tool-choice",
		"enable_auto_tool_choice",
		"tool-call-parser",
		"tool_call_parser",
		`"auto" tool choice requires`,
		"auto tool choice requires",
	}
	for _, n := range needles {
		if strings.Contains(m, n) {
			return true
		}
	}
	return false
}

// isOpenAIReasoningModel mirrors agent-runtime model_compat.detect_family → openai_reasoning.
// Those models need reasoning_effort=none for function tools on /v1/chat/completions.
func isOpenAIReasoningModel(model string) bool {
	m := strings.ToLower(strings.TrimSpace(model))
	if m == "" {
		return false
	}
	if strings.HasPrefix(m, "o1") || strings.HasPrefix(m, "o3") || strings.HasPrefix(m, "o4") {
		return true
	}
	if strings.HasPrefix(m, "gpt-5") {
		return true
	}
	if strings.Contains(m, "luna") || strings.Contains(m, "-thinking") || strings.Contains(m, "reasoning") {
		return true
	}
	return false
}

func isReasoningEffortToolsRejectBody(body string) bool {
	m := strings.ToLower(body)
	if !strings.Contains(m, "reasoning_effort") {
		return false
	}
	// Upstream: "Function tools with reasoning_effort are not supported ... set reasoning_effort to 'none'."
	return strings.Contains(m, "function tools") ||
		strings.Contains(m, "set reasoning_effort") ||
		strings.Contains(m, "tools") ||
		strings.Contains(m, "'none'") ||
		strings.Contains(m, `"none"`)
}

func applyToolsReasoningEffort(payload map[string]any, model string) {
	if isOpenAIReasoningModel(model) {
		payload["reasoning_effort"] = "none"
	}
}

// postUpstreamChatTools posts a tools probe payload. If the gateway rejects because
// reasoning_effort must be none (common for luna / gpt-5 / o-series), retry once with none.
func postUpstreamChatTools(
	ctx context.Context,
	baseURL, apiKey, model string,
	payload map[string]any,
) (*upstreamChatResult, error) {
	applyToolsReasoningEffort(payload, model)
	r, err := postUpstreamChat(ctx, baseURL, apiKey, payload)
	if err != nil {
		return r, err
	}
	if r.status >= 400 &&
		isReasoningEffortToolsRejectBody(r.body) &&
		payload["reasoning_effort"] != "none" {
		payload["reasoning_effort"] = "none"
		return postUpstreamChat(ctx, baseURL, apiKey, payload)
	}
	return r, nil
}

func contentLooksLikeToolMarkup(text string) bool {
	low := strings.ToLower(text)
	if strings.Contains(low, "<tool_call") || strings.Contains(low, "<function=") {
		return true
	}
	if strings.Contains(low, "tool_calls:") && strings.Contains(low, "- tool:") {
		return true
	}
	return false
}

type upstreamChatResult struct {
	status     int
	body       string
	toolCalls  int
	content    string
	finish     string
	parseError string
}

func postUpstreamChat(
	ctx context.Context,
	baseURL, apiKey string,
	payload map[string]any,
) (*upstreamChatResult, error) {
	url := normalizeLLMBaseURL(baseURL) + "/chat/completions"
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if strings.TrimSpace(apiKey) != "" {
		req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
	}
	client := &http.Client{Timeout: 25 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	out := &upstreamChatResult{status: resp.StatusCode, body: string(bodyBytes)}
	if resp.StatusCode >= 300 {
		return out, nil
	}
	var parsed struct {
		Choices []struct {
			FinishReason string `json:"finish_reason"`
			Message      struct {
				Content   any `json:"content"`
				ToolCalls []struct {
					ID       string `json:"id"`
					Type     string `json:"type"`
					Function struct {
						Name string `json:"name"`
					} `json:"function"`
				} `json:"tool_calls"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(bodyBytes, &parsed); err != nil {
		out.parseError = err.Error()
		return out, nil
	}
	if len(parsed.Choices) == 0 {
		return out, nil
	}
	ch := parsed.Choices[0]
	out.finish = ch.FinishReason
	out.toolCalls = len(ch.Message.ToolCalls)
	switch c := ch.Message.Content.(type) {
	case string:
		out.content = c
	case []any:
		var b strings.Builder
		for _, part := range c {
			if m, ok := part.(map[string]any); ok {
				if t, _ := m["text"].(string); t != "" {
					b.WriteString(t)
				}
			}
		}
		out.content = b.String()
	}
	return out, nil
}

func pingToolDefs() []map[string]any {
	return []map[string]any{
		{
			"type": "function",
			"function": map[string]any{
				"name":        "ping",
				"description": "Health check tool used only to verify function calling support.",
				"parameters": map[string]any{
					"type":       "object",
					"properties": map[string]any{},
				},
			},
		},
	}
}

func probeLLMTools(ctx context.Context, baseURL, apiKey, model string) LLMToolsProbeResult {
	baseURL = normalizeLLMBaseURL(baseURL)
	model = strings.TrimSpace(model)
	if baseURL == "" || model == "" {
		return LLMToolsProbeResult{
			OK: false, Mode: "error", Detail: "需要 base_url 和 model",
			Error: "需要 base_url 和 model",
		}
	}

	msgs := []map[string]any{
		{
			"role":    "system",
			"content": "You must call the ping tool via function calling. Do not answer in plain text.",
		},
		{"role": "user", "content": "Call the ping tool now."},
	}
	tools := pingToolDefs()

	// Attempt 1: tools without explicit tool_choice (OpenAI defaults to auto; Qwen profile omits auto).
	r1Payload := map[string]any{
		"model":    model,
		"stream":   false,
		"messages": msgs,
		"tools":    tools,
	}
	r1, err := postUpstreamChatTools(ctx, baseURL, apiKey, model, r1Payload)
	if err != nil {
		return LLMToolsProbeResult{
			OK: false, Mode: "error", Detail: "无法连接上游：" + err.Error(),
			Error: err.Error(),
		}
	}
	if r1.status < 300 && r1.toolCalls > 0 {
		return LLMToolsProbeResult{
			OK: true, CanEnableTools: true, SupportsTools: true,
			Mode: "native", Detail: "上游返回了 tool_calls，支持原生 function calling。",
			HTTPStatus: r1.status,
		}
	}
	if r1.status < 300 && contentLooksLikeToolMarkup(r1.content) {
		return LLMToolsProbeResult{
			OK: true, CanEnableTools: true, SupportsTools: true,
			Mode: "markup",
			Detail: "上游未返回标准 tool_calls，但文本里出现了工具调用标记；可启用 tools（走文本工具协议）。",
			Hint:   "更稳妥是让上游支持 OpenAI tool_calls（vLLM 需 --enable-auto-tool-choice 与 --tool-call-parser）。",
			HTTPStatus: r1.status,
		}
	}

	autoBlocked := r1.status >= 400 && isAutoToolChoiceUnsupportedBody(r1.body)

	// Attempt 2: forced tool_choice (some vLLM builds accept this without auto flags).
	r2Payload := map[string]any{
		"model":    model,
		"stream":   false,
		"messages": msgs,
		"tools":    tools,
		"tool_choice": map[string]any{
			"type":     "function",
			"function": map[string]any{"name": "ping"},
		},
	}
	r2, err := postUpstreamChatTools(ctx, baseURL, apiKey, model, r2Payload)
	if err != nil {
		return LLMToolsProbeResult{
			OK: false, Mode: "error", Detail: "无法连接上游：" + err.Error(),
			Error: err.Error(), HTTPStatus: r1.status,
		}
	}
	if r2.status < 300 && r2.toolCalls > 0 {
		detail := "上游仅在指定 tool_choice 时返回 tool_calls；自由选择工具（auto）不可用。"
		hint := "可暂时启用 tools（运行时会用文本工具协议兜底）。建议在 vLLM 增加 --enable-auto-tool-choice 与 --tool-call-parser。"
		if autoBlocked {
			detail = "上游拒绝 tool_choice=auto（缺 enable-auto-tool-choice / tool-call-parser），但强制指定工具名可以调用。"
		}
		return LLMToolsProbeResult{
			OK: true, CanEnableTools: true, SupportsTools: true,
			Mode: "forced_only", Detail: detail, Hint: hint,
			HTTPStatus: r2.status,
		}
	}
	if r2.status < 300 && contentLooksLikeToolMarkup(r2.content) {
		return LLMToolsProbeResult{
			OK: true, CanEnableTools: true, SupportsTools: true,
			Mode: "markup",
			Detail: "强制 tool_choice 后仍以文本标记表示工具调用；可启用 tools（走文本工具协议）。",
			Hint:   "建议配置上游原生 function calling。",
			HTTPStatus: r2.status,
		}
	}

	// Attempt 3: plain completion — proves the endpoint works at all.
	r3, err := postUpstreamChat(ctx, baseURL, apiKey, map[string]any{
		"model":    model,
		"stream":   false,
		"messages": []map[string]any{{"role": "user", "content": "ping"}},
	})
	if err != nil {
		return LLMToolsProbeResult{
			OK: false, Mode: "error", Detail: "无法连接上游：" + err.Error(),
			Error: err.Error(),
		}
	}
	if r3.status >= 300 {
		clip := r3.body
		if len(clip) > 400 {
			clip = clip[:400] + "…"
		}
		return LLMToolsProbeResult{
			OK: false, Mode: "error",
			Detail:     fmt.Sprintf("上游聊天接口失败（HTTP %d）", r3.status),
			Error:      clip,
			HTTPStatus: r3.status,
		}
	}

	detail := "上游能聊天，但不支持可用的 function calling / tools。"
	if autoBlocked {
		detail = "上游能聊天，但拒绝 tools（需要 --enable-auto-tool-choice 与 --tool-call-parser）。当前不能可靠启用 tools。"
	} else if r1.status >= 400 {
		clip := r1.body
		if len(clip) > 280 {
			clip = clip[:280] + "…"
		}
		detail = fmt.Sprintf("上游拒绝 tools 请求（HTTP %d）：%s", r1.status, clip)
	}
	return LLMToolsProbeResult{
		OK: false, CanEnableTools: false, SupportsTools: false,
		Mode: "none", Detail: detail,
		Hint:       "不要勾选「启用 tools」，或换支持 function calling 的模型/网关。",
		HTTPStatus: r1.status,
	}
}

func (s *Server) resolveProbeCredentials(r *http.Request, body llmProbeBody) (baseURL, apiKey, model string, err error) {
	baseURL = strings.TrimSpace(body.BaseURL)
	apiKey = strings.TrimSpace(body.APIKey)
	model = strings.TrimSpace(body.Model)
	uid := userIDFrom(r.Context())

	if cid := strings.TrimSpace(body.ConnectionID); cid != "" {
		c, gerr := s.db.GetLLMConnection(uid, cid)
		if gerr != nil {
			return "", "", "", gerr
		}
		if baseURL == "" {
			baseURL = c.BaseURL
		}
		if model == "" {
			model = c.Model
		}
		if apiKey == "" {
			apiKey = c.APIKey
		}
	}
	return baseURL, apiKey, model, nil
}

func (s *Server) handleProbeLLMTools(w http.ResponseWriter, r *http.Request) {
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
	result := probeLLMTools(r.Context(), baseURL, apiKey, model)
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleAdminProbeLLMTools(w http.ResponseWriter, r *http.Request) {
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
	result := probeLLMTools(r.Context(), baseURL, apiKey, model)
	writeJSON(w, http.StatusOK, result)
}
