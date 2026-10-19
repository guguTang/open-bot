package httpserver

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"path"
	"strings"
	"unicode/utf8"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

// PUT /v1/micro-apps/{id}/bundle — multipart field "bundle" (zip) or raw application/zip body.
func (s *Server) handlePutMicroAppBundle(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	app, err := s.db.GetMicroApp(uid, id)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if app.Status == db.MicroAppStatusArchived {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "archived"})
		return
	}

	var zipBytes []byte
	ct := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0]))
	if strings.HasPrefix(ct, "multipart/") {
		if err := r.ParseMultipartForm(microAppMaxBundleBytes + (1 << 20)); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid multipart"})
			return
		}
		file, _, err := r.FormFile("bundle")
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bundle file required"})
			return
		}
		defer file.Close()
		zipBytes, err = readLimited(file, microAppMaxBundleBytes)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
	} else {
		zipBytes, err = readLimited(r.Body, microAppMaxBundleBytes)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
	}
	if len(zipBytes) < 4 || zipBytes[0] != 'P' || zipBytes[1] != 'K' {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bundle must be a zip archive"})
		return
	}

	files, entrypoint, err := unpackMicroAppZip(zipBytes)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if man, ok := files["manifest.json"]; ok {
		if err := validateManifestCapabilities(man, app.Capabilities); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		if ep := entrypointFromManifest(man); ep != "" {
			entrypoint = ep
		}
	}

	store := s.microAppObjects()
	ctx := r.Context()
	prefix := strings.TrimSuffix(db.MicroAppObjectKey(uid, id), "/")
	_ = store.DeletePrefix(ctx, prefix+"/")

	bundleKey := microAppBundleObjectKey(uid, id)
	if err := store.Put(ctx, bundleKey, zipBytes); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "object storage: " + err.Error()})
		return
	}
	for rel, body := range files {
		if err := store.Put(ctx, microAppFileObjectKey(uid, id, rel), body); err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "object storage: " + err.Error()})
			return
		}
	}

	hash := sha256Hex(zipBytes)
	updated, err := s.db.SetMicroAppBundle(uid, id, prefix+"/", hash, entrypoint)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	updated.BundleURL = "/v1/micro-apps/" + updated.ID + "/bundle"
	s.publishMicroAppsChanged(uid, "bundle", updated.ID, map[string]any{"bundle_hash": hash})
	writeJSON(w, http.StatusOK, map[string]any{
		"micro_app":   updated,
		"files":       len(files),
		"entrypoint":  entrypoint,
		"bundle_hash": hash,
	})
}

// GET /v1/micro-apps/{id}/bundle — stream zip from object storage.
func (s *Server) handleGetMicroAppBundle(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	app, err := s.db.GetMicroApp(uid, id)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	body, err := s.microAppObjects().Get(r.Context(), microAppBundleObjectKey(uid, id))
	if err != nil {
		if isNotExist(err) {
			writeJSON(w, http.StatusNotFound, map[string]string{
				"error":      "bundle_not_found",
				"bundle_key": app.BundleKey,
				"message":    "upload a zip via PUT /v1/micro-apps/{id}/bundle first",
			})
			return
		}
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", app.ID+".zip"))
	w.Header().Set("X-Bundle-Hash", app.BundleHash)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

// GET /v1/micro-apps/{id}/runtime — entrypoint + files for sandboxed iframe srcdoc.
func (s *Server) handleGetMicroAppRuntime(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	app, err := s.db.GetMicroApp(uid, id)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	zipBytes, err := s.microAppObjects().Get(r.Context(), microAppBundleObjectKey(uid, id))
	if err != nil {
		if isNotExist(err) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "bundle_not_found"})
			return
		}
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	files, entrypoint, err := unpackMicroAppZip(zipBytes)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if ep := strings.TrimSpace(app.Entrypoint); ep != "" {
		if _, ok := files[ep]; ok {
			entrypoint = ep
		}
	}
	outFiles := map[string]any{}
	for rel, body := range files {
		mt := mime.TypeByExtension(path.Ext(rel))
		if mt == "" {
			mt = "application/octet-stream"
		}
		if isTextyMIME(mt) && utf8.Valid(body) {
			outFiles[rel] = map[string]any{"encoding": "utf8", "mime": mt, "content": string(body)}
			continue
		}
		outFiles[rel] = map[string]any{
			"encoding": "base64",
			"mime":     mt,
			"content":  base64.StdEncoding.EncodeToString(body),
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"micro_app_id": app.ID,
		"title":        app.Title,
		"entrypoint":   entrypoint,
		"capabilities": app.Capabilities,
		"bundle_hash":  app.BundleHash,
		"files":        outFiles,
	})
}

