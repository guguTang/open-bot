package db

import (
	"regexp"
	"strings"
)

// groupPassCoreRe matches the silence sentinel after wrappers are peeled.
var groupPassCoreRe = regexp.MustCompile(`(?i)^pass$`)

// ContentIsGroupPass reports structured group-chat silence tokens such as
// [PASS], PASS, 【PASS】, markdown wrappers, or empty text. Used so journal
// projection and HTTP persist never leave a visible assistant bubble.
func ContentIsGroupPass(text string) bool {
	t := strings.TrimSpace(text)
	if t == "" {
		return true
	}
	for i := 0; i < 8; i++ {
		prev := t
		t = strings.TrimSpace(t)
		t = strings.Trim(t, "` \t\r\n\"'")
		t = strings.Trim(t, "*_~") // markdown emphasis / code leftovers
		pairs := [][2]string{
			{"[", "]"},
			{"【", "】"},
			{"（", "）"},
			{"(", ")"},
			{"「", "」"},
			{"『", "』"},
			{"<", ">"},
			{"《", "》"},
		}
		for _, p := range pairs {
			if strings.HasPrefix(t, p[0]) && strings.HasSuffix(t, p[1]) && len(t) >= len(p[0])+len(p[1]) {
				t = strings.TrimSpace(t[len(p[0]) : len(t)-len(p[1])])
			}
		}
		t = strings.TrimRight(t, "。.!！…")
		t = strings.TrimSpace(t)
		if t == prev {
			break
		}
	}
	return groupPassCoreRe.MatchString(t)
}
