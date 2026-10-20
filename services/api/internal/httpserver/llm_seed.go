package httpserver

import (
	"net/url"
	"strings"
)

type llmSeed struct {
	BaseURL     string
	APIKey      string
	Model       string
	EnableTools bool
}

// envSeedLLM decides whether a newly registered user gets a personal
// "默认连接" copied from env OPENAI_*.
//
// A personal default always wins over the admin org LLM (ResolveEffectiveLLM),
// so seeding an unusable connection silently hides the org default: e.g.
// .env.example ships OPENAI_BASE_URL=https://api.openai.com/v1 +
// OPENAI_MODEL=gpt-4o-mini with an empty key, and every new member then chats
// against key-less OpenAI instead of the org's configured model.
//
// Skip when the model is empty, or when the base is OpenAI's hosted API
// without a key (cannot work). Key-less self-hosted bases (vLLM, Ollama) are
// still seeded.
func envSeedLLM(getenv func(string) string) (llmSeed, bool) {
	seed := llmSeed{
		BaseURL: strings.TrimSpace(getenv("OPENAI_BASE_URL")),
		APIKey:  strings.TrimSpace(getenv("OPENAI_API_KEY")),
		Model:   strings.TrimSpace(getenv("OPENAI_MODEL")),
	}
	switch strings.ToLower(strings.TrimSpace(getenv("OPENAI_ENABLE_TOOLS"))) {
	case "1", "true", "yes", "on":
		seed.EnableTools = true
	}
	if seed.Model == "" {
		return seed, false
	}
	if seed.APIKey == "" && isHostedOpenAI(seed.BaseURL) {
		return seed, false
	}
	return seed, true
}

func isHostedOpenAI(base string) bool {
	if base == "" {
		return true // runtime defaults to api.openai.com
	}
	u, err := url.Parse(base)
	if err != nil {
		return false
	}
	return strings.EqualFold(u.Hostname(), "api.openai.com")
}
