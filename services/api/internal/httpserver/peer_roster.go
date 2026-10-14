package httpserver

import (
	"strings"
	"unicode/utf8"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

const peerRosterMax = 12
const peerRosterDescRunes = 200

// peerRosterBlock lists same-account bots the current one may ask.
// Group membership and computer_mode are not filters. Bots without a job
// description are omitted because the model cannot tell what they do.
func peerRosterBlock(selfID string, agents []*db.Agent) (string, bool) {
	selfID = strings.TrimSpace(selfID)
	var lines []string
	for _, a := range agents {
		if a == nil || strings.TrimSpace(a.ID) == "" || a.ID == selfID {
			continue
		}
		desc := strings.TrimSpace(a.Description)
		if desc == "" {
			continue
		}
		desc = strings.ReplaceAll(desc, "\n", " ")
		if utf8.RuneCountInString(desc) > peerRosterDescRunes {
			desc = string([]rune(desc)[:peerRosterDescRunes]) + "…"
		}
		name := strings.TrimSpace(a.Name)
		if name == "" {
			name = a.ID
		}
		lines = append(lines, "- "+name+"（"+a.ID+"）："+desc)
		if len(lines) >= peerRosterMax {
			break
		}
	}
	if len(lines) == 0 {
		return "", false
	}
	return "同事名单（同一账户里的其他助手，不必在同一个群。只在用户点名某位，或问题落在对方岗位描述里而你的岗位盖不住时，调用 ask_agent 问其中一位。一次只问一个。你能做、两边都能做、闲聊、名单里没有对口的人，不要问。同事的回复已经出现在当前会话里，不要把那段话再写一遍。若回复带 needs_user，或是在追问只有用户知道的细节：问题已经展示给用户，停下来等用户回答，不要替用户选定，不要复述问题，也不要用猜的内容再调用 ask_agent）：\n" + strings.Join(lines, "\n"), true
}

// peerRosterSystem appends the roster when this turn may ask a colleague.
// askDepth >= 1 is a child answer and must not invite another ask.
func peerRosterSystem(selfID, system string, agents []*db.Agent, askDepth int) (string, bool) {
	if askDepth >= 1 {
		return system, false
	}
	block, allow := peerRosterBlock(selfID, agents)
	if !allow {
		return system, false
	}
	if strings.TrimSpace(system) == "" {
		return block, true
	}
	return system + "\n\n" + block, true
}

// attachPeerRoster writes the account roster into a runtime payload.
// Existing ask_depth >= 1 is left unable to call ask_agent.
func (s *Server) attachPeerRoster(payload map[string]any, userID, agentID string) {
	if payload == nil {
		return
	}
	depth := 0
	switch v := payload["ask_depth"].(type) {
	case int:
		depth = v
	case float64:
		depth = int(v)
	}
	system, _ := payload["system_prompt"].(string)
	if depth >= 1 || s == nil || s.db == nil {
		payload["ask_depth"] = depth
		payload["allow_ask_agent"] = false
		return
	}
	agents, err := s.db.ListAgents(userID)
	if err != nil {
		payload["ask_depth"] = 0
		payload["allow_ask_agent"] = false
		return
	}
	next, allow := peerRosterSystem(agentID, system, agents, 0)
	payload["system_prompt"] = next
	payload["ask_depth"] = 0
	payload["allow_ask_agent"] = allow
}
