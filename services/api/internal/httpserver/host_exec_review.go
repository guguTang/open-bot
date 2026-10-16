package httpserver

import (
	"path/filepath"
	"strings"
	"unicode"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

// Host-exec Auto-review (Grok Bot–aligned): deterministic tiers, no LLM judgment.
//
//  1. hard deny — clearly dangerous patterns, rejected with no confirm card
//  2. confirm  — the command line looks mutating or risky
//  3. auto     — everything else
//
// host_shell has no positive command allowlist. cd, pwd, find, ls, grep, git status,
// interpreters, and pipes of ordinary tools auto-run unless a risky pattern hits.
// find -exec/-execdir of a known read-only utility (du, stat, ls, file, md5,
// shasum, wc, head, tail, cat, echo, or print-only awk) is auto. find -delete,
// -ok/-okdir, and -exec of anything else stay confirm at the built-in tier.
// exec_policy=allow and Auto-review on downgrade built-in confirm to auto
// (no chat card). Hard deny stays deny. A user rule that explicitly says 先询问
// still confirms. exec_policy=ask or Auto-review off keeps confirm.
// User NL rules never override deny.

type hostExecReviewTier string

const (
	hostExecReviewAuto    hostExecReviewTier = "auto"
	hostExecReviewConfirm hostExecReviewTier = "confirm"
	hostExecReviewDeny    hostExecReviewTier = "deny"
)

type hostExecReview struct {
	Tier   hostExecReviewTier
	Reason string // short, user-visible / card copy
	Code   string // stable machine code for tests / logs
}

// Substrings that force confirm (case-insensitive on the raw command).
// Hard-deny rules are checked first and win over this list.
// Command substitution is treated as a dangerous context: the inner command
// is not statically proven safe.
var shellConfirmSubstrings = []string{
	"$(", "\x60",
	"$((",
	"<<",
	"-delete",
	"sudo", "doas", " pkexec",
	"|sh", "| sh", "|bash", "| bash", "|zsh", "| zsh", "|dash", "| dash",
	"|fish", "| fish",
	"curl ", "wget ",
	" nc ", "ncat ", "netcat ",
	"ssh ", "scp ", "sftp ",
	"rm ", "rm\t", "mv ", "mv\t", "cp ", "cp\t",
	"chmod ", "chown ", "chgrp ", "unlink ",
	"mkdir ", "rmdir ", "touch ", "ln ", "dd ",
	"tee ", "truncate ", "shred ",
	"kill ", "pkill ", "killall ",
	"reboot", "shutdown", "halt ",
	"eval ", "source ", " exec ",
	"sed -i", "perl -i", "ruby -i",
	"git push",
	"npm install", "npm ci", "pnpm install", "pnpm add",
	"yarn add", "yarn install",
	"pip install", "pip3 install", "pipx install",
	"brew install", "brew uninstall",
	"apt install", "apt-get install", "apt remove", "apt-get remove",
	"yum install", "dnf install",
	"cargo install", "go install", "gem install",
	"snap install", "flatpak install",
	"choco install", "winget install", "conda install",
	"bun install", "bun add",
}

// First-token binaries that are mutating or risky even with no extra arguments.
var shellRiskyBins = map[string]struct{}{
	"rm": {}, "mv": {}, "cp": {},
	"chmod": {}, "chown": {}, "chgrp": {}, "unlink": {},
	"mkdir": {}, "rmdir": {}, "touch": {}, "ln": {}, "dd": {},
	"tee": {}, "truncate": {}, "shred": {},
	"sudo": {}, "doas": {}, "pkexec": {},
	"ssh": {}, "scp": {}, "sftp": {},
	"curl": {}, "wget": {},
	"kill": {}, "pkill": {}, "killall": {},
	"nc": {}, "ncat": {}, "netcat": {},
	"reboot": {}, "shutdown": {}, "halt": {},
	"eval": {}, "source": {}, "exec": {},
}

// Hard-deny patterns: never execute, no confirm card (Auto-review hard block).
// Keep this list narrow — ordinary deletes/writes stay in the confirm tier.
type hardDenyRule struct {
	substr string
	code   string
	reason string
}

var hostExecHardDenyRules = []hardDenyRule{
	{substr: "curl ", code: "pipe_download_shell", reason: "Auto-review 硬拒绝：下载管道进 shell（如 curl|sh）"},
	{substr: "wget ", code: "pipe_download_shell", reason: "Auto-review 硬拒绝：下载管道进 shell（如 wget|sh）"},
	{substr: "|sh", code: "pipe_to_shell", reason: "Auto-review 硬拒绝：管道进 shell 解释器"},
	{substr: "| sh", code: "pipe_to_shell", reason: "Auto-review 硬拒绝：管道进 shell 解释器"},
	{substr: "|bash", code: "pipe_to_shell", reason: "Auto-review 硬拒绝：管道进 shell 解释器"},
	{substr: "| bash", code: "pipe_to_shell", reason: "Auto-review 硬拒绝：管道进 shell 解释器"},
	{substr: "|zsh", code: "pipe_to_shell", reason: "Auto-review 硬拒绝：管道进 shell 解释器"},
	{substr: "| zsh", code: "pipe_to_shell", reason: "Auto-review 硬拒绝：管道进 shell 解释器"},
	{substr: "|dash", code: "pipe_to_shell", reason: "Auto-review 硬拒绝：管道进 shell 解释器"},
	{substr: "| dash", code: "pipe_to_shell", reason: "Auto-review 硬拒绝：管道进 shell 解释器"},
	{substr: "|fish", code: "pipe_to_shell", reason: "Auto-review 硬拒绝：管道进 shell 解释器"},
	{substr: "| fish", code: "pipe_to_shell", reason: "Auto-review 硬拒绝：管道进 shell 解释器"},
	{substr: ":(){", code: "fork_bomb", reason: "Auto-review 硬拒绝：疑似 fork bomb"},
	{substr: "mkfs", code: "format_disk", reason: "Auto-review 硬拒绝：格式化磁盘"},
	{substr: "of=/dev/", code: "raw_disk_write", reason: "Auto-review 硬拒绝：写入块设备"},
	{substr: "> /dev/sd", code: "raw_disk_write", reason: "Auto-review 硬拒绝：写入块设备"},
	{substr: ">/dev/sd", code: "raw_disk_write", reason: "Auto-review 硬拒绝：写入块设备"},
	{substr: "> /dev/disk", code: "raw_disk_write", reason: "Auto-review 硬拒绝：写入块设备"},
	{substr: ">/dev/disk", code: "raw_disk_write", reason: "Auto-review 硬拒绝：写入块设备"},
	{substr: "dd if=", code: "dd_image", reason: "Auto-review 硬拒绝：dd 磁盘镜像类命令"},
}

func classifyHostExecReview(op, path, dest string) hostExecReview {
	op = strings.TrimSpace(op)
	path = strings.TrimSpace(path)
	dest = strings.TrimSpace(dest)

	switch op {
	case "ls", "read", "ssh_ls", "ssh_read", "open", "list_windows", "ax":
		return hostExecReview{Tier: hostExecReviewAuto, Reason: "只读/可逆操作，Auto-review 自动放行", Code: "readonly_op"}
	case "screenshot":
		return hostExecReview{Tier: hostExecReviewAuto, Reason: "截取屏幕是只读操作，Auto-review 自动放行", Code: "screenshot"}
	case "tcc_status":
		return hostExecReview{Tier: hostExecReviewAuto, Reason: "查看权限是只读操作，Auto-review 自动放行", Code: "tcc_status"}
	case "click":
		return hostExecReview{Tier: hostExecReviewConfirm, Reason: "点击界面，需你确认", Code: "click"}
	case "type":
		return hostExecReview{Tier: hostExecReviewConfirm, Reason: "向界面输入文字，需你确认", Code: "type"}
	case "key":
		return hostExecReview{Tier: hostExecReviewConfirm, Reason: "发送按键，需你确认", Code: "key"}
	case "scroll":
		return hostExecReview{Tier: hostExecReviewConfirm, Reason: "滚动界面，需你确认", Code: "scroll"}
	case "mouse_move":
		return hostExecReview{Tier: hostExecReviewConfirm, Reason: "移动鼠标，需你确认", Code: "mouse_move"}
	case "drag":
		return hostExecReview{Tier: hostExecReviewConfirm, Reason: "拖拽界面，需你确认", Code: "drag"}
	case "write":
		return hostExecReview{Tier: hostExecReviewConfirm, Reason: "写入本机文件，需你确认", Code: "write"}
	case "delete":
		return hostExecReview{Tier: hostExecReviewConfirm, Reason: "删除本机文件，需你确认", Code: "delete"}
	case "move":
		return hostExecReview{Tier: hostExecReviewConfirm, Reason: "移动或重命名，需你确认", Code: "move"}
	case "ssh_write":
		return hostExecReview{Tier: hostExecReviewConfirm, Reason: "写入远程文件，需你确认", Code: "ssh_write"}
	case "ssh_delete":
		return hostExecReview{Tier: hostExecReviewConfirm, Reason: "删除远程文件，需你确认", Code: "ssh_delete"}
	case "ssh_exec":
		return hostExecReview{Tier: hostExecReviewConfirm, Reason: "远程执行命令，需你确认", Code: "ssh_exec"}
	case "email_send":
		return hostExecReview{Tier: hostExecReviewConfirm, Reason: "将通过已连接的 Gmail 发送邮件，需你确认", Code: "email_send_confirm"}
	case "shell":
		if dest == "terminal" {
			return hostExecReview{Tier: hostExecReviewConfirm, Reason: "将打开终端窗口，需你确认", Code: "terminal"}
		}
		if hit, rule := matchHardDenyShell(path); hit {
			return hostExecReview{Tier: hostExecReviewDeny, Reason: rule.reason, Code: rule.code}
		}
		if hostShellAutoEligible(path) {
			return hostExecReview{Tier: hostExecReviewAuto, Reason: "未发现写入或危险模式，Auto-review 自动放行", Code: "shell_auto"}
		}
		return hostExecReview{Tier: hostExecReviewConfirm, Reason: "命令看起来会改动系统或有风险，需你确认", Code: "shell_confirm"}
	default:
		return hostExecReview{Tier: hostExecReviewConfirm, Reason: "未知操作，需你确认", Code: "unknown_op"}
	}
}

func matchHardDenyShell(command string) (bool, hardDenyRule) {
	lower := strings.ToLower(strings.TrimSpace(command))
	if lower == "" {
		return false, hardDenyRule{}
	}
	if isWipeRootCommand(lower) {
		return true, hardDenyRule{
			code:   "wipe_root",
			reason: "Auto-review 硬拒绝：疑似清空根目录",
		}
	}
	pipedShell := strings.Contains(lower, "|sh") || strings.Contains(lower, "| sh") ||
		strings.Contains(lower, "|bash") || strings.Contains(lower, "| bash") ||
		strings.Contains(lower, "|zsh") || strings.Contains(lower, "| zsh") ||
		strings.Contains(lower, "|dash") || strings.Contains(lower, "| dash") ||
		strings.Contains(lower, "|fish") || strings.Contains(lower, "| fish")
	// Prefer a clearer code when download is piped into a shell.
	if pipedShell && (strings.Contains(lower, "curl ") || strings.Contains(lower, "wget ")) {
		return true, hardDenyRule{
			code:   "pipe_download_shell",
			reason: "Auto-review 硬拒绝：下载管道进 shell（如 curl|sh）",
		}
	}
	for _, rule := range hostExecHardDenyRules {
		if rule.code == "pipe_download_shell" {
			continue
		}
		if strings.Contains(lower, strings.ToLower(rule.substr)) {
			return true, rule
		}
	}
	return false, hardDenyRule{}
}

// isWipeRootCommand matches rm -rf / or rm -rf /* (and -fr), but not rm -rf /tmp.
func isWipeRootCommand(lower string) bool {
	for _, prefix := range []string{"rm -rf ", "rm -fr "} {
		idx := strings.Index(lower, prefix)
		for idx >= 0 {
			rest := strings.TrimLeft(lower[idx+len(prefix):], " \t")
			if rest == "/" || rest == "/*" {
				return true
			}
			if strings.HasPrefix(rest, "/") {
				after := rest[1:]
				if after == "" || after == "*" {
					return true
				}
				// "/" followed by path chars → not wipe root (e.g. /tmp)
				if after[0] == ' ' || after[0] == '\t' || after[0] == ';' || after[0] == '&' || after[0] == '|' || after[0] == '\n' {
					return true
				}
			}
			next := strings.Index(lower[idx+len(prefix):], prefix)
			if next < 0 {
				break
			}
			idx = idx + len(prefix) + next
		}
	}
	return false
}

// hostExecNeedsChatConfirm reports whether the chat confirm card is required.
// Hard-deny ops return false here (they are rejected before confirm).
func hostExecNeedsChatConfirm(op, path, dest string) bool {
	return classifyHostExecReview(op, path, dest).Tier == hostExecReviewConfirm
}

func hostExecHardDenied(op, path, dest string) (bool, hostExecReview) {
	rev := classifyHostExecReview(op, path, dest)
	if rev.Tier == hostExecReviewDeny {
		return true, rev
	}
	return false, rev
}

func hostOpNeedsConfirm(op string) bool {
	switch op {
	case "write", "delete", "move", "shell", "ssh_write", "ssh_delete", "ssh_exec", "email_send",
		"click", "type", "key", "scroll", "mouse_move", "drag":
		return true
	default:
		return false
	}
}

// find -exec/-execdir utilities that only read. Anything else confirms.
var findExecReadonlyBins = map[string]struct{}{
	"du": {}, "stat": {}, "ls": {}, "file": {},
	"md5": {}, "shasum": {},
	"wc": {}, "head": {}, "tail": {}, "cat": {}, "echo": {},
}

// findExecBlocksAuto is true when a find -exec/-execdir/-ok cannot be proven
// read-only. Unterminated or unknown utilities confirm. -delete is separate.
func findExecBlocksAuto(command string) bool {
	words := scanShellWords(command)
	for i := 0; i < len(words); i++ {
		switch strings.ToLower(words[i]) {
		case "-ok", "-okdir":
			return true
		case "-exec", "-execdir":
			if !readonlyFindExec(words, i) {
				return true
			}
		}
	}
	return false
}

func readonlyFindExec(words []string, i int) bool {
	if i+1 >= len(words) {
		return false
	}
	util := strings.ToLower(filepath.Base(words[i+1]))
	for j := i + 2; j < len(words); j++ {
		if words[j] != "{}" {
			continue
		}
		if j+1 >= len(words) {
			return false
		}
		term := words[j+1]
		if term != "+" && term != ";" {
			return false
		}
		args := words[i+2 : j]
		if util == "awk" {
			return awkExecPrintOnly(args)
		}
		_, ok := findExecReadonlyBins[util]
		return ok
	}
	return false
}

func awkExecPrintOnly(args []string) bool {
	sawProgram := false
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "--" {
			if i+1 >= len(args) {
				return false
			}
			return awkProgramSafe(args[i+1])
		}
		if a == "-f" || strings.HasPrefix(a, "--file") {
			return false
		}
		if a == "--source" {
			if i+1 >= len(args) || !awkProgramSafe(args[i+1]) {
				return false
			}
			sawProgram = true
			i++
			continue
		}
		if strings.HasPrefix(a, "-") {
			if (a == "-v" || a == "-F" || a == "-E") && !strings.Contains(a, "=") {
				i++
			}
			continue
		}
		if !sawProgram {
			if !awkProgramSafe(a) {
				return false
			}
			sawProgram = true
		}
	}
	return sawProgram
}

