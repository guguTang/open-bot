package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

// POST /v1/micro-apps/{id}/rpc/cloud.http — narrow server-side HTTP proxy (SSRF-safe).
// Body: { "url": "https://...", "method": "GET", "headers": {}, "body": "" }
// Requires capability declared + Grant (caller must pass grant check client-side;
// server re-checks declaration and optional grant_decision echo).
func (s *Server) handleMicroAppCloudHTTP(w http.ResponseWriter, r *http.Request) {
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
	if !microAppHasCapability(app, "cloud.http") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "capability_not_declared"})
		return
	}
	var body struct {
		URL       string            `json:"url"`
		Method    string            `json:"method"`
		Headers   map[string]string `json:"headers"`
		Body      string            `json:"body"`
		MachineID string            `json:"machine_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if err := s.requireMicroAppGrantOrDeny(uid, id, "cloud.http", body.MachineID); err != nil {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": err.Error()})
		return
	}
	rawURL := strings.TrimSpace(body.URL)
	if rawURL == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "url required"})
		return
	}
	if err := validateMicroAppHTTPURL(rawURL); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	method := strings.ToUpper(strings.TrimSpace(body.Method))
	if method == "" {
		method = http.MethodGet
	}
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodPost:
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "method not allowed"})
		return
	}
	var reqBody io.Reader
	if body.Body != "" && method == http.MethodPost {
		reqBody = strings.NewReader(body.Body)
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, rawURL, reqBody)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	req.Header.Set("User-Agent", "open-bot-micro-app/1.0")
	for k, v := range body.Headers {
		lk := strings.ToLower(k)
		if lk == "host" || lk == "authorization" || lk == "cookie" {
			continue
		}
		req.Header.Set(k, v)
	}
	client := &http.Client{
		Timeout: 15 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return fmt.Errorf("too many redirects")
			}
			return validateMicroAppHTTPURL(req.URL.String())
		},
	}
	resp, err := client.Do(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 512<<10))
	writeJSON(w, http.StatusOK, map[string]any{
		"status":  resp.StatusCode,
		"headers": filterResponseHeaders(resp.Header),
		"body":    string(respBody),
	})
}

// POST /v1/micro-apps/{id}/rpc/grant-check — evaluate grant state for a capability.
func (s *Server) handleMicroAppGrantCheck(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	var body struct {
		Capability string `json:"capability"`
		MachineID  string `json:"machine_id"`
		// Command (host.shell.run): evaluated against the grant's command_allowlist.
		Command string `json:"command"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	app, err := s.db.GetMicroApp(uid, id)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	capName := strings.TrimSpace(body.Capability)
	if !microAppHasCapability(app, capName) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "capability_not_declared"})
		return
	}
	decision, grant, err := s.db.EvaluateMicroAppGrant(uid, id, capName, body.MachineID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	suggested := db.DefaultGrantDecisionForCapability(capName)
	_, highSens := db.MicroAppHighSensitivityCapabilities[capName]
	out := map[string]any{
		"capability":         capName,
		"suggested_decision": suggested,
		"high_sensitivity":   highSens,
	}
	if grant != nil {
		out["grant_id"] = grant.ID
		out["grant_decision"] = grant.Decision
	}
	// Phase 3: host.shell.run + always_allow honours the per-grant command allowlist.
	// Non-matching (or compound) commands fall back to a prompt; deny stays deny.
	if capName == db.MicroAppShellCapability && grant != nil {
		out["command_allowlist"] = grant.CommandAllowlist
		if cmd := strings.TrimSpace(body.Command); cmd != "" {
			allowed := db.MicroAppShellCommandAllowed(grant.CommandAllowlist, cmd)
			out["command_allowlisted"] = allowed
			if decision == db.MicroAppGrantAlwaysAllow && len(grant.CommandAllowlist) > 0 && !allowed {
				decision = ""
				out["reason"] = "command_not_in_allowlist"
			}
		}
	}
	out["decision"] = decision // empty → client should prompt
	out["needs_prompt"] = decision == ""
	writeJSON(w, http.StatusOK, out)
}

// POST /v1/micro-apps/{id}/rpc/grant-consume — consume allow_once after success.
func (s *Server) handleMicroAppGrantConsume(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	var body struct {
		GrantID string `json:"grant_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if _, err := s.db.GetMicroApp(uid, id); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err := s.db.ConsumeAllowOnceGrant(uid, strings.TrimSpace(body.GrantID)); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func microAppHasCapability(app *db.MicroApp, capability string) bool {
	capability = strings.TrimSpace(capability)
	for _, c := range app.Capabilities {
		if c == capability {
			return true
		}
	}
	return false
}

func (s *Server) requireMicroAppGrantOrDeny(userID, appID, capability, machineID string) error {
	decision, grant, err := s.db.EvaluateMicroAppGrant(userID, appID, capability, machineID)
	if err != nil {
		return err
	}
	if decision == "" {
		return errors.New("grant_required")
	}
	if decision == db.MicroAppGrantDeny {
		return errors.New("grant_denied")
	}
	if decision == db.MicroAppGrantAllowOnce && grant != nil {
		_ = s.db.ConsumeAllowOnceGrant(userID, grant.ID)
	}
	return nil
}

func validateMicroAppHTTPURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return errors.New("invalid url")
	}
	if u.Scheme != "https" && u.Scheme != "http" {
		return errors.New("only http/https allowed")
	}
	// Prefer https; allow http only for allowlisted hosts in dev.
	host := strings.ToLower(u.Hostname())
	if host == "" {
		return errors.New("invalid host")
	}
	if allow := microAppHTTPAllowlist(); len(allow) > 0 {
		ok := false
		for _, h := range allow {
			if host == h || strings.HasSuffix(host, "."+h) {
				ok = true
				break
			}
		}
		if !ok {
			return fmt.Errorf("host not in allowlist: %s", host)
		}
	} else if u.Scheme != "https" {
		return errors.New("https required when allowlist empty")
	}
	ips, err := net.LookupIP(host)
	if err != nil {
		// DNS failure — reject rather than open SSRF via redirects to weird hosts.
		return fmt.Errorf("dns lookup failed: %w", err)
	}
	for _, ip := range ips {
		if isBlockedMicroAppIP(ip) {
			return errors.New("private or reserved address blocked")
		}
	}
	return nil
}

func microAppHTTPAllowlist() []string {
	raw := strings.TrimSpace(os.Getenv("MICRO_APP_HTTP_ALLOWLIST"))
	if raw == "" {
		return nil
	}
	var out []string
	for _, p := range strings.Split(raw, ",") {
		p = strings.ToLower(strings.TrimSpace(p))
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func isBlockedMicroAppIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return true
	}
	// Cloud metadata
	if ip4 := ip.To4(); ip4 != nil {
		if ip4[0] == 169 && ip4[1] == 254 {
			return true
		}
	}
	return false
}

func filterResponseHeaders(h http.Header) map[string]string {
	out := map[string]string{}
	for _, k := range []string{"Content-Type", "Cache-Control", "X-Request-Id"} {
		if v := h.Get(k); v != "" {
			out[k] = v
		}
	}
	return out
}
