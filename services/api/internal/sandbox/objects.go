package sandbox

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
)

// UseObjectStore injects a store (tests). Production uses NewManager, which
// attaches MinIO when SANDBOX_S3_ENDPOINT or MINIO_ENDPOINT is set.
func (m *Manager) UseObjectStore(s ObjectStore) {
	if m == nil {
		return
	}
	m.objects = s
}

func (m *Manager) objectKey(userID, conversationID, botID, homeRel string) (string, error) {
	if strings.TrimSpace(userID) == "" {
		return "", fmt.Errorf("user_id required")
	}
	rel, err := cleanObjectRel(homeRel)
	if err != nil {
		return "", err
	}
	return m.Cfg.ObjectStore.normalizedPrefix() +
		SanitizeUserID(userID) + "/" +
		objectSegment(conversationID) + "/" +
		objectSegment(botID) + "/" +
		rel, nil
}

// objectPrefix is the key prefix for delete/list.
// Empty conversation and bot selects the whole user.
// A set conversation and empty bot selects that conversation (every bot).
func (m *Manager) objectPrefix(userID, conversationID, botID string) (string, error) {
	if strings.TrimSpace(userID) == "" {
		return "", fmt.Errorf("user_id required")
	}
	p := m.Cfg.ObjectStore.normalizedPrefix() + SanitizeUserID(userID) + "/"
	if strings.TrimSpace(conversationID) == "" && strings.TrimSpace(botID) == "" {
		return p, nil
	}
	p += objectSegment(conversationID) + "/"
	if strings.TrimSpace(botID) == "" {
		return p, nil
	}
	return p + objectSegment(botID) + "/", nil
}

func (m *Manager) homeRel(userID, host string) (string, error) {
	home := m.UserHomeHost(userID)
	absHome, err := filepath.Abs(home)
	if err != nil {
		return "", err
	}
	absHost, err := filepath.Abs(host)
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(absHome, absHost)
	if err != nil {
		return "", err
	}
	rel = filepath.ToSlash(rel)
	if rel == ".." || strings.HasPrefix(rel, "../") {
		return "", ErrPathEscape
	}
	return rel, nil
}

func (m *Manager) publishBytes(ctx context.Context, op FileOp, host string, body []byte) error {
	if m == nil || m.objects == nil {
		return nil
	}
	if int64(len(body)) > MaxDownloadBytes {
		return fmt.Errorf("file too large")
	}
	rel, err := m.homeRel(op.UserID, host)
	if err != nil {
		return err
	}
	if rel == "" || rel == "." {
		return fmt.Errorf("invalid object path")
	}
	bot := objectBot(op, rel)
	convs := []string{"_"}
	if seg := objectSegment(op.ConversationID); seg != "_" {
		convs = []string{op.ConversationID, "_"}
	}
	for _, conv := range convs {
		key, err := m.objectKey(op.UserID, conv, bot, rel)
		if err != nil {
			return err
		}
		if err := m.objects.Put(ctx, key, body); err != nil {
			return err
		}
	}
	return nil
}

func (m *Manager) fetchObject(ctx context.Context, op FileOp, homeRel string) ([]byte, error) {
	if m == nil || m.objects == nil {
		return nil, os.ErrNotExist
	}
	bot := objectBot(op, homeRel)
	var keys []string
	if objectSegment(op.ConversationID) != "_" {
		if k, err := m.objectKey(op.UserID, op.ConversationID, bot, homeRel); err == nil {
			keys = append(keys, k)
		}
	}
	if k, err := m.objectKey(op.UserID, "_", bot, homeRel); err == nil {
		keys = append(keys, k)
	}
	var hard error
	for _, key := range keys {
		body, err := m.objects.Get(ctx, key)
		if err == nil {
			return body, nil
		}
		if isNotFound(err) {
			continue
		}
		hard = err
	}
	if hard != nil {
		return nil, hard
	}
	return nil, os.ErrNotExist
}

// materializeFile copies one object onto the hot working dir when the local
// file is missing. Local bytes win when they already exist.
func (m *Manager) materializeFile(ctx context.Context, op FileOp, host string) error {
	if st, err := os.Stat(host); err == nil && !st.IsDir() {
		return nil
	}
	if m == nil || m.objects == nil {
		return os.ErrNotExist
	}
	rel, err := m.homeRel(op.UserID, host)
	if err != nil {
		return err
	}
	if rel == "" || rel == "." {
		return os.ErrNotExist
	}
	body, err := m.fetchObject(ctx, op, rel)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(host), 0o755); err != nil {
		return err
	}
	return os.WriteFile(host, body, 0o644)
}

// PublishLive uploads the hot working tree (shared/bots/private/workspace)
// to object storage. conversationID empty publishes only the latest ("_") copy.
// Shell-created files are picked up here; WriteFile publishes immediately.
func (m *Manager) PublishLive(ctx context.Context, userID, conversationID string) error {
	if m == nil || m.objects == nil {
		return nil
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return fmt.Errorf("user_id required")
	}
	home := m.UserHomeHost(userID)
	var first error
	for _, name := range []string{"shared", "bots", "private", "workspace"} {
		src := filepath.Join(home, name)
		st, err := os.Stat(src)
		if err != nil || !st.IsDir() {
			continue
		}
		err = filepath.Walk(src, func(path string, info os.FileInfo, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if info.IsDir() {
				if skipPublishDir(info.Name()) && path != src {
					return filepath.SkipDir
				}
				return nil
			}
			if info.Mode()&os.ModeSymlink != 0 {
				return nil
			}
			if info.Size() > MaxDownloadBytes {
				return nil
			}
			body, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			op := FileOp{UserID: userID, ConversationID: conversationID, Ctx: ctx}
			if err := m.publishBytes(ctx, op, path, body); err != nil && first == nil {
				first = err
				return err
			}
			return nil
		})
		if err != nil && first == nil {
			first = err
		}
		if first != nil {
			return first
		}
	}
	return nil
}

