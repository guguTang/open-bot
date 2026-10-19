package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

// Phase 6 model-side dual gate: Bot tool policy ∩ MicroApp Grant.
// Maps runtime host_* tool names → MicroApp.capabilities, then evaluates Grant.

// tool → micro-app capability (empty = unmapped; blocked in micro-app context).
var microAppToolCapability = map[string]string{
	"host_shell":      db.MicroAppShellCapability,
	"host_screenshot": "host.screenshot",
	"host_find_app":   "host.app.find",
	"host_open":       "host.app.open",
	"host_ls":         "host.fs.read",
	"host_read":       "host.fs.read",
	"host_write":      "host.fs.write",
	"host_delete":     "host.fs.write",
	"host_move":       "host.fs.write",
}

// Alternates accepted as declaration for FS tools (workspace covers bot /workspace).
var microAppCapabilityAlternates = map[string][]string{
	"host.fs.read":  {"host.fs.workspace"},
	"host.fs.write": {"host.fs.workspace"},
}

func microAppCapabilityDeclared(app *db.MicroApp, capability string) bool {
	if microAppHasCapability(app, capability) {
		return true
	}
	for _, alt := range microAppCapabilityAlternates[capability] {
		if microAppHasCapability(app, alt) {
			return true
		}
	}
	return false
}

// POST /internal/micro-apps/tool-gate — runtime dual-gate check (X-Internal-Token).
// Body: user_id, micro_app_id, tool, machine_id?, command?, host_tools?
// When tool is empty: returns context only (capabilities) for offer-time filtering.
func (s *Server) handleInternalMicroAppToolGate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID     string `json:"user_id"`
		MicroAppID string `json:"micro_app_id"`
		Tool       string `json:"tool"`
		MachineID  string `json:"machine_id"`
		Command    string `json:"command"`
		HostTools  *bool  `json:"host_tools"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	uid := strings.TrimSpace(body.UserID)
	appID := strings.TrimSpace(body.MicroAppID)
	if uid == "" || appID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "user_id and micro_app_id required"})
		return
	}
	app, err := s.db.GetMicroApp(uid, appID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found", "error_code": "micro_app_not_found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	caps := app.Capabilities
	if caps == nil {
		caps = []string{}
	}
	out := map[string]any{
		"micro_app_id": app.ID,
		"agent_id":     app.AgentID,
		"status":       app.Status,
		"capabilities": caps,
	}
	tool := strings.TrimSpace(body.Tool)
	if tool == "" {
		out["allowed"] = true
		writeJSON(w, http.StatusOK, out)
		return
	}
	out["tool"] = tool

	// Gate A — Bot tool policy: host_* requires client host_tools when provided.
	if strings.HasPrefix(tool, "host_") && body.HostTools != nil && !*body.HostTools {
		out["allowed"] = false
		out["error_code"] = "host_required"
		out["error"] = "host_required: client has no host_tools"
		writeJSON(w, http.StatusOK, out)
		return
	}

	capability, mapped := microAppToolCapability[tool]
	if !mapped {
		// Unmapped host / CU / ssh tools: not declarable via current catalog → block.
		out["allowed"] = false
		out["error_code"] = "capability_not_declared"
		out["error"] = "capability_not_declared: tool_unmapped:" + tool
		writeJSON(w, http.StatusOK, out)
		return
	}
	out["capability"] = capability
	_, highSens := db.MicroAppHighSensitivityCapabilities[capability]
	out["high_sensitivity"] = highSens
	out["suggested_decision"] = db.DefaultGrantDecisionForCapability(capability)

	if !microAppCapabilityDeclared(app, capability) {
		out["allowed"] = false
		out["error_code"] = "capability_not_declared"
		out["error"] = "capability_not_declared: " + capability
		writeJSON(w, http.StatusOK, out)
		return
	}

	// Gate B — MicroApp Grant (entry × device).
	decision, grant, err := s.db.EvaluateMicroAppGrant(uid, appID, capability, body.MachineID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if grant != nil {
		out["grant_id"] = grant.ID
		out["grant_decision"] = grant.Decision
	}
	if decision == db.MicroAppGrantDeny {
		out["allowed"] = false
		out["error_code"] = "grant_denied"
		out["error"] = "grant_denied"
		out["decision"] = decision
		writeJSON(w, http.StatusOK, out)
		return
	}
	if decision == "" {
		// Model path does not prompt; user grants via MicroApp Shell / Grant panel.
		out["allowed"] = false
		out["error_code"] = "grant_required"
		out["error"] = "grant_required"
		out["needs_prompt"] = true
		out["decision"] = ""
		writeJSON(w, http.StatusOK, out)
		return
	}

	// host.shell.run: honour command allowlist (same as grant-check RPC).
	if capability == db.MicroAppShellCapability && grant != nil {
		out["command_allowlist"] = grant.CommandAllowlist
		cmd := strings.TrimSpace(body.Command)
		if cmd != "" {
			allowed := db.MicroAppShellCommandAllowed(grant.CommandAllowlist, cmd)
			out["command_allowlisted"] = allowed
			if decision == db.MicroAppGrantAlwaysAllow && len(grant.CommandAllowlist) > 0 && !allowed {
				out["allowed"] = false
				out["error_code"] = "grant_required"
				out["error"] = "command_not_in_allowlist"
				out["reason"] = "command_not_in_allowlist"
				out["needs_prompt"] = true
				out["decision"] = ""
				writeJSON(w, http.StatusOK, out)
				return
			}
		}
	}

	out["allowed"] = true
	out["decision"] = decision
	writeJSON(w, http.StatusOK, out)
}

// POST /internal/micro-apps/grant-consume — consume allow_once after successful model-side tool.
func (s *Server) handleInternalMicroAppGrantConsume(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID  string `json:"user_id"`
		GrantID string `json:"grant_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	uid := strings.TrimSpace(body.UserID)
	gid := strings.TrimSpace(body.GrantID)
	if uid == "" || gid == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "user_id and grant_id required"})
		return
	}
	if err := s.db.ConsumeAllowOnceGrant(uid, gid); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
