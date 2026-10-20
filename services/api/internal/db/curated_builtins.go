package db

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// Curated role values in skills/curated-builtins.json.
const (
	CuratedRoleDefault  = ""          // default-on for new bots; toggleable
	CuratedRoleAlwaysOn = "always_on" // discovery entry: always mounted; disable blocked
	CuratedRolePublic   = "public"    // platform public/common: default-on + survives onboarding; toggleable
)

// CuratedBuiltin is one default-on skill for new bots (skills.sh batch or first-party public).
type CuratedBuiltin struct {
	Slug          string `json:"slug"`
	Role          string `json:"role"`
	Package       string `json:"package"`
	Skill         string `json:"skill"`
	Repo          string `json:"repo"`
	Path          string `json:"path"`
	Ref           string `json:"ref"`
	PreserveLocal bool   `json:"preserve_local"`
}

type curatedManifest struct {
	Version    int              `json:"version"`
	Skills     []CuratedBuiltin `json:"skills"`
	NotDefault []string         `json:"not_default"`
}

var (
	curatedOnce       sync.Once
	curatedSlugs      []string
	curatedSet        map[string]bool
	alwaysOnSlugs     []string
	alwaysOnSet       map[string]bool
	publicCommonSlugs []string
	publicCommonSet   map[string]bool
)

// ErrSkillDisableBlocked is returned when disabling an always-on discovery skill.
var ErrSkillDisableBlocked = errors.New("find-skills is always-on (skill discovery); disabling or deleting it is blocked")

func curatedManifestPath() string {
	return filepath.Join(SkillsRoot(), "curated-builtins.json")
}

func loadCuratedManifest() {
	curatedOnce.Do(func() {
		curatedSet = map[string]bool{}
		alwaysOnSet = map[string]bool{}
		publicCommonSet = map[string]bool{}
		data, err := os.ReadFile(curatedManifestPath())
		if err != nil {
			return
		}
		var m curatedManifest
		if err := json.Unmarshal(data, &m); err != nil {
			return
		}
		for _, s := range m.Skills {
			slug := strings.TrimSpace(s.Slug)
			if slug == "" {
				continue
			}
			curatedSlugs = append(curatedSlugs, slug)
			curatedSet[slug] = true
			role := strings.TrimSpace(strings.ToLower(s.Role))
			switch role {
			case CuratedRoleAlwaysOn:
				alwaysOnSlugs = append(alwaysOnSlugs, slug)
				alwaysOnSet[slug] = true
			case CuratedRolePublic:
				publicCommonSlugs = append(publicCommonSlugs, slug)
				publicCommonSet[slug] = true
			}
		}
	})
}

// CuratedBuiltinSlugs returns the ordered curated default-on list (skills.sh + first-party public).
// Empty when skills/curated-builtins.json is missing or invalid.
func CuratedBuiltinSlugs() []string {
	loadCuratedManifest()
	out := make([]string, len(curatedSlugs))
	copy(out, curatedSlugs)
	return out
}

// IsCuratedBuiltin reports whether name is in the curated default-on list.
func IsCuratedBuiltin(name string) bool {
	loadCuratedManifest()
	return curatedSet[strings.TrimSpace(name)]
}

// AlwaysOnBuiltinSlugs returns curated skills marked role=always_on (discovery entry).
func AlwaysOnBuiltinSlugs() []string {
	loadCuratedManifest()
	out := make([]string, len(alwaysOnSlugs))
	copy(out, alwaysOnSlugs)
	return out
}

// IsAlwaysOnBuiltin reports whether name is an always-on discovery skill (disable blocked).
func IsAlwaysOnBuiltin(name string) bool {
	loadCuratedManifest()
	return alwaysOnSet[strings.TrimSpace(name)]
}

// EnsureAlwaysOnSkills appends missing always-on slugs to names (deduped, order preserved).
func EnsureAlwaysOnSkills(names []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(names)+len(AlwaysOnBuiltinSlugs()))
	for _, n := range names {
		n = strings.TrimSpace(n)
		if n == "" || seen[n] {
			continue
		}
		seen[n] = true
		out = append(out, n)
	}
	for _, slug := range AlwaysOnBuiltinSlugs() {
		if seen[slug] {
			continue
		}
		seen[slug] = true
		out = append(out, slug)
	}
	return out
}

// PublicCommonBuiltinSlugs returns curated skills marked role=public (platform public/common).
func PublicCommonBuiltinSlugs() []string {
	loadCuratedManifest()
	out := make([]string, len(publicCommonSlugs))
	copy(out, publicCommonSlugs)
	return out
}

// IsPublicCommonBuiltin reports whether name is a platform public/common skill (toggleable).
func IsPublicCommonBuiltin(name string) bool {
	loadCuratedManifest()
	return publicCommonSet[strings.TrimSpace(name)]
}

// EnsurePublicCommonSkills appends missing role=public slugs to names (deduped, order preserved).
// Used so onboarding presets (A/B/D/F) cannot drop generative-ui; unlike always_on, disable stays allowed.
func EnsurePublicCommonSkills(names []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(names)+len(PublicCommonBuiltinSlugs()))
	for _, n := range names {
		n = strings.TrimSpace(n)
		if n == "" || seen[n] {
			continue
		}
		seen[n] = true
		out = append(out, n)
	}
	for _, slug := range PublicCommonBuiltinSlugs() {
		if seen[slug] {
			continue
		}
		seen[slug] = true
		out = append(out, slug)
	}
	return out
}

// ResetCuratedBuiltinCacheForTest clears the sync.Once cache (tests only).
func ResetCuratedBuiltinCacheForTest() {
	curatedOnce = sync.Once{}
	curatedSlugs = nil
	curatedSet = nil
	alwaysOnSlugs = nil
	alwaysOnSet = nil
	publicCommonSlugs = nil
	publicCommonSet = nil
}
