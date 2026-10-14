package httpserver

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestUploadMemoryTextLeadsWithRecallInstruction(t *testing.T) {
	t.Parallel()
	got := uploadMemoryText("季度报告.pdf", "att-1", strings.Repeat("正文", 5000))
	if !strings.HasPrefix(got, "用户上传过文件「季度报告.pdf」。附件 id：att-1。") {
		t.Fatalf("prefix %q", got[:80])
	}
	if !strings.Contains(got, "read_upload") {
		t.Fatal("missing tool name")
	}
	if utf8.RuneCountInString(got) > 500+uploadMemoryRunes {
		t.Fatalf("too long %d", utf8.RuneCountInString(got))
	}
	idx := strings.Index(got, "附件 id：att-1")
	if idx < 0 || idx > 80 {
		t.Fatalf("id not in the recall window: %d", idx)
	}
}
