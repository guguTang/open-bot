package httpserver

import (
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
