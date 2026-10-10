package sandbox

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	DefaultImage        = "openbot-sandbox:dev"
	DefaultDesktopImage = "openbot-sandbox-desktop:dev"
	DefaultDataRoot     = "data/sandboxes"
	DefaultMemoryMB     = 512
	DefaultCPUs         = 1.0
	MaxExecOutputBytes  = 256 * 1024
	// MaxDownloadBytes caps a single workspace file download from the chat UI.
	MaxDownloadBytes = 64 * 1024 * 1024
)

var sanitizer = regexp.MustCompile(`[^a-zA-Z0-9_-]+`)

type Config struct {
	Enabled      bool
	Image        string
	DesktopImage string
	DesktopPort  int    // container port for noVNC/webtop (default 6080)
	DataRoot     string // absolute host path
	MemoryMB     int
	CPUs         float64
	NetworkMode  string // "" = default bridge; "none" for lockdown demos
	DockerBin    string
}

func LoadConfig() Config {
	enabled := true
	switch strings.ToLower(strings.TrimSpace(os.Getenv("SANDBOX_ENABLED"))) {
	case "0", "false", "no", "off":
		enabled = false
	}
	img := strings.TrimSpace(os.Getenv("SANDBOX_IMAGE"))
	if img == "" {
		img = DefaultImage
	}
	desk := strings.TrimSpace(os.Getenv("SANDBOX_DESKTOP_IMAGE"))
	if desk == "" {
		desk = DefaultDesktopImage
	}
	deskPort := 6080
	if v := strings.TrimSpace(os.Getenv("SANDBOX_DESKTOP_PORT")); v != "" {
		if n, e := strconv.Atoi(v); e == nil && n > 0 {
			deskPort = n
		}
	}
	root := strings.TrimSpace(os.Getenv("SANDBOX_DATA_ROOT"))
	if root == "" {
		if base := strings.TrimSpace(os.Getenv("OPEN_BOT_ROOT")); base != "" {
			root = filepath.Join(base, DefaultDataRoot)
		} else {
			cwd, _ := os.Getwd()
			root = filepath.Join(cwd, DefaultDataRoot)
		}
	}
	abs, err := filepath.Abs(root)
	if err == nil {
		root = abs
	}
	mem := DefaultMemoryMB
	if v := strings.TrimSpace(os.Getenv("SANDBOX_MEMORY_MB")); v != "" {
		if n, e := strconv.Atoi(v); e == nil && n > 0 {
			mem = n
		}
	}
	cpus := DefaultCPUs
	if v := strings.TrimSpace(os.Getenv("SANDBOX_CPUS")); v != "" {
		if f, e := strconv.ParseFloat(v, 64); e == nil && f > 0 {
			cpus = f
		}
	}
	net := strings.TrimSpace(os.Getenv("SANDBOX_NETWORK_MODE"))
	bin := strings.TrimSpace(os.Getenv("DOCKER_BIN"))
	if bin == "" {
		bin = "docker"
	}
	return Config{
		Enabled:      enabled,
		Image:        img,
		DesktopImage: desk,
		DesktopPort:  deskPort,
		DataRoot:     root,
		MemoryMB:     mem,
		CPUs:         cpus,
		NetworkMode:  net,
		DockerBin:    bin,
	}
}

// Manager is the Docker CLI implementation of Provider.
type Manager struct {
	Cfg Config
}

func NewManager(cfg Config) *Manager {
	return &Manager{Cfg: cfg}
}

func SanitizeUserID(userID string) string {
	s := sanitizer.ReplaceAllString(strings.TrimSpace(userID), "-")
	if s == "" {
		s = "unknown"
	}
	if len(s) > 48 {
		s = s[:48]
	}
	return s
}

func (m *Manager) ContainerName(userID string) string {
	return "openbot-sbx-" + SanitizeUserID(userID)
}

// WorkdirHost returns the team-mode mount root (user home). Prefer MountRootHost for mode-aware paths.
func (m *Manager) WorkdirHost(userID string) string {
	return m.UserHomeHost(userID)
}

