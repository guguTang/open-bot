package db

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCuratedBuiltinSlugsFromRepo(t *testing.T) {
	ResetCuratedBuiltinCacheForTest()
	root := SkillsRoot()
	manifest := filepath.Join(root, "curated-builtins.json")
	if _, err := os.Stat(manifest); err != nil {
		t.Skip("curated-builtins.json not present:", err)
	}
	slugs := CuratedBuiltinSlugs()
	if len(slugs) < 10 {
		t.Fatalf("expected curated batch, got %v", slugs)
	}
	want := map[string]bool{
		"find-skills": true, "generative-ui": true, "grill-me": true, "tdd": true, "diagnosing-bugs": true,
		"vercel-react-best-practices": true, "frontend-design": true,
	}
	for name := range want {
		if !IsCuratedBuiltin(name) {
			t.Fatalf("missing curated %s in %v", name, slugs)
		}
	}
	if IsCuratedBuiltin("agent-browser") || IsCuratedBuiltin("grilling") {
		t.Fatal("excluded leaderboard skills must not be curated")
	}
}

func TestFindSkillsAlwaysOnDiscovery(t *testing.T) {
	ResetCuratedBuiltinCacheForTest()
	root := SkillsRoot()
	manifest := filepath.Join(root, "curated-builtins.json")
	if _, err := os.Stat(manifest); err != nil {
		t.Skip("curated-builtins.json not present:", err)
	}
	if !IsAlwaysOnBuiltin("find-skills") {
		t.Fatal("find-skills must be role=always_on discovery entry")
	}
	if IsAlwaysOnBuiltin("grill-me") || IsAlwaysOnBuiltin("tdd") || IsAlwaysOnBuiltin("generative-ui") {
		t.Fatal("other curated skills must remain toggleable (not always_on)")
	}
	if !IsPublicCommonBuiltin("generative-ui") {
		t.Fatal("generative-ui must be role=public platform common skill")
	}
	if IsPublicCommonBuiltin("find-skills") || IsPublicCommonBuiltin("grill-me") {
		t.Fatal("only generative-ui should be role=public for now")
	}
	got := AlwaysOnBuiltinSlugs()
	if len(got) != 1 || got[0] != "find-skills" {
		t.Fatalf("AlwaysOnBuiltinSlugs=%v want [find-skills]", got)
	}
	ensured := EnsureAlwaysOnSkills([]string{"grill-me", "tdd"})
	if ensured[len(ensured)-1] != "find-skills" {
		t.Fatalf("EnsureAlwaysOnSkills missing find-skills: %v", ensured)
	}
	ensured2 := EnsureAlwaysOnSkills([]string{"find-skills", "grill-me"})
	if len(ensured2) != 2 {
		t.Fatalf("dedupe failed: %v", ensured2)
	}
	pub := EnsurePublicCommonSkills([]string{"summarize-text"})
	if len(pub) != 2 || pub[0] != "summarize-text" || pub[1] != "generative-ui" {
		t.Fatalf("EnsurePublicCommonSkills=%v want [summarize-text generative-ui]", pub)
	}
	pub2 := EnsurePublicCommonSkills([]string{"generative-ui", "summarize-text"})
	if len(pub2) != 2 {
		t.Fatalf("EnsurePublicCommonSkills dedupe failed: %v", pub2)
	}
}
