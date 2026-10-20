package httpserver

import "testing"

func TestEnvSeedLLM(t *testing.T) {
	cases := []struct {
		name string
		env  map[string]string
		want bool
	}{
		{"example env: openai without key", map[string]string{"OPENAI_BASE_URL": "https://api.openai.com/v1", "OPENAI_MODEL": "gpt-4o-mini"}, false},
		{"empty base without key", map[string]string{"OPENAI_MODEL": "gpt-4o-mini"}, false},
		{"openai with key", map[string]string{"OPENAI_BASE_URL": "https://api.openai.com/v1", "OPENAI_API_KEY": "sk-x", "OPENAI_MODEL": "gpt-4o-mini"}, true},
		{"self-hosted without key", map[string]string{"OPENAI_BASE_URL": "http://127.0.0.1:8000/v1", "OPENAI_MODEL": "qwen"}, true},
		{"no model", map[string]string{"OPENAI_BASE_URL": "https://api.minimax.cn/v1", "OPENAI_API_KEY": "k"}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, ok := envSeedLLM(func(k string) string { return c.env[k] })
			if ok != c.want {
				t.Fatalf("got %v want %v", ok, c.want)
			}
		})
	}
	seed, _ := envSeedLLM(func(k string) string {
		return map[string]string{"OPENAI_MODEL": "m", "OPENAI_BASE_URL": "http://x/v1", "OPENAI_ENABLE_TOOLS": "on"}[k]
	})
	if !seed.EnableTools || seed.Model != "m" {
		t.Fatalf("bad seed %+v", seed)
	}
}
