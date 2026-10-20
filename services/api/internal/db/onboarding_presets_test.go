package db

import (
	"testing"
)

func TestNormalizeOnboardingPresetID(t *testing.T) {
	id, err := NormalizeOnboardingPresetID("f")
	if err != nil || id != "F" {
		t.Fatalf("single letter: got %q %v", id, err)
	}
	id, err = NormalizeOnboardingPresetID("micro_apps")
	if err != nil || id != "micro_apps" {
		t.Fatalf("slug: got %q %v", id, err)
	}
	if _, err := NormalizeOnboardingPresetID("1bad"); err == nil {
		t.Fatal("expected error for id starting with digit")
	}
}

func TestOnboardingPresetResolveSkills(t *testing.T) {
	p := &OnboardingPreset{SkillsJSON: SkillsUnsetMarker}
	if _, set := p.ResolveSkills(); set {
		t.Fatal("null must be unset")
	}
	p.SkillsJSON = SkillsCuratedMarker
	sk, set := p.ResolveSkills()
	if !set {
		t.Fatal("curated must set")
	}
	if len(sk) == 0 {
		// curated may be empty if manifest missing in test cwd — still ok that set=true
		t.Log("curated list empty (manifest missing); set flag ok")
	}
	p.SkillsJSON = `["prototype","handoff"]`
	sk, set = p.ResolveSkills()
	if !set || len(sk) != 2 || sk[0] != "prototype" {
		t.Fatalf("list: %#v set=%v", sk, set)
	}
}

func TestHardcodedOnboardingFallbackIncludesF(t *testing.T) {
	list := HardcodedOnboardingFallback()
	var sawF, sawCustom bool
	for _, p := range list {
		if p.ID == "F" {
			sawF = true
			if p.Title != "微应用与本机工具" {
				t.Fatalf("F title: %q", p.Title)
			}
		}
		if p.IsCustomFallback {
			sawCustom = true
			if p.ID != "E" {
				t.Fatalf("custom fallback want E got %s", p.ID)
			}
		}
	}
	if !sawF || !sawCustom {
		t.Fatalf("sawF=%v sawCustom=%v", sawF, sawCustom)
	}
}
