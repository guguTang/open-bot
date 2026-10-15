package sandbox

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/minio/minio-go/v7"
)

func testManager(t *testing.T) (*Manager, *MemStore) {
	t.Helper()
	root := t.TempDir()
	m := NewManager(Config{
		DataRoot:  root,
		Enabled:   true,
		Image:     "x",
		DockerBin: "docker",
		ObjectStore: ObjectConfig{
			Prefix: "sandboxes/",
			Bucket: "openbot",
		},
	})
	store := NewMemStore()
	m.UseObjectStore(store)
	return m, store
}

func TestLoadObjectConfigUnset(t *testing.T) {
	t.Setenv("SANDBOX_S3_ENDPOINT", "")
	t.Setenv("MINIO_ENDPOINT", "")
	if loadObjectConfig().Enabled() {
		t.Fatal("expected local-only when endpoint unset")
	}
}

func TestLoadObjectConfigReusesMinIOEnv(t *testing.T) {
	t.Setenv("SANDBOX_S3_ENDPOINT", "")
	t.Setenv("MINIO_ENDPOINT", "http://127.0.0.1:9000")
	t.Setenv("SANDBOX_S3_ACCESS_KEY", "")
	t.Setenv("SANDBOX_S3_SECRET_KEY", "")
	t.Setenv("MINIO_ROOT_USER", "openbot")
	t.Setenv("MINIO_ROOT_PASSWORD", "openbotopenbot")
	t.Setenv("SANDBOX_S3_BUCKET", "")
	t.Setenv("SANDBOX_S3_PREFIX", "")
	t.Setenv("SANDBOX_S3_USE_SSL", "")
	cfg := loadObjectConfig()
	if !cfg.Enabled() {
		t.Fatal("expected enabled")
	}
	if cfg.Endpoint != "127.0.0.1:9000" || cfg.UseSSL {
		t.Fatalf("endpoint: %+v", cfg)
	}
	if cfg.Bucket != "openbot" || cfg.Prefix != "sandboxes/" {
		t.Fatalf("bucket/prefix: %+v", cfg)
	}
	if cfg.AccessKey != "openbot" || cfg.SecretKey != "openbotopenbot" {
		t.Fatalf("creds: %+v", cfg)
	}
	host, ssl := parseS3Endpoint("https://minio.internal:9000")
	if host != "minio.internal:9000" || !ssl {
		t.Fatalf("https parse: %s %v", host, ssl)
	}
}

func TestObjectKeyRejectsEscape(t *testing.T) {
	m, _ := testManager(t)
	if _, err := m.objectKey("u1", "c1", "b1", "../etc/passwd"); err == nil {
		t.Fatal("expected reject")
	}
	key, err := m.objectKey("u1", "", "bot-1", "bots/bot-1/a.txt")
	if err != nil {
		t.Fatal(err)
	}
	if key != "sandboxes/u1/_/bot-1/bots/bot-1/a.txt" {
		t.Fatalf("key %s", key)
	}
}

