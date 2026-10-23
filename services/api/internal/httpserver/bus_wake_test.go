package httpserver

import (
	"strings"
	"testing"
)

func TestPriorityWakeNoticeRequiresDeliverable(t *testing.T) {
	notice := priorityWakeNotice("文案编辑")
	must := []string{
		"所有权",
		"用户",
		"交付",
		"purpose",
		"工具",
		"文案编辑",
	}
	for _, needle := range must {
		if !strings.Contains(notice, needle) {
			t.Fatalf("wake notice missing %q: %s", needle, notice)
		}
	}
	// Instruction structure (not a product reply filter): acknowledge-only is disallowed.
	if !strings.Contains(notice, "不要只确认") && !strings.Contains(notice, "不要只说你会处理") {
		t.Fatalf("wake notice should forbid ack-only: %s", notice)
	}
	if !strings.Contains(notice, "实质") {
		t.Fatalf("wake notice should require substance before closing: %s", notice)
	}
}

func TestPriorityWakeNoticeEmptyLabelFallback(t *testing.T) {
	notice := priorityWakeNotice("  ")
	if !strings.Contains(notice, "同事") {
		t.Fatalf("empty label should fall back: %s", notice)
	}
}

func TestSourceHintMarksHandoffWake(t *testing.T) {
	if got := sourceHint("协作唤醒 ← 编程工程师"); got != "handoff_wake" {
		t.Fatalf("got %q", got)
	}
	if got := sourceHint("例行任务"); got != "routine" {
		t.Fatalf("routine: got %q", got)
	}
}