func (m *Manager) Available(ctx context.Context) error {
	if !m.Cfg.Enabled {
		return fmt.Errorf("%w: SANDBOX_ENABLED=0", ErrDockerUnavailable)
	}
	cmd := exec.CommandContext(ctx, m.Cfg.DockerBin, "info", "--format", "{{.ServerVersion}}")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return fmt.Errorf("%w: %s", ErrDockerUnavailable, msg)
	}
	if strings.TrimSpace(string(out)) == "" {
		return fmt.Errorf("%w: empty docker info", ErrDockerUnavailable)
	}
	return nil
}

type containerInspect struct {
	ID     string `json:"Id"`
	Name   string `json:"Name"`
	Config struct {
		Image string `json:"Image"`
	} `json:"Config"`
	State struct {
		Running bool   `json:"Running"`
		Status  string `json:"Status"`
	} `json:"State"`
	NetworkSettings struct {
		Ports map[string][]struct {
			HostIP   string `json:"HostIp"`
			HostPort string `json:"HostPort"`
		} `json:"Ports"`
	} `json:"NetworkSettings"`
}

func (m *Manager) inspect(ctx context.Context, nameOrID string) (*containerInspect, error) {
	cmd := exec.CommandContext(ctx, m.Cfg.DockerBin, "inspect", nameOrID)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		low := strings.ToLower(stderr.String() + err.Error())
		if strings.Contains(low, "no such object") || strings.Contains(low, "no such container") {
			return nil, nil
		}
		return nil, fmt.Errorf("docker inspect: %s", strings.TrimSpace(stderr.String()))
	}
	var list []containerInspect
	if err := json.Unmarshal(out, &list); err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return nil, nil
	}
	return &list[0], nil
}