func TestMemStoreRoundTrip(t *testing.T) {
	s := NewMemStore()
	ctx := context.Background()
	if err := s.Put(ctx, "sandboxes/u/c/b/a.txt", []byte("hi")); err != nil {
		t.Fatal(err)
	}
	body, err := s.Get(ctx, "sandboxes/u/c/b/a.txt")
	if err != nil || string(body) != "hi" {
		t.Fatalf("get %q %v", body, err)
	}
	infos, err := s.List(ctx, "sandboxes/u/c/")
	if err != nil || len(infos) != 1 || infos[0].Size != 2 {
		t.Fatalf("list %+v %v", infos, err)
	}
	if err := s.DeletePrefix(ctx, "sandboxes/u/c/"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get(ctx, "sandboxes/u/c/b/a.txt"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected missing, %v", err)
	}
}

func TestWriteReadListDeleteByConversation(t *testing.T) {
	m, store := testManager(t)
	ctx := context.Background()
	op := FileOp{
		UserID:         "user 1",
		AgentID:        "bot-1",
		ConversationID: "conv-1",
		Mode:           ModeTeam,
		Path:           "notes.txt",
		Ctx:            ctx,
	}
	if err := m.WriteFile(op, "hello"); err != nil {
		t.Fatal(err)
	}
	sessionKey := "sandboxes/user-1/conv-1/bot-1/bots/bot-1/notes.txt"
	latestKey := "sandboxes/user-1/_/bot-1/bots/bot-1/notes.txt"
	for _, key := range []string{sessionKey, latestKey} {
		body, err := store.Get(ctx, key)
		if err != nil || string(body) != "hello" {
			t.Fatalf("key %s body %q err %v", key, body, err)
		}
	}

	host, err := m.resolveOp(op)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(host); err != nil {
		t.Fatal(err)
	}
	got, err := m.ReadFile(op, 0)
	if err != nil || got != "hello" {
		t.Fatalf("hydrate read %q %v", got, err)
	}
	if _, err := os.Stat(host); err != nil {
		t.Fatalf("hot file not restored: %v", err)
	}

	if err := os.Remove(host); err != nil {
		t.Fatal(err)
	}
	entries, err := m.ListDir(FileOp{
		UserID:         "user 1",
		AgentID:        "bot-1",
		ConversationID: "conv-1",
		Mode:           ModeTeam,
		Path:           "/workspace/bots/bot-1",
		Ctx:            ctx,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name != "notes.txt" || entries[0].IsDir {
		t.Fatalf("list %+v", entries)
	}

	if err := m.DeleteStored(ctx, "user 1", "conv-1", "bot-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get(ctx, sessionKey); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("session key still present: %v", err)
	}
	if body, err := store.Get(ctx, latestKey); err != nil || string(body) != "hello" {
		t.Fatalf("latest should remain: %q %v", body, err)
	}
	if err := m.DeleteStored(ctx, "user 1", "", ""); err != nil {
		t.Fatal(err)
	}
	infos, err := store.List(ctx, "sandboxes/user-1/")
	if err != nil || len(infos) != 0 {
		t.Fatalf("user prefix not empty: %+v %v", infos, err)
	}
}

func TestHydrateLatestAndPublishSkipsJunk(t *testing.T) {
	m, store := testManager(t)
	ctx := context.Background()
	home := m.UserHomeHost("u1")
	keep := filepath.Join(home, "shared", "keep.txt")
	if err := os.MkdirAll(filepath.Dir(keep), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keep, []byte("keep"), 0o644); err != nil {
		t.Fatal(err)
	}
	junk := filepath.Join(home, "bots", "b", "node_modules", "pkg", "index.js")
	if err := os.MkdirAll(filepath.Dir(junk), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(junk, []byte("nope"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := m.PublishLive(ctx, "u1", "conv-9"); err != nil {
		t.Fatal(err)
	}
	infos, err := store.List(ctx, "sandboxes/u1/")
	if err != nil {
		t.Fatal(err)
	}
	for _, info := range infos {
		if filepath.Base(info.Key) == "index.js" {
			t.Fatalf("uploaded node_modules: %s", info.Key)
		}
	}
	found := false
	for _, info := range infos {
		if info.Key == "sandboxes/u1/conv-9/_/shared/keep.txt" || info.Key == "sandboxes/u1/_/_/shared/keep.txt" {
			found = true
		}
	}
	if !found {
		t.Fatalf("missing shared object: %+v", infos)
	}

	if err := os.RemoveAll(home); err != nil {
		t.Fatal(err)
	}
	if err := m.HydrateLatest(ctx, "u1"); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(m.UserHomeHost("u1"), "shared", "keep.txt"))
	if err != nil || string(b) != "keep" {
		t.Fatalf("hydrate %q %v", b, err)
	}
}

func TestLocalOnlyWriteWithoutStore(t *testing.T) {
	root := t.TempDir()
	m := NewManager(Config{DataRoot: root})
	if err := m.WriteFile(FileOp{UserID: "u", AgentID: "a", Mode: ModeTeam, Path: "x.txt"}, "z"); err != nil {
		t.Fatal(err)
	}
	if err := m.PublishLive(context.Background(), "u", "c"); err != nil {
		t.Fatal(err)
	}
	if err := m.DeleteStored(context.Background(), "u", "c", ""); err != nil {
		t.Fatal(err)
	}
	got, err := m.ReadFile(FileOp{UserID: "u", AgentID: "a", Mode: ModeTeam, Path: "x.txt"}, 0)
	if err != nil || got != "z" {
		t.Fatalf("local read %q %v", got, err)
	}
}

func TestMapMinIONotFound(t *testing.T) {
	err := mapMinIOErr(minio.ErrorResponse{Code: "NoSuchKey", StatusCode: 404})
	if !errors.Is(err, os.ErrNotExist) {
		t.Fatal(err)
	}
}
