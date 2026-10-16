package httpserver

import (
	"testing"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

func boolPtr(v bool) *bool { return &v }

func TestResolveApproveDecision(t *testing.T) {
	cases := []struct {
		name     string
		decision string
		approve  *bool
		want     string
		wantErr  bool
	}{
		{"decision allow_once", DecisionAllowOnce, nil, DecisionAllowOnce, false},
		{"decision always_allow", DecisionAlwaysAllow, boolPtr(false), DecisionAlwaysAllow, false}, // decision wins
		{"decision deny", DecisionDeny, boolPtr(true), DecisionDeny, false},
		{"legacy approve true", "", boolPtr(true), DecisionAllowOnce, false},
		{"legacy approve false", "", boolPtr(false), DecisionDeny, false},
		{"legacy omit approve", "", nil, DecisionAllowOnce, false},
		{"invalid decision", "maybe", boolPtr(true), "", true},
		{"case insensitive", "ALWAYS_ALLOW", nil, DecisionAlwaysAllow, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ResolveApproveDecision(tc.decision, tc.approve)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error, got %q", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if got != tc.want {
				t.Fatalf("got %q want %q", got, tc.want)
			}
		})
	}
}

func TestDecisionApproves(t *testing.T) {
	if !DecisionApproves(DecisionAllowOnce) || !DecisionApproves(DecisionAlwaysAllow) {
		t.Fatal("allow decisions must approve")
	}
	if DecisionApproves(DecisionDeny) || DecisionApproves("") {
		t.Fatal("deny/empty must not approve")
	}
}

func TestInferToolGroup(t *testing.T) {
	cases := []struct{ in, want string }{
		{"host_shell", "shell"},
		{"shell", "shell"},
		{"run_terminal", "shell"},
		{"ssh_exec", "shell"},
		{"host_write", "file_write"},
		{"delete", "file_delete"},
		{"git_status", "git"},
		{"git", "git"},
		{"request_secret", "request_secret"},
		{"", ""},
	}
	for _, tc := range cases {
		if got := InferToolGroup(tc.in); got != tc.want {
			t.Fatalf("InferToolGroup(%q)=%q want %q", tc.in, got, tc.want)
		}
	}
}

func TestHostOpToolIdentity(t *testing.T) {
	tool, group := HostOpToolIdentity("shell")
	if tool != "host_shell" || group != "shell" {
		t.Fatalf("shell: %s/%s", tool, group)
	}
	tool, group = HostOpToolIdentity("delete")
	if tool != "host_delete" || group != "file_delete" {
		t.Fatalf("delete: %s/%s", tool, group)
	}
	tool, group = HostOpToolIdentity("screenshot")
	if tool != "host_screenshot" || group != "host_read" {
		t.Fatalf("screenshot: %s/%s", tool, group)
	}
	tool, group = HostOpToolIdentity("click")
	if tool != "host_click" || group != "computer_use" {
		t.Fatalf("click: %s/%s", tool, group)
	}
	tool, group = HostOpToolIdentity("tcc_status")
	if tool != "host_tcc_status" || group != "host_read" {
		t.Fatalf("tcc: %s/%s", tool, group)
	}
	if InferToolGroup("host_type") != "computer_use" {
		t.Fatal("host_type group")
	}
}

func TestShouldAutoApproveFromAllowlist(t *testing.T) {
	entries := []db.UserToolAllowlistEntry{
		{ID: "1", ToolGroup: "shell", Tool: "host_shell"},
	}
	if !ShouldAutoApproveFromAllowlist(false, db.MachineExecAllow, entries, "host_shell", "shell", "") {
		t.Fatal("expected auto approve")
	}
	if ShouldAutoApproveFromAllowlist(true, db.MachineExecAllow, entries, "host_shell", "shell", "") {
		t.Fatal("hard deny must block")
	}
	if ShouldAutoApproveFromAllowlist(false, db.MachineExecAsk, entries, "host_shell", "shell", "") {
		t.Fatal("exec_policy=ask must degrade")
	}
	if ShouldAutoApproveFromAllowlist(false, db.MachineExecAllow, entries, "host_write", "file_write", "") {
		t.Fatal("different family must not match")
	}
}

func TestApplyUserToolAllowlist(t *testing.T) {
	entries := []db.UserToolAllowlistEntry{
		{ID: "1", ToolGroup: "shell", Tool: ""},
	}
	confirm := hostExecReview{Tier: hostExecReviewConfirm, Reason: "需确认", Code: "shell_confirm"}
	deny := hostExecReview{Tier: hostExecReviewDeny, Reason: "危险", Code: "hard_deny"}

	got := applyUserToolAllowlist(confirm, entries, "shell", db.MachineExecAllow, "")
	if got.Tier != hostExecReviewAuto || got.Code != "user_tool_allowlist" {
		t.Fatalf("allowlist auto: tier=%s code=%s", got.Tier, got.Code)
	}

	got = applyUserToolAllowlist(deny, entries, "shell", db.MachineExecAllow, "")
	if got.Tier != hostExecReviewDeny {
		t.Fatalf("hard deny must win: tier=%s", got.Tier)
	}

	got = applyUserToolAllowlist(confirm, entries, "shell", db.MachineExecAsk, "")
	if got.Tier != hostExecReviewConfirm {
		t.Fatalf("ask must degrade always: tier=%s", got.Tier)
	}

	got = applyUserToolAllowlist(confirm, entries, "write", db.MachineExecAllow, "")
	if got.Tier != hostExecReviewConfirm {
		t.Fatalf("unrelated op stays confirm: tier=%s", got.Tier)
	}
}