// Ensure brings up the per-user container with team/private layout.
// Soft-fails docker unavailability via ErrDockerUnavailable.
// If workspace is empty and a checkpoint exists, Restore runs first.
// When req.Desktop is true, starts/reuses a desktop image with noVNC published on localhost
// and fills Instance.DesktopPort / DesktopToken. Explicit desktop requests do not silently
// fall back to the CLI image (callers get a clear error instead).
func (m *Manager) Ensure(ctx context.Context, req EnsureRequest) (*Instance, error) {
	userID := strings.TrimSpace(req.UserID)
	if userID == "" {
		return nil, errors.New("user_id required")
	}
	mode := NormalizeMode(string(req.Mode))
	agentID := strings.TrimSpace(req.AgentID)

	mountRoot, err := m.EnsureLayout(userID, agentID, mode)
	if err != nil {
		return nil, err
	}

	restored := ""
	if !hasLiveData(m.UserHomeHost(userID)) {
		if e := m.Restore(ctx, userID); e == nil {
			if b, re := os.ReadFile(m.LatestCheckpointMarker(userID)); re == nil {
				ts := strings.TrimSpace(string(b))
				if ts != "" {
					restored = filepath.Join(m.CheckpointsHost(userID), ts)
				}
			}
		}
	}

	if err := m.Available(ctx); err != nil {
		return &Instance{
			WorkdirHost:  mountRoot,
			Image:        m.imageFor(req.Desktop),
			Mode:         mode,
			AgentID:      agentID,
			RestoredFrom: restored,
		}, err
	}

	image := m.imageFor(req.Desktop)
	name := m.ContainerName(userID)
	wantPort := m.desktopContainerPort()

	info, err := m.inspect(ctx, name)
	if err != nil {
		return nil, err
	}
	if info != nil {
		needRecreate := false
		if req.Desktop {
			hostPort := hostPortFromInspect(info, wantPort)
			if !info.State.Running || hostPort <= 0 {
				needRecreate = true
			}
			// Recreate when switching from CLI image to desktop image.
			if info.Config.Image != "" && info.Config.Image != image && !strings.HasPrefix(info.Config.Image, image) {
				// Image field may be digests; still recreate if no desktop port mapped.
				if hostPort <= 0 {
					needRecreate = true
				}
			}
		}
		if !needRecreate {
			if info.State.Running {
				inst := &Instance{
					ContainerID:  shortID(info.ID),
					WorkdirHost:  mountRoot,
					Image:        image,
					Mode:         mode,
					AgentID:      agentID,
					RestoredFrom: restored,
				}
				if req.Desktop {
					inst.DesktopPort = hostPortFromInspect(info, wantPort)
					inst.DesktopToken = newDesktopToken()
				}
				return inst, nil
			}
			start := exec.CommandContext(ctx, m.Cfg.DockerBin, "start", name)
			var stderr bytes.Buffer
			start.Stderr = &stderr
			if _, e := start.Output(); e == nil {
				info2, e2 := m.inspect(ctx, name)
				if e2 == nil && info2 != nil && info2.State.Running {
					inst := &Instance{
						ContainerID:  shortID(info2.ID),
						WorkdirHost:  mountRoot,
						Image:        image,
						Mode:         mode,
						AgentID:      agentID,
						RestoredFrom: restored,
					}
					if req.Desktop {
						inst.DesktopPort = hostPortFromInspect(info2, wantPort)
						inst.DesktopToken = newDesktopToken()
						if inst.DesktopPort <= 0 {
							needRecreate = true
						} else {
							return inst, nil
						}
					} else {
						return inst, nil
					}
				}
			}
			needRecreate = true
		}
		if needRecreate || info != nil {
			_ = m.removeContainer(ctx, name)
		}
	}

	mem := m.Cfg.MemoryMB
	if req.Desktop && mem < 1024 {
		mem = 1024
	}
	args := []string{
		"run", "-d",
		"--pull", "never",
		"--name", name,
		"--restart", "unless-stopped",
		"--memory", fmt.Sprintf("%dm", mem),
		"--cpus", strconv.FormatFloat(m.Cfg.CPUs, 'f', 2, 64),
		"-w", "/workspace",
		"-v", mountRoot + ":/workspace",
	}
	if m.Cfg.NetworkMode != "" {
		args = append(args, "--network", m.Cfg.NetworkMode)
	}
	desktopToken := ""
	if req.Desktop {
		desktopToken = newDesktopToken()
		args = append(args,
			"-p", fmt.Sprintf("127.0.0.1::%d", wantPort),
			"-e", "OPENBOT_DESKTOP_TOKEN="+desktopToken,
		)
		// Use image ENTRYPOINT/CMD (noVNC stack). Do not override with sleep.
		args = append(args, image)
	} else {
		args = append(args, image, "sleep", "infinity")
	}

	run := exec.CommandContext(ctx, m.Cfg.DockerBin, args...)
	var stderr bytes.Buffer
	run.Stderr = &stderr
	out, err := run.Output()
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		if req.Desktop {
			low := strings.ToLower(msg)
			if strings.Contains(low, "unable to find image") || strings.Contains(low, "not found") || strings.Contains(low, "pull access denied") {
				return nil, fmt.Errorf("%w: 桌面镜像不可用（%s）。请执行 make sandbox-image-desktop，或将 SANDBOX_DESKTOP_IMAGE 设为可用镜像（如 lscr.io/linuxserver/webtop:alpine-xfce 并设置 SANDBOX_DESKTOP_PORT=3000）: %s", ErrDockerUnavailable, image, msg)
			}
			return nil, fmt.Errorf("无法启动沙箱桌面容器: %s", msg)
		}
		return nil, fmt.Errorf("docker run: %s", msg)
	}
	id := shortID(strings.TrimSpace(string(out)))
	inst := &Instance{
		ContainerID:  id,
		WorkdirHost:  mountRoot,
		Image:        image,
		Mode:         mode,
		AgentID:      agentID,
		RestoredFrom: restored,
		DesktopToken: desktopToken,
	}
	if req.Desktop {
		// Port mapping can take a moment to appear in inspect.
		for i := 0; i < 10; i++ {
			info3, e3 := m.inspect(ctx, name)
			if e3 == nil && info3 != nil {
				if p := hostPortFromInspect(info3, wantPort); p > 0 {
					inst.DesktopPort = p
					break
				}
			}
			time.Sleep(200 * time.Millisecond)
		}
		if inst.DesktopPort <= 0 {
			return inst, fmt.Errorf("桌面容器已启动但未拿到 noVNC 端口映射；请检查 Docker 与镜像是否暴露 %d", wantPort)
		}
	}
	return inst, nil
}