func awkProgramSafe(prog string) bool {
	lower := strings.ToLower(prog)
	if !strings.Contains(lower, "print") {
		return false
	}
	for _, bad := range []string{"system", "getline", "delete", "|", ">", "<", "close"} {
		if strings.Contains(lower, bad) {
			return false
		}
	}
	return true
}

func scanShellWords(command string) []string {
	var words []string
	var b strings.Builder
	inSingle, inDouble := false, false
	flush := func() {
		if b.Len() == 0 {
			return
		}
		words = append(words, b.String())
		b.Reset()
	}
	for i := 0; i < len(command); i++ {
		c := command[i]
		if inSingle {
			if c == '\'' {
				inSingle = false
			} else {
				b.WriteByte(c)
			}
			continue
		}
		if inDouble {
			if c == '"' {
				inDouble = false
			} else if c == '\\' && i+1 < len(command) {
				i++
				b.WriteByte(command[i])
			} else {
				b.WriteByte(c)
			}
			continue
		}
		switch c {
		case '\'':
			inSingle = true
		case '"':
			inDouble = true
		case '\\':
			if i+1 < len(command) {
				i++
				b.WriteByte(command[i])
			}
		default:
			if unicode.IsSpace(rune(c)) {
				flush()
			} else {
				b.WriteByte(c)
			}
		}
	}
	flush()
	return words
}