func isTextyMIME(mt string) bool {
	mt = strings.ToLower(mt)
	return strings.HasPrefix(mt, "text/") ||
		strings.Contains(mt, "javascript") ||
		strings.Contains(mt, "json") ||
		strings.Contains(mt, "xml") ||
		strings.Contains(mt, "svg")
}

func unpackMicroAppZip(zipBytes []byte) (map[string][]byte, string, error) {
	zr, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil {
		return nil, "", fmt.Errorf("invalid zip: %w", err)
	}
	if len(zr.File) > microAppMaxFiles {
		return nil, "", fmt.Errorf("too many files (max %d)", microAppMaxFiles)
	}
	out := map[string][]byte{}
	var total int64
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		name := strings.Trim(strings.ReplaceAll(f.Name, "\\", "/"), "/")
		if name == "" || strings.HasPrefix(name, "/") || strings.Contains(name, "..") {
			return nil, "", fmt.Errorf("illegal path in zip: %s", f.Name)
		}
		// Strip single top-level folder if present (foo/index.html → index.html).
		rc, err := f.Open()
		if err != nil {
			return nil, "", err
		}
		body, err := io.ReadAll(io.LimitReader(rc, microAppMaxBundleBytes+1))
		_ = rc.Close()
		if err != nil {
			return nil, "", err
		}
		total += int64(len(body))
		if total > microAppMaxBundleBytes {
			return nil, "", fmt.Errorf("extracted size exceeds limit")
		}
		out[name] = body
	}
	if len(out) == 0 {
		return nil, "", errors.New("empty zip")
	}
	// Flatten if all paths share one top dir.
	out = maybeFlattenZipRoot(out)
	entrypoint := "index.html"
	if _, ok := out["index.html"]; !ok {
		for k := range out {
			if strings.HasSuffix(strings.ToLower(k), ".html") {
				entrypoint = k
				break
			}
		}
	}
	return out, entrypoint, nil
}

func maybeFlattenZipRoot(files map[string][]byte) map[string][]byte {
	var root string
	for k := range files {
		parts := strings.SplitN(k, "/", 2)
		if len(parts) < 2 {
			return files
		}
		if root == "" {
			root = parts[0]
		} else if root != parts[0] {
			return files
		}
	}
	if root == "" {
		return files
	}
	out := map[string][]byte{}
	for k, v := range files {
		out[strings.TrimPrefix(k, root+"/")] = v
	}
	return out
}

func entrypointFromManifest(raw []byte) string {
	var m struct {
		Entry     string `json:"entry"`
		Entrypoint string `json:"entrypoint"`
	}
	if json.Unmarshal(raw, &m) != nil {
		return ""
	}
	if e := strings.TrimSpace(m.Entrypoint); e != "" {
		return e
	}
	return strings.TrimSpace(m.Entry)
}

func validateManifestCapabilities(raw []byte, declared []string) error {
	var m struct {
		Capabilities []string `json:"capabilities"`
	}
	if err := json.Unmarshal(raw, &m); err != nil {
		return fmt.Errorf("manifest.json: %w", err)
	}
	if len(m.Capabilities) == 0 {
		return nil
	}
	allow := map[string]struct{}{}
	for _, c := range declared {
		allow[c] = struct{}{}
	}
	for _, c := range m.Capabilities {
		c = strings.TrimSpace(c)
		if c == "" {
			continue
		}
		if _, ok := allow[c]; !ok {
			return fmt.Errorf("manifest capability %q not declared on micro-app", c)
		}
	}
	return nil
}
