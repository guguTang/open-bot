package sandbox

import (
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestNormalizeMode(t *testing.T) {
	if NormalizeMode("") != ModeTeam {
		t.Fatal("default team")
	}
	if NormalizeMode("private") != ModePrivate {
		t.Fatal("private")
	}
}

func TestRemapWritePathTeam(t *testing.T) {
	p, err := RemapWritePath("notes.txt", "agent-1", ModeTeam)
	if err != nil {
		t.Fatal(err)
	}
	if p != "/workspace/bots/agent-1/notes.txt" {
		t.Fatalf("got %s", p)
	}
	p, err = RemapWritePath("/workspace/shared/x.md", "agent-1", ModeTeam)
	if err != nil || p != "/workspace/shared/x.md" {
		t.Fatalf("shared passthrough: %s %v", p, err)
	}
	p, err = RemapWritePath("out.txt", "a", ModePrivate)
	if err != nil || p != "/workspace/out.txt" {
		t.Fatalf("private: %s %v", p, err)
	}
}

func TestEnsureLayoutMigratesWorkspace(t *testing.T) {
	root := t.TempDir()
	m := NewManager(Config{DataRoot: root, Enabled: true, Image: "x", DockerBin: "docker"})
	home := m.UserHomeHost("u1")
	legacy := filepath.Join(home, "workspace")
	if err := os.MkdirAll(legacy, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(legacy, "old.txt"), []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}
	mount, err := m.EnsureLayout("u1", "botA", ModeTeam)
	if err != nil {
		t.Fatal(err)
	}
	if mount != home {
		t.Fatalf("mount=%s home=%s", mount, home)
	}
	sharedFile := filepath.Join(home, "shared", "old.txt")
	b, err := os.ReadFile(sharedFile)
	if err != nil || string(b) != "hi" {
		t.Fatalf("migrate failed: %v %q", err, b)
	}
	botDir := m.BotHost("u1", "botA")
	if st, err := os.Stat(botDir); err != nil || !st.IsDir() {
		t.Fatalf("bot dir missing: %v", err)
	}
}

func TestEnsureLayoutPrivate(t *testing.T) {
	root := t.TempDir()
	m := NewManager(Config{DataRoot: root})
	mount, err := m.EnsureLayout("u2", "agentX", ModePrivate)
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(root, "u2", "private", "agentX")
	if mount != want {
		t.Fatalf("got %s want %s", mount, want)
	}
}

func TestRemapWritePathBareAbsolute(t *testing.T) {
	p, err := RemapWritePath("/workspace/tetris.html", "d4112a62-a53b-4e6b-8cc0-daed1d7446eb", ModeTeam)
	if err != nil {
		t.Fatal(err)
	}
	want := "/workspace/bots/d4112a62-a53b-4e6b-8cc0-daed1d7446eb/tetris.html"
	if p != want {
		t.Fatalf("got %s want %s", p, want)
	}
}

func TestReadFileTeamCandidates(t *testing.T) {
	root := t.TempDir()
	m := NewManager(Config{DataRoot: root, Enabled: true, Image: "x", DockerBin: "docker"})
	uid := "user-read"
	aid := "d4112a62-a53b-4e6b-8cc0-daed1d7446eb"
	if _, err := m.EnsureLayout(uid, aid, ModeTeam); err != nil {
		t.Fatal(err)
	}
	botFile := filepath.Join(m.BotHost(uid, aid), "tetris.html")
	if err := os.WriteFile(botFile, []byte("<html>ok</html>"), 0o644); err != nil {
		t.Fatal(err)
	}

	// With agent_id: remap candidate
	content, err := m.ReadFile(FileOp{UserID: uid, AgentID: aid, Mode: ModeTeam, Path: "/workspace/tetris.html"}, 0)
	if err != nil {
		t.Fatalf("with agent_id: %v", err)
	}
	if content != "<html>ok</html>" {
		t.Fatalf("content=%q", content)
	}

	// Without agent_id: bots/* unique search
	content, err = m.ReadFile(FileOp{UserID: uid, AgentID: "", Mode: ModeTeam, Path: "/workspace/tetris.html"}, 0)
	if err != nil {
		t.Fatalf("without agent_id: %v", err)
	}
	if content != "<html>ok</html>" {
		t.Fatalf("content=%q", content)
	}

	// Explicit shared path still works
	shared := filepath.Join(m.SharedHost(uid), "note.txt")
	if err := os.WriteFile(shared, []byte("shared"), 0o644); err != nil {
		t.Fatal(err)
	}
	content, err = m.ReadFile(FileOp{UserID: uid, AgentID: aid, Mode: ModeTeam, Path: "/workspace/shared/note.txt"}, 0)
	if err != nil || content != "shared" {
		t.Fatalf("shared: %v %q", err, content)
	}
}

func TestOpenWorkspaceFileKeepsBytes(t *testing.T) {
	root := t.TempDir()
	m := NewManager(Config{DataRoot: root, Enabled: true, Image: "x", DockerBin: "docker"})
	uid := "user-dl"
	aid := "bot-dl"
	if _, err := m.EnsureLayout(uid, aid, ModeTeam); err != nil {
		t.Fatal(err)
	}
	payload := []byte{0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x0a}
	botFile := filepath.Join(m.BotHost(uid, aid), "chart.png")
	if err := os.WriteFile(botFile, payload, 0o644); err != nil {
		t.Fatal(err)
	}
	f, st, err := m.OpenWorkspaceFile(FileOp{UserID: uid, AgentID: aid, Mode: ModeTeam, Path: "/workspace/chart.png"})
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if st.Size() != int64(len(payload)) {
		t.Fatalf("size=%d", st.Size())
	}
	got, err := io.ReadAll(f)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(payload) {
		t.Fatalf("bytes mismatch")
	}
}

func TestListDirDoesNotRemapWorkspaceRoot(t *testing.T) {
	root := t.TempDir()
	m := NewManager(Config{DataRoot: root})
	uid := "user-ls"
	aid := "botA"
	if _, err := m.EnsureLayout(uid, aid, ModeTeam); err != nil {
		t.Fatal(err)
	}
	entries, err := m.ListDir(FileOp{UserID: uid, AgentID: aid, Mode: ModeTeam, Path: "/workspace"})
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]bool{}
	for _, e := range entries {
		names[e.Name] = true
	}
	if !names["shared"] || !names["bots"] {
		t.Fatalf("expected shared+bots at workspace root, got %#v", entries)
	}
}

