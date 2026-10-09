package httpserver

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

func TestHostSSHOps(t *testing.T) {
	if !supportedHostOp("ssh_exec") || supportedHostOp("ssh") {
		t.Fatal("ssh ops")
	}
	if !hostOpNeedsConfirm("ssh_write") || hostOpNeedsConfirm("ssh_ls") {
		t.Fatal("ssh confirm")
	}
	label := hostActivityLabel("Mac", "ssh_exec", "ls", "")
	if label == "" || len(label) < 8 {
		t.Fatal(label)
	}
}

func TestHostConfirmStatus(t *testing.T) {
	if hostConfirmStatus(map[string]any{"denied": true, "ok": false}) != "denied" {
		t.Fatal("denied")
	}
	if hostConfirmStatus(map[string]any{"ok": true}) != "allowed" {
		t.Fatal("ok")
	}
	if hostConfirmStatus(map[string]any{"ok": false, "confirmed": true}) != "allowed" {
		t.Fatal("confirmed failure still counts as allowed")
	}
	if hostConfirmStatus(map[string]any{"ok": false}) != "denied" {
		t.Fatal("timeout")
	}
}

func TestHostConfirmGateResolve(t *testing.T) {
	g := newHostConfirmGate()
	ch := g.register("c1", "r1")
	go func() { g.resolve("c1", "r1", true) }()
	select {
	case ok := <-ch:
		if !ok {
			t.Fatal("expected allowed")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout")
	}
}

func TestHostConfirmGateMultiWaiter(t *testing.T) {
	g := newHostConfirmGate()
	ch1 := g.register("c1", "r1")
	ch2 := g.register("c1", "r1")
	go func() { g.resolve("c1", "r1", true) }()
	for i, ch := range []<-chan bool{ch1, ch2} {
		select {
		case ok := <-ch:
			if !ok {
				t.Fatalf("waiter %d denied", i)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("waiter %d timeout", i)
		}
	}
}

func TestMergeHostPaths(t *testing.T) {
	got := mergeHostPaths("~/a.txt", "~/b.txt\n~/a.txt")
	if got != "~/a.txt\n~/b.txt" {
		t.Fatal(got)
	}
	if !isDeleteConfirmOp("delete") || isDeleteConfirmOp("write") {
		t.Fatal("delete op check")
	}
}

func TestHistoryForRuntimeIncludesHostConfirm(t *testing.T) {
	msgs := []db.Message{
		{Role: "user", Content: "删了"},
		{Role: "host_confirm", Content: `{"req_id":"1","op":"delete","path":"~/Downloads/a.mp4","status":"denied"}`},
		{Role: "assistant", Content: "被拒绝了"},
		{Role: "user", Content: "再试一次"},
	}
	out := historyForRuntime(msgs, "", nil)
	if len(out) != 4 {
		t.Fatalf("len=%d %#v", len(out), out)
	}
	if out[1].Role != "system" || !strings.Contains(out[1].Content, "已拒绝") {
		t.Fatalf("missing confirm note: %#v", out[1])
	}
	if !strings.Contains(out[1].Content, "host_delete") {
		t.Fatalf("note should remind retry tool: %#v", out[1])
	}
}

func TestHostCallNotConnected(t *testing.T) {
	h := newHostHub()
	_, err := h.Call(context.Background(), "user", "machine", hostExecRequest{Op: "ls", Path: "Downloads"})
	if !errors.Is(err, errHostNotConnected) {
		t.Fatalf("expected not connected, got %v", err)
	}
}

func TestHostCallDeliversResult(t *testing.T) {
	h := newHostHub()
	sess := &hostSession{
		userID:    "user",
		machineID: "machine",
		send:      make(chan []byte, 1),
		pending:   map[string]chan map[string]any{},
	}
	h.sessions[hostKey("user", "machine")] = sess
	go func() {
		raw := <-sess.send
		if len(raw) == 0 {
			t.Errorf("empty request")
		}
		sess.mu.Lock()
		var reqID string
		for id := range sess.pending {
			reqID = id
		}
		sess.mu.Unlock()
		h.deliver(sess, reqID, map[string]any{"ok": true, "entries": []any{"a.txt"}})
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	got, err := h.Call(ctx, "user", "machine", hostExecRequest{Op: "ls", Path: "Downloads"})
	if err != nil {
		t.Fatal(err)
	}
	if ok, _ := got["ok"].(bool); !ok {
		t.Fatalf("result %+v", got)
	}
}

func TestHostExecTimeoutExceedsDesktopShell(t *testing.T) {
	const desktopShell = 120 * time.Second
	if hostExecTimeout <= desktopShell {
		t.Fatalf("hostExecTimeout=%s must exceed desktop host_shell %s", hostExecTimeout, desktopShell)
	}
	if hostConfirmTimeout != 90*time.Second {
		t.Fatalf("confirm wait changed: %s", hostConfirmTimeout)
	}
}
