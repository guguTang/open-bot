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
