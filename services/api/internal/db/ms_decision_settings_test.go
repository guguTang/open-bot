package db

import (
	"testing"

	"github.com/google/uuid"
)

func TestUpsertOrgMSDecisionRoundTrip(t *testing.T) {
	d, err := Open("")
	if err != nil {
		t.Skip(err)
	}
	defer d.Close()

	org, err := d.CreateOrg("msd1-test-"+uuid.NewString()[:8], "msd1 test")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = d.SQL.Exec(`DELETE FROM orgs WHERE id = $1`, org.ID) })

	s, err := d.GetOrgSettings(org.ID)
	if err != nil {
		t.Fatal(err)
	}
	if s.MSDecisionEnabled || s.MSDecisionProvider != "openrouter" || s.MSDecisionAuthMode != "api_key" ||
		s.MSDecisionConfidenceThreshold != nil || s.MSDecisionTimeoutMS != nil || s.MSDecisionAPIKey != "" {
		t.Fatalf("defaults: %+v", s)
	}

	thr, tmo := 0.6, 5000
	s, err = d.UpsertOrgMSDecision(org.ID, MSDecisionUpdate{
		Enabled: true, Provider: "azure_foundry", BaseURL: "https://r.services.ai.azure.com",
		APIKey: "fake-key-abcd", Model: "dep-1", AuthMode: "api_key",
		ConfidenceThreshold: &thr, TimeoutMS: &tmo,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !s.MSDecisionEnabled || s.MSDecisionProvider != "azure_foundry" || s.MSDecisionModel != "dep-1" ||
		s.MSDecisionAPIKey != "fake-key-abcd" || *s.MSDecisionConfidenceThreshold != 0.6 || *s.MSDecisionTimeoutMS != 5000 {
		t.Fatalf("saved: %+v", s)
	}
	if NormalizeDecisionProvider(s.DecisionProvider) != "microsoft" {
		t.Fatalf("enabling MS must select exclusive provider=microsoft, got %s", s.DecisionProvider)
	}
	pub := s.MSDecisionPublic()
	if !pub.Enabled || !pub.APIKeySet || pub.APIKeyHint != "****abcd" {
		t.Fatalf("public: %+v", pub)
	}

	// Blank key keeps stored key; nil threshold/timeout clears them; disable → provider off.
	s, err = d.UpsertOrgMSDecision(org.ID, MSDecisionUpdate{Enabled: false, Provider: "openrouter", AuthMode: "api_key"})
	if err != nil {
		t.Fatal(err)
	}
	if s.MSDecisionAPIKey != "fake-key-abcd" || s.MSDecisionConfidenceThreshold != nil || s.MSDecisionTimeoutMS != nil {
		t.Fatalf("keep key / clear optional: %+v", s)
	}
	if NormalizeDecisionProvider(s.DecisionProvider) != "off" {
		t.Fatalf("disabling MS must set decision_provider=off, got %s", s.DecisionProvider)
	}
	if s.MSDecisionPublic().Enabled {
		t.Fatal("public Enabled must be false when provider is off")
	}
	s, err = d.UpsertOrgMSDecision(org.ID, MSDecisionUpdate{Provider: "openrouter", ClearAPIKey: true})
	if err != nil {
		t.Fatal(err)
	}
	if s.MSDecisionAPIKey != "" {
		t.Fatal("clear key failed")
	}

	// UpsertOrgDecision(microsoft) flips ms_decision_enabled; switching to jev clears it.
	s, err = d.UpsertOrgDecision(org.ID, "microsoft", "", "", "", true)
	if err != nil {
		t.Fatal(err)
	}
	if !s.MSDecisionEnabled || NormalizeDecisionProvider(s.DecisionProvider) != "microsoft" {
		t.Fatalf("UpsertOrgDecision(microsoft): %+v", s)
	}
	s, err = d.UpsertOrgDecision(org.ID, "jev", "", "k", "", false)
	if err != nil {
		t.Fatal(err)
	}
	if s.MSDecisionEnabled || NormalizeDecisionProvider(s.DecisionProvider) != "jev" {
		t.Fatalf("UpsertOrgDecision(jev) must clear ms enabled: provider=%s enabled=%v", s.DecisionProvider, s.MSDecisionEnabled)
	}
}
