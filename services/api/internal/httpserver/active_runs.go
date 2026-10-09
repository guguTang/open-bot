package httpserver

import (
	"context"
	"sync"
	"time"
)

// How long cancel / register wait for the previous run to finish persisting
// the partial assistant reply (keep-partial-next-turn sequencing).
const cancelFlushWait = 2 * time.Second

// activeRuns tracks in-flight chat runs per conversation so Stop / a new
// send can cooperatively cancel the previous generation (Go → runtime) and
// wait briefly for partial persistence before the next turn loads history.
// Run lifetime is independent of any single HTTP/SSE client connection:
// refresh or client hangup must not cancel; only explicit cancel / replace.
type activeRuns struct {
	mu   sync.Mutex
	byID map[string]*runHandle
}

// sseEvent is one fan-out frame for live subscribers (original POST or resume GET).
type sseEvent struct {
	Event string
	Data  any
}

type runSub struct {
	ch chan sseEvent
}

type runHandle struct {
	cancel context.CancelFunc
	done   chan struct{}

	mu             sync.Mutex
	subs           map[*runSub]struct{}
	partial        string // legacy single-agent catchup text
	partialByAgent map[string]string
	agentNames     map[string]string
	agentID        string
	agentName      string
	closed         bool
}

func newActiveRuns() *activeRuns {
	return &activeRuns{byID: make(map[string]*runHandle)}
}

func newRunHandle(cancel context.CancelFunc) *runHandle {
	return &runHandle{
		cancel: cancel,
		done:   make(chan struct{}),
		subs:   make(map[*runSub]struct{}),
	}
}

// finish signals waiters that this run has completed cleanup/persist,
// closes subscriber channels, and marks the handle closed.
// Safe to call more than once.
func (h *runHandle) finish() {
	if h == nil {
		return
	}
	h.mu.Lock()
	if !h.closed {
		h.closed = true
		for sub := range h.subs {
			close(sub.ch)
		}
		h.subs = nil
	}
	h.mu.Unlock()
	if h.done == nil {
		return
	}
	select {
	case <-h.done:
	default:
		close(h.done)
	}
}

func waitHandleDone(h *runHandle, timeout time.Duration) {
	if h == nil || h.done == nil {
		return
	}
	t := time.NewTimer(timeout)
	defer t.Stop()
	select {
	case <-h.done:
	case <-t.C:
	}
}

// Publish fans an SSE frame out to resume subscribers and updates the
// catch-up snapshot (current agent + partial assistant text).
// Tokens may carry agent_id so parallel group candidates keep separate partials.
func (h *runHandle) Publish(event string, data any) {
	if h == nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return
	}
	switch event {
	case "token":
		if m, ok := data.(map[string]any); ok {
			if t, ok := m["text"].(string); ok {
				aid, _ := m["agent_id"].(string)
				if aid == "" {
					aid = h.agentID
				}
				if aid != "" {
					if h.partialByAgent == nil {
						h.partialByAgent = map[string]string{}
					}
					h.partialByAgent[aid] += t
				}
				h.partial += t
			}
		}
	case "meta":
		if m, ok := data.(map[string]any); ok {
			if phase, _ := m["phase"].(string); phase == "agent_start" {
				id, _ := m["agent_id"].(string)
				name, _ := m["agent_name"].(string)
				if id != "" {
					h.agentID = id
					if h.partialByAgent == nil {
						h.partialByAgent = map[string]string{}
					}
					h.partialByAgent[id] = ""
					if name != "" {
						if h.agentNames == nil {
							h.agentNames = map[string]string{}
						}
						h.agentNames[id] = name
						h.agentName = name
					}
					// Sequential single-active catchup: reset legacy buffer on switch.
					if len(h.partialByAgent) <= 1 {
						h.partial = ""
					}
				} else {
					h.partial = ""
				}
			}
		}
	}
	ev := sseEvent{Event: event, Data: data}
	for sub := range h.subs {
		select {
		case sub.ch <- ev:
		default:
			// Slow subscriber: drop rather than block the run.
		}
	}
}

