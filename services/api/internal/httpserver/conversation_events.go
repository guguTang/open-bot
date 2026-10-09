package httpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// newSSEEmitter writes SSE to the initiating client when still connected and
// always fans out to runHandle subscribers (for refresh / reconnect).
// Client disconnect never cancels the run — only handle.cancel does.
// Writes are serialized with writeMu so parallel group candidates can emit safely.
func newSSEEmitter(w http.ResponseWriter, flusher http.Flusher, clientCtx context.Context, handle *runHandle) func(event string, data any) {
	var clientGone atomic.Bool
	var writeMu sync.Mutex
	go func() {
		<-clientCtx.Done()
		clientGone.Store(true)
	}()
	return func(event string, data any) {
		if handle != nil {
			handle.Publish(event, data)
		}
		writeMu.Lock()
		defer writeMu.Unlock()
		if clientGone.Load() || w == nil || flusher == nil {
			return
		}
		if clientCtx.Err() != nil {
			clientGone.Store(true)
			return
		}
		if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, mustJSON(data)); err != nil {
			clientGone.Store(true)
			return
		}
		flusher.Flush()
	}
}

func (s *Server) handleConversationRunStatus(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	if _, err := s.db.EnsureConversation(uid, id, "", "会话 "+id); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"active": s.runs.isActive(id)})
}

// handleConversationEvents serves GET /v1/conversations/{id}/events.
// - reaction_updated: always available via conversation SSE hub (source of truth).
// - In-flight run frames: multiplexed when a run is active (resume / reconnect).
// Idle (no run) connections stay open with pings so reaction subscribers work.
func (s *Server) handleConversationEvents(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	if _, err := s.db.EnsureConversation(uid, id, "", "会话 "+id); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	writeFrame := func(event string, data any) bool {
		if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, mustJSON(data)); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}
	// convEventName names a conversation-hub frame by its JSON "type"
	// (reaction_updated, bot_presence, …); legacy payloads default to reaction_updated.
	convEventName := func(payload []byte) string {
		var meta struct {
			Type string `json:"type"`
		}
		if json.Unmarshal(payload, &meta) == nil && strings.TrimSpace(meta.Type) != "" {
			return strings.TrimSpace(meta.Type)
		}
		return "reaction_updated"
	}
	writeRaw := func(event string, payload []byte) bool {
		if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, payload); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}

	var reactCh chan []byte
	if s.convEvents != nil {
		reactCh = s.convEvents.subscribe(id)
		defer s.convEvents.unsubscribe(id, reactCh)
	}

	handle := s.runs.get(id)
	if handle == nil {
		// No active run: long-lived stream for reaction_updated / bot_presence.
		if !writeFrame("ready", map[string]any{"conversation_id": id, "active": false}) {
			return
		}
		ticker := time.NewTicker(25 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-r.Context().Done():
				return
			case <-ticker.C:
				if _, err := fmt.Fprintf(w, ": ping\n\n"); err != nil {
					return
				}
				flusher.Flush()
			case payload, open := <-reactCh:
				if !open {
					return
				}
				if !writeRaw(convEventName(payload), payload) {
					return
				}
			}
		}
	}

	sub, catchup, okSub := handle.Subscribe()
	if !okSub || sub == nil {
		// Race: run finished between get and Subscribe — fall through as idle reaction stream.
		if !writeFrame("done", map[string]any{"ok": true, "active": false}) {
			return
		}
		return
	}
	defer handle.Unsubscribe(sub)

	for _, ev := range catchup {
		if !writeFrame(ev.Event, ev.Data) {
			return
		}
	}

	for {
		select {
		case <-r.Context().Done():
			// Subscriber left; run continues on the server.
			return
		case payload, open := <-reactCh:
			if open {
				if !writeRaw(convEventName(payload), payload) {
					return
				}
			}
		case ev, open := <-sub.ch:
			if !open {
				_ = writeFrame("done", map[string]any{"ok": true, "active": false})
				return
			}
			if !writeFrame(ev.Event, ev.Data) {
				return
			}
			if ev.Event == "done" {
				return
			}
		}
	}
}