func skipPublishDir(name string) bool {
	switch name {
	case "node_modules", ".git", "__pycache__", ".venv", "venv", "dist":
		return true
	default:
		return false
	}
}

// HydrateLatest pulls the latest ("_") objects into the hot working dir.
// Used when the local home has no live files (new process, wiped disk).
func (m *Manager) HydrateLatest(ctx context.Context, userID string) error {
	if m == nil || m.objects == nil {
		return nil
	}
	prefix, err := m.objectPrefix(userID, "_", "")
	if err != nil {
		return err
	}
	infos, err := m.objects.List(ctx, prefix)
	if err != nil {
		return err
	}
	home := m.UserHomeHost(userID)
	for _, info := range infos {
		rel, ok := homeRelFromKey(info.Key, prefix)
		if !ok {
			continue
		}
		dest := filepath.Join(home, filepath.FromSlash(rel))
		if st, err := os.Stat(dest); err == nil && !st.IsDir() {
			continue
		}
		body, err := m.objects.Get(ctx, info.Key)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(dest, body, 0o644); err != nil {
			return err
		}
	}
	return nil
}

// homeRelFromKey strips "{bot}/" from the remainder of a list prefix
// ("{prefix}{user}/{conv}/") and returns the path relative to the user home.
func homeRelFromKey(key, prefix string) (string, bool) {
	rest := strings.TrimPrefix(key, prefix)
	if rest == key || rest == "" {
		return "", false
	}
	parts := strings.SplitN(rest, "/", 2)
	if len(parts) != 2 || parts[1] == "" {
		return "", false
	}
	rel, err := cleanObjectRel(parts[1])
	if err != nil {
		return "", false
	}
	return rel, true
}

// DeleteStored removes objects for a user, and optionally one conversation
// and/or bot. Empty conversationID and botID deletes the user's whole prefix.
func (m *Manager) DeleteStored(ctx context.Context, userID, conversationID, botID string) error {
	if m == nil || m.objects == nil {
		return nil
	}
	prefix, err := m.objectPrefix(userID, conversationID, botID)
	if err != nil {
		return err
	}
	return m.objects.DeletePrefix(ctx, prefix)
}

func (m *Manager) listStoredDir(ctx context.Context, op FileOp, host string) ([]DirEntry, error) {
	if m == nil || m.objects == nil {
		return nil, os.ErrNotExist
	}
	rel, err := m.homeRel(op.UserID, host)
	if err != nil {
		return nil, err
	}
	if rel == "." {
		rel = ""
	}
	conv := "_"
	if objectSegment(op.ConversationID) != "_" {
		conv = op.ConversationID
	}
	entries, err := m.listPrefixDir(ctx, op.UserID, conv, rel)
	if err != nil {
		return nil, err
	}
	if len(entries) == 0 && conv != "_" {
		entries, err = m.listPrefixDir(ctx, op.UserID, "_", rel)
		if err != nil {
			return nil, err
		}
	}
	if len(entries) == 0 {
		return nil, os.ErrNotExist
	}
	return entries, nil
}

func (m *Manager) listPrefixDir(ctx context.Context, userID, conversationID, dirRel string) ([]DirEntry, error) {
	prefix, err := m.objectPrefix(userID, conversationID, "")
	if err != nil {
		return nil, err
	}
	infos, err := m.objects.List(ctx, prefix)
	if err != nil {
		return nil, err
	}
	dirRel = strings.Trim(dirRel, "/")
	byName := map[string]DirEntry{}
	var order []string
	for _, info := range infos {
		homeRel, ok := homeRelFromKey(info.Key, prefix)
		if !ok {
			continue
		}
		child := homeRel
		if dirRel != "" {
			if homeRel == dirRel {
				continue
			}
			if !strings.HasPrefix(homeRel, dirRel+"/") {
				continue
			}
			child = strings.TrimPrefix(homeRel, dirRel+"/")
		}
		name := child
		isDir := false
		if i := strings.Index(child, "/"); i >= 0 {
			name = child[:i]
			isDir = true
		}
		if name == "" {
			continue
		}
		prev, seen := byName[name]
		if !seen {
			order = append(order, name)
			byName[name] = DirEntry{Name: name, IsDir: isDir, Size: info.Size}
			continue
		}
		if isDir && !prev.IsDir {
			prev.IsDir = true
			prev.Size = 0
			byName[name] = prev
		}
	}
	out := make([]DirEntry, 0, len(order))
	for _, name := range order {
		out = append(out, byName[name])
	}
	return out, nil
}

func logHydrateErr(userID string, err error) {
	if err != nil {
		log.Printf("sandbox hydrate user %s: %v", userID, err)
	}
}
