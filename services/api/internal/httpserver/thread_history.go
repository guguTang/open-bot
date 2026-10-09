package httpserver

import (
	"strings"
	"unicode/utf8"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

const (
	// Cap thread replies fed to the model before relying on a thread summary.
	threadHistoryMaxMsgs = 40
	// Soft char budget for a thread transcript (excluding optional main summary).
	threadHistoryMaxChars = 12000
	replySnippetMaxRunes  = 240
)

// filterMainTimeline keeps top-level messages (not inside a reply thread).
// Summaries without thread_root_id belong to the main timeline.
func filterMainTimeline(msgs []db.Message) []db.Message {
	out := make([]db.Message, 0, len(msgs))
	for _, m := range msgs {
		if strings.TrimSpace(m.ThreadRootID) == "" {
			out = append(out, m)
		}
	}
	return out
}

// filterThreadMessages returns the root (by id) plus all messages in that thread,
// ordered as in msgs (created_at ASC from ListMessages).
func filterThreadMessages(msgs []db.Message, threadRootID string) []db.Message {
	rootID := strings.TrimSpace(threadRootID)
	if rootID == "" {
		return nil
	}
	out := make([]db.Message, 0, 16)
	for _, m := range msgs {
		if m.ID == rootID || strings.TrimSpace(m.ThreadRootID) == rootID {
			out = append(out, m)
		}
	}
	return out
}

// lastMainSummary returns the last main-timeline summary content, if any.
func lastMainSummary(msgs []db.Message) string {
	main := filterMainTimeline(msgs)
	for i := len(main) - 1; i >= 0; i-- {
		if main[i].Role == "summary" {
			content := stripThinkTags(main[i].Content)
			if strings.TrimSpace(content) != "" {
				return content
			}
		}
	}
	return ""
}

// historyForRuntime builds model history for a normal (non-thread) turn:
// main timeline only, from the last summary onward.
// currentAgentID + agentNames attribute other bots' assistant turns in groups.
func historyForRuntime(msgs []db.Message, currentAgentID string, agentNames map[string]string) []runtimeMsg {
	return historyForRuntimeScoped(filterMainTimeline(msgs), false, currentAgentID, agentNames)
}

// historyForThreadRuntime builds history for a thread reply:
// optional main-timeline summary + thread root + thread messages
// (with per-thread summary truncation when the thread is long).
func historyForThreadRuntime(msgs []db.Message, threadRootID, currentAgentID string, agentNames map[string]string) []runtimeMsg {
	rootID := strings.TrimSpace(threadRootID)
	if rootID == "" {
		return historyForRuntime(msgs, currentAgentID, agentNames)
	}
	thread := filterThreadMessages(msgs, rootID)
	scoped := historyForRuntimeScoped(thread, true, currentAgentID, agentNames)
	if sum := lastMainSummary(msgs); sum != "" {
		out := make([]runtimeMsg, 0, len(scoped)+1)
		out = append(out, runtimeMsg{Role: "summary", Content: sum})
		out = append(out, scoped...)
		return out
	}
	return scoped
}

// historyForRuntimeScoped converts a pre-filtered message slice into runtime
// turns, cutting from the last summary and optionally compacting long threads.
// When currentAgentID is set, assistant messages from other agents are rewritten
// as labeled user turns so the target bot does not treat them as its own voice.
func historyForRuntimeScoped(msgs []db.Message, compactThread bool, currentAgentID string, agentNames map[string]string) []runtimeMsg {
	lastSummary := -1
	for i, m := range msgs {
		if m.Role == "summary" {
			lastSummary = i
		}
	}
	start := 0
	if lastSummary >= 0 {
		start = lastSummary
	}
	slice := msgs[start:]
	if compactThread {
		slice = compactThreadSlice(slice)
	}
	current := strings.TrimSpace(currentAgentID)
	out := make([]runtimeMsg, 0, len(slice))
	for _, m := range slice {
		switch m.Role {
		case "user", "assistant", "summary", "system":
			content := m.Content
			if m.Role == "assistant" || m.Role == "summary" {
				content = stripThinkTags(content)
				if strings.TrimSpace(content) == "" {
					continue
				}
			}
			if m.Role == "assistant" && current != "" {
				speaker := strings.TrimSpace(m.AgentID)
				if speaker != "" && speaker != current {
					label := speaker
					if agentNames != nil {
						if n := strings.TrimSpace(agentNames[speaker]); n != "" {
							label = n
						}
					}
					out = append(out, runtimeMsg{Role: "user", Content: formatOtherAgentHistoryNote(label, content)})
					continue
				}
			}
			out = append(out, runtimeMsg{Role: m.Role, Content: content})
		case "host_confirm":
			if note := hostConfirmRuntimeNote(m.Content); note != "" {
				out = append(out, runtimeMsg{Role: "system", Content: note})
			}
		}
	}
	return out
}

// formatOtherAgentHistoryNote labels another member's prior reply for the model.
func formatOtherAgentHistoryNote(agentLabel, content string) string {
	label := strings.TrimSpace(agentLabel)
	if label == "" {
		label = "助手"
	}
	return "【" + label + "】" + content
}

// speakerNamesForHistory builds id→name for attributing multi-bot history.
func speakerNamesForHistory(database *db.DB, msgs []db.Message, currentAgentID, currentAgentName string) map[string]string {
	ids := make([]string, 0, len(msgs)+1)
	if id := strings.TrimSpace(currentAgentID); id != "" {
		ids = append(ids, id)
	}
	for _, m := range msgs {
		if id := strings.TrimSpace(m.AgentID); id != "" {
			ids = append(ids, id)
		}
	}
	var names map[string]string
	if database != nil {
		names = database.LookupAgentNames(ids)
	}
	if names == nil {
		names = map[string]string{}
	}
	if id := strings.TrimSpace(currentAgentID); id != "" {
		if n := strings.TrimSpace(currentAgentName); n != "" {
			names[id] = n
		}
	}
	return names
}

// compactThreadSlice keeps the last summary (if any) plus a recent window so
// long threads stay within a soft size budget without inventing LangGraph state.
func compactThreadSlice(msgs []db.Message) []db.Message {
	if len(msgs) <= threadHistoryMaxMsgs {
		chars := 0
		for _, m := range msgs {
			chars += len(m.Content)
		}
		if chars <= threadHistoryMaxChars {
			return msgs
		}
	}
	// Prefer cutting after the last summary inside this slice.
	lastSummary := -1
	for i, m := range msgs {
		if m.Role == "summary" {
			lastSummary = i
		}
	}
	keep := threadHistoryMaxMsgs
	if keep > len(msgs) {
		keep = len(msgs)
	}
	start := len(msgs) - keep
	if lastSummary >= 0 && lastSummary < start {
		// Keep summary + recent tail.
		tail := msgs[start:]
		out := make([]db.Message, 0, 1+len(tail))
		out = append(out, msgs[lastSummary])
		out = append(out, tail...)
		return out
	}
	if start < 0 {
		start = 0
	}
	return msgs[start:]
}

// formatReplyContextPrefix builds a short Chinese prefix injected into the
// *runtime* user content (not stored). Runtime may drop lone system turns, so
// reply context must ride on the user message.
func formatReplyContextPrefix(parent *db.Message, parentAgentName string) string {
	if parent == nil {
		return ""
	}
	snippet := strings.TrimSpace(stripThinkTags(parent.Content))
	if snippet == "" {
		return ""
	}
	snippet = truncateRunes(snippet, replySnippetMaxRunes)
	who := "消息"
	switch parent.Role {
	case "assistant":
		name := strings.TrimSpace(parentAgentName)
		if name == "" {
			name = strings.TrimSpace(parent.AgentID)
		}
		if name == "" {
			name = "助手"
		}
		who = name
	case "user":
		who = "用户"
	}
	return "【回复 " + who + "：「" + snippet + "」】\n"
}

func truncateRunes(s string, max int) string {
	if max <= 0 || s == "" {
		return s
	}
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	runes := []rune(s)
	return string(runes[:max]) + "…"
}

// injectReplyIntoUserContent prefixes the last user turn in history and the
// top-level content string with reply context (idempotent if already prefixed).
func injectReplyIntoUserContent(content string, history []runtimeMsg, prefix string) (string, []runtimeMsg) {
	prefix = strings.TrimRight(prefix, "\n") + "\n"
	if strings.TrimSpace(prefix) == "" || prefix == "\n" {
		return content, history
	}
	if !strings.HasPrefix(strings.TrimSpace(content), "【回复") {
		content = prefix + content
	}
	if len(history) == 0 {
		return content, history
	}
	out := append([]runtimeMsg(nil), history...)
	for i := len(out) - 1; i >= 0; i-- {
		if out[i].Role == "user" {
			if !strings.HasPrefix(strings.TrimSpace(out[i].Content), "【回复") {
				out[i].Content = prefix + out[i].Content
			}
			break
		}
	}
	return content, out
}

// threadRecallQuery augments the user text used for memory / Mem0 recall with
// the replied snippet and a short thread tail.
func threadRecallQuery(userText string, parent *db.Message, threadMsgs []db.Message) string {
	parts := make([]string, 0, 4)
	if parent != nil {
		snip := strings.TrimSpace(stripThinkTags(parent.Content))
		if snip != "" {
			parts = append(parts, "回复："+truncateRunes(snip, replySnippetMaxRunes))
		}
	}
	// Recent thread turns (skip the current user text duplicate).
	n := 0
	for i := len(threadMsgs) - 1; i >= 0 && n < 6; i-- {
		m := threadMsgs[i]
		if m.Role != "user" && m.Role != "assistant" {
			continue
		}
		c := strings.TrimSpace(stripThinkTags(m.Content))
		if c == "" {
			continue
		}
		parts = append(parts, truncateRunes(c, 120))
		n++
	}
	parts = append(parts, strings.TrimSpace(userText))
	return strings.TrimSpace(strings.Join(parts, "\n"))
}
