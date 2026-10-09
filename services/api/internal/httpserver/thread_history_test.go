package httpserver

import (
	"strings"
	"testing"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

func TestHistoryForRuntimeIgnoresThreadReplies(t *testing.T) {
	msgs := []db.Message{
		{ID: "r1", Role: "user", Content: "主线问题"},
		{ID: "a1", Role: "assistant", Content: "主线回答", AgentID: "bot-a"},
		{ID: "u2", Role: "user", Content: "线程里追问", ReplyToID: "a1", ThreadRootID: "a1"},
		{ID: "a2", Role: "assistant", Content: "线程回答", AgentID: "bot-a", ReplyToID: "u2", ThreadRootID: "a1"},
		{ID: "u3", Role: "user", Content: "主线继续"},
	}
	out := historyForRuntime(msgs, "", nil)
	if len(out) != 3 {
		t.Fatalf("main timeline should exclude thread msgs, got %#v", out)
	}
	if out[0].Content != "主线问题" || out[2].Content != "主线继续" {
		t.Fatalf("unexpected %#v", out)
	}
}

func TestHistoryForThreadRuntimeIncludesRootAndOptionalMainSummary(t *testing.T) {
	msgs := []db.Message{
		{ID: "s0", Role: "summary", Content: "主线摘要：讨论过部署"},
		{ID: "r1", Role: "user", Content: "怎么部署？"},
		{ID: "a1", Role: "assistant", Content: "用 make dev", AgentID: "bot-a"},
		{ID: "u2", Role: "user", Content: "端口呢？", ReplyToID: "a1", ThreadRootID: "a1"},
		{ID: "a2", Role: "assistant", Content: "8080", AgentID: "bot-a", ReplyToID: "u2", ThreadRootID: "a1"},
		{ID: "u3", Role: "user", Content: "再确认下", ReplyToID: "a2", ThreadRootID: "a1"},
	}
	out := historyForThreadRuntime(msgs, "a1", "", nil)
	if len(out) < 4 {
		t.Fatalf("expected summary+root+thread, got %#v", out)
	}
	if out[0].Role != "summary" || !strings.Contains(out[0].Content, "主线摘要") {
		t.Fatalf("missing main summary: %#v", out[0])
	}
	joined := ""
	for _, m := range out {
		joined += m.Content + "|"
	}
	if !strings.Contains(joined, "用 make dev") || !strings.Contains(joined, "端口呢") {
		t.Fatalf("missing thread content: %s", joined)
	}
	if strings.Contains(joined, "怎么部署") {
		// root is assistant a1; user r1 is NOT in thread filter (only root id + thread_root_id)
		// r1 is not included — that's OK for Slack-style (root = a1)
	}
}

func TestFormatReplyContextPrefix(t *testing.T) {
	parent := &db.Message{Role: "assistant", Content: "这是一段很长的助手回复内容用于截断测试", AgentID: "bot-a"}
	p := formatReplyContextPrefix(parent, "码农助手")
	if !strings.Contains(p, "【回复 码农助手：") {
		t.Fatalf("prefix=%q", p)
	}
	if !strings.HasSuffix(strings.TrimRight(p, "\n"), "」】") && !strings.Contains(p, "」】") {
		t.Fatalf("bad wrap: %q", p)
	}
}

func TestInjectReplyIntoUserContent(t *testing.T) {
	hist := []runtimeMsg{
		{Role: "assistant", Content: "旧"},
		{Role: "user", Content: "新问题"},
	}
	content, out := injectReplyIntoUserContent("新问题", hist, "【回复 助手：「旧」】\n")
	if !strings.HasPrefix(content, "【回复") {
		t.Fatalf("content=%q", content)
	}
	if !strings.HasPrefix(out[len(out)-1].Content, "【回复") {
		t.Fatalf("history user=%q", out[len(out)-1].Content)
	}
}

func TestResolveThreadRoot(t *testing.T) {
	top := &db.Message{ID: "m1"}
	if db.ResolveThreadRoot(top) != "m1" {
		t.Fatal("top-level parent should become root")
	}
	nested := &db.Message{ID: "m2", ThreadRootID: "m1"}
	if db.ResolveThreadRoot(nested) != "m1" {
		t.Fatal("nested should inherit")
	}
}

func TestResolveSendTargetsReplyDefaultsToBot(t *testing.T) {
	s := &Server{}
	// Without a real DB channel path: DM always returns conv agent — covered elsewhere.
	// Unit-test the replyParent branch via a fake by calling the function with empty channel
	conv := &db.Conversation{AgentID: "open-bot", ChannelID: ""}
	parent := &db.Message{Role: "assistant", AgentID: "other-bot"}
	got, err := s.resolveSendTargets("u", conv, nil, "继续", parent)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0] != "open-bot" {
		t.Fatalf("DM should still use conv agent, got %#v", got)
	}
}

func TestHistoryForRuntimeLabelsOtherAgents(t *testing.T) {
	msgs := []db.Message{
		{ID: "u1", Role: "user", Content: "@A 你好"},
		{ID: "a1", Role: "assistant", Content: "我是A", AgentID: "bot-a"},
		{ID: "u2", Role: "user", Content: "@B 接着说"},
		{ID: "a2", Role: "assistant", Content: "我是B", AgentID: "bot-b"},
	}
	names := map[string]string{"bot-a": "助手A", "bot-b": "助手B"}
	out := historyForRuntime(msgs, "bot-b", names)
	if len(out) != 4 {
		t.Fatalf("len=%d %#v", len(out), out)
	}
	// A's assistant must not be bare assistant as B's voice.
	if out[1].Role != "user" || !strings.Contains(out[1].Content, "【助手A】") || !strings.Contains(out[1].Content, "我是A") {
		t.Fatalf("expected labeled other-agent turn, got %#v", out[1])
	}
	if out[3].Role != "assistant" || out[3].Content != "我是B" {
		t.Fatalf("same-agent assistant should stay assistant, got %#v", out[3])
	}
}

func TestHistoryForThreadRuntimeLabelsOtherAgents(t *testing.T) {
	msgs := []db.Message{
		{ID: "r1", Role: "assistant", Content: "根回复A", AgentID: "bot-a"},
		{ID: "u2", Role: "user", Content: "@B 追问", ReplyToID: "r1", ThreadRootID: "r1"},
		{ID: "a2", Role: "assistant", Content: "线程里B", AgentID: "bot-b", ReplyToID: "u2", ThreadRootID: "r1"},
	}
	names := map[string]string{"bot-a": "助手A", "bot-b": "助手B"}
	out := historyForThreadRuntime(msgs, "r1", "bot-b", names)
	foundLabeled := false
	for _, m := range out {
		if m.Role == "user" && strings.Contains(m.Content, "【助手A】") {
			foundLabeled = true
		}
		if m.Role == "assistant" && m.Content == "根回复A" {
			t.Fatalf("other-agent root must not stay bare assistant: %#v", out)
		}
	}
	if !foundLabeled {
		t.Fatalf("expected labeled A in thread history: %#v", out)
	}
}