func (m *Manager) imageFor(desktop bool) string {
	if desktop {
		return m.Cfg.DesktopImage
	}
	return m.Cfg.Image
}

func (m *Manager) desktopContainerPort() int {
	if m.Cfg.DesktopPort > 0 {
		return m.Cfg.DesktopPort
	}
	return 6080
}

func hostPortFromInspect(info *containerInspect, containerPort int) int {
	if info == nil || info.NetworkSettings.Ports == nil {
		return 0
	}
	key := fmt.Sprintf("%d/tcp", containerPort)
	bindings := info.NetworkSettings.Ports[key]
	for _, b := range bindings {
		if p, err := strconv.Atoi(strings.TrimSpace(b.HostPort)); err == nil && p > 0 {
			return p
		}
	}
	return 0
}

func newDesktopToken() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b[:])
}

func (m *Manager) removeContainer(ctx context.Context, name string) error {
	cmd := exec.CommandContext(ctx, m.Cfg.DockerBin, "rm", "-f", name)
	_ = cmd.Run()
	return nil
}

func (m *Manager) Stop(ctx context.Context, userID string) error {
	// Checkpoint before stop (filesystem; ignore errors).
	_, _ = m.Checkpoint(ctx, userID)
	if err := m.Available(ctx); err != nil {
		return err
	}
	name := m.ContainerName(userID)
	cmd := exec.CommandContext(ctx, m.Cfg.DockerBin, "stop", "-t", "5", name)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		low := strings.ToLower(stderr.String())
		if strings.Contains(low, "no such container") {
			return nil
		}
		return fmt.Errorf("docker stop: %s", strings.TrimSpace(stderr.String()))
	}
	return nil
}

// PurgeUserHome stops/removes the container and deletes the entire per-user host
// data directory (shared/bots/private/checkpoints/workspace). Used by admin
// user data purge — irreversible for that user's 运行环境 files.
func (m *Manager) PurgeUserHome(ctx context.Context, userID string) error {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return fmt.Errorf("user_id required")
	}
	_ = m.removeContainer(ctx, m.ContainerName(userID))
	home := m.UserHomeHost(userID)
	if home == "" || home == m.Cfg.DataRoot || home == "/" {
		return fmt.Errorf("refusing to remove unsafe home path")
	}
	if err := os.RemoveAll(home); err != nil {
		return err
	}
	return nil
}

// Destroy stops and removes the container but keeps host data (and takes a checkpoint).
func (m *Manager) Destroy(ctx context.Context, userID string) error {
	_, _ = m.Checkpoint(ctx, userID)
	if err := m.Available(ctx); err != nil {
		return err
	}
	return m.removeContainer(ctx, m.ContainerName(userID))
}

// Reset checkpoints, wipes live shared/bots/private (not checkpoints/), recreates container.
func (m *Manager) Reset(ctx context.Context, userID, agentID string, mode ComputerMode) (*Instance, error) {
	_, _ = m.Checkpoint(ctx, userID)
	if err := m.Available(ctx); err != nil {
		// Still wipe + layout even if docker down
		_ = wipeLiveData(m.UserHomeHost(userID))
		mount, _ := m.EnsureLayout(userID, agentID, mode)
		return &Instance{WorkdirHost: mount, Image: m.Cfg.Image, Mode: NormalizeMode(string(mode)), AgentID: agentID}, err
	}
	_ = m.removeContainer(ctx, m.ContainerName(userID))
	_ = wipeLiveData(m.UserHomeHost(userID))
	return m.Ensure(ctx, EnsureRequest{UserID: userID, AgentID: agentID, Mode: mode})
}

