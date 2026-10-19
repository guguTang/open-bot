package httpserver

import (
	"strings"
	"testing"
)

func TestMicroAppGrantRuntimeNoteAutoRetry(t *testing.T) {
	allowed := `{"req_id":"mag-1","micro_app_id":"app1","capability":"host.shell.run","tool":"host_shell","command":"git status","pending_args":"{\"command\":\"git status\"}","status":"allowed","auto_retry":true}`
	note := microAppGrantRuntimeNote(allowed)
	if note == "" {
		t.Fatal("empty note")
	}
	if !strings.Contains(note, "已允许") {
		t.Fatalf("missing allowed: %s", note)
	}
	if !strings.Contains(note, "立即重试") {
		t.Fatalf("should instruct immediate retry: %s", note)
	}
	if strings.Contains(note, "再说一次") || strings.Contains(note, "不自动重试") {
		t.Fatalf("stale no-retry copy: %s", note)
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
	if !strings.Contains(pnote, "自动重试") {
		t.Fatalf("pending should mention auto-retry: %s", pnote)
	}
}
