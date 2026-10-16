package httpserver

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/tangxin/open-bot/services/api/internal/db"
)

const maxAttachmentBytes = 20 << 20 // 20 MiB
const maxInlineTextBytes = 40 << 10 // 40 KiB inlined into model prompt

// AttachmentRef is metadata returned by upload and accepted on send.
// URL is the authenticated GET path (relative); client may append ?access_token=.
type AttachmentRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Mime string `json:"mime"`
	Size int64  `json:"size"`
	Path string `json:"path"` // relative to uploadsRoot()
	URL  string `json:"url,omitempty"`
}

func uploadsRoot() string {
	if v := strings.TrimSpace(os.Getenv("OPENBOT_UPLOAD_ROOT")); v != "" {
		return v
	}
	if root := strings.TrimSpace(os.Getenv("OPEN_BOT_ROOT")); root != "" {
		return filepath.Join(root, "data", "uploads")
	}
	here, err := os.Getwd()
	if err == nil {
		dir := here
		for i := 0; i < 8; i++ {
			candidate := filepath.Join(dir, "data")
			if st, err := os.Stat(candidate); err == nil && st.IsDir() {
				abs, _ := filepath.Abs(filepath.Join(candidate, "uploads"))
				return abs
			}
			// Prefer repo root that has go.mod sibling services/api or package.json
			if _, err := os.Stat(filepath.Join(dir, "package.json")); err == nil {
				abs, _ := filepath.Abs(filepath.Join(dir, "data", "uploads"))
				return abs
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	return filepath.Clean(filepath.Join("data", "uploads"))
}

func sanitizeUploadName(name string) string {
	name = filepath.Base(strings.TrimSpace(name))
	name = strings.ReplaceAll(name, "..", "_")
	var b strings.Builder
	for _, r := range name {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') ||
			r == '.' || r == '-' || r == '_' || r == ' ' {
			b.WriteRune(r)
		} else {
			b.WriteByte('_')
		}
	}
	out := strings.TrimSpace(b.String())
	if out == "" || out == "." {
		return "file"
	}
	if len(out) > 120 {
		out = out[:120]
	}
	return out
}

func attachmentAllowed(mimeType, filename string) bool {
	mt := strings.ToLower(strings.TrimSpace(strings.Split(mimeType, ";")[0]))
	ext := strings.ToLower(filepath.Ext(filename))

	allowedExt := map[string]bool{
		".txt": true, ".md": true, ".markdown": true, ".csv": true, ".tsv": true,
		".json": true, ".jsonl": true, ".xml": true, ".yaml": true, ".yml": true,
		".html": true, ".htm": true, ".css": true, ".js": true, ".ts": true,
		".tsx": true, ".jsx": true, ".py": true, ".go": true, ".rs": true,
		".java": true, ".c": true, ".h": true, ".cpp": true, ".hpp": true,
		".rb": true, ".php": true, ".sh": true, ".bash": true, ".zsh": true,
		".sql": true, ".toml": true, ".ini": true, ".cfg": true, ".log": true,
		".pdf": true, ".docx": true, ".xlsx": true, ".xls": true, ".pptx": true,
		".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true,
		".svg": true, ".bmp": true, ".ico": true,
	}
	if allowedExt[ext] {
		return true
	}
	switch {
	case strings.HasPrefix(mt, "text/"):
		return true
	case mt == "application/json", mt == "application/xml", mt == "application/pdf":
		return true
	case officeMIME(mt):
		return true
	case strings.HasPrefix(mt, "image/"):
		return true
	case mt == "application/javascript", mt == "application/typescript":
		return true
	case mt == "application/x-yaml", mt == "text/yaml":
		return true
	default:
		return false
	}
}

func isTextLikeAttachment(mimeType, filename string) bool {
	mt := strings.ToLower(strings.TrimSpace(strings.Split(mimeType, ";")[0]))
	ext := strings.ToLower(filepath.Ext(filename))
	if strings.HasPrefix(mt, "text/") || mt == "application/json" || mt == "application/xml" ||
		mt == "application/javascript" || mt == "application/typescript" ||
		mt == "application/x-yaml" || mt == "text/yaml" {
		return true
	}
	textExt := map[string]bool{
		".txt": true, ".md": true, ".markdown": true, ".csv": true, ".tsv": true,
		".json": true, ".jsonl": true, ".xml": true, ".yaml": true, ".yml": true,
		".html": true, ".htm": true, ".css": true, ".js": true, ".ts": true,
		".tsx": true, ".jsx": true, ".py": true, ".go": true, ".rs": true,
		".java": true, ".c": true, ".h": true, ".cpp": true, ".hpp": true,
		".rb": true, ".php": true, ".sh": true, ".bash": true, ".zsh": true,
		".sql": true, ".toml": true, ".ini": true, ".cfg": true, ".log": true,
	}
	return textExt[ext]
}

func fenceLangFor(filename, mimeType string) string {
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(filename), "."))
	switch ext {
	case "md", "markdown":
		return "markdown"
	case "json", "jsonl":
		return "json"
	case "yml", "yaml":
		return "yaml"
	case "ts", "tsx":
		return "typescript"
	case "js", "jsx":
		return "javascript"
	case "py":
		return "python"
	case "go":
		return "go"
	case "rs":
		return "rust"
	case "sh", "bash", "zsh":
		return "bash"
	case "sql":
		return "sql"
	case "html", "htm":
		return "html"
	case "css":
		return "css"
	case "csv", "tsv", "txt", "log":
		return ""
	}
	mt := strings.ToLower(strings.Split(mimeType, ";")[0])
	if mt == "application/json" {
		return "json"
	}
	return ""
}

func formatSize(n int64) string {
	if n < 1024 {
		return fmt.Sprintf("%d B", n)
	}
	if n < 1024*1024 {
		return fmt.Sprintf("%.1f KB", float64(n)/1024)
	}
	return fmt.Sprintf("%.1f MB", float64(n)/(1024*1024))
}

// saveAttachmentBytes writes file bytes under the conversation upload prefix and
// inserts a message_attachments row (message_id NULL until linked). Shared by
// user multipart upload and the internal present-image path.
func (s *Server) saveAttachmentBytes(uid, convID, name, mimeType string, data []byte) (AttachmentRef, error) {
	uid = strings.TrimSpace(uid)
	convID = strings.TrimSpace(convID)
	if uid == "" || convID == "" {
		return AttachmentRef{}, fmt.Errorf("user_id and conversation_id required")
	}
	if len(data) == 0 {
		return AttachmentRef{}, fmt.Errorf("empty file")
	}
	if int64(len(data)) > maxAttachmentBytes {
		return AttachmentRef{}, fmt.Errorf("file exceeds 20MB limit")
	}
	name = sanitizeUploadName(name)
	mimeType = strings.TrimSpace(mimeType)
	if mimeType == "" {
		mimeType = mime.TypeByExtension(filepath.Ext(name))
	}
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	if !attachmentAllowed(mimeType, name) {
		return AttachmentRef{}, fmt.Errorf("unsupported file type")
	}
	if _, err := s.db.GetConversation(uid, convID); err != nil {
		return AttachmentRef{}, err
	}
	id := uuid.NewString()
	relDir := filepath.Join(db.SanitizeUserSegment(uid), db.SanitizeUserSegment(convID))
	absDir := filepath.Join(uploadsRoot(), relDir)
	if err := os.MkdirAll(absDir, 0o755); err != nil {
		return AttachmentRef{}, err
	}
	storedName := id + "_" + name
	absPath := filepath.Join(absDir, storedName)
	if err := os.WriteFile(absPath, data, 0o644); err != nil {
		return AttachmentRef{}, err
	}
	relPath := filepath.ToSlash(filepath.Join(relDir, storedName))
	row, err := s.db.CreateMessageAttachment(db.MessageAttachment{
		ID:             id,
		ConversationID: convID,
		UserID:         uid,
		Name:           name,
		Mime:           mimeType,
		Size:           int64(len(data)),
		Path:           relPath,
	})
	if err != nil {
		_ = os.Remove(absPath)
		return AttachmentRef{}, err
	}
	return AttachmentRef{
		ID:   row.ID,
		Name: row.Name,
		Mime: row.Mime,
		Size: row.Size,
		Path: row.Path,
		URL:  row.URL,
	}, nil
}

// handleInternalUploadAttachment stores an image (or other allowed file) for a
// conversation so the assistant can embed ![](/v1/conversations/{id}/attachments/{aid}).
// POST /internal/conversations/attachments  JSON:
//
//	user_id, conversation_id, filename?, mime?, content_base64
func (s *Server) handleInternalUploadAttachment(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID         string `json:"user_id"`
		ConversationID string `json:"conversation_id"`
		Filename       string `json:"filename"`
		Mime           string `json:"mime"`
		ContentBase64  string `json:"content_base64"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	uid := strings.TrimSpace(body.UserID)
	cid := strings.TrimSpace(body.ConversationID)
	b64 := strings.ReplaceAll(strings.TrimSpace(body.ContentBase64), "\n", "")
	b64 = strings.ReplaceAll(b64, "\r", "")
	b64 = strings.ReplaceAll(b64, " ", "")
	if uid == "" || cid == "" || b64 == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "user_id, conversation_id, content_base64 required"})
		return
	}
	data, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		// Some callers may send URL-safe base64.
		data, err = base64.RawStdEncoding.DecodeString(b64)
	}
	if err != nil {
		data, err = base64.URLEncoding.DecodeString(b64)
	}
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid content_base64"})
		return
	}
	name := strings.TrimSpace(body.Filename)
	if name == "" {
		name = "image.jpg"
		mt := strings.ToLower(strings.TrimSpace(body.Mime))
		switch {
		case strings.Contains(mt, "png"):
			name = "image.png"
		case strings.Contains(mt, "webp"):
			name = "image.webp"
		case strings.Contains(mt, "gif"):
			name = "image.gif"
		}
	}
	ref, err := s.saveAttachmentBytes(uid, cid, name, body.Mime, data)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "conversation not found"})
			return
		}
		msg := err.Error()
		code := http.StatusBadRequest
		if strings.Contains(msg, "20MB") || strings.Contains(msg, "unsupported") || strings.Contains(msg, "empty") {
			code = http.StatusBadRequest
		} else if !strings.Contains(msg, "required") {
			code = http.StatusInternalServerError
		}
		writeJSON(w, code, map[string]string{"error": msg})
		return
	}
	writeJSON(w, http.StatusCreated, ref)
}

func (s *Server) handleUploadAttachment(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	convID := r.PathValue("id")
	if strings.TrimSpace(convID) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "conversation id required"})
		return
	}
	if _, err := s.db.GetConversation(uid, convID); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "conversation not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	if err := r.ParseMultipartForm(maxAttachmentBytes + (1 << 20)); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid multipart or file too large"})
		return
	}
	file, hdr, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "file field required"})
		return
	}
	defer file.Close()

	if hdr.Size > 0 && hdr.Size > maxAttachmentBytes {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "file exceeds 20MB limit"})
		return
	}

	name := sanitizeUploadName(hdr.Filename)
	mimeType := hdr.Header.Get("Content-Type")
	if mimeType == "" {
		mimeType = mime.TypeByExtension(filepath.Ext(name))
	}
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	if !attachmentAllowed(mimeType, name) {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "unsupported file type (allow images, text, pdf, docx, xlsx, xls, pptx, json, md, csv, code)",
		})
		return
	}

	id := uuid.NewString()
	relDir := filepath.Join(db.SanitizeUserSegment(uid), db.SanitizeUserSegment(convID))
	absDir := filepath.Join(uploadsRoot(), relDir)
	if err := os.MkdirAll(absDir, 0o755); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	storedName := id + "_" + name
	absPath := filepath.Join(absDir, storedName)
	out, err := os.Create(absPath)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	written, err := io.Copy(out, io.LimitReader(file, maxAttachmentBytes+1))
	_ = out.Close()
	if err != nil {
		_ = os.Remove(absPath)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if written > maxAttachmentBytes {
		_ = os.Remove(absPath)
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "file exceeds 20MB limit"})
		return
	}

	relPath := filepath.ToSlash(filepath.Join(relDir, storedName))
	row, err := s.db.CreateMessageAttachment(db.MessageAttachment{
		ID:             id,
		ConversationID: convID,
		UserID:         uid,
		Name:           name,
		Mime:           mimeType,
		Size:           written,
		Path:           relPath,
	})
	if err != nil {
		_ = os.Remove(absPath)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, AttachmentRef{
		ID:   row.ID,
		Name: row.Name,
		Mime: row.Mime,
		Size: row.Size,
		Path: row.Path,
		URL:  row.URL,
	})
}

func (s *Server) handleGetAttachment(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	convID := r.PathValue("id")
	attID := r.PathValue("attachmentId")
	if strings.TrimSpace(convID) == "" || strings.TrimSpace(attID) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "conversation id and attachment id required"})
		return
	}
	if _, err := s.db.GetConversation(uid, convID); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "conversation not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	att, err := s.db.GetMessageAttachment(uid, convID, attID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "attachment not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	abs, err := resolveAttachmentPath(uid, convID, AttachmentRef{
		ID:   att.ID,
		Name: att.Name,
		Mime: att.Mime,
		Size: att.Size,
		Path: att.Path,
	})
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "attachment file missing"})
		return
	}
	f, err := os.Open(abs)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "attachment file missing"})
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	ctype := att.Mime
	if ctype == "" {
		ctype = mime.TypeByExtension(filepath.Ext(att.Name))
	}
	if ctype == "" {
		ctype = "application/octet-stream"
	}
	w.Header().Set("Content-Type", ctype)
	// Images: inline so <img> / diagram-card can display; others: download.
	disp := "attachment"
	if strings.HasPrefix(strings.ToLower(ctype), "image/") {
		disp = "inline"
	}
	w.Header().Set("Content-Disposition", fmt.Sprintf(`%s; filename="%s"`, disp, strings.ReplaceAll(att.Name, `"`, `_`)))
	w.Header().Set("Cache-Control", "private, max-age=3600")
	http.ServeContent(w, r, att.Name, st.ModTime(), f)
}

func resolveAttachmentPath(uid, convID string, ref AttachmentRef) (string, error) {
	root, err := filepath.Abs(uploadsRoot())
	if err != nil {
		return "", err
	}
	rel := filepath.Clean(filepath.FromSlash(ref.Path))
	if rel == "." || strings.HasPrefix(rel, "..") {
		return "", fmt.Errorf("invalid attachment path")
	}
	abs := filepath.Join(root, rel)
	abs, err = filepath.Abs(abs)
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(abs, root+string(os.PathSeparator)) && abs != root {
		return "", fmt.Errorf("attachment path escapes uploads root")
	}
	wantPrefix := filepath.Join(root, db.SanitizeUserSegment(uid), db.SanitizeUserSegment(convID))
	if !strings.HasPrefix(abs, wantPrefix+string(os.PathSeparator)) {
		return "", fmt.Errorf("attachment does not belong to this conversation")
	}
	if ref.ID != "" && !strings.Contains(filepath.Base(abs), ref.ID) {
		return "", fmt.Errorf("attachment id mismatch")
	}
	st, err := os.Stat(abs)
	if err != nil || st.IsDir() {
		return "", fmt.Errorf("attachment file missing")
	}
	return abs, nil
}

func buildUserContentWithAttachments(ctx context.Context, text string, uid, convID string, refs []AttachmentRef, parseTimeout time.Duration) (string, []attachmentExtract, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	text = strings.TrimSpace(text)
	if len(refs) == 0 {
		return text, nil, nil
	}
	var b strings.Builder
	var extracts []attachmentExtract
	if text != "" {
		b.WriteString(text)
		b.WriteString("\n\n")
	}
	b.WriteString(fmt.Sprintf("（用户上传了 %d 个附件）\n", len(refs)))
	for _, ref := range refs {
		abs, err := resolveAttachmentPath(uid, convID, ref)
		if err != nil {
			return "", nil, err
		}
		name := ref.Name
		if name == "" {
			name = filepath.Base(abs)
		}
		mimeType := ref.Mime
		size := ref.Size
		if size <= 0 {
			if st, err := os.Stat(abs); err == nil {
				size = st.Size()
			}
		}
		b.WriteString(fmt.Sprintf("- %s (%s, %s)\n", name, mimeType, formatSize(size)))

		var markdown string
		if isOfficeAttachment(mimeType, name) {
			markdown = appendOfficeDocument(ctx, &b, abs, name, mimeType, parseTimeout)
		} else if strings.HasPrefix(strings.ToLower(mimeType), "image/") {
			b.WriteString("  （图片已存储；一期未传视觉多模态，仅文本提及）\n")
		} else if !isTextLikeAttachment(mimeType, name) {
			// binary without a text extract
		} else {
			raw, err := os.ReadFile(abs)
			if err != nil {
				b.WriteString("  （无法读取文件内容）\n")
			} else {
				truncated := false
				if len(raw) > maxInlineTextBytes {
					raw = raw[:maxInlineTextBytes]
					truncated = true
				}
				body := string(raw)
				if !utf8.ValidString(body) {
					body = strings.ToValidUTF8(body, "�")
				}
				markdown = body
				lang := fenceLangFor(name, mimeType)
				b.WriteString("```")
				b.WriteString(lang)
				b.WriteByte('\n')
				b.WriteString(body)
				if !strings.HasSuffix(body, "\n") {
					b.WriteByte('\n')
				}
				b.WriteString("```\n")
				if truncated {
					b.WriteString("  （内容已截断）\n")
				}
			}
		}
		if strings.TrimSpace(markdown) != "" && strings.TrimSpace(ref.ID) != "" {
			extracts = append(extracts, attachmentExtract{ID: ref.ID, Name: name, Markdown: markdown})
		}
	}
	return strings.TrimRight(b.String(), "\n"), extracts, nil
}

type attachmentExtract struct {
	ID       string
	Name     string
	Markdown string
}

// ensureAttachmentRows upserts DB rows for refs that exist on disk but were uploaded
// before message_attachments existed (or if CreateMessageAttachment failed silently).
func (s *Server) ensureAttachmentRows(uid, convID string, refs []AttachmentRef) error {
	for _, ref := range refs {
		id := strings.TrimSpace(ref.ID)
		if id == "" {
			continue
		}
		if _, err := s.db.GetMessageAttachment(uid, convID, id); err == nil {
			continue
		} else if !errors.Is(err, db.ErrNotFound) {
			return err
		}
		abs, err := resolveAttachmentPath(uid, convID, ref)
		if err != nil {
			return err
		}
		name := ref.Name
		if name == "" {
			name = filepath.Base(abs)
		}
		mimeType := ref.Mime
		if mimeType == "" {
			mimeType = mime.TypeByExtension(filepath.Ext(name))
		}
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}
		size := ref.Size
		if size <= 0 {
			if st, serr := os.Stat(abs); serr == nil {
				size = st.Size()
			}
		}
		rel := ref.Path
		if rel == "" {
			root, _ := filepath.Abs(uploadsRoot())
			rel, _ = filepath.Rel(root, abs)
			rel = filepath.ToSlash(rel)
		}
		if _, err := s.db.CreateMessageAttachment(db.MessageAttachment{
			ID:             id,
			ConversationID: convID,
			UserID:         uid,
			Name:           name,
			Mime:           mimeType,
			Size:           size,
			Path:           rel,
		}); err != nil {
			return err
		}
	}
	return nil
}