func wipeLiveData(home string) error {
	for _, name := range []string{"shared", "bots", "private", "workspace"} {
		p := filepath.Join(home, name)
		_ = os.RemoveAll(p)
	}
	return nil
}

type ExecResult struct {
	ExitCode int    `json:"exit_code"`
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
}

func (m *Manager) Exec(ctx context.Context, userID, cmdStr, workdir string, timeoutSec int) (*ExecResult, error) {
	if err := m.Available(ctx); err != nil {
		return nil, err
	}
	cmdStr = strings.TrimSpace(cmdStr)
	if cmdStr == "" {
		return nil, ErrEmptyCmd
	}
	if timeoutSec <= 0 {
		timeoutSec = 30
	}
	if timeoutSec > 300 {
		timeoutSec = 300
	}
	name := m.ContainerName(userID)
	info, err := m.inspect(ctx, name)
	if err != nil {
		return nil, err
	}
	if info == nil || !info.State.Running {
		return nil, ErrNotRunning
	}
	wd := "/workspace"
	if tw := strings.TrimSpace(workdir); tw != "" {
		resolved, e := ResolveWorkspacePath(tw)
		if e != nil {
			return nil, e
		}
		wd = resolved
	}

	execCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutSec)*time.Second)
	defer cancel()

	args := []string{"exec", "-w", wd, name, "bash", "-lc", cmdStr}
	c := exec.CommandContext(execCtx, m.Cfg.DockerBin, args...)
	var stdout, stderr bytes.Buffer
	c.Stdout = &stdout
	c.Stderr = &stderr
	runErr := c.Run()

	outStr := truncateBytes(stdout.Bytes(), MaxExecOutputBytes)
	errStr := truncateBytes(stderr.Bytes(), MaxExecOutputBytes)
	exitCode := 0
	if runErr != nil {
		if execCtx.Err() == context.DeadlineExceeded {
			return &ExecResult{ExitCode: 124, Stdout: outStr, Stderr: truncateJoin(errStr, "timeout")}, nil
		}
		var ee *exec.ExitError
		if errors.As(runErr, &ee) {
			exitCode = ee.ExitCode()
		} else {
			return nil, fmt.Errorf("docker exec: %w", runErr)
		}
	}
	return &ExecResult{ExitCode: exitCode, Stdout: outStr, Stderr: errStr}, nil
}

// ResolveWorkspacePath maps a user-supplied path to an absolute path under /workspace.
// Bare absolute paths like /tetris.html are treated as /workspace/tetris.html (common tool/UI footgun).
func ResolveWorkspacePath(p string) (string, error) {
	p = strings.TrimSpace(p)
	if p == "" {
		p = "/workspace"
	}
	p = filepath.Clean(p)
	if !strings.HasPrefix(p, "/") {
		p = "/workspace/" + p
		p = filepath.Clean(p)
	} else if p != "/workspace" && !strings.HasPrefix(p, "/workspace/") {
		p = filepath.Clean("/workspace" + p)
	}
	if p != "/workspace" && !strings.HasPrefix(p, "/workspace/") {
		return "", ErrPathEscape
	}
	if strings.Contains(p, "..") {
		return "", ErrPathEscape
	}
	return p, nil
}

// HostPathFor maps a workspace path to the host bind-mount path for the given mount root.
func (m *Manager) HostPathForMount(mountRoot, workspacePath string) (string, error) {
	wp, err := ResolveWorkspacePath(workspacePath)
	if err != nil {
		return "", err
	}
	rel := strings.TrimPrefix(wp, "/workspace")
	rel = strings.TrimPrefix(rel, "/")
	full := filepath.Join(mountRoot, rel)
	absRoot, err := filepath.Abs(mountRoot)
	if err != nil {
		return "", err
	}
	absFull, err := filepath.Abs(full)
	if err != nil {
		return "", err
	}
	if absFull != absRoot && !strings.HasPrefix(absFull, absRoot+string(os.PathSeparator)) {
		return "", ErrPathEscape
	}
	return absFull, nil
}

