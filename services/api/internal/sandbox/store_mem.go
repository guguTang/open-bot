package sandbox

import (
	"context"
	"os"
	"sort"
	"strings"
	"sync"
)

// MemStore is an in-memory ObjectStore for tests and local fallback checks.
type MemStore struct {
	mu   sync.Mutex
	objs map[string][]byte
}

func NewMemStore() *MemStore {
	return &MemStore{objs: map[string][]byte{}}
}

func (s *MemStore) Put(_ context.Context, key string, body []byte) error {
	if strings.TrimSpace(key) == "" {
		return os.ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.objs[key] = append([]byte(nil), body...)
	return nil
}

func (s *MemStore) Get(_ context.Context, key string) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, ok := s.objs[key]
	if !ok {
		return nil, os.ErrNotExist
	}
	return append([]byte(nil), b...), nil
}

func (s *MemStore) List(_ context.Context, prefix string) ([]ObjectInfo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []ObjectInfo
	for k, b := range s.objs {
		if strings.HasPrefix(k, prefix) {
			out = append(out, ObjectInfo{Key: k, Size: int64(len(b))})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Key < out[j].Key })
	return out, nil
}

func (s *MemStore) Delete(_ context.Context, key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.objs, key)
	return nil
}

func (s *MemStore) DeletePrefix(_ context.Context, prefix string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for k := range s.objs {
		if strings.HasPrefix(k, prefix) {
			delete(s.objs, k)
		}
	}
	return nil
}
