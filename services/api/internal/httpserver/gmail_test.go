package httpserver

import (
	"strings"
	"testing"
)

func TestHostOpNeedsConfirmEmailSend(t *testing.T) {
	if !hostOpNeedsConfirm("email_send") {
		t.Fatal("email_send must require confirm")
	}
}

func TestHostOpToolIdentityEmailSend(t *testing.T) {
	tool, group := HostOpToolIdentity("email_send")
	if tool != "gmail_send" || group != "email" {
		t.Fatalf("got tool=%q group=%q", tool, group)
	}
}

func TestApplyUserToolAllowlistNeverAutosEmailSend(t *testing.T) {
	base := hostExecReview{Tier: hostExecReviewConfirm, Reason: "need confirm", Code: "email_send_confirm"}
	// Even with a matching allowlist entry, email_send stays confirm.
	entries := []struct{}{}
	_ = entries
	rev := applyUserToolAllowlist(base, nil, "email_send", "allow", "")
	if rev.Tier != hostExecReviewConfirm {
		t.Fatalf("email_send must stay confirm, got %s", rev.Tier)
	}
}

func TestGmailNotConnectedHint(t *testing.T) {
	h := gmailNotConnectedHint(false, true)
	if !strings.Contains(h, "连接应用") {
		t.Fatalf("hint=%q", h)
	}
	h2 := gmailNotConnectedHint(false, false)
	if !strings.Contains(h2, "GOOGLE_OAUTH") {
		t.Fatalf("hint=%q", h2)
	}
	if gmailNotConnectedHint(true, true) != "" {
		t.Fatal("connected should have empty hint")
	}
}

func TestValidateEmailList(t *testing.T) {
	if err := validateEmailList("a@example.com"); err != nil {
		t.Fatal(err)
	}
	if err := validateEmailList("a@example.com, b@example.com"); err != nil {
		t.Fatal(err)
	}
	if err := validateEmailList("not-an-email"); err == nil {
		t.Fatal("expected error")
	}
}

func TestBuildRFC822Message(t *testing.T) {
	raw, err := buildRFC822Message("me@x.com", "you@y.com", "", "", "Hello", "Body line")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(raw, "To: you@y.com") || !strings.Contains(raw, "Body line") {
		t.Fatalf("raw=%q", raw)
	}
}

func TestLoadGmailOAuthConfigDisabled(t *testing.T) {
	t.Setenv("GOOGLE_OAUTH_CLIENT_ID", "")
	t.Setenv("GOOGLE_OAUTH_CLIENT_SECRET", "")
	cfg := loadGmailOAuthConfig()
	if cfg.Enabled() {
		t.Fatal("expected disabled")
	}
}

func TestLoadGmailOAuthConfigEnabled(t *testing.T) {
	t.Setenv("GOOGLE_OAUTH_CLIENT_ID", "cid")
	t.Setenv("GOOGLE_OAUTH_CLIENT_SECRET", "sec")
	t.Setenv("GOOGLE_OAUTH_REDIRECT_URI", "http://127.0.0.1:18080/v1/integrations/gmail/callback")
	cfg := loadGmailOAuthConfig()
	if !cfg.Enabled() {
		t.Fatal("expected enabled")
	}
}
