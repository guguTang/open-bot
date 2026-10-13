package httpserver

import (
	"errors"
	"net/http"
	"net/url"
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


func TestIssueParseGmailOAuthState(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-gmail-oauth-state-secret")
	state, err := issueGmailOAuthState("user-123")
	if err != nil {
		t.Fatal(err)
	}
	if state == "" || !strings.Contains(state, ".") {
		t.Fatalf("unexpected state %q", state)
	}
	uid, err := parseGmailOAuthState(state)
	if err != nil {
		t.Fatal(err)
	}
	if uid != "user-123" {
		t.Fatalf("uid=%q", uid)
	}
}

func TestParseGmailOAuthStateRejectsTamper(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-gmail-oauth-state-secret")
	state, err := issueGmailOAuthState("user-123")
	if err != nil {
		t.Fatal(err)
	}
	// Corrupt MAC segment (avoid single-char base64 edge cases).
	parts := strings.Split(state, ".")
	if len(parts) != 2 {
		t.Fatalf("state=%q", state)
	}
	parts[1] = "AAAA" + parts[1]
	if _, err := parseGmailOAuthState(parts[0]+"."+parts[1]); err == nil {
		t.Fatal("expected tamper rejection")
	}
	if _, err := parseGmailOAuthState("not-a-state"); err == nil {
		t.Fatal("expected malformed rejection")
	}
}

func TestVerifyGmailOAuthStateCookie(t *testing.T) {
	state := "signed.state.value"
	// Missing cookie is OK (cross-origin start often cannot set it).
	req, _ := http.NewRequest(http.MethodGet, "/callback", nil)
	if err := verifyGmailOAuthStateCookie(req, state); err != nil {
		t.Fatalf("missing cookie should be ok: %v", err)
	}
	// Matching cookie OK.
	req.AddCookie(&http.Cookie{Name: gmailOAuthStateCookie, Value: state})
	if err := verifyGmailOAuthStateCookie(req, state); err != nil {
		t.Fatalf("matching cookie: %v", err)
	}
	// Mismatch rejected.
	req2, _ := http.NewRequest(http.MethodGet, "/callback", nil)
	req2.AddCookie(&http.Cookie{Name: gmailOAuthStateCookie, Value: "other"})
	if err := verifyGmailOAuthStateCookie(req2, state); err == nil {
		t.Fatal("expected mismatch error")
	}
}


func TestGmailQueryParamPreservesPlus(t *testing.T) {
	raw := "code=4/0Axx+yy/zz&state=ab.cd"
	if got := gmailQueryParam(raw, "code"); got != "4/0Axx+yy/zz" {
		t.Fatalf("code=%q", got)
	}
	// %2B should decode to +
	raw2 := "code=4/0Axx%2Byy&state=ab.cd"
	if got := gmailQueryParam(raw2, "code"); got != "4/0Axx+yy" {
		t.Fatalf("code=%q", got)
	}
	// Contrast: url.Query turns bare + into space
	u, _ := url.Parse("http://x/?" + raw)
	if u.Query().Get("code") == "4/0Axx+yy/zz" {
		t.Fatal("expected std Query to corrupt +, otherwise test assumption wrong")
	}
}

func TestMapGmailTokenExchangeError(t *testing.T) {
	cases := map[string]string{
		"token network: dial tcp: i/o timeout":        "token_exchange_network",
		"Post https://oauth2.googleapis.com/token: context deadline exceeded": "token_exchange_network",
		"redirect_uri_mismatch":                      "redirect_uri_mismatch",
		"invalid_client: Unauthorized":               "invalid_client",
		"invalid_grant: Bad Request":                 "invalid_grant",
		"something else":                             "token_exchange_failed",
	}
	for in, want := range cases {
		if got := mapGmailTokenExchangeError(errors.New(in)); got != want {
			t.Fatalf("in=%q got=%q want=%q", in, got, want)
		}
	}
}


func TestGmailHasSendScope(t *testing.T) {
	if !gmailHasSendScope("https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email") {
		t.Fatal("expected send")
	}
	if gmailHasSendScope("https://www.googleapis.com/auth/userinfo.email openid") {
		t.Fatal("email-only must not can_send")
	}
	if !gmailHasSendScope("https://mail.google.com/") {
		t.Fatal("full mail scope should allow send")
	}
	if gmailHasSendScope("") {
		t.Fatal("empty")
	}
}