func TestReadFilePercentEncodedPath(t *testing.T) {
	root := t.TempDir()
	m := NewManager(Config{DataRoot: root, Enabled: true, Image: "x", DockerBin: "docker"})
	uid := "user-pct"
	aid := "bot-pct"
	if _, err := m.EnsureLayout(uid, aid, ModeTeam); err != nil {
		t.Fatal(err)
	}
	name := "社会保险个人权益记录-内容摘要.html"
	botFile := filepath.Join(m.BotHost(uid, aid), "out", name)
	if err := os.MkdirAll(filepath.Dir(botFile), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(botFile, []byte("<html>社保</html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	encoded := "/workspace/bots/" + aid + "/out/%E7%A4%BE%E4%BC%9A%E4%BF%9D%E9%99%A9%E4%B8%AA%E4%BA%BA%E6%9D%83%E7%9B%8A%E8%AE%B0%E5%BD%95-%E5%86%85%E5%AE%B9%E6%91%98%E8%A6%81.html"
	content, err := m.ReadFile(FileOp{UserID: uid, AgentID: aid, Mode: ModeTeam, Path: encoded}, 0)
	if err != nil {
		t.Fatalf("percent-encoded read: %v", err)
	}
	if content != "<html>社保</html>" {
		t.Fatalf("content=%q", content)
	}
}