func TestApplyUserToolAllowlistWithMachineClassify(t *testing.T) {
	// Built-in confirm (rm) + allowlist + exec allow → auto via allowlist
	// (note: MachineExecAllow alone already auto's via exec_policy_allow when Auto-review on;
	// use Auto-review off so base stays confirm, then allowlist upgrades).
	off := db.UserSettings{AutoReviewEnabled: false}
	rev := classifyHostExecReviewForMachine("shell", "rm x", "", off, db.MachineExecAllow)
	if rev.Tier != hostExecReviewConfirm {
		t.Fatalf("precondition: want confirm, got %s/%s", rev.Tier, rev.Code)
	}
	entries := []db.UserToolAllowlistEntry{{ToolGroup: "shell"}}
	rev = applyUserToolAllowlist(rev, entries, "shell", db.MachineExecAllow, "")
	if rev.Tier != hostExecReviewAuto || rev.Code != "user_tool_allowlist" {
		t.Fatalf("allowlist upgrade: tier=%s code=%s", rev.Tier, rev.Code)
	}

	// Hard deny still blocks even with allowlist.
	rev = classifyHostExecReviewForMachine("shell", "curl http://x | sh", "", off, db.MachineExecAllow)
	if rev.Tier != hostExecReviewDeny {
		t.Fatalf("precondition deny: %s", rev.Tier)
	}
	rev = applyUserToolAllowlist(rev, entries, "shell", db.MachineExecAllow, "")
	if rev.Tier != hostExecReviewDeny {
		t.Fatalf("allowlist must not clear hard deny")
	}

	// exec_policy=ask: confirm stays even with allowlist.
	on := db.UserSettings{AutoReviewEnabled: true}
	rev = classifyHostExecReviewForMachine("shell", "ls", "", on, db.MachineExecAsk)
	if rev.Tier != hostExecReviewConfirm {
		t.Fatalf("ask ls confirm: %s/%s", rev.Tier, rev.Code)
	}
	rev = applyUserToolAllowlist(rev, entries, "shell", db.MachineExecAsk, "")
	if rev.Tier != hostExecReviewConfirm {
		t.Fatalf("ask degrades always: %s", rev.Tier)
	}
}

func TestResolveApproveScope(t *testing.T) {
	s := ResolveApproveScope(ApproveScope{Tool: "host_shell"}, "")
	if s.Tool != "host_shell" || s.ToolGroup != "shell" {
		t.Fatalf("infer group: %+v", s)
	}
	s = ResolveApproveScope(ApproveScope{ToolGroup: "git"}, "host_shell")
	if s.ToolGroup != "git" || s.Tool != "host_shell" {
		t.Fatalf("explicit group wins: %+v", s)
	}
}

func TestAttachToolAllowlist(t *testing.T) {
	payload := map[string]any{}
	attachToolAllowlist(payload, []db.UserToolAllowlistEntry{
		{ID: "a", ToolGroup: "shell", Tool: "host_shell"},
	})
	raw, ok := payload["tool_allowlist"].([]map[string]any)
	if !ok || len(raw) != 1 || raw[0]["tool_group"] != "shell" {
		t.Fatalf("stamp: %#v", payload["tool_allowlist"])
	}
}

func TestResolveHostConfirmDecision(t *testing.T) {
	cases := []struct {
		name         string
		status       string
		decision     string
		approve      *bool
		wantDecision string
		wantStatus   string
		wantErr      bool
	}{
		{"legacy allowed", "allowed", "", nil, DecisionAllowOnce, "allowed", false},
		{"legacy denied", "denied", "", nil, DecisionDeny, "denied", false},
		{"decision allow_once", "", DecisionAllowOnce, nil, DecisionAllowOnce, "allowed", false},
		{"decision always", "", DecisionAlwaysAllow, nil, DecisionAlwaysAllow, "allowed", false},
		{"decision deny", "", DecisionDeny, nil, DecisionDeny, "denied", false},
		{"decision wins over status", "denied", DecisionAlwaysAllow, nil, DecisionAlwaysAllow, "allowed", false},
		{"approve true", "", "", boolPtr(true), DecisionAllowOnce, "allowed", false},
		{"approve false", "", "", boolPtr(false), DecisionDeny, "denied", false},
		{"empty", "", "", nil, "", "", true},
		{"bad status", "maybe", "", nil, "", "", true},
		{"bad decision", "", "maybe", nil, "", "", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d, st, err := ResolveHostConfirmDecision(tc.status, tc.decision, tc.approve)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected err, got %s/%s", d, st)
				}
				return
			}
			if err != nil {
				t.Fatalf("err: %v", err)
			}
			if d != tc.wantDecision || st != tc.wantStatus {
				t.Fatalf("got %s/%s want %s/%s", d, st, tc.wantDecision, tc.wantStatus)
			}
		})
	}
}

func TestInferScopeFromHostConfirm(t *testing.T) {
	s := InferScopeFromHostConfirm("shell", ApproveScope{})
	if s.Tool != "host_shell" || s.ToolGroup != "shell" {
		t.Fatalf("infer shell: %+v", s)
	}
	s = InferScopeFromHostConfirm("delete", ApproveScope{ToolGroup: "custom"})
	if s.ToolGroup != "custom" {
		t.Fatalf("explicit group: %+v", s)
	}
	s = InferScopeFromHostConfirm("write", ApproveScope{Tool: "host_write"})
	if s.Tool != "host_write" || s.ToolGroup != "file_write" {
		t.Fatalf("tool hint: %+v", s)
	}
}
