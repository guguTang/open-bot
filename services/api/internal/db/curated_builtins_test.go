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
}
