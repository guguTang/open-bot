package httpserver

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/tangxin/open-bot/services/api/internal/db"
	"github.com/tangxin/open-bot/services/api/internal/sandbox"
)

const (
	microAppMaxBundleBytes = 5 << 20 // 5 MiB
	microAppMaxFiles       = 128
	microAppBundleFileName = "bundle.zip"
)

// microAppObjectStore wraps MinIO (same env as sandbox) or local disk fallback.
// Keys: micro-apps/{owner}/{app}/bundle.zip and micro-apps/{owner}/{app}/files/...
type microAppObjectStore struct {
	mu    sync.Mutex
	inner sandbox.ObjectStore
	local string // abs root when MinIO unset
}

func (s *Server) microAppObjects() *microAppObjectStore {
	s.microAppStoreOnce.Do(func() {
		cfg := sandbox.LoadObjectConfigForMicroApps()
		store := &microAppObjectStore{}
		if cfg.Enabled() {
			store.inner = sandbox.NewMinIOStore(cfg)
		} else {
			root := strings.TrimSpace(os.Getenv("OPENBOT_MICRO_APP_ROOT"))
			if root == "" {
				if r := strings.TrimSpace(os.Getenv("OPEN_BOT_ROOT")); r != "" {
					root = filepath.Join(r, "data", "micro-apps-store")
				} else {
					root = filepath.Join("data", "micro-apps-store")
				}
			}
			abs, err := filepath.Abs(root)
			if err == nil {
				root = abs
			}
			_ = os.MkdirAll(root, 0o755)
			store.local = root
		}
		s.microAppStore = store
	})
	return s.microAppStore
}

func (st *microAppObjectStore) Put(ctx context.Context, key string, body []byte) error {
	key = cleanMicroAppObjectKey(key)
	if st.inner != nil {
		return st.inner.Put(ctx, key, body)
	}
	path, err := st.localPath(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, body, 0o644)
}

func (st *microAppObjectStore) Get(ctx context.Context, key string) ([]byte, error) {
	key = cleanMicroAppObjectKey(key)
	if st.inner != nil {
		return st.inner.Get(ctx, key)
	}
	path, err := st.localPath(key)
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, os.ErrNotExist
		}
		return nil, err
	}
	return b, nil
}

func (st *microAppObjectStore) DeletePrefix(ctx context.Context, prefix string) error {
	prefix = cleanMicroAppObjectKey(prefix)
	if st.inner != nil {
		return st.inner.DeletePrefix(ctx, prefix)
	}
	path, err := st.localPath(prefix)
	if err != nil {
		return err
	}
	return os.RemoveAll(path)
}

func (st *microAppObjectStore) localPath(key string) (string, error) {
	key = strings.Trim(strings.ReplaceAll(key, "\\", "/"), "/")
	if key == "" || strings.Contains(key, "..") {
		return "", fmt.Errorf("invalid object key")
	}
	full := filepath.Join(st.local, filepath.FromSlash(key))
	absLocal, _ := filepath.Abs(st.local)
	absFull, err := filepath.Abs(full)
	if err != nil {
		return "", err
	}
	if absFull != absLocal && !strings.HasPrefix(absFull, absLocal+string(os.PathSeparator)) {
		return "", fmt.Errorf("invalid object key")
	}
	return absFull, nil
}

func cleanMicroAppObjectKey(key string) string {
	key = strings.TrimSpace(key)
	key = strings.ReplaceAll(key, "\\", "/")
	return strings.Trim(key, "/")
}

func microAppBundleObjectKey(ownerID, appID string) string {
	return strings.TrimSuffix(db.MicroAppObjectKey(ownerID, appID), "/") + "/" + microAppBundleFileName
}

func microAppFileObjectKey(ownerID, appID, rel string) string {
	rel = strings.Trim(strings.ReplaceAll(rel, "\\", "/"), "/")
	return strings.TrimSuffix(db.MicroAppObjectKey(ownerID, appID), "/") + "/files/" + rel
}

func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func readLimited(r io.Reader, max int64) ([]byte, error) {
	var buf bytes.Buffer
	n, err := io.Copy(&buf, io.LimitReader(r, max+1))
	if err != nil {
		return nil, err
	}
	if n > max {
		return nil, fmt.Errorf("bundle exceeds %d bytes", max)
	}
	return buf.Bytes(), nil
}

func isNotExist(err error) bool {
	return err != nil && (errors.Is(err, os.ErrNotExist) || os.IsNotExist(err))
}
