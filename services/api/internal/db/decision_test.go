package db

import "testing"

func TestNormalizeDecisionProvider(t *testing.T) {
	if got := NormalizeDecisionProvider(" Jev "); got != "jev" {
		t.Fatalf("jev: %s", got)
	}
	if got := NormalizeDecisionProvider("LAYA"); got != "laya" {
		t.Fatalf("laya: %s", got)
	}
	if got := NormalizeDecisionProvider("Unsloth"); got != "laya" {
		t.Fatalf("legacy unsloth should migrate to laya: %s", got)
	}
	if got := NormalizeDecisionProvider("Microsoft"); got != "microsoft" {
		t.Fatalf("microsoft: %s", got)
	}
	if got := NormalizeDecisionProvider(" Custom "); got != "custom" {
		t.Fatalf("custom: %s", got)
	}
	if got := NormalizeDecisionProvider(""); got != "off" {
		t.Fatalf("empty: %s", got)
	}
	if got := NormalizeDecisionProvider("mem0"); got != "off" {
		t.Fatalf("unknown: %s", got)
	}
	if IsRuntimeSystemOneProvider("jev") != true || IsRuntimeSystemOneProvider("microsoft") != false {
		t.Fatal("runtime vs microsoft classification")
	}
	if !IsRuntimeSystemOneProvider("custom") {
		t.Fatal("custom should classify as runtime System One")
	}
	if !IsRuntimeSystemOneProvider("unsloth") {
		t.Fatal("legacy unsloth should classify as runtime System One (via laya)")
	}
	if !IsMicrosoftDecisionProvider("microsoft") || IsMicrosoftDecisionProvider("laya") || IsMicrosoftDecisionProvider("custom") {
		t.Fatal("microsoft classification")
	}
}

func TestApplyDecisionDefaults(t *testing.T) {
	p, base, model := ApplyDecisionDefaults("off", "", "")
	if p != "off" || base != "" || model != "" {
		t.Fatalf("off should stay empty: %s %s %s", p, base, model)
	}
	p, base, model = ApplyDecisionDefaults("jev", "", "")
	if p != "jev" || base != "https://api.typesafe.ai" || model != "jev-latest" {
		t.Fatalf("jev defaults: %s %s %s", p, base, model)
	}
	p, base, model = ApplyDecisionDefaults("jev", "https://example.test/", "jev-1.13.0")
	if base != "https://example.test" || model != "jev-1.13.0" {
		t.Fatalf("jev custom: %s %s", base, model)
	}
	p, base, model = ApplyDecisionDefaults("laya", "", "")
	if p != "laya" || base != "" || model != "convaiinnovations/laya" {
		t.Fatalf("laya local: %s %q %s", p, base, model)
	}
	_, base, _ = ApplyDecisionDefaults("laya", "http://127.0.0.1:8081/", "")
	if base != "http://127.0.0.1:8081" {
		t.Fatalf("laya http base: %s", base)
	}
	// Legacy unsloth → laya with former Unsloth desktop defaults when empty.
	p, base, model = ApplyDecisionDefaults("unsloth", "", "")
	if p != "laya" || base != "http://localhost:8888" || model != "laya" {
		t.Fatalf("legacy unsloth defaults: %s %s %s", p, base, model)
	}
	p, base, model = ApplyDecisionDefaults("unsloth", "http://127.0.0.1:9999/", "jev-latest")
	if p != "laya" || base != "http://127.0.0.1:9999" || model != "jev-latest" {
		t.Fatalf("legacy unsloth custom: %s %s %s", p, base, model)
	}
	// Explicit Laya + Unsloth-desktop HTTP (supported admin path).
	p, base, model = ApplyDecisionDefaults("laya", "http://localhost:8888/", "laya")
	if p != "laya" || base != "http://localhost:8888" || model != "laya" {
		t.Fatalf("laya+HTTP Unsloth desktop: %s %s %s", p, base, model)
	}
	p, base, model = ApplyDecisionDefaults("microsoft", "https://ignored.example/", "ignored")
	if p != "microsoft" || base != "https://ignored.example" || model != "ignored" {
		t.Fatalf("microsoft should not invent System One defaults: %s %s %s", p, base, model)
	}
	// custom: keep empty; do not invent host/model.
	p, base, model = ApplyDecisionDefaults("custom", "", "")
	if p != "custom" || base != "" || model != "" {
		t.Fatalf("custom empty should stay empty: %s %q %q", p, base, model)
	}
	p, base, model = ApplyDecisionDefaults("custom", "http://127.0.0.1:8888/", "laya")
	if p != "custom" || base != "http://127.0.0.1:8888" || model != "laya" {
		t.Fatalf("custom keeps user values: %s %s %s", p, base, model)
	}
}
