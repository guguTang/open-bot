package httpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"
)

const (
	uploadMemoryRunes = 4000
	uploadReadRunes   = 12000
)

func (s *Server) persistAttachmentExtracts(ctx context.Context, userID, conversationID string, extracts []attachmentExtract) {
	if s == nil || s.db == nil {
		return
	}
	for _, ex := range extracts {
		md := strings.TrimSpace(ex.Markdown)
		if md == "" || strings.TrimSpace(ex.ID) == "" {
			continue
		}
		if err := s.db.SetAttachmentExtract(userID, conversationID, ex.ID, md); err != nil {
			log.Printf("attachment extract %s: %v", ex.ID, err)
			continue
		}
		s.rememberUpload(ctx, userID, ex)
	}
}

func (s *Server) rememberUpload(ctx context.Context, userID string, ex attachmentExtract) {
	if s == nil || strings.TrimSpace(s.runtimeURL) == "" {
		return
	}
	body := uploadMemoryText(ex.Name, ex.ID, ex.Markdown)
	go func() {
		cctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		_, code, err := s.postRuntimeJSON(cctx, "/v1/memories/upsert", map[string]any{
			"user_id": userID,
			"content": body,
			"tag":     "upload:" + ex.ID,
			"tier":    "note",
			"scope":   "user",
		})
		if err != nil || code >= 300 {
			log.Printf("upload memory %s: code=%d err=%v", ex.ID, code, err)
		}
	}()
	_ = ctx
}

func uploadMemoryText(name, id, markdown string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		name = id
	}
	prefix := fmt.Sprintf(
		"用户上传过文件「%s」。附件 id：%s。以后任何会话里追问这份文件，调用 read_upload，query 填文件名或附件 id。\n摘录：\n",
		name, id,
	)
	return prefix + clipRunes(strings.TrimSpace(markdown), uploadMemoryRunes)
}

func (s *Server) handleInternalReadUploads(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID       string `json:"user_id"`
		Query        string `json:"query"`
		AttachmentID string `json:"attachment_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	uid := strings.TrimSpace(body.UserID)
	if uid == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "user_id required"})
		return
	}
	rows, err := s.db.SearchAttachmentExtracts(uid, body.Query, body.AttachmentID, 3)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	out := make([]map[string]any, 0, len(rows))
	for _, a := range rows {
		out = append(out, map[string]any{
			"attachment_id":   a.ID,
			"conversation_id": a.ConversationID,
			"name":            a.Name,
			"text":            clipRunes(a.ExtractMD, uploadReadRunes),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"uploads": out})
}
