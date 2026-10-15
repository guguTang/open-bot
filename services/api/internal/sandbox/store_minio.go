package sandbox

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// MinIOStore talks to the deploy MinIO (S3 API, path-style).
// The client and bucket are created on first use so API boot does not require MinIO.
type MinIOStore struct {
	cfg    ObjectConfig
	mu     sync.Mutex
	client *minio.Client
}

func NewMinIOStore(cfg ObjectConfig) *MinIOStore {
	return &MinIOStore{cfg: cfg}
}

func (s *MinIOStore) connect(ctx context.Context) (*minio.Client, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.client != nil {
		return s.client, nil
	}
	if strings.TrimSpace(s.cfg.AccessKey) == "" || strings.TrimSpace(s.cfg.SecretKey) == "" {
		return nil, fmt.Errorf("sandbox object storage: access key and secret required (SANDBOX_S3_ACCESS_KEY / SANDBOX_S3_SECRET_KEY or MINIO_ROOT_USER / MINIO_ROOT_PASSWORD)")
	}
	client, err := minio.New(s.cfg.Endpoint, &minio.Options{
		Creds:        credentials.NewStaticV4(s.cfg.AccessKey, s.cfg.SecretKey, ""),
		Secure:       s.cfg.UseSSL,
		Region:       s.cfg.Region,
		BucketLookup: minio.BucketLookupPath,
	})
	if err != nil {
		return nil, fmt.Errorf("sandbox object storage: %w", err)
	}
	exists, err := client.BucketExists(ctx, s.cfg.Bucket)
	if err != nil {
		return nil, fmt.Errorf("sandbox object storage: bucket %s: %w", s.cfg.Bucket, err)
	}
	if !exists {
		if err := client.MakeBucket(ctx, s.cfg.Bucket, minio.MakeBucketOptions{Region: s.cfg.Region}); err != nil {
			return nil, fmt.Errorf("sandbox object storage: create bucket %s: %w", s.cfg.Bucket, err)
		}
	}
	s.client = client
	return client, nil
}

func (s *MinIOStore) Put(ctx context.Context, key string, body []byte) error {
	client, err := s.connect(ctx)
	if err != nil {
		return err
	}
	_, err = client.PutObject(ctx, s.cfg.Bucket, key, bytes.NewReader(body), int64(len(body)), minio.PutObjectOptions{
		ContentType: contentTypeForKey(key),
	})
	if err != nil {
		return fmt.Errorf("sandbox put %s: %w", key, err)
	}
	return nil
}

func (s *MinIOStore) Get(ctx context.Context, key string) ([]byte, error) {
	client, err := s.connect(ctx)
	if err != nil {
		return nil, err
	}
	obj, err := client.GetObject(ctx, s.cfg.Bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, mapMinIOErr(err)
	}
	defer obj.Close()
	st, err := obj.Stat()
	if err != nil {
		return nil, mapMinIOErr(err)
	}
	if st.Size > MaxDownloadBytes {
		return nil, fmt.Errorf("file too large")
	}
	buf, err := io.ReadAll(io.LimitReader(obj, MaxDownloadBytes+1))
	if err != nil {
		return nil, mapMinIOErr(err)
	}
	if int64(len(buf)) > MaxDownloadBytes {
		return nil, fmt.Errorf("file too large")
	}
	return buf, nil
}

func (s *MinIOStore) List(ctx context.Context, prefix string) ([]ObjectInfo, error) {
	client, err := s.connect(ctx)
	if err != nil {
		return nil, err
	}
	var out []ObjectInfo
	for object := range client.ListObjects(ctx, s.cfg.Bucket, minio.ListObjectsOptions{
		Prefix:    prefix,
		Recursive: true,
	}) {
		if object.Err != nil {
			return nil, fmt.Errorf("sandbox list %s: %w", prefix, object.Err)
		}
		if strings.HasSuffix(object.Key, "/") {
			continue
		}
		out = append(out, ObjectInfo{Key: object.Key, Size: object.Size})
	}
	return out, nil
}

func (s *MinIOStore) Delete(ctx context.Context, key string) error {
	client, err := s.connect(ctx)
	if err != nil {
		return err
	}
	err = client.RemoveObject(ctx, s.cfg.Bucket, key, minio.RemoveObjectOptions{})
	if err != nil {
		return fmt.Errorf("sandbox delete %s: %w", key, err)
	}
	return nil
}

func (s *MinIOStore) DeletePrefix(ctx context.Context, prefix string) error {
	infos, err := s.List(ctx, prefix)
	if err != nil {
		return err
	}
	for _, info := range infos {
		if err := s.Delete(ctx, info.Key); err != nil {
			return err
		}
	}
	return nil
}

func mapMinIOErr(err error) error {
	if err == nil {
		return nil
	}
	resp := minio.ToErrorResponse(err)
	switch resp.Code {
	case "NoSuchKey", "NoSuchObject", "NotFound":
		return os.ErrNotExist
	}
	if resp.StatusCode == 404 {
		return os.ErrNotExist
	}
	return err
}