// Subscribe registers a fan-out listener and returns catch-up frames so a
// reconnecting client can paint the current partial bubble. Returns
// ok=false when the run already finished.
func (h *runHandle) Subscribe() (sub *runSub, catchup []sseEvent, ok bool) {
	if h == nil {
		return nil, nil, false
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return nil, nil, false
	}
	sub = &runSub{ch: make(chan sseEvent, 128)}
	h.subs[sub] = struct{}{}
	catchup = append(catchup, sseEvent{
		Event: "meta",
		Data:  map[string]any{"phase": "resumed", "active": true},
	})
	// Parallel group: emit each in-flight agent partial with agent_id.
	if len(h.partialByAgent) > 1 {
		ids := make([]string, 0, len(h.partialByAgent))
		for id := range h.partialByAgent {
			ids = append(ids, id)
		}
		// Stable order for tests / UI.
		for i := 0; i < len(ids); i++ {
			for j := i + 1; j < len(ids); j++ {
				if ids[j] < ids[i] {
					ids[i], ids[j] = ids[j], ids[i]
				}
			}
		}
		for _, id := range ids {
			name := ""
			if h.agentNames != nil {
				name = h.agentNames[id]
			}
			catchup = append(catchup, sseEvent{
				Event: "meta",
				Data: map[string]any{
					"phase":      "agent_start",
					"agent_id":   id,
					"agent_name": name,
				},
			})
			if text := h.partialByAgent[id]; text != "" {
				catchup = append(catchup, sseEvent{
					Event: "token",
					Data:  map[string]any{"text": text, "agent_id": id},
				})
			}
		}
	} else {
		if h.agentID != "" {
			catchup = append(catchup, sseEvent{
				Event: "meta",
				Data: map[string]any{
					"phase":      "agent_start",
					"agent_id":   h.agentID,
					"agent_name": h.agentName,
				},
			})
		}
		if h.partial != "" {
			data := map[string]any{"text": h.partial}
			if h.agentID != "" {
				data["agent_id"] = h.agentID
			}
			catchup = append(catchup, sseEvent{
				Event: "token",
				Data:  data,
			})
		}
	}
	return sub, catchup, true
}

func (h *runHandle) Unsubscribe(sub *runSub) {
	if h == nil || sub == nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.subs == nil {
		return
	}
	if _, exists := h.subs[sub]; !exists {
		return
	}
	delete(h.subs, sub)
	// Drain is not required; closing only happens in finish().
	// Leave channel open until finish so we don't double-close.
}

// register stores cancel for convID. Any previous run for the same conversation
// is cancelled first and waited on briefly so its partial can flush
// (keep-partial-next-turn).
func (a *activeRuns) register(convID string, h *runHandle) {
	if a == nil || convID == "" || h == nil {
		return
	}
	a.mu.Lock()
	var prev *runHandle
	if p, ok := a.byID[convID]; ok && p != h {
		prev = p
	}
	a.byID[convID] = h
	a.mu.Unlock()
	if prev != nil {
		prev.cancel()
		waitHandleDone(prev, cancelFlushWait)
	}
}

func (a *activeRuns) unregister(convID string, h *runHandle) {
	if a == nil || convID == "" || h == nil {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if cur, ok := a.byID[convID]; ok && cur == h {
		delete(a.byID, convID)
	}
}

func (a *activeRuns) get(convID string) *runHandle {
	if a == nil || convID == "" {
		return nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.byID[convID]
}

func (a *activeRuns) isActive(convID string) bool {
	return a.get(convID) != nil
}

// cancel stops the active run for convID if any, then waits briefly for it to
// finish persisting. Returns true when a run was found.
func (a *activeRuns) cancel(convID string) bool {
	if a == nil || convID == "" {
		return false
	}
	a.mu.Lock()
	h, ok := a.byID[convID]
	if ok {
		delete(a.byID, convID)
	}
	a.mu.Unlock()
	if !ok {
		return false
	}
	h.cancel()
	waitHandleDone(h, cancelFlushWait)
	return true
}
