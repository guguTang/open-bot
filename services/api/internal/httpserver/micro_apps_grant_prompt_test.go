package httpserver

import (
	"strings"
	"testing"
)

func TestMicroAppGrantRuntimeNoteParkResume(t *testing.T) {
	allowed := `{"req_id":"mag-1","micro_app_id":"app1","capability":"host.shell.run","tool":"host_shell","command":"git status","pending_args":"{\"command\":\"git status\"}","status":"allowed","park_resolved":true}`
	note := microAppGrantRuntimeNote(allowed)
	if note == "" {
		t.Fatal("empty note")
	}
	if !strings.Contains(note, "已允许") {
		t.Fatalf("missing allowed: %s", note)
	}
	if !strings.Contains(note, "同一工具调用") && !strings.Contains(note, "park/resume") {
		t.Fatalf("should describe same-call resume: %s", note)
	}
	if strings.Contains(note, "客户端会自动续跑") {
		t.Fatalf("stale new-turn copy: %s", note)
	}
	if !strings.Contains(note, "host_shell") {
		t.Fatalf("missing tool: %s", note)
	}

	denied := `{"req_id":"mag-2","micro_app_id":"app1","capability":"host.shell.run","tool":"host_shell","status":"denied"}`
	dnote := microAppGrantRuntimeNote(denied)
	if !strings.Contains(dnote, "已拒绝") || !strings.Contains(dnote, "勿重试") {
		t.Fatalf("deny note: %s", dnote)
	}

	pending := `{"req_id":"mag-3","micro_app_id":"app1","capability":"host.fs.read","tool":"host_read","status":"pending"}`
	pnote := microAppGrantRuntimeNote(pending)
	if !strings.Contains(pnote, "同一工具调用将继续") {
		t.Fatalf("pending should mention same-call continue: %s", pnote)
	}
}
