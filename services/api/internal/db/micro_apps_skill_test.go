package db

import "testing"

func TestSyncSkillOnPinRequiresSlug(t *testing.T) {
	d := &DB{}
	err := d.syncSkillOnPin("u", &MicroApp{Kind: MicroAppKindSkill, SkillSlug: ""})
	if err == nil {
		t.Fatal("expected error for empty skill_slug")
	}
}

func TestSyncSkillOnPinSkipsNonSkill(t *testing.T) {
	d := &DB{}
	if err := d.syncSkillOnPin("u", &MicroApp{Kind: MicroAppKindUI, SkillSlug: ""}); err != nil {
		t.Fatal(err)
	}
}