// hostShellAutoEligible is true when a host_shell command can auto-run:
// not empty, not huge, and no mutating/risky pattern. Not an allowlist.
func hostShellAutoEligible(command string) bool {
	cmd := strings.TrimSpace(command)
	if cmd == "" || len(cmd) > 2000 {
		return false
	}
	if findExecBlocksAuto(cmd) {
		return false
	}
	lower := strings.ToLower(cmd)
	for _, bad := range shellConfirmSubstrings {
		if strings.Contains(lower, strings.ToLower(bad)) {
			return false
		}
	}
	if hasNonNullWriteRedirect(cmd) {
		return false
	}
	segments := splitShellSegments(cmd)
	if len(segments) == 0 {
		return false
	}
	for _, seg := range segments {
		if !shellSegmentAutoOK(seg) {
			return false
		}
	}
	return true
}

func shellSegmentAutoOK(seg string) bool {
	seg = strings.TrimSpace(seg)
	if seg == "" || strings.HasSuffix(seg, "&") {
		return false
	}
	args := shellArgs(seg)
	if len(args) == 0 {
		return false
	}
	base := strings.ToLower(filepath.Base(args[0]))
	if _, ok := shellRiskyBins[base]; ok {
		return false
	}
	if segmentGitPush(args) || segmentPackageInstall(args) {
		return false
	}
	return true
}

