package httpserver

import (
	"strings"
	"testing"
)

func TestRuntimeDoneFailure(t *testing.T) {
	cases := []struct {
		name    string
		payload map[string]any
		wantErr bool
		substr  string
	}{
		{name: "nil", payload: nil, wantErr: false},
		{name: "ok true", payload: map[string]any{"ok": true}, wantErr: false},
		{name: "ok omitted", payload: map[string]any{"run_id": "x"}, wantErr: false},
		{name: "waiting approval", payload: map[string]any{"ok": false, "waiting_approval": true}, wantErr: false},
		{name: "cancelled", payload: map[string]any{"ok": false, "cancelled": true}, wantErr: false},
		{name: "failed with error", payload: map[string]any{"ok": false, "error": "ReadTimeout"}, wantErr: true, substr: "ReadTimeout"},
		{name: "failed without error", payload: map[string]any{"ok": false}, wantErr: true, substr: "runtime run failed"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := runtimeDoneFailure(c.payload)
			if c.wantErr {
				if err == nil {
					t.Fatalf("expected error")
				}
				if c.substr != "" && !strings.Contains(err.Error(), c.substr) {
					t.Fatalf("err=%q want substr %q", err.Error(), c.substr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected err %v", err)
			}
		})
	}
}

func TestFormatAssistantRunFailure(t *testing.T) {
	got := formatAssistantRunFailure(nil)
	if got != "（失败）运行失败" {
		t.Fatalf("nil: %q", got)
	}
	got = formatAssistantRunFailure(errString("upstream HTTP 500: boom"))
	if got != "（失败）upstream HTTP 500: boom" {
		t.Fatalf("msg: %q", got)
	}
	long := strings.Repeat("x", 400)
	got = formatAssistantRunFailure(errString(long))
	if !strings.HasPrefix(got, "（失败）") || !strings.HasSuffix(got, "…") {
		t.Fatalf("truncate shape: %q", got)
	}
	body := strings.TrimPrefix(got, "（失败）")
	if len([]rune(body)) != 301 { // 300 + ellipsis
		t.Fatalf("truncate len=%d body=%q", len([]rune(body)), body)
	}
}

type errString string

func (e errString) Error() string { return string(e) }
