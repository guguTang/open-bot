package httpserver

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

type decisionBody struct {
	Provider string `json:"provider"`
	BaseURL  string `json:"base_url"`
	APIKey   string `json:"api_key"`
	Model    string `json:"model"`
}

func (s *Server) handleAdminGetDecision(w http.ResponseWriter, r *http.Request) {
	u, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	settings, err := s.db.GetOrgSettings(u.OrgID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, settings.DecisionPublic())
}

func (s *Server) handleAdminPutDecision(w http.ResponseWriter, r *http.Request) {
	u, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	var body decisionBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	settings, err := s.db.UpsertOrgDecision(u.OrgID, body.Provider, body.BaseURL, body.APIKey, body.Model, strings.TrimSpace(body.APIKey) == "")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	pub := settings.DecisionPublic()
	s.writeAudit(u.OrgID, u.ID, "org.decision_update", "org_settings", u.OrgID, map[string]any{
		"provider":        pub.Provider,
		"base_url":        pub.BaseURL,
		"model":           pub.Model,
		"api_key_updated": strings.TrimSpace(body.APIKey) != "",
	})
	writeJSON(w, http.StatusOK, pub)
}

func (s *Server) handleAdminTestDecision(w http.ResponseWriter, r *http.Request) {
	u, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	var body decisionBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	settings, err := s.db.GetOrgSettings(u.OrgID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	provider, baseURL, model := db.ApplyDecisionDefaults(body.Provider, body.BaseURL, body.Model)
	if provider == "off" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "决策层已关闭"})
		return
	}
	if provider == "microsoft" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Microsoft-Decision-1 请使用 /v1/admin/org/decision/microsoft/test"})
		return
	}
	apiKey := strings.TrimSpace(body.APIKey)
	if apiKey == "" {
		apiKey = settings.DecisionAPIKey
	}
	payload, _ := json.Marshal(map[string]any{
		"provider": provider,
		"base_url": baseURL,
		"api_key":  apiKey,
		"model":    model,
	})
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, s.runtimeURL+"/v1/decision/test", bytes.NewReader(payload))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "runtime unreachable"})
		return
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 8192))
	if resp.StatusCode >= 300 {
		msg := strings.TrimSpace(string(raw))
		var parsed map[string]any
		if json.Unmarshal(raw, &parsed) == nil {
			if detail, ok := parsed["detail"].(string); ok && detail != "" {
				msg = detail
			} else if errText, ok := parsed["error"].(string); ok && errText != "" {
				msg = errText
			}
		}
		if msg == "" {
			msg = "决策测试失败"
		}
		code := resp.StatusCode
		if code >= 500 {
			code = http.StatusBadGateway
		}
		writeJSON(w, code, map[string]string{"error": msg})
		return
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "runtime 返回了无法解析的结果"})
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// decisionRuntimePayload is nil when the org has the decision layer off.
// The runtime then keeps the disabled client and does not call Jev/Laya/custom.
func (s *Server) decisionRuntimePayload(userID string) map[string]any {
	userID = strings.TrimSpace(userID)
	if userID == "" || s.db == nil {
		return nil
	}
	u, err := s.db.GetUserByID(userID)
	if err != nil || strings.TrimSpace(u.OrgID) == "" {
		return nil
	}
	settings, err := s.db.GetOrgSettings(u.OrgID)
	if err != nil {
		return nil
	}
	provider, baseURL, model := db.ApplyDecisionDefaults(settings.DecisionProvider, settings.DecisionBaseURL, settings.DecisionModel)
	// microsoft is Go-native only; do not hand it to agent-runtime System One factory.
	if !db.IsRuntimeSystemOneProvider(provider) {
		return nil
	}
	return map[string]any{
		"provider": provider,
		"base_url": baseURL,
		"api_key":  settings.DecisionAPIKey,
		"model":    model,
	}
}

func attachDecision(payload map[string]any, decision map[string]any) {
	if decision != nil {
		payload["decision"] = decision
	}
}
