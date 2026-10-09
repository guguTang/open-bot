package httpserver

import (
	"fmt"
	"regexp"
	"strings"
	"unicode"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

var mentionTokenRe = regexp.MustCompile(`@([^\s@]+)`)

// parseMentionTokens extracts raw @tokens from text (without the @).
func parseMentionTokens(content string) []string {
	matches := mentionTokenRe.FindAllStringSubmatch(content, -1)
	if len(matches) == 0 {
		return nil
	}
	seen := map[string]struct{}{}
	var out []string
	for _, m := range matches {
		tok := strings.TrimRightFunc(m[1], func(r rune) bool {
			return unicode.IsPunct(r) && r != '_' && r != '-'
		})
		tok = strings.TrimSpace(tok)
		if tok == "" {
			continue
		}
		key := strings.ToLower(tok)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, tok)
	}
	return out
}

// resolveMentionedAgents maps @tokens / explicit ids to channel member agent ids.
// Preference: exact agent id, then case-insensitive name, then id/name prefix, then unique name substring.
func resolveMentionedAgents(tokens []string, members []string, agents []*db.Agent) []string {
	if len(tokens) == 0 || len(members) == 0 {
		return nil
	}
	memberSet := map[string]struct{}{}
	for _, id := range members {
		memberSet[id] = struct{}{}
	}
	byID := map[string]*db.Agent{}
	byName := map[string][]string{} // lower name -> ids
	for _, a := range agents {
		if a == nil {
			continue
		}
		if _, ok := memberSet[a.ID]; !ok {
			continue
		}
		byID[a.ID] = a
		byID[strings.ToLower(a.ID)] = a
		ln := strings.ToLower(strings.TrimSpace(a.Name))
		if ln != "" {
			byName[ln] = append(byName[ln], a.ID)
		}
	}

	var out []string
	seen := map[string]struct{}{}
	add := func(id string) {
		id = strings.TrimSpace(id)
		if id == "" {
			return
		}
		if _, ok := memberSet[id]; !ok {
			return
		}
		if _, ok := seen[id]; ok {
			return
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}

	for _, tok := range tokens {
		lower := strings.ToLower(tok)
		// @everyone / @all → all channel members (group broadcast).
		if lower == "everyone" || lower == "all" {
			for _, id := range members {
				add(id)
			}
			continue
		}
		if a, ok := byID[tok]; ok {
			add(a.ID)
			continue
		}
		if a, ok := byID[lower]; ok {
			add(a.ID)
			continue
		}
		if ids, ok := byName[lower]; ok {
			for _, id := range ids {
				add(id)
			}
			continue
		}
		// Fuzzy after exact id/name failed: prefer id prefix, then name prefix,
		// then a unique name substring — avoid first-hit Contains stealing another member.
		var idPrefix, namePrefix, nameContains []string
		for _, a := range agents {
			if a == nil {
				continue
			}
			if _, ok := memberSet[a.ID]; !ok {
				continue
			}
			lid := strings.ToLower(a.ID)
			lname := strings.ToLower(strings.TrimSpace(a.Name))
			switch {
			case strings.HasPrefix(lid, lower):
				idPrefix = append(idPrefix, a.ID)
			case lname != "" && strings.HasPrefix(lname, lower):
				namePrefix = append(namePrefix, a.ID)
			case lname != "" && strings.Contains(lname, lower):
				nameContains = append(nameContains, a.ID)
			}
		}
		switch {
		case len(idPrefix) > 0:
			for _, id := range idPrefix {
				add(id)
			}
		case len(namePrefix) > 0:
			for _, id := range namePrefix {
				add(id)
			}
		case len(nameContains) == 1:
			add(nameContains[0])
		}
	}
	return out
}

// mentionIncludesEveryone reports whether @everyone/@all appears in content.
func mentionIncludesEveryone(content string) bool {
	for _, tok := range parseMentionTokens(content) {
		lower := strings.ToLower(tok)
		if lower == "everyone" || lower == "all" {
			return true
		}
	}
	return false
}

// resolveGroupSendTargets picks candidate agents for a group turn.
// DM is handled by the caller (empty channel). Rules:
//   - @everyone/@all → all members (each should reply)
//   - specific @Name / explicit agent_ids → those agents (all of them, not first-only)
//   - no @ → all members are candidates; each may reply or PASS by relevance
// Reply-to-bot is not a hard filter (history/quote still steer relevance).
func resolveGroupSendTargets(members []string, agents []*db.Agent, explicit []string, content string, replyParent *db.Message, convAgentID string) []string {
	_ = replyParent // reserved: soft signal via quote/history, not candidate filter
	if len(members) == 0 {
		if convAgentID != "" {
			return []string{convAgentID}
		}
		return nil
	}
	memberSet := map[string]struct{}{}
	for _, m := range members {
		memberSet[m] = struct{}{}
	}
	copyMembers := func() []string {
		out := make([]string, len(members))
		copy(out, members)
		return out
	}

	if mentionIncludesEveryone(content) {
		return copyMembers()
	}

	var targets []string
	for _, id := range dedupeStrings(explicit) {
		if _, ok := memberSet[id]; ok {
			targets = append(targets, id)
		}
	}
	for _, id := range resolveMentionedAgents(parseMentionTokens(content), members, agents) {
		targets = append(targets, id)
	}
	targets = dedupeStrings(targets)
	if len(targets) == 0 {
		// No @: every member is a candidate (each may PASS).
		return copyMembers()
	}
	return targets
}

// groupForcedAgentSet returns agents that were explicitly addressed and should not PASS.
// @everyone/@all → all members; otherwise each resolved @mention (not bare no-@ candidates).
func groupForcedAgentSet(content string, members []string, agents []*db.Agent) map[string]bool {
	out := map[string]bool{}
	if mentionIncludesEveryone(content) {
		for _, id := range members {
			out[id] = true
		}
		return out
	}
	for _, id := range resolveMentionedAgents(parseMentionTokens(content), members, agents) {
		out[id] = true
	}
	return out
}

// groupParticipationRoleHint is a short role line for the roster / PASS prompt.
func groupParticipationRoleHint(a *db.Agent) string {
	if a == nil {
		return ""
	}
	if d := strings.TrimSpace(a.Description); d != "" {
		return d
	}
	sp := strings.TrimSpace(a.SystemPrompt)
	if sp == "" {
		return ""
	}
	line := strings.TrimSpace(strings.Split(sp, "\n")[0])
	runes := []rune(line)
	if len(runes) > 80 {
		return string(runes[:80]) + "…"
	}
	return line
}

// formatGroupMemberRoster lists channel peers (name + role) for participation prompts.
func formatGroupMemberRoster(members []string, agents []*db.Agent, selfID string) string {
	byID := map[string]*db.Agent{}
	for _, a := range agents {
		if a != nil {
			byID[a.ID] = a
		}
	}
	var lines []string
	for _, id := range members {
		a := byID[id]
		name := id
		role := ""
		if a != nil {
			if n := strings.TrimSpace(a.Name); n != "" {
				name = n
			}
			role = groupParticipationRoleHint(a)
		}
		tag := ""
		if id == selfID {
			tag = "（你）"
		}
		if role != "" {
			lines = append(lines, fmt.Sprintf("- %s%s：%s", name, tag, role))
		} else {
			lines = append(lines, fmt.Sprintf("- %s%s", name, tag))
		}
	}
	return strings.Join(lines, "\n")
}

// groupParticipationExtraSystem is appended in channel turns so bots can stay silent.
// forced: this agent was @mentioned or @everyone — should reply, not PASS.
// Non-forced prompts name this bot's role and inject a short member roster so
// specialty bots prefer [PASS] when another peer is the better fit.
func groupParticipationExtraSystem(forced bool, self *db.Agent, members []string, agents []*db.Agent) string {
	if forced {
		return "【群聊参与】你在群聊中，且本回合被用户点名（@你或 @everyone/@all）。请直接回复用户，不要输出 [PASS]，也不要只打招呼敷衍。"
	}
	selfID := ""
	selfName := "你"
	selfRole := ""
	if self != nil {
		selfID = self.ID
		if n := strings.TrimSpace(self.Name); n != "" {
			selfName = n
		}
		selfRole = groupParticipationRoleHint(self)
	}
	roster := formatGroupMemberRoster(members, agents, selfID)
	roleLine := fmt.Sprintf("你的身份是「%s」。\n", selfName)
	if selfRole != "" {
		roleLine = fmt.Sprintf("你的身份是「%s」：%s\n", selfName, selfRole)
	}
	body := "【群聊参与】你在群聊中。同一条用户消息会并行发给多名成员，各自独立决定是否发言（看不到彼此本回合的回复）。\n" +
		roleLine
	if roster != "" {
		body += "群成员：\n" + roster + "\n"
	}
	body += "决策规则（严格执行）：\n" +
		"- 仅当用户请求明显属于你的职责/专长，或需要每位成员表态（如自我介绍、轮流发言），才正常回复。\n" +
		"- 若问题更适合其他专长成员（例如写诗/文案→写作类；写代码/排障→编程类；查资料→研究类），即使你也能勉强回答，也请只输出一行：[PASS]\n" +
		"- 若明显在对别人说话、或与你无关，请只输出一行：[PASS]\n" +
		"- 输出 [PASS] 时不要附加任何其他文字。"
	return body
}

// isGroupPassReply reports a structured silence / no-op reply from a group candidate.
func isGroupPassReply(text string) bool {
	return db.ContentIsGroupPass(text)
}

// dedupeStrings preserves order.
func dedupeStrings(ids []string) []string {
	seen := map[string]struct{}{}
	var out []string
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}
