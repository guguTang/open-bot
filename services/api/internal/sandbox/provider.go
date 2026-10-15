// Package sandbox manages per-user Docker containers for the "sandbox computer".
// Provider is the pluggable contract; DockerManager is the first implementation.
package sandbox

import (
	"context"
	"errors"
)

var (
	ErrDockerUnavailable = errors.New("docker unavailable")
	ErrNotRunning        = errors.New("sandbox not running")
	ErrEmptyCmd          = errors.New("cmd required")
	ErrPathEscape        = errors.New("path must stay under /workspace")
	ErrUnsupported       = errors.New("operation not supported by this provider")
)

// ComputerMode controls on-disk layout inside the user sandbox home.
type ComputerMode string

const (
	ModeTeam    ComputerMode = "team"
	ModePrivate ComputerMode = "private"
)

func NormalizeMode(m string) ComputerMode {
	switch ComputerMode(m) {
	case ModePrivate:
		return ModePrivate
	default:
		return ModeTeam
	}
}

// EnsureRequest is the input for Provider.Ensure.
type EnsureRequest struct {
	UserID  string
	AgentID string
	Mode    ComputerMode
	Desktop bool // lazy-start desktop stack when image is available
}

// Instance describes a running (or just ensured) sandbox.
type Instance struct {
	ContainerID  string
	WorkdirHost  string // host path mounted at /workspace
	Image        string
	Mode         ComputerMode
	AgentID      string
	DesktopPort  int
	DesktopToken string
	RestoredFrom string // checkpoint path if restore ran
}

// FileOp carries optional agent context so team-mode writes land under bots/{agent_id}/.
// ConversationID keys the durable object copy; empty publishes only the latest copy.
type FileOp struct {
	UserID         string
	AgentID        string
	ConversationID string
	Mode           ComputerMode
	Path           string
	Ctx            context.Context
}

// Provider is the sandbox backend contract. Docker remains the first implementation;
// a second provider (e.g. remote agent / k8s) can be added without rewriting callers.
type Provider interface {
	Available(ctx context.Context) error
	Ensure(ctx context.Context, req EnsureRequest) (*Instance, error)
	Stop(ctx context.Context, userID string) error
	Destroy(ctx context.Context, userID string) error
	Exec(ctx context.Context, userID, cmdStr, workdir string, timeoutSec int) (*ExecResult, error)
	ReadFile(op FileOp, maxBytes int) (string, error)
	WriteFile(op FileOp, content string) error
	ListDir(op FileOp) ([]DirEntry, error)
	// Checkpoint snapshots workspace data; soft-fail when docker/data unavailable.
	Checkpoint(ctx context.Context, userID string) (string, error)
	// Restore copies latest checkpoint into an empty workspace home.
	Restore(ctx context.Context, userID string) error
}

// Compile-time check: Docker Manager implements Provider.
var _ Provider = (*Manager)(nil)