func shellArgs(seg string) []string {
	s := strings.TrimSpace(seg)
	var args []string
	for {
		tok, rest := takeToken(s)
		if tok == "" {
			break
		}
		s = rest
		if len(args) == 0 && isEnvAssign(tok) {
			continue
		}
		args = append(args, tok)
	}
	return args
}

func isEnvAssign(tok string) bool {
	return strings.Contains(tok, "=") && !strings.HasPrefix(tok, "-") && !strings.Contains(tok, "/")
}

func segmentGitPush(args []string) bool {
	if len(args) == 0 || strings.ToLower(filepath.Base(args[0])) != "git" {
		return false
	}
	for i := 1; i < len(args); i++ {
		a := args[i]
		if flagTakesValue(a) {
			i++
			continue
		}
		if strings.HasPrefix(a, "-") {
			continue
		}
		return strings.EqualFold(a, "push")
	}
	return false
}

func segmentPackageInstall(args []string) bool {
	if len(args) == 0 {
		return false
	}
	base := strings.ToLower(filepath.Base(args[0]))
	rest := args[1:]
	switch base {
	case "go":
		return firstPositionalIs(rest, "install")
	case "npm", "pnpm", "bun":
		return npmStyleInstall(rest)
	case "yarn":
		if len(positionals(rest)) == 0 {
			return true // bare yarn installs dependencies
		}
		return npmStyleInstall(rest)
	case "pip", "pip3", "pipx", "brew", "cargo", "gem", "conda", "choco", "winget", "snap", "flatpak", "composer":
		return firstPositionalIn(rest, "install", "uninstall", "remove", "upgrade", "add", "require")
	case "apt", "apt-get", "yum", "dnf", "zypper":
		return firstPositionalIn(rest, "install", "remove", "purge", "autoremove", "upgrade", "dist-upgrade")
	case "pacman":
		return pacmanMutating(rest)
	default:
		return false
	}
}

