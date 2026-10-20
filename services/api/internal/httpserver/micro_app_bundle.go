package httpserver

import (
	"archive/zip"
	"bytes"
	"context"
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

	result, err := s.applyMicroAppBundleZip(r.Context(), uid, app, zipBytes, "")
	if err != nil {
		writeMicroAppBundleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
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

type microAppBundleApplyError struct {
	status int
	msg    string
}

func (e *microAppBundleApplyError) Error() string { return e.msg }

func writeMicroAppBundleError(w http.ResponseWriter, err error) {
	var ae *microAppBundleApplyError
	if errors.As(err, &ae) {
		writeJSON(w, ae.status, map[string]string{"error": ae.msg})
		return
	}
	writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
}

// applyMicroAppBundleZip unpacks, validates manifest ⊆ capabilities, stores zip+files, updates DB.
// preferredEntrypoint overrides when the path exists in the unpacked tree (after flatten).
func (s *Server) applyMicroAppBundleZip(ctx context.Context, uid string, app *db.MicroApp, zipBytes []byte, preferredEntrypoint string) (map[string]any, error) {
	if len(zipBytes) < 4 || zipBytes[0] != 'P' || zipBytes[1] != 'K' {
		return nil, &microAppBundleApplyError{status: http.StatusBadRequest, msg: "bundle must be a zip archive"}
	}
	if int64(len(zipBytes)) > microAppMaxBundleBytes {
		return nil, &microAppBundleApplyError{status: http.StatusBadRequest, msg: fmt.Sprintf("bundle exceeds %d bytes", microAppMaxBundleBytes)}
	}
	files, entrypoint, err := unpackMicroAppZip(zipBytes)
	if err != nil {
		return nil, &microAppBundleApplyError{status: http.StatusBadRequest, msg: err.Error()}
	}
	if man, ok := files["manifest.json"]; ok {
		if err := validateManifestCapabilities(man, app.Capabilities); err != nil {
			return nil, &microAppBundleApplyError{status: http.StatusBadRequest, msg: err.Error()}
		}
		if ep := entrypointFromManifest(man); ep != "" {
			entrypoint = ep
		}
	}
	if ep := strings.TrimSpace(preferredEntrypoint); ep != "" {
		if _, ok := files[ep]; ok {
			entrypoint = ep
		}
	}

	store := s.microAppObjects()
	id := app.ID
	prefix := strings.TrimSuffix(db.MicroAppObjectKey(uid, id), "/")
	_ = store.DeletePrefix(ctx, prefix+"/")

	bundleKey := microAppBundleObjectKey(uid, id)
	if err := store.Put(ctx, bundleKey, zipBytes); err != nil {
		return nil, &microAppBundleApplyError{status: http.StatusBadGateway, msg: "object storage: " + err.Error()}
	}
	for rel, body := range files {
		if err := store.Put(ctx, microAppFileObjectKey(uid, id, rel), body); err != nil {
			return nil, &microAppBundleApplyError{status: http.StatusBadGateway, msg: "object storage: " + err.Error()}
		}
	}

	hash := sha256Hex(zipBytes)
	updated, err := s.db.SetMicroAppBundle(uid, id, prefix+"/", hash, entrypoint)
	if err != nil {
		return nil, &microAppBundleApplyError{status: http.StatusInternalServerError, msg: err.Error()}
	}
	updated.BundleURL = "/v1/micro-apps/" + updated.ID + "/bundle"
	s.publishMicroAppsChanged(uid, "bundle", updated.ID, map[string]any{"bundle_hash": hash})
	return map[string]any{
		"micro_app":   updated,
		"files":       len(files),
		"entrypoint":  entrypoint,
		"bundle_hash": hash,
	}, nil
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

// packMicroAppZip builds a flat zip from relative path → bytes (same validation as unpack).
func packMicroAppZip(files map[string][]byte) ([]byte, error) {
	if len(files) == 0 {
		return nil, errors.New("empty files")
	}
	if len(files) > microAppMaxFiles {
		return nil, fmt.Errorf("too many files (max %d)", microAppMaxFiles)
	}
	var total int64
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, body := range files {
		rel, err := sanitizeMicroAppRelPath(name)
		if err != nil {
			_ = zw.Close()
			return nil, err
		}
		total += int64(len(body))
		if total > microAppMaxBundleBytes {
			_ = zw.Close()
			return nil, fmt.Errorf("extracted size exceeds limit")
		}
		w, err := zw.Create(rel)
		if err != nil {
			_ = zw.Close()
			return nil, err
		}
		if _, err := w.Write(body); err != nil {
			_ = zw.Close()
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	out := buf.Bytes()
	if int64(len(out)) > microAppMaxBundleBytes {
		return nil, fmt.Errorf("bundle exceeds %d bytes", microAppMaxBundleBytes)
	}
	return out, nil
}

func sanitizeMicroAppRelPath(name string) (string, error) {
	rel := strings.Trim(strings.ReplaceAll(name, "\\", "/"), "/")
	if rel == "" || strings.HasPrefix(rel, "/") || strings.Contains(rel, "..") {
		return "", fmt.Errorf("illegal path: %s", name)
	}
	return rel, nil
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
		Entry      string `json:"entry"`
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

// decodeMicroAppFilesMap turns JSON files object into path → bytes.
// Values may be utf-8 strings or {"encoding":"utf8"|"base64","content":"..."}.
func decodeMicroAppFilesMap(raw map[string]json.RawMessage) (map[string][]byte, error) {
	if len(raw) == 0 {
		return nil, errors.New("files required")
	}
	out := map[string][]byte{}
	var total int64
	for name, blob := range raw {
		rel, err := sanitizeMicroAppRelPath(name)
		if err != nil {
			return nil, err
		}
		body, err := decodeMicroAppFileValue(blob)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", rel, err)
		}
		total += int64(len(body))
		if total > microAppMaxBundleBytes {
			return nil, fmt.Errorf("extracted size exceeds limit")
		}
		out[rel] = body
	}
	return out, nil
}

func decodeMicroAppFileValue(blob json.RawMessage) ([]byte, error) {
	blob = bytes.TrimSpace(blob)
	if len(blob) == 0 {
		return nil, errors.New("empty content")
	}
	if blob[0] == '"' {
		var s string
		if err := json.Unmarshal(blob, &s); err != nil {
			return nil, err
		}
		return []byte(s), nil
	}
	var obj struct {
		Encoding string `json:"encoding"`
		Content  string `json:"content"`
	}
	if err := json.Unmarshal(blob, &obj); err != nil {
		return nil, err
	}
	enc := strings.ToLower(strings.TrimSpace(obj.Encoding))
	if enc == "" || enc == "utf8" || enc == "utf-8" {
		return []byte(obj.Content), nil
	}
	if enc == "base64" {
		b, err := base64.StdEncoding.DecodeString(strings.TrimSpace(obj.Content))
		if err != nil {
			// tolerate raw std without padding / URL encoding variants lightly
			b, err = base64.RawStdEncoding.DecodeString(strings.TrimSpace(obj.Content))
			if err != nil {
				return nil, fmt.Errorf("invalid base64: %w", err)
			}
		}
		return b, nil
	}
	return nil, fmt.Errorf("unsupported encoding %q", obj.Encoding)
}
