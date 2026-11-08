package httpserver

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIsVisionInputReject(t *testing.T) {
	if !isVisionInputReject("upstream HTTP 400: unknown field image_url") {
		t.Fatal("image_url")
	}
	if !isVisionInputReject("model does not support image input") {
		t.Fatal("english")
	}
	if !isVisionInputReject("该模型不支持图像输入") {
		t.Fatal("chinese")
	}
	if isVisionInputReject("upstream HTTP 400: invalid json") {
		t.Fatal("unrelated")
	}
}

func TestProbeLLMVisionSupported(t *testing.T) {
	var sawImage bool
	var sawStream bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/chat/completions") {
			http.NotFound(w, r)
			return
		}
		body, _ := io.ReadAll(r.Body)
		var payload map[string]any
		_ = json.Unmarshal(body, &payload)
		if payload["stream"] == false {
			sawStream = true
		}
		raw := string(body)
		if strings.Contains(raw, "image_url") && strings.Contains(raw, "data:image/png;base64,") {
			sawImage = true
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]any{"content": "ok"}}},
		})
	}))
	defer srv.Close()

	res := probeLLMVision(context.Background(), srv.URL+"/v1", "sk-test", "gpt-4o")
	if !res.OK || !res.SupportsVision {
		t.Fatalf("%+v", res)
	}
	if !sawImage || !sawStream {
		t.Fatalf("image=%v stream=%v", sawImage, sawStream)
	}
}

func TestProbeLLMVisionRejectedButChatWorks(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		_ = json.NewDecoder(r.Body).Decode(&payload)
		msgs, _ := payload["messages"].([]any)
		if len(msgs) > 0 {
			if m, ok := msgs[0].(map[string]any); ok {
				if _, isList := m["content"].([]any); isList {
					w.WriteHeader(http.StatusBadRequest)
					_, _ = w.Write([]byte(`{"error":{"message":"model does not support image input"}}`))
					return
				}
			}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]any{"content": "pong"}}},
		})
	}))
	defer srv.Close()

	res := probeLLMVision(context.Background(), srv.URL, "sk-test", "small-text")
	if !res.OK || res.SupportsVision {
		t.Fatalf("%+v", res)
	}
	if !strings.Contains(res.Detail, "不接受图像") && !strings.Contains(res.Detail, "不支持") && !strings.Contains(res.Detail, "拒绝图像") {
		t.Fatalf("detail %q", res.Detail)
	}
	if res.Hint == visionProbeUnconfirmedHint {
		t.Fatal("confirmed text-only should not use the unconfirmed hint")
	}
}

func TestProbeLLMVisionUpstreamDown(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	srv.Close()
	res := probeLLMVision(context.Background(), srv.URL, "sk-test", "gpt-4o")
	if res.OK || res.SupportsVision {
		t.Fatalf("%+v", res)
	}
	if res.Hint != visionProbeUnconfirmedHint {
		t.Fatalf("hint %q", res.Hint)
	}
}

func TestProbeLLMVisionChatAlsoFails(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"bad key"}`))
	}))
	defer srv.Close()
	res := probeLLMVision(context.Background(), srv.URL, "sk-test", "gpt-4o")
	if res.OK || res.SupportsVision {
		t.Fatalf("%+v", res)
	}
	if res.Hint != visionProbeUnconfirmedHint {
		t.Fatalf("hint %q", res.Hint)
	}
}