func flagTakesValue(flag string) bool {
	switch flag {
	case "-C", "-c", "--cwd", "--prefix", "--directory", "-t", "--target",
		"--git-dir", "--work-tree", "--namespace", "--config", "--registry",
		"--cache", "--file", "-f", "--requirement":
		return true
	default:
		return false
	}
}

func positionals(args []string) []string {
	var out []string
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "--" {
			out = append(out, args[i+1:]...)
			break
		}
		if flagTakesValue(a) {
			i++
			continue
		}
		if strings.HasPrefix(a, "-") {
			continue
		}
		out = append(out, a)
	}
	return out
}

func firstPositionalIs(args []string, verb string) bool {
	pos := positionals(args)
	return len(pos) > 0 && strings.EqualFold(pos[0], verb)
}

func firstPositionalIn(args []string, verbs ...string) bool {
	pos := positionals(args)
	if len(pos) == 0 {
		return false
	}
	for _, v := range verbs {
		if strings.EqualFold(pos[0], v) {
			return true
		}
	}
	return false
}

func npmStyleInstall(args []string) bool {
	pos := positionals(args)
	if len(pos) == 0 {
		return false
	}
	switch strings.ToLower(pos[0]) {
	case "install", "i", "add", "ci", "uninstall", "un", "remove", "rm", "update", "upgrade":
		return true
	default:
		return false
	}
}

