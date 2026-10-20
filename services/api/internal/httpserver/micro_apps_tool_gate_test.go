package httpserver

import (
	"testing"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

func TestMicroAppToolCapabilityMap(t *testing.T) {
	if microAppToolCapability["host_shell"] != db.MicroAppShellCapability {
		t.Fatalf("host_shell map")
	}
	if microAppToolCapability["host_screenshot"] != "host.screenshot" {
		t.Fatalf("screenshot map")
	}
	if _, ok := microAppToolCapability["host_click"]; ok {
		t.Fatalf("host_click should be unmapped")
	}
}

func TestMicroAppCapabilityDeclaredAlternates(t *testing.T) {
	app := &db.MicroApp{Capabilities: []string{"host.fs.workspace"}}
	if !microAppCapabilityDeclared(app, "host.fs.read") {
		t.Fatalf("workspace should satisfy fs.read")
	}
	if !microAppCapabilityDeclared(app, "host.fs.write") {
		t.Fatalf("workspace should satisfy fs.write")
	}
	if microAppCapabilityDeclared(app, "host.shell.run") {
		t.Fatalf("shell not declared")
	}
	app2 := &db.MicroApp{Capabilities: []string{"host.shell.run"}}
	if !microAppCapabilityDeclared(app2, "host.shell.run") {
		t.Fatalf("shell declared")
	}
}
