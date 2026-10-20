package httpserver

import (
	"strings"
	"unicode/utf8"
)

const (
	statusWaitText  = "还在做，好了发这里。"
	cancelTaskText  = "已停下。"
	taskFailText    = "这件我没做成：没有改到文件。"
	taskTimeoutText = "这件做超时了，你可以让我接着做。"

	// pendingTaskInstructionPrefix is the host-injected cue for defer_work delivery
	// turns (see buildPendingTaskInstruction). Structured routing prefers an open
	// conversation_tasks row + payload flags (background / owner_task /
	// task_continuation); this string is a fallback marker only.
	pendingTaskInstructionPrefix = "你有一条尚未交付的后台任务"
)

type sendGate int

const (
	gateNone sendGate = iota
	gateCancel
	gateFollowUp
)

func isCancelPhrase(content string) bool {
	content = strings.TrimSpace(content)
	if content == "" || utf8.RuneCountInString(content) > 16 {
		return false
	}
	for _, p := range []string{"别做了", "不用了", "取消", "停下", "停止", "停"} {
		if strings.Contains(content, p) {
			return true
		}
	}
	return false
}

// classifySend looks only at whether a backend agent is already running.
// The words of the message are not a delivery signal.
func classifySend(content string, taskOpen bool) sendGate {
	if !taskOpen {
		return gateNone
	}
	if isCancelPhrase(content) {
		return gateCancel
	}
	return gateFollowUp
}

// isPendingTaskContinuationPrompt reports whether content looks like the host
// unfinished-background-task cue. Prefer OpenConversationTask / task_continuation
// flags; keep this as a string fallback so such prompts never re-enter Auto选人.
func isPendingTaskContinuationPrompt(content string) bool {
	return strings.Contains(content, pendingTaskInstructionPrefix)
}

// buildPendingTaskInstruction is the system/user cue for a defer_work delivery turn.
func buildPendingTaskInstruction(goal string) string {
	return pendingTaskInstructionPrefix + "，必须在本轮用工具真正做完，不能只回复承诺或「稍后」。\n目标：\n" +
		strings.TrimSpace(goal) + "\n完成后：用简短中文报告结果；若改了文件请给出可打开的链接。若做不到，说明卡在哪一步。"
}

// openTaskSendPlan skips Auto选人 / decision and pins the turn to the bot that
// owns the pending background work.
func openTaskSendPlan(agentID string) *groupSendPlan {
	agentID = strings.TrimSpace(agentID)
	if agentID == "" {
		return &groupSendPlan{Targets: nil}
	}
	return &groupSendPlan{
		Targets: []string{agentID},
		AutoPick: &groupAutoPickResult{
			AgentIDs:            []string{agentID},
			Confidence:          1,
			Method:              "open_task",
			AllowSecondFailOpen: false,
			LeadFallback:        map[string]bool{agentID: true},
		},
	}
}