// HostPathFor uses team mount root (user home). Prefer FileOp methods for mode-aware access.
func (m *Manager) HostPathFor(userID, workspacePath string) (string, error) {
	return m.HostPathForMount(m.UserHomeHost(userID), workspacePath)
}

func (m *Manager) resolveOp(op FileOp) (host string, err error) {
	mode := NormalizeMode(string(op.Mode))
	mount := m.MountRootHost(op.UserID, op.AgentID, mode)
	path := op.Path
	if mode == ModeTeam {
		path, err = RemapWritePath(op.Path, op.AgentID, mode)
		if err != nil {
			return "", err
		}
	} else {
		path, err = ResolveWorkspacePath(op.Path)
		if err != nil {
			return "", err
		}
	}
	return m.HostPathForMount(mount, path)
}

// hostExists returns host path if it exists (file or dir).
func hostExists(host string) (string, bool) {
	if host == "" {
		return "", false
	}
	if _, err := os.Stat(host); err == nil {
		return host, true
	}
	return "", false
}

// isBareWorkspaceFile is true for /workspace/<single-segment> paths that are not
// reserved layout dirs (shared/bots/checkpoints/private).
func isBareWorkspaceFile(wp string) bool {
	if wp == "/workspace" || !strings.HasPrefix(wp, "/workspace/") {
		return false
	}
	rel := strings.TrimPrefix(wp, "/workspace/")
	if rel == "" || strings.Contains(rel, "/") {
		return false
	}
	switch rel {
	case "shared", "bots", "checkpoints", "private":
		return false
	default:
		return true
	}
}

// findBareInBots looks for bots/<agent>/<basename> under the user mount.
// Prefers preferAgentID's bot dir when present; otherwise requires a unique match.
func (m *Manager) findBareInBots(mount, basename, preferAgentID string) (string, bool) {
	botsDir := filepath.Join(mount, "bots")
	if aid := SanitizeUserID(preferAgentID); aid != "" && aid != "unknown" {
		cand := filepath.Join(botsDir, aid, basename)
		if st, err := os.Stat(cand); err == nil && !st.IsDir() {
			return cand, true
		}
	}
	entries, err := os.ReadDir(botsDir)
	if err != nil {
		return "", false
	}
	var matches []string
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		cand := filepath.Join(botsDir, e.Name(), basename)
		st, err := os.Stat(cand)
		if err != nil || st.IsDir() {
			continue
		}
		matches = append(matches, cand)
	}
	if len(matches) == 1 {
		return matches[0], true
	}
	return "", false
}

// resolveReadHost picks a host path for ReadFile in team mode:
//  1. remapped bots/{agent}/… via RemapWritePath
//  2. original ResolveWorkspacePath location (shared/, bots/, explicit)
//  3. unique bots/*/<basename> for bare /workspace/<file> (UI open without agent_id)
func (m *Manager) resolveReadHost(op FileOp) (string, error) {
	mode := NormalizeMode(string(op.Mode))
	mount := m.MountRootHost(op.UserID, op.AgentID, mode)
	wp, err := ResolveWorkspacePath(op.Path)
	if err != nil {
		return "", err
	}

	tryWP := func(workspacePath string) (string, bool) {
		h, e := m.HostPathForMount(mount, workspacePath)
		if e != nil {
			return "", false
		}
		return hostExists(h)
	}

	if mode == ModeTeam {
		if remapped, e := RemapWritePath(op.Path, op.AgentID, mode); e == nil {
			if h, ok := tryWP(remapped); ok {
				return h, nil
			}
		}
	}

	if h, ok := tryWP(wp); ok {
		return h, nil
	}

	if mode == ModeTeam && isBareWorkspaceFile(wp) {
		if h, ok := m.findBareInBots(mount, filepath.Base(wp), op.AgentID); ok {
			return h, nil
		}
	}

	// Fall back to original host path so callers get a normal NotExist error.
	return m.HostPathForMount(mount, wp)
}

