package httpserver

import (
	"strings"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

// HITL three-state decisions for POST .../approve (and allowlist matching).
const (
	DecisionAllowOnce   = "allow_once"
	DecisionAlwaysAllow = "always_allow"
	DecisionDeny        = "deny"
)

// ApproveScope identifies which tool family to remember on always_allow.
type ApproveScope struct {
	Tool      string `json:"tool"`
	ToolGroup string `json:"tool_group"`
}

// ResolveApproveDecision maps the extended approve body to a three-state
// decision. Explicit decision wins; otherwise approve bool maps:
//
//	approve:true  → allow_once
//	approve:false → deny
//	approve omitted → allow_once (legacy default)
func ResolveApproveDecision(decision string, approve *bool) (string, error) {
	d := strings.ToLower(strings.TrimSpace(decision))
	switch d {
	case DecisionAllowOnce, DecisionAlwaysAllow, DecisionDeny:
		return d, nil
	case "":
		// fall through to approve bool
	default:
		return "", errInvalidDecision
	}
	if approve != nil && !*approve {
		return DecisionDeny, nil
	}
	return DecisionAllowOnce, nil
}

var errInvalidDecision = errBadRequest("decision must be allow_once, always_allow, or deny")

type errBadRequest string

func (e errBadRequest) Error() string { return string(e) }

// DecisionApproves reports whether the decision resumes the interrupt as allowed.
func DecisionApproves(decision string) bool {
	switch strings.ToLower(strings.TrimSpace(decision)) {
	case DecisionAllowOnce, DecisionAlwaysAllow:
		return true
	default:
		return false
	}
}

// NormalizeToolGroup returns a canonical tool family for allowlist MVP matching.
func NormalizeToolGroup(tool, toolGroup string) string {
	g := strings.ToLower(strings.TrimSpace(toolGroup))
	if g != "" {
		return g
	}
	return InferToolGroup(tool)
}

// InferToolGroup maps a tool / host-op name to an MVP family.
func InferToolGroup(tool string) string {
	t := strings.ToLower(strings.TrimSpace(tool))
	if t == "" {
		return ""
	}
	switch t {
	case "shell", "host_shell", "run_terminal", "sandbox_shell", "ssh_exec", "host_ssh_exec":
		return "shell"
	case "write", "host_write", "ssh_write":
		return "file_write"
	case "delete", "host_delete", "ssh_delete":
		return "file_delete"
	case "move", "host_move", "ssh_move":
		return "file_move"
	case "click", "host_click", "type", "host_type", "key", "host_key",
		"scroll", "host_scroll", "mouse_move", "host_mouse_move", "drag", "host_drag":
		return "computer_use"
	}
	if strings.HasPrefix(t, "git_") || t == "git" {
		return "git"
	}
	if strings.Contains(t, "shell") {
		return "shell"
	}
	return t
}

// HostOpToolIdentity maps a host-exec op to (tool, tool_group) for allowlist.
func HostOpToolIdentity(op string) (tool, toolGroup string) {
	op = strings.ToLower(strings.TrimSpace(op))
	switch op {
	case "shell":
		return "host_shell", "shell"
	case "ssh_exec":
		return "host_ssh_exec", "shell"
	case "write":
		return "host_write", "file_write"
	case "ssh_write":
		return "host_ssh_write", "file_write"
	case "delete":
		return "host_delete", "file_delete"
	case "ssh_delete":
		return "host_ssh_delete", "file_delete"
	case "move":
		return "host_move", "file_move"
	case "ls", "read", "open", "find_app", "screenshot", "list_windows", "ax", "tcc_status":
		return "host_" + op, "host_read"
	case "click", "type", "key", "scroll", "mouse_move", "drag":
		return "host_" + op, "computer_use"
	case "email_send":
		return "gmail_send", "email"
	default:
		if op == "" {
			return "", ""
		}
		return "host_" + op, InferToolGroup(op)
	}
}

// ResolveApproveScope fills missing scope fields from hints / inference.
func ResolveApproveScope(scope ApproveScope, toolHint string) ApproveScope {
	tool := strings.TrimSpace(scope.Tool)
	if tool == "" {
		tool = strings.TrimSpace(toolHint)
	}
	group := NormalizeToolGroup(tool, scope.ToolGroup)
	return ApproveScope{Tool: tool, ToolGroup: group}
}

// applyUserToolAllowlist upgrades confirm → auto when the user previously
// chose Always allow for this tool family — except when:
//  1. base is hard deny (platform Auto-review hard deny wins)
//  2. machine exec_policy == ask (Always allow degrades to allow_once / still confirm)
func applyUserToolAllowlist(
	base hostExecReview,
	entries []db.UserToolAllowlistEntry,
	op string,
	policy string,
	agentID string,
) hostExecReview {
	if base.Tier == hostExecReviewDeny {
		return base
	}
	if base.Tier != hostExecReviewConfirm {
		return base
	}
	// Product: never auto-send email (不擅自代发).
	if strings.EqualFold(strings.TrimSpace(op), "email_send") {
		return base
	}
	policy = db.NormalizeMachineExecPolicy(policy)
	if policy == db.MachineExecAsk {
		// Degrade: do not auto-resume; card still shown each round.
		return base
	}
	tool, group := HostOpToolIdentity(op)
	if !db.MatchUserToolAllowlist(entries, tool, group, agentID) {
		return base
	}
	return hostExecReview{
		Tier:   hostExecReviewAuto,
		Reason: "你已始终允许此类操作",
		Code:   "user_tool_allowlist",
	}
}

// ShouldAutoApproveFromAllowlist is the pure predicate used by tests and
// runtime-stamping docs: allowlist match + not hard-deny + exec_policy != ask.
func ShouldAutoApproveFromAllowlist(
	hardDenied bool,
	execPolicy string,
	entries []db.UserToolAllowlistEntry,
	tool, toolGroup, agentID string,
) bool {
	if hardDenied {
		return false
	}
	if db.NormalizeMachineExecPolicy(execPolicy) == db.MachineExecAsk {
		return false
	}
	group := NormalizeToolGroup(tool, toolGroup)
	return db.MatchUserToolAllowlist(entries, strings.TrimSpace(tool), group, agentID)
}

// ResolveHostConfirmDecision maps host-confirm decide body fields to a three-state
// decision and the gate status (allowed|denied).
//
// Precedence: explicit decision > status > approve bool.
// Legacy status: allowed → allow_once, denied → deny.
func ResolveHostConfirmDecision(status, decision string, approve *bool) (resolvedDecision, resolvedStatus string, err error) {
	status = strings.ToLower(strings.TrimSpace(status))
	decision = strings.TrimSpace(decision)
	if decision != "" {
		d, derr := ResolveApproveDecision(decision, approve)
		if derr != nil {
			return "", "", derr
		}
		return d, statusForDecision(d), nil
	}
	if status == "allowed" || status == "denied" {
		if status == "allowed" {
			return DecisionAllowOnce, "allowed", nil
		}
		return DecisionDeny, "denied", nil
	}
	if approve != nil || decision != "" {
		d, derr := ResolveApproveDecision(decision, approve)
		if derr != nil {
			return "", "", derr
		}
		return d, statusForDecision(d), nil
	}
	return "", "", errBadRequest("status must be allowed or denied, or provide decision/approve")
}

func statusForDecision(decision string) string {
	if DecisionApproves(decision) {
		return "allowed"
	}
	return "denied"
}

// InferScopeFromHostConfirm builds ApproveScope from a stored host_confirm payload.
func InferScopeFromHostConfirm(op string, scope ApproveScope) ApproveScope {
	if strings.TrimSpace(scope.Tool) != "" || strings.TrimSpace(scope.ToolGroup) != "" {
		return ResolveApproveScope(scope, "")
	}
	tool, group := HostOpToolIdentity(op)
	return ApproveScope{Tool: tool, ToolGroup: group}
}
