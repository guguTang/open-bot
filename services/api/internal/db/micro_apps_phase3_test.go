package db

import "testing"

func TestMicroAppShellCommandAllowed(t *testing.T) {
	allow := []string{"git status", "ls", "npm run build"}
	cases := []struct {
		cmd  string
		want bool
	}{
		{"git status", true},
		{"git  status   -s", true},
		{"git statusx", false},
		{"git push", false},
		{"ls -la /tmp", true},
		{"lsof", false},
		{"npm run build", true},
		{"ls; rm -rf ~", false},
		{"ls && whoami", false},
		{"ls | sh", false},
		{"ls $(whoami)", false},
		{"ls `whoami`", false},
		{"ls > /etc/passwd", false},
		{"", false},
	}
	for _, c := range cases {
		if got := MicroAppShellCommandAllowed(allow, c.cmd); got != c.want {
			t.Errorf("%q: got %v want %v", c.cmd, got, c.want)
		}
	}
	if !MicroAppShellCommandAllowed([]string{"*"}, "echo hi") {
		t.Error("* should allow simple command")
	}
	if MicroAppShellCommandAllowed([]string{"*"}, "echo hi; id") {
		t.Error("* must not allow compound command")
	}
	if MicroAppShellCommandAllowed(nil, "echo hi") {
		t.Error("empty list matches nothing (caller treats empty as any)")
	}
}

func TestNormalizeMicroAppShellAllowlist(t *testing.T) {
	got, err := NormalizeMicroAppShellAllowlist([]string{" git  status ", "git status", "", "ls"})
	if err != nil || len(got) != 2 || got[0] != "git status" {
		t.Fatalf("got %v %v", got, err)
	}
	if _, err := NormalizeMicroAppShellAllowlist([]string{"ls; rm"}); err == nil {
		t.Fatal("expected compound entry rejected")
	}
}

func TestValidateMicroAppRoutineConfig(t *testing.T) {
	if err := ValidateMicroAppRoutineConfig(nil); err != nil {
		t.Fatal(err)
	}
	ok := &MicroAppRoutineConfig{Prompt: "summarize inbox", ScheduleCron: "0 9 * * 1-5", Timezone: "Asia/Shanghai"}
	if err := ValidateMicroAppRoutineConfig(ok); err != nil {
		t.Fatal(err)
	}
	bad := []*MicroAppRoutineConfig{
		{ScheduleCron: "0 9 * * *"},
		{Prompt: "x"},
		{Prompt: "x", ScheduleCron: "every day"},
		{Prompt: "x", ScheduleCron: "0 9 * * *", Timezone: "Mars/Base"},
		{Prompt: "x", Triggers: []RoutineTrigger{{Source: "email", Type: "x"}}},
	}
	for i, c := range bad {
		if err := ValidateMicroAppRoutineConfig(c); err == nil {
			t.Errorf("case %d: expected error", i)
		}
	}
	trig := &MicroAppRoutineConfig{Prompt: "x", Triggers: []RoutineTrigger{{Source: "github", Type: "pull_request"}}}
	if err := ValidateMicroAppRoutineConfig(trig); err != nil {
		t.Fatal(err)
	}
}

func TestSyncRoutineOnPinRequiresBinding(t *testing.T) {
	d := &DB{}
	if _, err := d.syncRoutineOnPin("u", &MicroApp{Kind: MicroAppKindRoutine}); err == nil {
		t.Fatal("expected error without routine_id / routine_config")
	}
	if rid, err := d.syncRoutineOnPin("u", &MicroApp{Kind: MicroAppKindUI}); err != nil || rid != "" {
		t.Fatalf("non-routine should no-op: %q %v", rid, err)
	}
}

func TestGrantDecisionAllowAlwaysAlias(t *testing.T) {
	d, err := NormalizeMicroAppGrantDecision("allow_always")
	if err != nil || d != MicroAppGrantAlwaysAllow {
		t.Fatalf("got %q %v", d, err)
	}
}

func TestSyncPinnedRoutineFromConfigNoop(t *testing.T) {
	d := &DB{}
	if err := d.syncPinnedRoutineFromConfig("u", nil, &MicroAppRoutineConfig{Prompt: "x", ScheduleCron: "0 9 * * *", Timezone: "Asia/Shanghai"}); err != nil {
		t.Fatal(err)
	}
	draft := &MicroApp{Kind: MicroAppKindRoutine, Status: MicroAppStatusDraft, RoutineID: "r1"}
	cfg := &MicroAppRoutineConfig{Prompt: "hi", ScheduleCron: "0 9 * * *", Timezone: "Asia/Shanghai"}
	if err := d.syncPinnedRoutineFromConfig("u", draft, cfg); err != nil {
		t.Fatal("draft should skip sync:", err)
	}
	ui := &MicroApp{Kind: MicroAppKindUI, Status: MicroAppStatusPinned, RoutineID: "r1"}
	if err := d.syncPinnedRoutineFromConfig("u", ui, cfg); err != nil {
		t.Fatal("non-routine should skip:", err)
	}
	pinnedNoRID := &MicroApp{Kind: MicroAppKindRoutine, Status: MicroAppStatusPinned}
	if err := d.syncPinnedRoutineFromConfig("u", pinnedNoRID, cfg); err != nil {
		t.Fatal("pinned without routine_id should skip:", err)
	}
}
