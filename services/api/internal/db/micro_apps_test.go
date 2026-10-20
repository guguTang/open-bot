package db

import "testing"

func TestNormalizeMicroAppKind(t *testing.T) {
	if NormalizeMicroAppKind("") != MicroAppKindUI {
		t.Fatalf("default kind")
	}
	if NormalizeMicroAppKind("SKILL") != MicroAppKindSkill {
		t.Fatalf("skill")
	}
}

func TestRequireKnownCapabilities(t *testing.T) {
	if err := ValidateMicroAppCapabilities([]string{"host.shell.run", "ui.notify"}); err != nil {
		t.Fatal(err)
	}
	if err := ValidateMicroAppCapabilities([]string{"evil.root"}); err == nil {
		t.Fatal("expected unknown capability error")
	}
}

func TestGrantDecisionNormalize(t *testing.T) {
	d, err := NormalizeMicroAppGrantDecision("allow_once")
	if err != nil || d != MicroAppGrantAllowOnce {
		t.Fatalf("got %q %v", d, err)
	}
	if _, err := NormalizeMicroAppGrantDecision("maybe"); err == nil {
		t.Fatal("expected error")
	}
}

func TestMicroAppObjectKey(t *testing.T) {
	k := MicroAppObjectKey("u1", "a1")
	if k != "micro-apps/u1/a1/" {
		t.Fatalf("got %q", k)
	}
}

func TestDefaultGrantHighSens(t *testing.T) {
	if DefaultGrantDecisionForCapability("host.shell.run") != MicroAppGrantAllowOnce {
		t.Fatal("shell should default allow_once")
	}
}