// resolveListHost prefers the original workspace path so listing /workspace and
// /workspace/shared keeps working; falls back to RemapWritePath when missing.
func (m *Manager) resolveListHost(op FileOp) (string, error) {
	mode := NormalizeMode(string(op.Mode))
	mount := m.MountRootHost(op.UserID, op.AgentID, mode)
	wp, err := ResolveWorkspacePath(op.Path)
	if err != nil {
		return "", err
	}
	host, err := m.HostPathForMount(mount, wp)
	if err != nil {
		return "", err
	}
	if _, ok := hostExists(host); ok {
		return host, nil
	}
	if mode == ModeTeam {
		remapped, e := RemapWritePath(op.Path, op.AgentID, mode)
		if e == nil && remapped != wp {
			if h, e2 := m.HostPathForMount(mount, remapped); e2 == nil {
				if _, ok := hostExists(h); ok {
					return h, nil
				}
			}
		}
	}
	return host, nil
}

// OpenWorkspaceFile opens a workspace file for a raw download. Caller closes the file.
func (m *Manager) OpenWorkspaceFile(op FileOp) (*os.File, os.FileInfo, error) {
	host, err := m.resolveReadHost(op)
	if err != nil {
		return nil, nil, err
	}
	st, err := os.Stat(host)
	if err != nil {
		return nil, nil, err
	}
	if st.IsDir() {
		return nil, nil, errors.New("path is a directory")
	}
	if st.Size() > MaxDownloadBytes {
		return nil, nil, fmt.Errorf("file too large")
	}
	f, err := os.Open(host)
	if err != nil {
		return nil, nil, err
	}
	return f, st, nil
}

func (m *Manager) ReadFile(op FileOp, maxBytes int) (string, error) {
	host, err := m.resolveReadHost(op)
	if err != nil {
		return "", err
	}
	if maxBytes <= 0 {
		maxBytes = MaxExecOutputBytes
	}
	st, err := os.Stat(host)
	if err != nil {
		return "", err
	}
	if st.IsDir() {
		return "", errors.New("path is a directory")
	}
	f, err := os.Open(host)
	if err != nil {
		return "", err
	}
	defer f.Close()
	buf := make([]byte, maxBytes+1)
	n, err := f.Read(buf)
	if err != nil && !errors.Is(err, io.EOF) {
		if n == 0 {
			return "", err
		}
	}
	if n > maxBytes {
		return string(buf[:maxBytes]) + "\n…[truncated]", nil
	}
	return string(buf[:n]), nil
}

func (m *Manager) WriteFile(op FileOp, content string) error {
	host, err := m.resolveOp(op)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(host), 0o755); err != nil {
		return err
	}
	return os.WriteFile(host, []byte(content), 0o644)
}

type DirEntry struct {
	Name  string `json:"name"`
	IsDir bool   `json:"is_dir"`
	Size  int64  `json:"size"`
}

func (m *Manager) ListDir(op FileOp) ([]DirEntry, error) {
	host, err := m.resolveListHost(op)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(host)
	if err != nil {
		return nil, err
	}
	out := make([]DirEntry, 0, len(entries))
	for _, e := range entries {
		info, _ := e.Info()
		var size int64
		if info != nil {
			size = info.Size()
		}
		out = append(out, DirEntry{Name: e.Name(), IsDir: e.IsDir(), Size: size})
	}
	return out, nil
}

func shortID(id string) string {
	id = strings.TrimSpace(id)
	if len(id) > 12 {
		return id[:12]
	}
	return id
}

func truncateBytes(b []byte, max int) string {
	if len(b) <= max {
		return string(b)
	}
	return string(b[:max]) + "\n…[truncated]"
}

func truncateJoin(a, b string) string {
	if a == "" {
		return b
	}
	if b == "" {
		return a
	}
	return a + "\n" + b
}
