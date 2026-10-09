package httpserver

import (
	"context"
	"testing"
	"time"
)

func TestActiveRunsCancelAndReplace(t *testing.T) {
	ar := newActiveRuns()
	ctx1, cancel1 := context.WithCancel(context.Background())
	h1 := newRunHandle(cancel1)
	ar.register("c1", h1)
	// Simulate run finishing quickly after cancel signal.
	go func() {
		<-ctx1.Done()
		h1.finish()
	}()

	if !ar.cancel("c1") {
		t.Fatal("expected cancel to find run")
	}
	if ctx1.Err() == nil {
		t.Fatal("expected ctx1 cancelled")
	}
	if ar.cancel("c1") {
		t.Fatal("second cancel should be false")
	}

	ctx2, cancel2 := context.WithCancel(context.Background())
	h2 := newRunHandle(cancel2)
	ar.register("c1", h2)
	go func() {
		<-ctx2.Done()
		h2.finish()
	}()

	ctx3, cancel3 := context.WithCancel(context.Background())
	h3 := newRunHandle(cancel3)
	ar.register("c1", h3) // cancels h2 and waits for finish
	if ctx2.Err() == nil {
		t.Fatal("expected previous run cancelled on register")
	}
	ar.unregister("c1", h3)
	if ar.cancel("c1") {
		t.Fatal("unregistered run should not cancel")
	}
	if ctx3.Err() != nil {
		t.Fatal("unregister must not cancel the handle")
	}
	cancel3()
	h3.finish()
}

func TestActiveRunsCancelWaitsForFinish(t *testing.T) {
	ar := newActiveRuns()
	ctx, cancel := context.WithCancel(context.Background())
	h := newRunHandle(cancel)
	ar.register("c1", h)

	finished := make(chan struct{})
	go func() {
		<-ctx.Done()
		time.Sleep(50 * time.Millisecond)
		h.finish()
		close(finished)
	}()

	start := time.Now()
	if !ar.cancel("c1") {
		t.Fatal("expected cancel")
	}
	elapsed := time.Since(start)
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("finish goroutine stuck")
	}
	if elapsed < 40*time.Millisecond {
		t.Fatalf("cancel returned too early (%v); expected wait for finish", elapsed)
	}
}

func TestActiveRunsCancelTimeout(t *testing.T) {
	ar := newActiveRuns()
	_, cancel := context.WithCancel(context.Background())
	h := newRunHandle(cancel)
	// Never call finish — cancel must time out rather than hang forever.
	ar.register("c1", h)

	// Use a short wait by temporarily relying on cancelFlushWait; assert upper bound.
	start := time.Now()
	ok := ar.cancel("c1")
	elapsed := time.Since(start)
	if !ok {
		t.Fatal("expected cancel")
	}
	if elapsed < cancelFlushWait/2 {
		t.Fatalf("expected cancel to approach flush wait, got %v", elapsed)
	}
	if elapsed > cancelFlushWait+time.Second {
		t.Fatalf("cancel waited too long: %v", elapsed)
	}
}

func TestActiveRunsSubscribeCatchupAndPublish(t *testing.T) {
	ar := newActiveRuns()
	_, cancel := context.WithCancel(context.Background())
	defer cancel()
	h := newRunHandle(cancel)
	ar.register("c1", h)

	h.Publish("meta", map[string]any{
		"phase":      "agent_start",
		"agent_id":   "a1",
		"agent_name": "Bot",
	})
	h.Publish("token", map[string]any{"text": "hello"})
	h.Publish("token", map[string]any{"text": " world"})

	sub, catchup, ok := h.Subscribe()
	if !ok || sub == nil {
		t.Fatal("expected subscribe ok")
	}
	defer h.Unsubscribe(sub)
	if len(catchup) < 3 {
		t.Fatalf("expected catchup frames, got %d", len(catchup))
	}
	foundPartial := false
	for _, ev := range catchup {
		if ev.Event == "token" {
			m := ev.Data.(map[string]any)
			if m["text"] == "hello world" {
				foundPartial = true
			}
		}
	}
	if !foundPartial {
		t.Fatalf("expected catchup partial text, got %#v", catchup)
	}

	h.Publish("token", map[string]any{"text": "!"})
	select {
	case ev := <-sub.ch:
		if ev.Event != "token" {
			t.Fatalf("expected token, got %s", ev.Event)
		}
	case <-time.After(time.Second):
		t.Fatal("expected live publish")
	}

	if !ar.isActive("c1") {
		t.Fatal("expected active")
	}
	h.finish()
	ar.unregister("c1", h)
	if ar.isActive("c1") {
		t.Fatal("expected inactive after unregister")
	}
}

func TestActiveRunsParallelAgentCatchup(t *testing.T) {
	_, cancel := context.WithCancel(context.Background())
	defer cancel()
	h := newRunHandle(cancel)

	h.Publish("meta", map[string]any{"phase": "agent_start", "agent_id": "a2", "agent_name": "Writer"})
	h.Publish("meta", map[string]any{"phase": "agent_start", "agent_id": "a1", "agent_name": "Coder"})
	h.Publish("token", map[string]any{"text": "code", "agent_id": "a1"})
	h.Publish("token", map[string]any{"text": "poem", "agent_id": "a2"})

	_, catchup, ok := h.Subscribe()
	if !ok {
		t.Fatal("subscribe")
	}
	var starts, tokens []string
	for _, ev := range catchup {
		m, _ := ev.Data.(map[string]any)
		if ev.Event == "meta" && m["phase"] == "agent_start" {
			starts = append(starts, m["agent_id"].(string))
		}
		if ev.Event == "token" {
			tokens = append(tokens, m["agent_id"].(string)+":"+m["text"].(string))
		}
	}
	if len(starts) != 2 || starts[0] != "a1" || starts[1] != "a2" {
		t.Fatalf("expected sorted agent_start a1,a2 got %#v", starts)
	}
	if len(tokens) != 2 || tokens[0] != "a1:code" || tokens[1] != "a2:poem" {
		t.Fatalf("expected per-agent tokens, got %#v", tokens)
	}
}