func pacmanMutating(args []string) bool {
	for _, a := range args {
		switch strings.ToLower(a) {
		case "-s", "-sy", "-syu", "-syy", "-syyu", "-su", "-u",
			"-r", "-rn", "-rns", "-runs", "--sync", "--remove", "--upgrade":
			return true
		}
	}
	return false
}

func hasNonNullWriteRedirect(cmd string) bool {
	// Scan for > or >> not part of 2> / &> discards to /dev/null.
	// Ignore > inside single/double quotes.
	i := 0
	inSingle, inDouble := false, false
	for i < len(cmd) {
		c := cmd[i]
		if c == '\'' && !inDouble {
			inSingle = !inSingle
			i++
			continue
		}
		if c == '"' && !inSingle {
			inDouble = !inDouble
			i++
			continue
		}
		if inSingle || inDouble || c != '>' {
			i++
			continue
		}
		j := i
		for j < len(cmd) && cmd[j] == '>' {
			j++
		}
		rest := strings.TrimSpace(cmd[j:])
		target := firstShellToken(rest)
		if target != "/dev/null" && target != "nul" {
			return true
		}
		i = j
	}
	return false
}

func splitShellSegments(cmd string) []string {
	// Split on |, ;, &&, || while ignoring those inside simple quotes.
	var out []string
	var b strings.Builder
	inSingle, inDouble := false, false
	for i := 0; i < len(cmd); i++ {
		c := cmd[i]
		if c == '\'' && !inDouble {
			inSingle = !inSingle
			b.WriteByte(c)
			continue
		}
		if c == '"' && !inSingle {
			inDouble = !inDouble
			b.WriteByte(c)
			continue
		}
		if !inSingle && !inDouble {
			if c == '|' || c == ';' {
				if c == '|' && i+1 < len(cmd) && cmd[i+1] == '|' {
					seg := strings.TrimSpace(b.String())
					if seg != "" {
						out = append(out, seg)
					}
					b.Reset()
					i++
					continue
				}
				if c == '|' {
					seg := strings.TrimSpace(b.String())
					if seg != "" {
						out = append(out, seg)
					}
					b.Reset()
					continue
				}
				// ;
				seg := strings.TrimSpace(b.String())
				if seg != "" {
					out = append(out, seg)
				}
				b.Reset()
				continue
			}
			if c == '&' && i+1 < len(cmd) && cmd[i+1] == '&' {
				seg := strings.TrimSpace(b.String())
				if seg != "" {
					out = append(out, seg)
				}
				b.Reset()
				i++
				continue
			}
		}
		b.WriteByte(c)
	}
	seg := strings.TrimSpace(b.String())
	if seg != "" {
		out = append(out, seg)
	}
	return out
}

