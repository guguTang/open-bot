package httpserver

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/tangxin/open-bot/services/api/internal/billing"
	"github.com/tangxin/open-bot/services/api/internal/db"
)

func (s *Server) handleMeUsage(w http.ResponseWriter, r *http.Request) {
	u, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	usage, err := s.db.GetUserMonthUsage(u.ID, r.URL.Query().Get("month"))
	if err != nil {
		if strings.Contains(err.Error(), "parsing time") {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "month 需要 YYYY-MM"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, usage)
}

func (s *Server) handleAdminListPrices(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.loadAuthUser(w, r); !ok {
		return
	}
	all := strings.TrimSpace(r.URL.Query().Get("all")) == "1"
	rows, err := s.db.ListModelPrices(!all)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if rows == nil {
		rows = []db.ModelPrice{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"prices":        rows,
		"currency":      billing.DefaultCurrency,
		"cached_policy": "缓存单价留空时，缓存 token 按输入单价计，并在记账时写入快照。",
	})
}

func (s *Server) handleAdminCreatePrice(w http.ResponseWriter, r *http.Request) {
	u, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	in, err := decodePriceInput(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	row, err := s.db.CreateModelPrice(in)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	s.writeAudit(u.OrgID, u.ID, "model_price.create", "model_price", strconv.FormatInt(row.ID, 10), map[string]any{
		"model": row.Model, "provider": row.Provider, "org_id": row.OrgID,
	})
	writeJSON(w, http.StatusCreated, row)
}

func (s *Server) handleAdminUpdatePrice(w http.ResponseWriter, r *http.Request) {
	u, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid id"})
		return
	}
	in, err := decodePriceInput(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	row, err := s.db.UpdateModelPrice(id, in)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	s.writeAudit(u.OrgID, u.ID, "model_price.update", "model_price", strconv.FormatInt(id, 10), map[string]any{
		"model": row.Model, "input_per_million_minor": row.InputPerMillionMinor,
	})
	writeJSON(w, http.StatusOK, row)
}

func (s *Server) handleAdminExpirePrice(w http.ResponseWriter, r *http.Request) {
	u, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid id"})
		return
	}
	if err := s.db.ExpireModelPrice(id); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.writeAudit(u.OrgID, u.ID, "model_price.expire", "model_price", strconv.FormatInt(id, 10), nil)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func decodePriceInput(r *http.Request) (db.ModelPriceInput, error) {
	var raw map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		return db.ModelPriceInput{}, fmt.Errorf("invalid json")
	}
	var in db.ModelPriceInput
	_ = json.Unmarshal(raw["org_id"], &in.OrgID)
	_ = json.Unmarshal(raw["provider"], &in.Provider)
	_ = json.Unmarshal(raw["model"], &in.Model)
	_ = json.Unmarshal(raw["match_kind"], &in.MatchKind)
	_ = json.Unmarshal(raw["input_per_million_minor"], &in.InputPerMillionMinor)
	_ = json.Unmarshal(raw["output_per_million_minor"], &in.OutputPerMillionMinor)
	_ = json.Unmarshal(raw["currency"], &in.Currency)
	_ = json.Unmarshal(raw["note"], &in.Note)
	if _, ok := raw["cached_per_million_minor"]; ok {
		in.CachedSet = true
		if string(raw["cached_per_million_minor"]) != "null" {
			var n int64
			if err := json.Unmarshal(raw["cached_per_million_minor"], &n); err != nil {
				return in, fmt.Errorf("cached_per_million_minor 无效")
			}
			in.CachedPerMillionMinor = &n
		}
	}
	return in, nil
}

func (s *Server) handleInternalUsage(w http.ResponseWriter, r *http.Request) {
	var body struct {
		OrgID          string           `json:"org_id"`
		UserID         string           `json:"user_id"`
		AgentID        string           `json:"agent_id"`
		ConversationID string           `json:"conversation_id"`
		Source         string           `json:"source"`
		Calls          []map[string]any `json:"calls"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if strings.TrimSpace(body.UserID) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "user_id required"})
		return
	}
	calls := make([]billing.Call, 0, len(body.Calls))
	for _, raw := range body.Calls {
		calls = append(calls, callFromMap(raw))
	}
	if err := s.db.RecordUsageLedger(db.UsageLedgerMeta{
		OrgID: body.OrgID, UserID: body.UserID, AgentID: body.AgentID,
		ConversationID: body.ConversationID, Source: body.Source,
	}, calls); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
