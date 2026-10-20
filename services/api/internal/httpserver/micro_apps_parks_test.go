package httpserver

import (
	"strings"
	"testing"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

func TestMicroAppParkStatusConstants(t *testing.T) {
	if db.MicroAppParkPending != "pending" {
		t.Fatalf("pending: %s", db.MicroAppParkPending)
	}
	if db.MicroAppParkResolved != "resolved" {
		t.Fatalf("resolved: %s", db.MicroAppParkResolved)
	}
	if db.MicroAppParkExpired != "expired" {
		t.Fatalf("expired: %s", db.MicroAppParkExpired)
	}
}

func TestParkReasonCopyInGrantNote(t *testing.T) {
	// waiter_lost path still surfaces allowed note (grant upserted; stack not resumed).
	allowed := `{"req_id":"mag-1","micro_app_id":"app1","capability":"host.shell.run","tool":"host_shell","status":"allowed","park_resolved":false,"park_reason":"waiter_lost"}`
	note := microAppGrantRuntimeNote(allowed)
	if !strings.Contains(note, "已允许") {
		t.Fatalf("note: %s", note)
	}
}