func firstShellToken(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	// Skip leading VAR=value assignments (rare for read-only; still take next token).
	for {
		tok, rest := takeToken(s)
		if tok == "" {
			return ""
		}
		if strings.Contains(tok, "=") && !strings.HasPrefix(tok, "-") && !strings.Contains(tok, "/") {
			// Likely ENV=val — skip and continue.
			s = rest
			continue
		}
		return tok
	}
}

func takeToken(s string) (tok, rest string) {
	s = strings.TrimLeftFunc(s, unicode.IsSpace)
	if s == "" {
		return "", ""
	}
	if s[0] == '\'' || s[0] == '"' {
		q := s[0]
		end := 1
		for end < len(s) && s[end] != q {
			end++
		}
		if end < len(s) {
			return s[1:end], s[end+1:]
		}
		return s[1:], ""
	}
	end := 0
	for end < len(s) && !unicode.IsSpace(rune(s[end])) {
		end++
	}
	return s[:end], s[end:]
}

// applyUserAutoReview layers per-user prefs on top of built-in Auto-review tiers.
//
// Order (Grok-aligned):
//  1. hard deny stays deny (built-in, always-on; user rules cannot override)
//  2. if auto_review_enabled is false → everything that was auto becomes confirm
//  3. user NL rules: ask_first wins over auto_allow on conflict
//     - ask_first upgrades auto → confirm
//     - auto_allow may downgrade confirm → auto (never deny)
//
// Matching is simple keyword/intent against op + path + dest + reason — not the chat LLM.
func applyUserAutoReview(base hostExecReview, settings db.UserSettings, op, path, dest string) hostExecReview {
	if base.Tier == hostExecReviewDeny {
		return base
	}
	if !settings.AutoReviewEnabled {
		if base.Tier == hostExecReviewAuto {
			return hostExecReview{
				Tier:   hostExecReviewConfirm,
				Reason: "自动审核已关闭，需你确认",
				Code:   "auto_review_off",
			}
		}
		return base
	}
	haystack := buildAutoReviewHaystack(op, path, dest, base.Reason)
	ask, allow := matchUserAutoReviewRules(settings.AutoReviewRules, haystack)
	if ask {
		if base.Tier == hostExecReviewAuto {
			return hostExecReview{
				Tier:   hostExecReviewConfirm,
				Reason: "用户规则：先询问",
				Code:   "user_rule_ask_first",
			}
		}
		return base
	}
	if allow && base.Tier == hostExecReviewConfirm {
		return hostExecReview{
			Tier:   hostExecReviewAuto,
			Reason: "用户规则：自动允许",
			Code:   "user_rule_auto_allow",
		}
	}
	return base
}

func buildAutoReviewHaystack(op, path, dest, reason string) string {
	parts := []string{
		op, path, dest, reason,
		hostOpChineseLabel(op),
	}
	if dest == "terminal" {
		parts = append(parts, "终端", "terminal")
	}
	return strings.ToLower(strings.Join(parts, " "))
}

