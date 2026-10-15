package sandbox

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Checkpoint copies team shared+bots (and private homes) into checkpoints/{ts}/ and
// updates the LATEST marker. Soft-fails are returned as errors for callers to log;
// docker availability is NOT required (filesystem only).
func (m *Manager) Checkpoint(ctx context.Context, userID string) (string, error) {
	_ = ctx
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return "", fmt.Errorf("user_id required")
	}
	home := m.UserHomeHost(userID)
	if _, err := os.Stat(home); err != nil {
		if os.IsNotExist(err) {
			return "", fmt.Errorf("no sandbox home to checkpoint")
		}
		return "", err
	}
	ts := time.Now().UTC().Format("20060102T150405Z")
	cpRoot := m.CheckpointsHost(userID)
	dst := filepath.Join(cpRoot, ts)
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return "", err
	}

	// Snapshot team shared + bots + private (skip checkpoints itself and legacy empty workspace).
	for _, name := range []string{"shared", "bots", "private"} {
		src := filepath.Join(home, name)
		if st, err := os.Stat(src); err != nil || !st.IsDir() {
			continue
		}
		if err := copyDir(src, filepath.Join(dst, name)); err != nil {
			return "", fmt.Errorf("checkpoint %s: %w", name, err)
		}
	}
	// Also snapshot legacy workspace if still present with content (pre-migration edge).
	legacy := filepath.Join(home, "workspace")
	if entries, err := os.ReadDir(legacy); err == nil && len(entries) > 0 {
		if err := copyDir(legacy, filepath.Join(dst, "workspace")); err != nil {
			return "", err
		}
	}

	marker := m.LatestCheckpointMarker(userID)
	if err := os.WriteFile(marker, []byte(ts+"\n"), 0o644); err != nil {
		return "", err
	}
	if err := m.PublishLive(ctx, userID, ""); err != nil {
		return dst, err
	}
	return dst, nil
}

// Restore copies the LATEST checkpoint into an empty home layout.
// If shared/ already has files, this is a no-op success (do not overwrite live data).
func (m *Manager) Restore(ctx context.Context, userID string) error {
	_ = ctx
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return fmt.Errorf("user_id required")
	}
	home := m.UserHomeHost(userID)
	marker := m.LatestCheckpointMarker(userID)
	b, err := os.ReadFile(marker)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // nothing to restore
		}
		return err
	}
	ts := strings.TrimSpace(string(b))
	if ts == "" {
		return nil
	}
	src := filepath.Join(m.CheckpointsHost(userID), ts)
	if st, err := os.Stat(src); err != nil || !st.IsDir() {
		return nil
	}

	// Consider "empty" if shared missing or empty AND bots missing or empty.
	if !isEmptyDir(filepath.Join(home, "shared")) || !isEmptyDir(filepath.Join(home, "bots")) ||
		!isEmptyDir(filepath.Join(home, "private")) {
		// Also check if any content exists under home besides checkpoints
		if hasLiveData(home) {
			return nil
		}
	}

	for _, name := range []string{"shared", "bots", "private", "workspace"} {
		from := filepath.Join(src, name)
		if st, err := os.Stat(from); err != nil || !st.IsDir() {
			continue
		}
		to := filepath.Join(home, name)
		if err := copyDir(from, to); err != nil {
			return fmt.Errorf("restore %s: %w", name, err)
		}
	}
	return nil
}

func hasLiveData(home string) bool {
	for _, name := range []string{"shared", "bots", "private", "workspace"} {
		if !isEmptyDir(filepath.Join(home, name)) {
			return true
		}
	}
	return false
}

func isEmptyDir(dir string) bool {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return true
	}
	return len(entries) == 0
}

func copyDir(src, dst string) error {
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return err
	}
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return nil // skip symlinks
		}
		return copyFile(path, target)
	})
}

func copyFile(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}
