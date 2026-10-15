package sandbox

import (
	"context"
	"errors"
	"fmt"
	"mime"
	"net/url"
	"os"
	"strings"
)

// ObjectStore is the durable home for session sandbox files.
// Keys are built by Manager: {prefix}{user}/{conversation}/{bot}/{homeRel}.
// A nil store (MinIO unset) keeps the historical local-disk layout.
type ObjectStore interface {
	Put(ctx context.Context, key string, body []byte) error
	Get(ctx context.Context, key string) ([]byte, error)
	List(ctx context.Context, prefix string) ([]ObjectInfo, error)
	Delete(ctx context.Context, key string) error
	DeletePrefix(ctx context.Context, prefix string) error
}

// ObjectInfo is one listed object. Key is the full object key.
type ObjectInfo struct {
	Key  string
	Size int64
}

// ObjectConfig is the MinIO (S3) target for sandbox artifacts.
// Enabled only when Endpoint is set; otherwise the API stays on local disk.
type ObjectConfig struct {
	Endpoint  string
	Bucket    string
	Prefix    string
	AccessKey string
	SecretKey string
	Region    string
	UseSSL    bool
}

func (c ObjectConfig) Enabled() bool {
	return strings.TrimSpace(c.Endpoint) != ""
}

func (c ObjectConfig) normalizedPrefix() string {
	p := strings.TrimSpace(c.Prefix)
	p = strings.Trim(p, "/")
	if p == "" {
		return ""
	}
	if strings.Contains(p, "..") {
		return ""
	}
	return p + "/"
}

func loadObjectConfig() ObjectConfig {
	endpoint := firstEnv("SANDBOX_S3_ENDPOINT", "MINIO_ENDPOINT")
	if endpoint == "" {
		return ObjectConfig{}
	}
	host, ssl := parseS3Endpoint(endpoint)
	if v := strings.TrimSpace(os.Getenv("SANDBOX_S3_USE_SSL")); v != "" {
		ssl = v == "1" || strings.EqualFold(v, "true") || strings.EqualFold(v, "yes")
	}
	bucket := strings.TrimSpace(os.Getenv("SANDBOX_S3_BUCKET"))
	if bucket == "" {
		bucket = "openbot"
	}
	prefix := strings.TrimSpace(os.Getenv("SANDBOX_S3_PREFIX"))
	if prefix == "" {
		prefix = "sandboxes/"
	}
	region := strings.TrimSpace(os.Getenv("SANDBOX_S3_REGION"))
	if region == "" {
		region = "us-east-1"
	}
	return ObjectConfig{
		Endpoint:  host,
		Bucket:    bucket,
		Prefix:    prefix,
		AccessKey: firstEnv("SANDBOX_S3_ACCESS_KEY", "MINIO_ROOT_USER", "MINIO_ACCESS_KEY", "AWS_ACCESS_KEY_ID"),
		SecretKey: firstEnv("SANDBOX_S3_SECRET_KEY", "MINIO_ROOT_PASSWORD", "MINIO_SECRET_KEY", "AWS_SECRET_ACCESS_KEY"),
		Region:    region,
		UseSSL:    ssl,
	}
}

func firstEnv(keys ...string) string {
	for _, k := range keys {
		if v := strings.TrimSpace(os.Getenv(k)); v != "" {
			return v
		}
	}
	return ""
}

// parseS3Endpoint accepts host:port, http://host:port, or https://host:port.
func parseS3Endpoint(raw string) (host string, ssl bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", false
	}
	if !strings.Contains(raw, "://") {
		return strings.TrimRight(raw, "/"), false
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return strings.TrimRight(raw, "/"), strings.HasPrefix(strings.ToLower(raw), "https://")
	}
	return u.Host, u.Scheme == "https"
}

// objectSegment is one safe key component. Empty becomes "_".
func objectSegment(s string) string {
	s = strings.TrimSpace(s)
	if s == "" || s == "_" {
		return "_"
	}
	s = SanitizeUserID(s)
	if s == "" || s == "unknown" {
		return "_"
	}
	return s
}

func cleanObjectRel(rel string) (string, error) {
	rel = strings.TrimSpace(rel)
	rel = strings.ReplaceAll(rel, "\\", "/")
	rel = strings.Trim(rel, "/")
	if rel == "" || strings.Contains(rel, "\x00") {
		return "", fmt.Errorf("invalid object path")
	}
	var parts []string
	for _, p := range strings.Split(rel, "/") {
		if p == "" || p == "." {
			continue
		}
		if p == ".." {
			return "", fmt.Errorf("invalid object path")
		}
		parts = append(parts, p)
	}
	if len(parts) == 0 {
		return "", fmt.Errorf("invalid object path")
	}
	return strings.Join(parts, "/"), nil
}

func objectBot(op FileOp, homeRel string) string {
	// Prefer the bot encoded in bots/{id} or private/{id}. Shared files stay
	// under "_" so a download without agent_id still finds them.
	if seg := botFromHomeRel(homeRel); seg != "_" {
		return seg
	}
	if seg := objectSegment(op.AgentID); seg != "_" {
		return seg
	}
	return "_"
}

func botFromHomeRel(rel string) string {
	parts := strings.Split(rel, "/")
	if len(parts) >= 2 && (parts[0] == "bots" || parts[0] == "private") {
		if seg := objectSegment(parts[1]); seg != "_" {
			return seg
		}
	}
	return "_"
}

func (op FileOp) ctx() context.Context {
	if op.Ctx != nil {
		return op.Ctx
	}
	return context.Background()
}

func contentTypeForKey(key string) string {
	ext := ""
	if i := strings.LastIndex(key, "."); i >= 0 {
		ext = key[i:]
	}
	if ct := mime.TypeByExtension(ext); ct != "" {
		return ct
	}
	return "application/octet-stream"
}

func isNotFound(err error) bool {
	return err != nil && errors.Is(err, os.ErrNotExist)
}