func hostOpChineseLabel(op string) string {
	switch strings.TrimSpace(op) {
	case "ls", "read", "open":
		return "本机只读 打开文件 列表"
	case "screenshot":
		return "截取屏幕 屏幕录制"
	case "tcc_status":
		return "查看权限 屏幕录制 辅助功能 发送事件"
	case "list_windows", "ax":
		return "查看界面 窗口 辅助功能"
	case "click":
		return "点击界面 桌面操控"
	case "type":
		return "输入文字 桌面操控"
	case "key":
		return "发送按键 桌面操控"
	case "scroll":
		return "滚动界面 桌面操控"
	case "mouse_move":
		return "移动鼠标 桌面操控"
	case "drag":
		return "拖拽界面 桌面操控"
	case "write":
		return "写入本机文件"
	case "delete":
		return "删除本机文件"
	case "move":
		return "移动重命名"
	case "shell":
		return "本机命令 shell 运行命令"
	case "ssh_ls", "ssh_read":
		return "远程只读"
	case "ssh_write", "ssh_delete", "ssh_exec":
		return "远程写入 远程删除 远程命令"
	case "email_send":
		return "发送邮件 Gmail"
	default:
		return op
	}
}

func matchUserAutoReviewRules(rules []db.AutoReviewRule, haystack string) (askFirst, autoAllow bool) {
	for _, r := range rules {
		when := strings.TrimSpace(r.When)
		if when == "" {
			continue
		}
		if !ruleMatchesHaystack(when, haystack) {
			continue
		}
		switch r.Action {
		case db.AutoReviewAskFirst:
			askFirst = true
		case db.AutoReviewAutoAllow:
			autoAllow = true
		}
	}
	return askFirst, autoAllow
}

func ruleMatchesHaystack(when, haystack string) bool {
	w := strings.ToLower(strings.TrimSpace(when))
	if w == "" {
		return false
	}
	// Whole-phrase match first.
	if strings.Contains(haystack, w) {
		return true
	}
	// Tokenize on whitespace / common CJK punctuation; require any token ≥2 runes.
	for _, sep := range []string{" ", "\t", "，", ",", "、", "/", "|", "；", ";", "：", ":", "。"} {
		w = strings.ReplaceAll(w, sep, " ")
	}
	for _, tok := range strings.Fields(w) {
		tok = strings.TrimSpace(tok)
		if len([]rune(tok)) < 2 {
			continue
		}
		if strings.Contains(haystack, tok) {
			return true
		}
	}
	return false
}

// classifyHostExecReviewForUser applies built-in tiers then user Auto-review prefs.
func classifyHostExecReviewForUser(op, path, dest string, settings db.UserSettings) hostExecReview {
	return applyUserAutoReview(classifyHostExecReview(op, path, dest), settings, op, path, dest)
}

// classifyHostExecReviewForMachine applies per-machine exec_policy on top of user Auto-review.
//
// allow + Auto-review on: no confirm card. Built-in confirm becomes auto.
// A matching 先询问 rule still confirms. Hard deny stays deny (no Allow card).
// ask: force confirm (Auto-review off) except hard deny.
// deny: reject before review.
func classifyHostExecReviewForMachine(op, path, dest string, settings db.UserSettings, policy string) hostExecReview {
	policy = db.NormalizeMachineExecPolicy(policy)
	if policy == db.MachineExecDeny {
		return hostExecReview{
			Tier:   hostExecReviewDeny,
			Reason: "这台电脑已设置为不允许执行",
			Code:   "exec_policy_deny",
		}
	}
	effective := settings
	if policy == db.MachineExecAsk {
		effective.AutoReviewEnabled = false
	}
	rev := classifyHostExecReviewForUser(op, path, dest, effective)
	if policy != db.MachineExecAllow || !settings.AutoReviewEnabled || rev.Tier != hostExecReviewConfirm {
		return rev
	}
	haystack := buildAutoReviewHaystack(op, path, dest, rev.Reason)
	if ask, _ := matchUserAutoReviewRules(settings.AutoReviewRules, haystack); ask {
		return hostExecReview{
			Tier:   hostExecReviewConfirm,
			Reason: "用户规则：先询问",
			Code:   "user_rule_ask_first",
		}
	}
	return hostExecReview{
		Tier:   hostExecReviewAuto,
		Reason: "这台电脑设置为始终允许，自动执行",
		Code:   "exec_policy_allow",
	}
}
