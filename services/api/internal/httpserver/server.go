package httpserver

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/tangxin/open-bot/services/api/internal/auth"
	"github.com/tangxin/open-bot/services/api/internal/db"
	"github.com/tangxin/open-bot/services/api/internal/sandbox"
)

type ctxKey int

const userIDKey ctxKey = 1

type Server struct {
	runtimeURL string
	client     *http.Client
	db         *db.DB
	hub        *busHub
	events     *chatHub
	convEvents *conversationEventHub // conversation SSE (reaction_updated, …)
	hosts      *hostHub
	confirms   *hostConfirmGate
	// Serializes coalescing parallel delete confirms into one chat card.
	deleteConfirmMu sync.Mutex
	tasks           *taskControl
	sbx             *sandbox.Manager
	runs            *activeRuns
	// Last published owner-host online bit (bot_online SSE dedupe).
	botOnline *botOnlineCache
}

func Listen(addr, runtimeURL string, database *db.DB) error {
	if err := database.PurgeBuiltinAgents(); err != nil {
		return fmt.Errorf("purge builtin agents: %w", err)
	}
	s := &Server{
		runtimeURL: strings.TrimRight(runtimeURL, "/"),
		client:     &http.Client{Timeout: 0},
		db:         database,
		hub:        newBusHub(),
		events:     newChatHub(),
		convEvents: newConversationEventHub(),
		hosts:      newHostHub(),
		confirms:   newHostConfirmGate(),
		tasks:      newTaskControl(),
		sbx:        sandbox.NewManager(sandbox.LoadConfig()),
		runs:       newActiveRuns(),
		botOnline:  &botOnlineCache{last: make(map[string]bool), seen: make(map[string]struct{})},
	}
	s.hosts.onChange = func(userID, machineID string, _ bool) {
		s.publishAgentsOnlineForMachine(userID, machineID)
	}
	// In-process routines scheduler (disable with ROUTINES_INPROCESS=0 when using make dev-worker).
	if v := strings.ToLower(strings.TrimSpace(os.Getenv("ROUTINES_INPROCESS"))); v != "0" && v != "false" && v != "off" {
		s.StartRoutineScheduler(context.Background())
	}
	s.StartConversationTaskRunner(context.Background())
	// Stale-heartbeat push: Connected socket but last_seen > 90s → bot_online offline.
	s.StartBotOnlineSweeper(context.Background())

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealthz)

	// A2A adapter (optional A2A_TOKEN; see docs)
	mux.HandleFunc("GET /.well-known/agent-card.json", s.handleAgentCard)
	mux.HandleFunc("POST /a2a/v1", s.handleA2AJSONRPC)

	mux.HandleFunc("POST /v1/auth/register", s.handleRegister)
	mux.HandleFunc("POST /v1/auth/login", s.handleLogin)
	mux.HandleFunc("GET /v1/auth/oidc/config", s.handleOIDCConfig)
	mux.HandleFunc("GET /v1/auth/oidc/start", s.handleOIDCStart)
	mux.HandleFunc("POST /v1/auth/oidc/exchange", s.handleOIDCExchange)
	mux.HandleFunc("GET /v1/me", s.requireAuth(s.handleMe))
	mux.HandleFunc("GET /v1/me/settings", s.requireAuth(s.handleGetUserSettings))
	mux.HandleFunc("PUT /v1/me/settings", s.requireAuth(s.handlePutUserSettings))

	// Admin auth (dedicated; members get 403 — chat users use /v1/auth/login)
	mux.HandleFunc("POST /v1/admin/auth/login", s.handleAdminLogin)
	mux.HandleFunc("POST /v1/admin/auth/oidc/exchange", s.handleAdminOIDCExchange)

	// Admin (org_admin+)
	mux.HandleFunc("GET /v1/admin/org", s.requireOrgAdmin(s.handleAdminOrg))
	mux.HandleFunc("GET /v1/admin/members", s.requireOrgAdmin(s.handleAdminMembers))
	mux.HandleFunc("POST /v1/admin/members/invite", s.requireOrgAdmin(s.handleAdminInvite))
	mux.HandleFunc("PATCH /v1/admin/members/{id}", s.requireOrgAdmin(s.handleAdminPatchMember))
	mux.HandleFunc("GET /v1/admin/org/llm", s.requireOrgAdmin(s.handleAdminGetLLM))
	mux.HandleFunc("PUT /v1/admin/org/llm", s.requireOrgAdmin(s.handleAdminPutLLM))
	mux.HandleFunc("POST /v1/admin/org/llm/probe-tools", s.requireOrgAdmin(s.handleAdminProbeLLMTools))
	mux.HandleFunc("GET /v1/admin/org/decision", s.requireOrgAdmin(s.handleAdminGetDecision))
	mux.HandleFunc("PUT /v1/admin/org/decision", s.requireOrgAdmin(s.handleAdminPutDecision))
	mux.HandleFunc("POST /v1/admin/org/decision/test", s.requireOrgAdmin(s.handleAdminTestDecision))
	mux.HandleFunc("GET /v1/admin/usage", s.requireOrgAdmin(s.handleAdminUsage))
	mux.HandleFunc("GET /v1/admin/me/scope", s.requireOrgAdmin(s.handleAdminMeScope))
	mux.HandleFunc("GET /v1/admin/platform/orgs", s.requirePlatformAdmin(s.handlePlatformListOrgs))
	mux.HandleFunc("POST /v1/admin/platform/orgs", s.requirePlatformAdmin(s.handlePlatformCreateOrg))
	mux.HandleFunc("GET /v1/admin/platform/orgs/{id}/usage", s.requirePlatformAdmin(s.handlePlatformOrgUsage))
	mux.HandleFunc("GET /v1/admin/feature-flags", s.requireOrgAdmin(s.handleAdminFeatureFlags))
	mux.HandleFunc("PUT /v1/admin/feature-flags", s.requireOrgAdmin(s.handleAdminFeatureFlags))
	mux.HandleFunc("GET /v1/admin/audit-logs", s.requireOrgAdmin(s.handleAdminAuditLogs))

	mux.HandleFunc("GET /v1/admin/users", s.requireOrgAdmin(s.handleAdminListUsers))
	mux.HandleFunc("POST /v1/admin/users", s.requireOrgAdmin(s.handleAdminCreateUser))
	mux.HandleFunc("PATCH /v1/admin/users/{id}", s.requireOrgAdmin(s.handleAdminPatchUser))
	mux.HandleFunc("DELETE /v1/admin/users/{id}", s.requireOrgAdmin(s.handleAdminDeleteUser))
	mux.HandleFunc("POST /v1/admin/users/batch-delete", s.requireOrgAdmin(s.handleAdminBatchDeleteUsers))
	mux.HandleFunc("POST /v1/admin/users/{id}/purge-data", s.requireOrgAdmin(s.handleAdminPurgeUserData))

	mux.HandleFunc("GET /v1/admin/bots", s.requireOrgAdmin(s.handleAdminListBots))
	mux.HandleFunc("POST /v1/admin/bots", s.requireOrgAdmin(s.handleAdminCreateBot))
	mux.HandleFunc("PATCH /v1/admin/bots/{id}", s.requireOrgAdmin(s.handleAdminPatchBot))
	mux.HandleFunc("DELETE /v1/admin/bots/{id}", s.requireOrgAdmin(s.handleAdminDeleteBot))
	mux.HandleFunc("POST /v1/admin/bots/{id}/clone", s.requireOrgAdmin(s.handleAdminCloneBot))

	mux.HandleFunc("GET /v1/admin/skills", s.requireOrgAdmin(s.handleAdminListSkills))
	mux.HandleFunc("GET /v1/admin/skills/{name}", s.requireOrgAdmin(s.handleAdminGetSkill))
	mux.HandleFunc("POST /v1/admin/skills", s.requireOrgAdmin(s.handleAdminUpsertSkill))
	mux.HandleFunc("POST /v1/admin/skills/import", s.requireOrgAdmin(s.handleAdminImportSkillZip))
	mux.HandleFunc("GET /v1/admin/skills/{name}/export", s.requireOrgAdmin(s.handleAdminExportSkillZip))
	mux.HandleFunc("PUT /v1/admin/skills/{name}", s.requireOrgAdmin(s.handleAdminUpsertSkill))
	mux.HandleFunc("PATCH /v1/admin/skills/{name}", s.requireOrgAdmin(s.handleAdminPatchSkill))
	mux.HandleFunc("DELETE /v1/admin/skills/{name}", s.requireOrgAdmin(s.handleAdminDeleteSkill))
	mux.HandleFunc("PUT /v1/admin/skills/{name}/files", s.requireOrgAdmin(s.handleAdminUpsertSkillFile))
	mux.HandleFunc("DELETE /v1/admin/skills/{name}/files", s.requireOrgAdmin(s.handleAdminDeleteSkillFile))
	mux.HandleFunc("PUT /v1/admin/skills/{name}/package", s.requireOrgAdmin(s.handleAdminSaveSkillPackage))
	mux.HandleFunc("GET /v1/admin/bots/{id}/skills", s.requireOrgAdmin(s.handleAdminListBotSkills))
	mux.HandleFunc("PUT /v1/admin/bots/{id}/skills/{name}", s.requireOrgAdmin(s.handleAdminSetBotSkill))
	mux.HandleFunc("GET /v1/admin/users/{id}/skills", s.requireOrgAdmin(s.handleAdminListUserSkills))
	mux.HandleFunc("PUT /v1/admin/users/{id}/skills/{name}", s.requireOrgAdmin(s.handleAdminSetUserSkill))
	mux.HandleFunc("GET /v1/admin/users/{id}/machines", s.requireOrgAdmin(s.handleAdminListUserMachines))
	mux.HandleFunc("DELETE /v1/admin/users/{id}/machines/{machineId}", s.requireOrgAdmin(s.handleAdminDeleteUserMachine))

	mux.HandleFunc("GET /v1/admin/traces/status", s.requireOrgAdmin(s.handleAdminTracesStatus))
	mux.HandleFunc("GET /v1/admin/traces", s.requireOrgAdmin(s.handleAdminListTraces))
	mux.HandleFunc("GET /v1/admin/traces/{id}", s.requireOrgAdmin(s.handleAdminGetTrace))

	mux.HandleFunc("GET /v1/admin/memories", s.requireOrgAdmin(s.handleAdminListMemories))
	mux.HandleFunc("GET /v1/admin/memories/auto", s.requireOrgAdmin(s.handleAdminListAutoMemories))
	mux.HandleFunc("GET /v1/admin/memory-recalls", s.requireOrgAdmin(s.handleAdminListMemoryRecalls))
	mux.HandleFunc("GET /v1/admin/memory-recalls/{id}", s.requireOrgAdmin(s.handleAdminGetMemoryRecall))
	mux.HandleFunc("GET /v1/admin/compactions", s.requireOrgAdmin(s.handleAdminListCompactions))
	mux.HandleFunc("GET /v1/admin/channels", s.requireOrgAdmin(s.handleAdminListChannels))
	mux.HandleFunc("GET /v1/admin/compact-config", s.requireOrgAdmin(s.handleCompactConfig))

	mux.HandleFunc("GET /v1/llm-connections", s.requireAuth(s.handleListLLM))
	mux.HandleFunc("POST /v1/llm-connections", s.requireAuth(s.handleCreateLLM))
	mux.HandleFunc("PATCH /v1/llm-connections/{id}", s.requireAuth(s.handlePatchLLM))
	mux.HandleFunc("DELETE /v1/llm-connections/{id}", s.requireAuth(s.handleDeleteLLM))
	mux.HandleFunc("POST /v1/llm-connections/{id}/default", s.requireAuth(s.handleDefaultLLM))
	mux.HandleFunc("POST /v1/llm/probe-tools", s.requireAuth(s.handleProbeLLMTools))

	mux.HandleFunc("GET /v1/agents", s.requireAuth(s.handleListAgents))
	mux.HandleFunc("GET /v1/agents/{id}/conversation", s.requireAuth(s.handlePrimaryAgentConversation))
	mux.HandleFunc("POST /v1/agents", s.requireAuth(s.handleCreateAgent))
	mux.HandleFunc("PATCH /v1/agents/{id}", s.requireAuth(s.handlePatchAgent))
	mux.HandleFunc("DELETE /v1/agents/{id}", s.requireAuth(s.handleDeleteAgent))
	mux.HandleFunc("POST /v1/agents/{id}/clone", s.requireAuth(s.handleCloneAgent))
	mux.HandleFunc("GET /v1/agents/{id}/skills", s.requireAuth(s.handleListAgentSkills))
	mux.HandleFunc("PUT /v1/agents/{id}/skills", s.requireAuth(s.handleReplaceAgentSkills))
	mux.HandleFunc("PUT /v1/agents/{id}/skills/{name}", s.requireAuth(s.handleSetAgentSkill))
	mux.HandleFunc("POST /v1/agents/{id}/onboarding", s.requireAuth(s.handleAgentOnboarding))

	mux.HandleFunc("GET /v1/skills", s.requireAuth(s.handleListSkillsDetailed))
	mux.HandleFunc("POST /v1/skills", s.requireAuth(s.handleCreateSkill))
	mux.HandleFunc("POST /v1/skills/upload", s.requireAuth(s.handleUploadSkill))
	mux.HandleFunc("GET /v1/skills/{name}/package", s.requireAuth(s.handleGetSkillPackageView))
	mux.HandleFunc("PUT /v1/skills/{name}/package", s.requireAuth(s.handleSaveSkillPackage))
	mux.HandleFunc("GET /v1/skills/{name}/export", s.requireAuth(s.handleExportSkillZip))
	mux.HandleFunc("PUT /v1/skills/{name}", s.requireAuth(s.handlePutSkill))
	mux.HandleFunc("DELETE /v1/skills/{name}", s.requireAuth(s.handleDeleteSkill))
	mux.HandleFunc("GET /v1/memories", s.requireAuth(s.handleListMemories))
	mux.HandleFunc("POST /v1/memories", s.requireAuth(s.handleCreateMemory))

	mux.HandleFunc("GET /v1/conversations", s.requireAuth(s.handleListConversations))
	mux.HandleFunc("POST /v1/conversations", s.requireAuth(s.handleCreateConversation))
	mux.HandleFunc("DELETE /v1/conversations/{id}", s.requireAuth(s.handleDeleteConversation))
	mux.HandleFunc("GET /v1/conversations/{id}/messages", s.requireAuth(s.handleListMessages))
	mux.HandleFunc("POST /v1/conversations/{id}/host-confirms", s.requireAuth(s.handleCreateHostConfirm))
	mux.HandleFunc("POST /v1/conversations/{id}/host-confirms/{msgId}", s.requireAuth(s.handleDecideHostConfirm))
	mux.HandleFunc("POST /v1/conversations/{id}/messages", s.requireAuth(s.handleSendMessage))
	mux.HandleFunc("POST /v1/conversations/{id}/cancel", s.requireAuth(s.handleCancelConversationRun))
	mux.HandleFunc("POST /v1/conversations/{id}/steer", s.requireAuth(s.handleConversationSteer))
	mux.HandleFunc("POST /v1/conversations/{id}/approve", s.requireAuth(s.handleConversationApprove))
	mux.HandleFunc("GET /v1/conversations/{id}/events", s.requireAuth(s.handleConversationEvents))
	mux.HandleFunc("GET /v1/conversations/{id}/run", s.requireAuth(s.handleConversationRunStatus))
	mux.HandleFunc("POST /v1/conversations/{id}/attachments", s.requireAuth(s.handleUploadAttachment))
	mux.HandleFunc("GET /v1/conversations/{id}/attachments/{attachmentId}", s.requireAuth(s.handleGetAttachment))
	mux.HandleFunc("PUT /v1/messages/{id}/reactions", s.requireAuth(s.handleToggleReaction))
	mux.HandleFunc("DELETE /v1/messages/{id}/reactions", s.requireAuth(s.handleDeleteReaction))
	// Message feedback → pending lessons (only confirmed/active lessons reach the runtime).
	mux.HandleFunc("POST /v1/message-feedbacks", s.requireAuth(s.handleCreateFeedback))
	mux.HandleFunc("GET /v1/agents/{id}/feedbacks", s.requireAuth(s.handleListFeedback))
	mux.HandleFunc("GET /v1/agents/{id}/lessons", s.requireAuth(s.handleListLessons))
	mux.HandleFunc("GET /v1/agents/{id}/lessons/active", s.requireAuth(s.handleListActiveLessons))
	mux.HandleFunc("POST /v1/agents/{id}/lessons", s.requireAuth(s.handleCreateLesson))
	mux.HandleFunc("PATCH /v1/lessons/{id}", s.requireAuth(s.handlePatchLesson))
	mux.HandleFunc("DELETE /v1/lessons/{id}", s.requireAuth(s.handleDeleteLesson))

	mux.HandleFunc("GET /v1/channels", s.requireAuth(s.handleListChannels))
	mux.HandleFunc("POST /v1/channels", s.requireAuth(s.handleCreateChannel))
	mux.HandleFunc("DELETE /v1/channels/{id}", s.requireAuth(s.handleDeleteChannel))
	mux.HandleFunc("POST /v1/channels/{id}/members", s.requireAuth(s.handleAddChannelMember))
	mux.HandleFunc("GET /v1/channels/{id}/conversation", s.requireAuth(s.handleChannelConversation))
	mux.HandleFunc("POST /v1/agent-bus/messages", s.requireAuth(s.handlePostAgentBusMessage))
	mux.HandleFunc("GET /v1/agent-bus/inbox", s.requireAuth(s.handleAgentBusInbox))
	mux.HandleFunc("POST /v1/agent-bus/messages/{id}/read", s.requireAuth(s.handleMarkAgentBusRead))
	mux.HandleFunc("GET /v1/agent-bus/ws", s.handleAgentBusWS)
	mux.HandleFunc("GET /v1/events/ws", s.handleChatEventsWS)
	// Internal: runtime send_to_agent → same deliver path (priority wake + WS)
	mux.HandleFunc("POST /internal/agent-bus/messages", s.requireInternal(s.handleInternalPostAgentBusMessage))
	mux.HandleFunc("POST /internal/handoff-notes", s.requireInternal(s.handleInternalHandoffNote))
	mux.HandleFunc("POST /internal/bot-presence", s.requireInternal(s.handleInternalBotPresence))
	mux.HandleFunc("GET /internal/lessons/active", s.requireInternal(s.handleInternalActiveLessons))
	mux.HandleFunc("GET /v1/compact-config", s.requireAuth(s.handleCompactConfig))

	mux.HandleFunc("GET /v1/mcp-servers", s.requireAuth(s.handleListMCPServers))
	mux.HandleFunc("POST /v1/mcp-servers", s.requireAuth(s.handleCreateMCPServer))
	mux.HandleFunc("PATCH /v1/mcp-servers/{id}", s.requireAuth(s.handlePatchMCPServer))
	mux.HandleFunc("DELETE /v1/mcp-servers/{id}", s.requireAuth(s.handleDeleteMCPServer))
	mux.HandleFunc("POST /v1/mcp-servers/{id}/test", s.requireAuth(s.handleTestMCPServer))
	mux.HandleFunc("POST /v1/mcp/list-tools", s.requireAuth(s.handleMCPListTools))
	mux.HandleFunc("POST /v1/mcp/call-tool", s.requireAuth(s.handleMCPCallTool))

	mux.HandleFunc("GET /v1/routines", s.requireAuth(s.handleListRoutines))
	mux.HandleFunc("POST /v1/routines", s.requireAuth(s.handleCreateRoutine))
	mux.HandleFunc("PATCH /v1/routines/{id}", s.requireAuth(s.handlePatchRoutine))
	mux.HandleFunc("DELETE /v1/routines/{id}", s.requireAuth(s.handleDeleteRoutine))
	mux.HandleFunc("POST /v1/routines/{id}/run", s.requireAuth(s.handleRunRoutine))
	mux.HandleFunc("GET /v1/inbound-hooks", s.requireAuth(s.handleListInboundHooks))
	mux.HandleFunc("POST /v1/inbound-hooks", s.requireAuth(s.handleCreateInboundHook))
	mux.HandleFunc("DELETE /v1/inbound-hooks/{id}", s.requireAuth(s.handleDeleteInboundHook))
	mux.HandleFunc("POST /v1/webhooks/slack/{token}", s.handleSlackWebhook)
	mux.HandleFunc("POST /v1/webhooks/github/{token}", s.handleGitHubWebhook)

	// Sandbox computer (Phase 1 MVP)
	mux.HandleFunc("GET /v1/sandbox", s.requireAuth(s.handleGetSandbox))
	mux.HandleFunc("POST /v1/sandbox/ensure", s.requireAuth(s.handleEnsureSandbox))
	mux.HandleFunc("POST /v1/sandbox/stop", s.requireAuth(s.handleStopSandbox))
	mux.HandleFunc("POST /v1/sandbox/reset", s.requireAuth(s.handleResetSandbox))
	mux.HandleFunc("POST /v1/sandbox/exec", s.requireAuth(s.handleExecSandbox))
	mux.HandleFunc("GET /v1/sandbox/files", s.requireAuth(s.handleReadSandboxFile))
	mux.HandleFunc("GET /v1/sandbox/files/download", s.requireAuth(s.handleDownloadSandboxFile))
	mux.HandleFunc("PUT /v1/sandbox/files", s.requireAuth(s.handleWriteSandboxFile))
	mux.HandleFunc("GET /v1/sandbox/ls", s.requireAuth(s.handleListSandbox))
	mux.HandleFunc("POST /internal/sandbox/ensure", s.requireInternal(s.handleInternalSandboxEnsure))
	mux.HandleFunc("POST /internal/sandbox/exec", s.requireInternal(s.handleInternalSandboxExec))
	mux.HandleFunc("POST /internal/sandbox/read", s.requireInternal(s.handleInternalSandboxRead))
	mux.HandleFunc("POST /internal/sandbox/write", s.requireInternal(s.handleInternalSandboxWrite))
	mux.HandleFunc("POST /internal/sandbox/ls", s.requireInternal(s.handleInternalSandboxLS))
	mux.HandleFunc("POST /v1/sandbox/checkpoint", s.requireAuth(s.handleCheckpointSandbox))
	// Go ServeMux: trailing-slash patterns conflict with {path...} (empty path).
	mux.HandleFunc("GET /v1/sandbox/desktop", s.requireAuth(s.handleSandboxDesktop))
	mux.HandleFunc("GET /v1/sandbox/desktop/{path...}", s.requireAuth(s.handleSandboxDesktop))
	mux.HandleFunc("POST /v1/sandbox/desktop/{path...}", s.requireAuth(s.handleSandboxDesktop))

	// bot_secrets (JWT metadata only; never plaintext)
	mux.HandleFunc("GET /v1/bot-secrets", s.requireAuth(s.handleListBotSecrets))
	mux.HandleFunc("POST /v1/bot-secrets", s.requireAuth(s.handleCreateBotSecret))
	mux.HandleFunc("DELETE /v1/bot-secrets/{id}", s.requireAuth(s.handleDeleteBotSecret))
	mux.HandleFunc("GET /v1/bot-secret-requests", s.requireAuth(s.handleListSecretRequests))
	mux.HandleFunc("POST /v1/bot-secret-requests/{id}/resolve", s.requireAuth(s.handleResolveSecretRequest))
	mux.HandleFunc("POST /internal/bot-secrets/request", s.requireInternal(s.handleInternalRequestSecret))
	mux.HandleFunc("POST /internal/bot-secrets/decrypt", s.requireInternal(s.handleInternalDecryptSecret))
	mux.HandleFunc("POST /internal/bot-secrets/http", s.requireInternal(s.handleInternalSecretHTTP))
	mux.HandleFunc("POST /internal/routines/run", s.requireInternal(s.handleInternalRunRoutine))
	mux.HandleFunc("POST /internal/conversation-tasks/enqueue", s.requireInternal(s.handleInternalEnqueueTask))
	mux.HandleFunc("POST /internal/memory-recalls", s.requireInternal(s.handleInternalRecordMemoryRecall))
	mux.HandleFunc("POST /internal/routines/list", s.requireInternal(s.handleInternalListRoutines))
	mux.HandleFunc("POST /internal/routines/create", s.requireInternal(s.handleInternalCreateRoutine))
	mux.HandleFunc("POST /internal/routines/update", s.requireInternal(s.handleInternalUpdateRoutine))
	mux.HandleFunc("POST /internal/routines/delete", s.requireInternal(s.handleInternalDeleteRoutine))
	mux.HandleFunc("POST /internal/agents/clone", s.requireInternal(s.handleInternalCloneAgent))

	// Registered host machines (ListMachines-like)
	mux.HandleFunc("GET /v1/machines", s.requireAuth(s.handleListMachines))
	mux.HandleFunc("POST /v1/machines/register", s.requireAuth(s.handleRegisterMachine))
	mux.HandleFunc("POST /v1/machines/{id}/heartbeat", s.requireAuth(s.handleHeartbeatMachine))
	mux.HandleFunc("DELETE /v1/machines/{id}", s.requireAuth(s.handleDeleteMachine))
	mux.HandleFunc("PATCH /v1/machines/{id}", s.requireAuth(s.handlePatchMachine))
	mux.HandleFunc("GET /v1/machines/{id}/exec", s.handleHostExecWS)
	mux.HandleFunc("POST /internal/machines/list", s.requireInternal(s.handleInternalListMachines))
	mux.HandleFunc("POST /internal/machines/exec", s.requireInternal(s.handleInternalHostExec))

	return http.ListenAndServe(addr, withCORS(mux))
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" || isLocalDevOrigin(origin) {
			if origin == "" {
				w.Header().Set("Access-Control-Allow-Origin", "*")
			} else {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Credentials", "true")
			}
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, X-Internal-Token, ngrok-skip-browser-warning")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func isLocalDevOrigin(origin string) bool {
	o := strings.ToLower(strings.TrimSpace(origin))
	switch o {
	case "tauri://localhost",
		"http://tauri.localhost",
		"https://tauri.localhost",
		"capacitor://localhost",
		"ionic://localhost",
		// Capacitor Android WebView default (androidScheme https).
		"https://localhost",
		"http://localhost":
		// Packaged Tauri / Capacitor shells. Rejected preflight shows as Load failed.
		return true
	}
	return strings.HasPrefix(o, "http://localhost:") ||
		strings.HasPrefix(o, "https://localhost:") ||
		strings.HasPrefix(o, "http://127.0.0.1:") ||
		strings.HasPrefix(o, "https://127.0.0.1:") ||
		strings.HasPrefix(o, "http://[::1]:")
}

func (s *Server) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tok := auth.BearerToken(r.Header.Get("Authorization"))
		if tok == "" {
			tok = strings.TrimSpace(r.URL.Query().Get("access_token"))
		}
		if tok == "" {
			tok = strings.TrimSpace(r.URL.Query().Get("token"))
		}
		if tok == "" {
			if c, err := r.Cookie("openbot_token"); err == nil {
				tok = strings.TrimSpace(c.Value)
			}
		}
		claims, err := auth.ParseToken(tok)
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		ctx := context.WithValue(r.Context(), userIDKey, claims.UserID)
		next(w, r.WithContext(ctx))
	}
}

func userIDFrom(ctx context.Context) string {
	v, _ := ctx.Value(userIDKey).(string)
	return v
}

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	cfg := auth.LoadOIDCConfig()
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":           true,
		"service":      "api",
		"time":         time.Now().UTC().Format(time.RFC3339),
		"oidc_enabled": cfg.Enabled,
	})
}

type authBody struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var body authBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	username := strings.TrimSpace(body.Username)
	password := body.Password
	if len(username) < 2 || len(password) < 4 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "username (>=2) and password (>=4) required"})
		return
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "hash failed"})
		return
	}
	u, err := s.db.CreateUser(username, hash)
	if err != nil {
		if errors.Is(err, db.ErrUserExists) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "username already exists"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	// seed default LLM from env
	base := strings.TrimSpace(os.Getenv("OPENAI_BASE_URL"))
	key := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	model := strings.TrimSpace(os.Getenv("OPENAI_MODEL"))
	enableTools := false
	switch strings.ToLower(strings.TrimSpace(os.Getenv("OPENAI_ENABLE_TOOLS"))) {
	case "1", "true", "yes", "on":
		enableTools = true
	}
	_, _ = s.db.CreateLLMConnection(u.ID, "默认连接", base, key, model, enableTools, true, nil)

	// Refresh user after org bootstrap
	if refreshed, err := s.db.GetUserByID(u.ID); err == nil {
		u = refreshed
	}
	token, err := auth.IssueToken(u.ID, u.Username, 0)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "token failed"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"token": token,
		"user":  u.PublicMap(),
	})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var body authBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	u, err := s.db.GetUserByUsername(body.Username)
	if err != nil || !auth.CheckPassword(u.PasswordHash, body.Password) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid credentials"})
		return
	}
	_ = s.db.ApplyPendingInviteIfAny(u)
	if refreshed, err := s.db.GetUserByID(u.ID); err == nil {
		u = refreshed
	}
	token, err := auth.IssueToken(u.ID, u.Username, 0)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "token failed"})
		return
	}
	s.writeAudit(u.OrgID, u.ID, "auth.login", "user", u.ID, map[string]any{"method": "password"})
	writeJSON(w, http.StatusOK, map[string]any{
		"token": token,
		"user":  u.PublicMap(),
	})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	u, err := s.db.GetUserByID(uid)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	_ = s.db.ApplyPendingInviteIfAny(u)
	if refreshed, err := s.db.GetUserByID(u.ID); err == nil {
		u = refreshed
	}
	writeJSON(w, http.StatusOK, u.PublicMap())
}

func (s *Server) handleListLLM(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	list, err := s.db.ListLLMConnections(uid)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	pub := make([]db.LLMConnectionPublic, 0, len(list))
	for _, c := range list {
		pub = append(pub, c.Public())
	}
	writeJSON(w, http.StatusOK, map[string]any{"connections": pub})
}

func llmRuntimePayload(conn *db.LLMConnection) map[string]any {
	if conn == nil {
		return nil
	}
	m := map[string]any{
		"base_url":     conn.BaseURL,
		"api_key":      conn.APIKey,
		"model":        conn.Model,
		"enable_tools": conn.EnableTools,
	}
	if conn.ContextWindow != nil && *conn.ContextWindow > 0 {
		m["context_window"] = *conn.ContextWindow
	}
	return m
}

type llmBody struct {
	Name          string `json:"name"`
	BaseURL       string `json:"base_url"`
	APIKey        string `json:"api_key"`
	Model         string `json:"model"`
	EnableTools   *bool  `json:"enable_tools"`
	IsDefault     *bool  `json:"is_default"`
	ContextWindow *int   `json:"context_window"`
}

func (s *Server) rejectIfToolsUnsupported(w http.ResponseWriter, r *http.Request, baseURL, apiKey, model string, enableTools bool) bool {
	if !enableTools {
		return false
	}
	res := probeLLMTools(r.Context(), baseURL, apiKey, model)
	if res.CanEnableTools {
		return false
	}
	msg := res.Detail
	if msg == "" {
		msg = "当前模型/网关不支持 tools，请关掉「启用 tools」或更换上游"
	}
	if res.Hint != "" {
		msg = msg + " " + res.Hint
	}
	writeJSON(w, http.StatusBadRequest, map[string]any{
		"error":            msg,
		"tools_probe":      res,
		"can_enable_tools": false,
	})
	return true
}

func (s *Server) handleCreateLLM(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	var body llmBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	enable := false
	if body.EnableTools != nil {
		enable = *body.EnableTools
	}
	isDef := true
	if body.IsDefault != nil {
		isDef = *body.IsDefault
	}
	// if user already has connections and didn't set is_default, default false
	existing, _ := s.db.ListLLMConnections(uid)
	if len(existing) > 0 && body.IsDefault == nil {
		isDef = false
	}
	if s.rejectIfToolsUnsupported(w, r, body.BaseURL, body.APIKey, body.Model, enable) {
		return
	}
	c, err := s.db.CreateLLMConnection(uid, body.Name, body.BaseURL, body.APIKey, body.Model, enable, isDef, body.ContextWindow)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, c.Public())
}

func (s *Server) handlePatchLLM(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	var body map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	upd := db.LLMUpdate{}
	if raw, ok := body["name"]; ok {
		var v string
		_ = json.Unmarshal(raw, &v)
		upd.Name = &v
	}
	if raw, ok := body["base_url"]; ok {
		var v string
		_ = json.Unmarshal(raw, &v)
		upd.BaseURL = &v
	}
	if raw, ok := body["api_key"]; ok {
		var v string
		_ = json.Unmarshal(raw, &v)
		upd.APIKey = &v
	}
	if raw, ok := body["model"]; ok {
		var v string
		_ = json.Unmarshal(raw, &v)
		upd.Model = &v
	}
	if raw, ok := body["enable_tools"]; ok {
		var v bool
		_ = json.Unmarshal(raw, &v)
		upd.EnableTools = &v
	}
	if raw, ok := body["is_default"]; ok {
		var v bool
		_ = json.Unmarshal(raw, &v)
		upd.IsDefault = &v
	}
	if raw, ok := body["context_window"]; ok {
		upd.SetContextWindow = true
		if string(raw) != "null" {
			var v int
			if err := json.Unmarshal(raw, &v); err == nil {
				upd.ContextWindow = &v
			}
		}
	}
	cur, cerr := s.db.GetLLMConnection(uid, id)
	if cerr != nil {
		if errors.Is(cerr, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": cerr.Error()})
		return
	}
	enable := cur.EnableTools
	if upd.EnableTools != nil {
		enable = *upd.EnableTools
	}
	baseURL := cur.BaseURL
	if upd.BaseURL != nil {
		baseURL = *upd.BaseURL
	}
	model := cur.Model
	if upd.Model != nil {
		model = *upd.Model
	}
	apiKey := cur.APIKey
	if upd.APIKey != nil && strings.TrimSpace(*upd.APIKey) != "" {
		apiKey = *upd.APIKey
	}
	if s.rejectIfToolsUnsupported(w, r, baseURL, apiKey, model, enable) {
		return
	}
	c, err := s.db.UpdateLLMConnection(uid, id, upd)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, c.Public())
}

func (s *Server) handleDeleteLLM(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	if err := s.db.DeleteLLMConnection(uid, id); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDefaultLLM(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	c, err := s.db.SetDefaultLLM(uid, id)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, c.Public())
}

func (s *Server) handleListAgents(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	list, err := s.db.ListAgents(uid)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	out := make([]map[string]any, 0, len(list))
	activeTasks, _ := s.db.ActiveTaskConversationIDs(uid)
	if activeTasks == nil {
		activeTasks = map[string]struct{}{}
	}
	for _, a := range list {
		s.stampAgentOnline(uid, a)
		item := map[string]any{
			"id":              a.ID,
			"name":            a.Name,
			"description":     a.Description,
			"system_prompt":   a.SystemPrompt,
			"is_builtin":      a.IsBuiltin,
			"computer_mode":   a.ComputerMode,
			"avatar_shape":    a.AvatarShape,
			"avatar_color":    a.AvatarColor,
			"avatar_user_set": a.AvatarUserSet,
			"machine_id":      a.MachineID,
			// read-only: '' | migrate | user (server-stamped; clients never send it)
			"machine_id_source": a.MachineIDSource,
			"online":            a.Online,
			"user_id":           a.UserID,
			"created_at":        a.CreatedAt.UTC().Format(time.RFC3339Nano),
			"updated_at":        a.UpdatedAt.UTC().Format(time.RFC3339Nano),
		}
		if prev, perr := s.db.GetAgentThreadPreview(uid, a.ID); perr == nil && prev != nil && prev.ConversationID != "" {
			item["conversation_id"] = prev.ConversationID
			item["last_message"] = prev.LastMessage
			if !prev.UpdatedAt.IsZero() {
				item["conversation_updated_at"] = prev.UpdatedAt.UTC().Format(time.RFC3339Nano)
			}
			if _, ok := activeTasks[prev.ConversationID]; ok {
				item["task_active"] = true
			}
		}
		out = append(out, item)
	}
	writeJSON(w, http.StatusOK, map[string]any{"agents": out})
}

func (s *Server) handlePrimaryAgentConversation(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	agentID := strings.TrimSpace(r.PathValue("id"))
	if agentID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "agent id required"})
		return
	}
	if _, err := s.db.GetAgent(uid, agentID); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "agent not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	conv, err := s.db.GetOrCreatePrimaryConversation(uid, agentID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.enrichConversationOnline(uid, conv)
	writeJSON(w, http.StatusOK, map[string]any{"conversation": conv})
}

type agentBody struct {
	Name         string  `json:"name"`
	Description  string  `json:"description"`
	SystemPrompt string  `json:"system_prompt"`
	ComputerMode string  `json:"computer_mode"`
	AvatarShape  string  `json:"avatar_shape"`
	AvatarColor  string  `json:"avatar_color"`
	MachineID    *string `json:"machine_id"` // optional; "" clears binding
	// No machine_id_source field on purpose: server stamps 'user' on any
	// CREATE/PATCH that sets machine_id ('' when cleared). A client-sent
	// machine_id_source is ignored by the decoder.
}

func (s *Server) handleCreateAgent(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	var body agentBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	a, err := s.db.CreateAgentWithAvatar(uid, body.Name, body.Description, body.SystemPrompt, body.AvatarShape, body.AvatarColor)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if body.MachineID != nil {
		a2, e2 := s.db.SetAgentMachineID(uid, a.ID, *body.MachineID)
		if e2 != nil {
			if errors.Is(e2, db.ErrNotFound) {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "machine not found"})
				return
			}
			if errors.Is(e2, db.ErrMobileNotHost) {
				writeJSON(w, http.StatusBadRequest, map[string]string{
					"error": "mobile devices cannot be preferred hosts",
				})
				return
			}
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": e2.Error()})
			return
		}
		a = a2
	}
	s.stampAgentOnline(uid, a)
	writeJSON(w, http.StatusCreated, a)
}

func (s *Server) handlePatchAgent(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	var body agentBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	var a *db.Agent
	var err error
	// Avatar/computer-mode-only PATCH must not wipe name/description/prompt.
	if body.Name != "" || body.Description != "" || body.SystemPrompt != "" {
		a, err = s.db.UpdateAgent(uid, id, body.Name, body.Description, body.SystemPrompt)
	} else {
		a, err = s.db.GetAgent(uid, id)
	}
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if body.ComputerMode != "" {
		if a2, e2 := s.db.SetAgentComputerMode(uid, id, body.ComputerMode); e2 == nil {
			a = a2
		}
	}
	if body.AvatarShape != "" || body.AvatarColor != "" {
		a2, e2 := s.db.UpdateAgentAvatar(uid, id, body.AvatarShape, body.AvatarColor)
		if e2 != nil {
			if errors.Is(e2, db.ErrNotFound) {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
				return
			}
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": e2.Error()})
			return
		}
		a = a2
	}
	if body.MachineID != nil {
		a2, e2 := s.db.SetAgentMachineID(uid, id, *body.MachineID)
		if e2 != nil {
			if errors.Is(e2, db.ErrNotFound) {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "machine not found"})
				return
			}
			if errors.Is(e2, db.ErrMobileNotHost) {
				writeJSON(w, http.StatusBadRequest, map[string]string{
					"error": "mobile devices cannot be preferred hosts",
				})
				return
			}
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": e2.Error()})
			return
		}
		a = a2
		s.publishAgentOnlineIfChanged(uid, a)
	}
	s.stampAgentOnline(uid, a)
	writeJSON(w, http.StatusOK, a)
}

func (s *Server) handleDeleteAgent(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	if err := s.db.DeleteAgent(uid, id); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) proxyJSON(w http.ResponseWriter, method, path string, query url.Values, body io.Reader, contentType string) {
	u := s.runtimeURL + path
	if len(query) > 0 {
		u = u + "?" + query.Encode()
	}
	req, err := http.NewRequest(method, u, body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		http.Error(w, fmt.Sprintf("runtime unreachable: %v", err), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(b)
}

func (s *Server) handleListSkills(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	list, err := s.db.ListUserSkills(uid)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"skills": list})
}

func (s *Server) handlePutSkill(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	name := r.PathValue("name")
	var body struct {
		Enabled *bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Enabled == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "enabled bool required"})
		return
	}
	sk, err := s.db.SetUserSkillEnabled(uid, name, *body.Enabled)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "skill not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, sk)
}

func (s *Server) handleUploadSkill(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	var nameHint, descHint string
	var files []db.SkillFileRecord

	ct := r.Header.Get("Content-Type")
	if strings.HasPrefix(ct, "multipart/form-data") {
		if err := r.ParseMultipartForm(maxSkillUploadBytes); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid multipart"})
			return
		}
		nameHint = strings.TrimSpace(r.FormValue("name"))
		descHint = strings.TrimSpace(r.FormValue("description"))
		bodyMarkdown := r.FormValue("body_markdown")
		if bodyMarkdown == "" {
			bodyMarkdown = r.FormValue("body")
		}

		// Prefer zip archive when provided.
		if file, hdr, err := r.FormFile("archive"); err == nil {
			defer file.Close()
			b, err := io.ReadAll(io.LimitReader(file, maxSkillUploadBytes))
			if err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "cannot read archive"})
				return
			}
			fn := strings.ToLower(hdr.Filename)
			if !strings.HasSuffix(fn, ".zip") && !looksLikeZip(b) {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "archive must be a .zip"})
				return
			}
			parsed, err := db.ParseZipSkillPackage(b)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
				return
			}
			files = parsed
		} else if parts := r.MultipartForm.File["files"]; len(parts) > 0 {
			for _, fh := range parts {
				f, err := fh.Open()
				if err != nil {
					writeJSON(w, http.StatusBadRequest, map[string]string{"error": "cannot read uploaded file"})
					return
				}
				b, err := io.ReadAll(io.LimitReader(f, int64(dbMaxSkillFileBytes)+1))
				_ = f.Close()
				if err != nil {
					writeJSON(w, http.StatusBadRequest, map[string]string{"error": "cannot read uploaded file"})
					return
				}
				if len(b) > dbMaxSkillFileBytes {
					writeJSON(w, http.StatusBadRequest, map[string]string{
						"error": "file too large: " + fh.Filename,
					})
					return
				}
				rel := strings.TrimSpace(fh.Filename)
				if rel == "" {
					continue
				}
				files = append(files, db.SkillFileRecord{Path: rel, Content: string(b)})
			}
		} else if file, hdr, err := r.FormFile("file"); err == nil {
			defer file.Close()
			b, err := io.ReadAll(io.LimitReader(file, maxSkillUploadBytes))
			if err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "cannot read file"})
				return
			}
			fn := strings.ToLower(hdr.Filename)
			if strings.HasSuffix(fn, ".zip") || looksLikeZip(b) {
				parsed, err := db.ParseZipSkillPackage(b)
				if err != nil {
					writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
					return
				}
				files = parsed
			} else {
				bodyMarkdown = string(b)
			}
		}

		if len(files) == 0 && strings.TrimSpace(bodyMarkdown) != "" {
			files = []db.SkillFileRecord{{Path: "SKILL.md", Content: bodyMarkdown}}
		}
	} else {
		var body struct {
			Name         string               `json:"name"`
			Description  string               `json:"description"`
			BodyMarkdown string               `json:"body_markdown"`
			Body         string               `json:"body"`
			Files        []db.SkillFileRecord `json:"files"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, maxSkillUploadBytes)).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
		nameHint = strings.TrimSpace(body.Name)
		descHint = strings.TrimSpace(body.Description)
		if len(body.Files) > 0 {
			files = body.Files
		} else {
			md := body.BodyMarkdown
			if md == "" {
				md = body.Body
			}
			if strings.TrimSpace(md) != "" || nameHint != "" {
				files = []db.SkillFileRecord{{Path: "SKILL.md", Content: md}}
			}
		}
	}

	if len(files) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "provide SKILL.md body, files[], or a zip archive",
		})
		return
	}

	sk, err := s.db.UploadUserSkillPackage(uid, files, nameHint, descHint)
	if err != nil {
		msg := err.Error()
		code := http.StatusBadRequest
		if strings.Contains(msg, "conflicts") {
			code = http.StatusConflict
		}
		writeJSON(w, code, map[string]string{"error": msg})
		return
	}
	writeJSON(w, http.StatusCreated, sk)
}

func (s *Server) handleGetUserSkillPackage(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	name := r.PathValue("name")
	sk, err := s.db.GetUserSkillPackage(uid, name)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "custom skill not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, sk)
}

const maxSkillUploadBytes = 8 << 20

// dbMaxSkillFileBytes mirrors db.maxSkillFileBytes (unexported).
const dbMaxSkillFileBytes = 512 * 1024

func looksLikeZip(b []byte) bool {
	return len(b) >= 4 && b[0] == 'P' && b[1] == 'K'
}

func (s *Server) handleDeleteSkill(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	name := r.PathValue("name")
	if err := s.db.DeleteUserSkill(uid, name); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "custom skill not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleListMemories(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	q := r.URL.Query()
	q.Set("user_id", uid)
	s.proxyJSON(w, http.MethodGet, "/v1/memories", q, nil, "")
}

func (s *Server) handleCreateMemory(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body == nil {
		body = map[string]any{}
	}
	body["user_id"] = uid
	b, _ := json.Marshal(body)
	s.proxyJSON(w, http.MethodPost, "/v1/memories", nil, bytes.NewReader(b), "application/json")
}

type createConversationBody struct {
	AgentID string `json:"agent_id"`
	Title   string `json:"title"`
}

func (s *Server) handleListConversations(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	list, err := s.db.ListConversations(uid, 50)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	for _, c := range list {
		s.enrichConversationOnline(uid, c)
	}
	writeJSON(w, http.StatusOK, map[string]any{"conversations": list})
}

func (s *Server) handleCreateConversation(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	var body createConversationBody
	_ = json.NewDecoder(r.Body).Decode(&body)
	agentID := strings.TrimSpace(body.AgentID)
	if agentID == "" {
		var err error
		agentID, err = s.db.FirstAgentID(uid)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
	}
	if _, err := s.db.GetAgent(uid, agentID); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown agent_id"})
		return
	}
	title := strings.TrimSpace(body.Title)
	if title == "" {
		title = "新对话"
	}
	conv, err := s.db.CreateConversation(uid, agentID, title)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.enrichConversationOnline(uid, conv)
	writeJSON(w, http.StatusCreated, conv)
}

func (s *Server) handleDeleteConversation(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	if err := s.db.DeleteConversation(uid, id); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleListMessages(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	msgs, err := s.db.ListMessages(uid, id)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "conversation not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	taskActive, _ := s.db.ConversationHasOpenTask(id)
	writeJSON(w, http.StatusOK, map[string]any{
		"messages":    msgs,
		"run_active":  s.runs.isActive(id),
		"task_active": taskActive,
	})
}

type sendBody struct {
	Content         string          `json:"content"`
	LLMConnectionID string          `json:"llm_connection_id"`
	Attachments     []AttachmentRef `json:"attachments"`
	AgentIDs        []string        `json:"agent_ids"` // group candidates; empty = server resolves (@ / all members)
	Client          map[string]any  `json:"client"`    // client environment envelope (platform/app/os/…)
	// ReplyToID is set only when the user explicitly clicks「回复」(quote / mainline).
	// Normal sends leave it empty. Bot assistant saves must never copy this onto reply_to_id;
	// turn linkage uses request_id (runtime run_id) instead.
	// reply_to_id alone must NOT invent thread_root_id (Grok-style mainline quote).
	ReplyToID string `json:"reply_to_id"`
	// ThreadRootID is set only when the client posts inside an existing sidebar thread
	// (opened via「N 条回复」etc.). Empty for mainline sends including explicit「回复」.
	// Never derived from ReplyToID / ResolveThreadRoot on this path.
	ThreadRootID string `json:"thread_root_id"`
	// PersistOnly stores the user message and returns JSON without running an agent.
	PersistOnly bool `json:"persist_only"`
	// HandoffContext is injected into runtime history (not stored) when @-handing off from another bot thread.
	HandoffContext []runtimeMsg `json:"handoff_context"`
	// WhenBusy: follow_up (default) | steer | reject — used when a durable run is already active.
	WhenBusy string `json:"when_busy"`
}

type runtimeMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

func (s *Server) handleCancelConversationRun(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	conv, err := s.db.EnsureConversation(uid, id, "", "会话 "+id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	_ = s.runs.cancel(id)
	_, _ = s.cancelTasksAndNotify(uid, conv, nil)
	// Best-effort durable abort when client supplies request_id (LangGraph thread).
	var body struct {
		RequestID string `json:"request_id"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if rid := strings.TrimSpace(body.RequestID); rid != "" && runtimeDurableEnabled() {
		_, _, _ = s.postRuntimeJSON(r.Context(), "/v1/runs/abort", map[string]any{
			"conversation_id": id,
			"request_id":      rid,
		})
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleSendMessage(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	var body sendBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	content := strings.TrimSpace(body.Content)
	if content == "" && len(body.Attachments) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "content or attachments required"})
		return
	}

	conv, err := s.db.EnsureConversation(uid, id, "", "会话 "+id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	storedContent := content
	if len(body.Attachments) > 0 {
		built, berr := buildUserContentWithAttachments(content, uid, conv.ID, body.Attachments)
		if berr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": berr.Error()})
			return
		}
		storedContent = built
	}

	var replyParent *db.Message
	replyQuote := "" // parent text for runtime reply_to_content (model-only)
	replyToID := strings.TrimSpace(body.ReplyToID)
	// Product: thread membership is explicit only. Mainline「回复」(reply_to_id alone)
	// stays on the main timeline — do NOT call ResolveThreadRoot(parent).
	threadRootID := resolvePersistedThreadRootID(body.ThreadRootID, replyToID)
	if replyToID != "" {
		parent, perr := s.db.GetMessage(uid, conv.ID, replyToID)
		if perr != nil {
			if errors.Is(perr, db.ErrNotFound) {
				// Same-conversation guard: GetMessage is scoped to conv.ID, so a
				// parent from another conversation never resolves. Reject before
				// AddMessage (no orphan user row, no cross-conv text to the model).
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "reply_to_id not in conversation"})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": perr.Error()})
			return
		}
		if parent.ConversationID != conv.ID {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "reply_to_id not in conversation"})
			return
		}
		replyParent = parent
		replyQuote, _ = resolveReplyQuote([]db.Message{{ID: parent.ID, Content: stripThinkTags(parent.Content)}}, parent.ID)
	}
	if threadRootID != "" {
		// Sidebar-thread post: root must already exist in this conversation.
		root, rerr := s.db.GetMessage(uid, conv.ID, threadRootID)
		if rerr != nil {
			if errors.Is(rerr, db.ErrNotFound) {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "thread_root_id not in conversation"})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": rerr.Error()})
			return
		}
		if root.ConversationID != conv.ID {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "thread_root_id not in conversation"})
			return
		}
	}

	if len(body.Attachments) > 0 {
		if eerr := s.ensureAttachmentRows(uid, conv.ID, body.Attachments); eerr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": eerr.Error()})
			return
		}
	}
	userMsg, err := s.db.AddMessageWithOpts(conv.ID, "user", storedContent, db.AddMessageOpts{
		ReplyToID:    replyToID,
		ThreadRootID: threadRootID,
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if len(body.Attachments) > 0 {
		ids := make([]string, 0, len(body.Attachments))
		for _, a := range body.Attachments {
			if id := strings.TrimSpace(a.ID); id != "" {
				ids = append(ids, id)
			}
		}
		linked, lerr := s.db.LinkAttachmentsToMessage(uid, conv.ID, userMsg.ID, ids)
		if lerr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": lerr.Error()})
			return
		}
		userMsg.Attachments = linked
	}
	// Session host for green-dot / host routing: desktop client_env.machine_id.
	if mid := clientEnvMachineID(body.Client); mid != "" {
		// Phones are login-only: never stamp mobile as conversation session host.
		if m, merr := s.db.GetMachine(uid, mid); merr == nil && m != nil && db.IsHostEligible(*m) {
			if err := s.db.SetConversationLastMachineID(uid, conv.ID, mid); err == nil {
				conv.LastMachineID = mid
				if a, gerr := s.db.GetAgent(uid, conv.AgentID); gerr == nil && a != nil {
					s.publishAgentOnlineSessionFlip(uid, a, mid, false)
				}
			}
		}
	}
	if body.PersistOnly {
		writeJSON(w, http.StatusOK, map[string]any{"message": userMsg, "persist_only": true})
		return
	}
	// Auto-title from first user message (20–30 chars, strip newlines).
	if n, cerr := s.db.CountUserMessages(conv.ID); cerr == nil && n == 1 {
		titleSrc := content
		if titleSrc == "" && len(body.Attachments) > 0 {
			titleSrc = body.Attachments[0].Name
		}
		title := autoTitleFromContent(titleSrc)
		if title != "" {
			_ = s.db.UpdateConversationTitle(uid, conv.ID, title)
			conv.Title = title
		}
	}

	targetAgents, terr := s.resolveSendTargets(uid, conv, body.AgentIDs, content, replyParent)
	if terr != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": terr.Error()})
		return
	}
	if len(targetAgents) == 0 {
		targetAgents = []string{conv.AgentID}
	}

	var llmPayload map[string]any
	var conn *db.LLMConnection
	if strings.TrimSpace(body.LLMConnectionID) != "" {
		conn, err = s.db.GetLLMConnection(uid, body.LLMConnectionID)
	} else {
		conn, err = s.db.ResolveEffectiveLLM(uid)
	}
	if err != nil && !errors.Is(err, db.ErrNotFound) {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if conn != nil {
		llmPayload = llmRuntimePayload(conn)
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	// Run lifetime is server-owned (detached from the HTTP request). Client
	// disconnect / refresh must NOT cancel; only POST .../cancel or a next-turn
	// send (register) cancels. The initiating SSE client is one subscriber;
	// reconnect via GET .../events.
	runCtx, runCancel := context.WithCancel(context.Background())
	handle := newRunHandle(runCancel)
	s.runs.register(conv.ID, handle)
	defer func() {
		runCancel()
		s.runs.unregister(conv.ID, handle)
		handle.finish() // after persist above; unblocks cancel/register waiters
	}()

	emit := newSSEEmitter(w, flusher, r.Context(), handle)

	// Announce targets so UI can attribute replies.
	emit("meta", map[string]any{
		"phase":      "targets",
		"agent_ids":  targetAgents,
		"channel_id": conv.ChannelID,
	})
	// Replace optimistic local-user-* id with the real persisted id.
	emit("meta", map[string]any{
		"phase":           "user_saved",
		"message_id":      userMsg.ID,
		"conversation_id": conv.ID,
		"reply_to_id":     userMsg.ReplyToID,
		"thread_root_id":  userMsg.ThreadRootID,
	})

	if s.tryShortcutTurn(uid, conv, userMsg.ID, storedContent, targetAgents[0], emit) {
		emit("done", map[string]any{"ok": true})
		return
	}

	// This request's agent is running until proxyRuntimeRun returns. Other
	// devices follow that, not the wording of the reply.
	if len(targetAgents) > 0 {
		s.publishTaskStatus(uid, conv.ID, targetAgents[0], conv.ChannelID, "running", "正在做，做好会发在这里")
		defer func() {
			open, err := s.db.OpenConversationTask(conv.ID)
			if err == nil && open != nil {
				return
			}
			s.publishTaskStatus(uid, conv.ID, targetAgents[0], conv.ChannelID, "idle", "")
		}()
	}


	// Busy durable run: place inbox (follow_up/steer/reject) instead of a parallel run.
	// Group channels share one conversation_id — only steer when a single candidate
	// owns the turn and matches the busy thread; multi-candidate group turns continue
	// the loop (other members still get a chance) instead of short-circuiting everyone.
	if runtimeDurableEnabled() && len(targetAgents) == 1 {
		_, activeReq, activeStatus, activeAgentID, aerr := s.db.ActiveHarnessThreadForConversation(conv.ID)
		if aerr == nil && strings.TrimSpace(activeReq) != "" && activeStatus != "" &&
			shouldSteerBusyHarness(activeAgentID, targetAgents[0]) {
			mode := strings.TrimSpace(body.WhenBusy)
			if mode == "" {
				mode = "follow_up"
			}
			if mode == "reject" {
				emit("error", map[string]string{"message": "busy_rejected"})
				emit("done", map[string]any{"ok": false, "error": "busy_rejected", "when_busy": "reject"})
				return
			}
			out, code, serr := s.postRuntimeJSON(runCtx, "/v1/runs/steer", map[string]any{
				"conversation_id": conv.ID,
				"request_id":      activeReq,
				"text":            storedContent,
				"mode":            mode,
				"when_busy":       mode,
			})
			if serr != nil {
				emit("error", map[string]string{"message": serr.Error()})
				emit("done", map[string]any{"ok": false})
				return
			}
			if code < 200 || code >= 300 {
				msg := "steer_failed"
				if e, ok := out["error"].(string); ok && e != "" {
					msg = e
				}
				emit("error", map[string]string{"message": msg})
				emit("done", map[string]any{"ok": false, "when_busy": mode})
				return
			}
			emit("meta", map[string]any{
				"phase":      "inbox_queued",
				"when_busy":  mode,
				"request_id": activeReq,
			})
			emit("inbox_updated", map[string]any{"when_busy": mode, "request_id": activeReq})
			emit("done", map[string]any{"ok": true, "inbox": true, "when_busy": mode, "request_id": activeReq})
			return
		}
	}

	cancelled := false
	var channelMembers []string
	var channelAgents []*db.Agent
	forcedAgents := map[string]bool{}
	if conv.ChannelID != "" {
		if ch, cerr := s.db.GetChannel(uid, conv.ChannelID); cerr == nil {
			channelMembers = ch.Members
		}
		channelAgents, _ = s.db.ListAgents(uid)
		forcedAgents = groupForcedAgentSet(content, channelMembers, channelAgents)
	}

	// Snapshot history once so multi-candidate group turns share the pre-send view.
	// Parallel candidates must not wait for / see each other's in-flight replies.
	msgs, lerr := s.db.ListMessages(uid, conv.ID)
	if lerr != nil {
		emit("error", map[string]string{"message": lerr.Error()})
		return
	}

	type groupCandidatePrep struct {
		index      int
		agentID    string
		agentName  string
		payloadMap map[string]any
		recallCtx  *recallPersistContext
	}
	preps := make([]groupCandidatePrep, 0, len(targetAgents))
	for i, agentID := range targetAgents {
		systemPrompt := ""
		agentName := agentID
		var selfAgent *db.Agent
		if agent, aerr := s.db.GetAgent(uid, agentID); aerr == nil {
			selfAgent = agent
			systemPrompt = agent.SystemPrompt
			agentName = agent.Name
		}
		// Group: each candidate may PASS when not specifically addressed.
		if conv.ChannelID != "" && len(targetAgents) > 1 {
			extra := groupParticipationExtraSystem(forcedAgents[agentID], selfAgent, channelMembers, channelAgents)
			if strings.TrimSpace(systemPrompt) != "" {
				systemPrompt = systemPrompt + "\n\n" + extra
			} else {
				systemPrompt = extra
			}
		}
		var history []runtimeMsg
		runtimeContent := storedContent
		agentNames := speakerNamesForHistory(s.db, msgs, agentID, agentName)
		if threadRootID != "" {
			// Quote injection is model-only and done by the runtime from
			// reply_to_content (apply_reply_quote); do not also prefix here or
			// the model would see the quote twice. Stored content stays raw.
			history = historyForThreadRuntime(msgs, threadRootID, agentID, agentNames)
		} else {
			history = historyForRuntime(msgs, agentID, agentNames)
		}
		if len(body.HandoffContext) > 0 {
			history = mergeHandoffContext(history, body.HandoffContext)
		}
		enabledSkills, _ := s.db.ListEnabledSkillNamesForAgent(uid, agentID)
		if enabledSkills == nil {
			enabledSkills = []string{}
		}
		requestID := uuid.NewString()
		payloadMap := map[string]any{
			"conversation_id": id,
			"content":         runtimeContent,
			"agent_id":        agentID,
			"user_id":         uid,
			"channel_id":      conv.ChannelID,
			"system_prompt":   systemPrompt,
			"messages":        history,
			"enabled_skills":  enabledSkills,
			"request_id":      requestID,
		}
		if replyToID != "" {
			payloadMap["reply_to_id"] = replyToID
		}
		// Explicit reply: parent already validated same-conversation above.
		// Runtime injects the quote into the model turn only.
		if replyQuote != "" {
			payloadMap["reply_to_content"] = replyQuote
		}
		if threadRootID != "" {
			payloadMap["thread_root_id"] = threadRootID
			threadMsgs := filterThreadMessages(msgs, threadRootID)
			payloadMap["reply_context"] = threadRecallQuery(storedContent, replyParent, threadMsgs)
		}
		if llmPayload != nil {
			payloadMap["llm"] = llmPayload
		}
		attachDecision(payloadMap, s.decisionRuntimePayload(uid))
		if body.Client != nil {
			payloadMap["client"] = body.Client
		}
		attachUserTimezone(payloadMap, s.userSettingsOrDefault(uid))
		s.attachPreferredMachine(payloadMap, uid, agentID)
		preps = append(preps, groupCandidatePrep{
			index:     i,
			agentID:   agentID,
			agentName: agentName,
			payloadMap: payloadMap,
			recallCtx: &recallPersistContext{
				UserID:         uid,
				AgentID:        agentID,
				ConversationID: conv.ID,
				MessageID:      userMsg.ID,
				Source:         "chat",
			},
		})
	}

	if err := runCtx.Err(); err != nil {
		cancelled = true
		if len(targetAgents) > 0 {
			// Cancelled before any candidate ran — keep a stop marker in history.
			_, _ = s.db.AddMessageWithOpts(conv.ID, "assistant", "（已停止）", botAssistantMessageOpts(targetAgents[0], threadRootID, ""))
		}
	} else {
		// Multi-candidate group: run concurrently (goroutines). Single-candidate
		// (DM / one @) still goes through the same path with wg size 1.
		// On hard runErr for one agent: continue others (parallel usefulness);
		// emit per-agent error + failure bubble, then a single terminal done.
		var (
			wg           sync.WaitGroup
			cancelledMu  sync.Mutex
			hardErrMu    sync.Mutex
			firstHardErr error
		)
		for _, prep := range preps {
			wg.Add(1)
			go func(prep groupCandidatePrep) {
				defer wg.Done()
				if runCtx.Err() != nil {
					cancelledMu.Lock()
					cancelled = true
					cancelledMu.Unlock()
					_, _ = s.db.AddMessageWithOpts(conv.ID, "assistant", "（已停止）", botAssistantMessageOpts(prep.agentID, threadRootID, ""))
					return
				}
				agentEmit := stampEmitAgentID(emit, prep.agentID)
				agentEmit("meta", map[string]any{
					"phase":      "agent_start",
					"agent_id":   prep.agentID,
					"agent_name": prep.agentName,
					"index":      prep.index,
					"total":      len(targetAgents),
					"forced":     forcedAgents[prep.agentID],
				})
				assistantText, pendingSummary, runID, runUsage, runErr := s.proxyRuntimeRun(runCtx, agentEmit, prep.payloadMap, prep.recallCtx)
				if pendingSummary != "" {
					sumAt := userMsg.CreatedAt.Add(-time.Millisecond)
					_, _ = s.db.AddMessageWithOpts(conv.ID, "summary", pendingSummary, db.AddMessageOpts{
						ThreadRootID: threadRootID,
						At:           sumAt,
					})
				}
				runCancelled := runCtx.Err() != nil || isCancelErr(runErr)
				// A failed run with empty tokens must NOT look like group PASS silence —
				// that is the "直接无返回" path (bubble dropped as PASS / never persisted).
				passed := conv.ChannelID != "" && !runCancelled && runErr == nil && isGroupPassReply(assistantText)
				// Persist partial assistant text even when cancelled mid-stream.
				// Empty cancel → keep a light UI/history marker so the next turn still
				// sees the interrupted turn (keep-partial-next-turn).
				// Group PASS / empty optional silence: do not persist a bubble.
				if passed {
					// Durable journal may have already projected PASS via commit_assistant(project=True).
					// Remove that row so silence never survives refresh / listMessages.
					s.dropProjectedGroupPass(conv.ID, runID)
					agentEmit("meta", map[string]any{
						"phase":    "agent_skipped",
						"agent_id": prep.agentID,
						"reason":   "pass",
						"index":    prep.index,
					})
				} else if strings.TrimSpace(assistantText) != "" {
					// Empty reply_to_id: Bot answers are not quotes. Link via request_id (= runtime run_id).
					s.saveAssistantThreaded(uid, conv.ID, prep.agentID, assistantText, "", threadRootID, runID, agentEmit)
				} else if runCancelled {
					_, _ = s.db.AddMessageWithOpts(conv.ID, "assistant", "（已停止）", botAssistantMessageOpts(prep.agentID, threadRootID, runID))
				} else if runErr != nil {
					// Persist a visible failure bubble (same family as 「（已停止）」) so refresh
					// and other clients still see the turn instead of silent empty.
					s.saveAssistantThreaded(uid, conv.ID, prep.agentID, formatAssistantRunFailure(runErr), "", threadRootID, runID, agentEmit)
				}
				if runErr != nil {
					if runCancelled {
						cancelledMu.Lock()
						cancelled = true
						cancelledMu.Unlock()
						return
					}
					// Continue sibling candidates; do not emit terminal done here.
					agentEmit("error", map[string]any{
						"message":  runErr.Error(),
						"agent_id": prep.agentID,
					})
					hardErrMu.Lock()
					if firstHardErr == nil {
						firstHardErr = runErr
					}
					hardErrMu.Unlock()
					return
				}
				if runCancelled {
					cancelledMu.Lock()
					cancelled = true
					cancelledMu.Unlock()
					return
				}
				if !passed {
					agentEmit("meta", map[string]any{
						"phase":    "agent_done",
						"agent_id": prep.agentID,
						"index":    prep.index,
					})
				}
				_ = s.db.RecordUsageRun("", uid, prep.agentID, conv.ID, "chat",
					runUsage.PromptTokens, runUsage.CompletionTokens, runUsage.TotalTokens)
			}(prep)
		}
		wg.Wait()
		if cancelled {
			emit("meta", map[string]any{"phase": "cancelled"})
			emit("done", map[string]any{"ok": false, "cancelled": true})
			return
		}
		if firstHardErr != nil {
			emit("done", map[string]any{"ok": false, "error": firstHardErr.Error(), "partial": true})
			return
		}
	}
	if cancelled {
		emit("meta", map[string]any{"phase": "cancelled"})
		emit("done", map[string]any{"ok": false, "cancelled": true})
		return
	}
	emit("done", map[string]any{"ok": true})
}

// stampEmitAgentID wraps an SSE emit so token/status/error/meta frames carry agent_id
// for parallel group candidates (client routes bubbles by agent_id).
func stampEmitAgentID(emit func(event string, data any), agentID string) func(event string, data any) {
	if emit == nil {
		return nil
	}
	agentID = strings.TrimSpace(agentID)
	if agentID == "" {
		return emit
	}
	return func(event string, data any) {
		switch event {
		case "token", "status", "error", "meta":
			switch m := data.(type) {
			case map[string]any:
				cp := make(map[string]any, len(m)+1)
				for k, v := range m {
					cp[k] = v
				}
				if _, ok := cp["agent_id"]; !ok {
					cp["agent_id"] = agentID
				}
				emit(event, cp)
				return
			case map[string]string:
				cp := make(map[string]any, len(m)+1)
				for k, v := range m {
					cp[k] = v
				}
				if _, ok := cp["agent_id"]; !ok {
					cp["agent_id"] = agentID
				}
				emit(event, cp)
				return
			}
		}
		emit(event, data)
	}
}

// resolveSendTargets picks which agents should answer this turn.
// DM: always the conversation's agent.
// Group: see resolveGroupSendTargets — candidates are @mentions, @everyone→all, or
// all members when no @; each optional candidate may PASS (see groupParticipationExtraSystem).
func (s *Server) resolveSendTargets(uid string, conv *db.Conversation, explicit []string, content string, replyParent *db.Message) ([]string, error) {
	if conv.ChannelID == "" {
		return []string{conv.AgentID}, nil
	}
	ch, err := s.db.GetChannel(uid, conv.ChannelID)
	if err != nil {
		return nil, err
	}
	members := ch.Members
	if len(members) == 0 {
		return []string{conv.AgentID}, nil
	}
	agents, _ := s.db.ListAgents(uid)
	return resolveGroupSendTargets(members, agents, explicit, content, replyParent, conv.AgentID), nil
}

type runtimeUsage struct {
	PromptTokens     int64
	CompletionTokens int64
	TotalTokens      int64
}

func usageFromDonePayload(payload map[string]any) runtimeUsage {
	var u runtimeUsage
	raw, _ := payload["usage"].(map[string]any)
	if raw == nil {
		raw, _ = payload["usage_details"].(map[string]any)
	}
	if raw == nil {
		return u
	}
	asInt := func(v any) int64 {
		switch t := v.(type) {
		case float64:
			return int64(t)
		case int64:
			return t
		case int:
			return int64(t)
		case json.Number:
			n, _ := t.Int64()
			return n
		default:
			return 0
		}
	}
	u.PromptTokens = asInt(raw["prompt_tokens"])
	if u.PromptTokens == 0 {
		u.PromptTokens = asInt(raw["input_tokens"])
	}
	u.CompletionTokens = asInt(raw["completion_tokens"])
	if u.CompletionTokens == 0 {
		u.CompletionTokens = asInt(raw["output_tokens"])
	}
	u.TotalTokens = asInt(raw["total_tokens"])
	if u.TotalTokens == 0 && (u.PromptTokens > 0 || u.CompletionTokens > 0) {
		u.TotalTokens = u.PromptTokens + u.CompletionTokens
	}
	return u
}

// proxyRuntimeRun streams one runtime /v1/runs call via emit, returning assistant text,
// optional summary, and the runtime run_id (exposed to clients as message.request_id).
func (s *Server) proxyRuntimeRun(ctx context.Context, emit func(event string, data any), payloadMap map[string]any, recallCtx *recallPersistContext) (_ string, _ string, _ string, _ runtimeUsage, runErr error) {
	presConv, _ := payloadMap["conversation_id"].(string)
	presAgent, _ := payloadMap["agent_id"].(string)
	presUser, _ := payloadMap["user_id"].(string)
	// Start of run → thinking; runtime pushes working during tool exec.
	s.publishBotPresence(presUser, presConv, presAgent, "thinking")
	defer func() { s.finishBotPresence(presUser, presConv, presAgent, runErr) }()
	payload, _ := json.Marshal(payloadMap)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.runtimeURL+"/v1/runs", bytes.NewReader(payload))
	if err != nil {
		return "", "", "", runtimeUsage{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")

	resp, err := s.client.Do(req)
	if err != nil {
		return "", "", "", runtimeUsage{}, fmt.Errorf("runtime unreachable: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return "", "", "", runtimeUsage{}, fmt.Errorf("runtime error: %s", string(b))
	}

	var assistant strings.Builder
	var eventName string
	var pendingSummary string
	var runID string
	var usage runtimeUsage
	var streamErr error
	reader := bufio.NewReader(resp.Body)
	for {
		if err := ctx.Err(); err != nil {
			return stripThinkTags(assistant.String()), pendingSummary, runID, usage, err
		}
		line, err := reader.ReadBytes('\n')
		if len(line) > 0 {
			trimmed := strings.TrimRight(string(line), "\r\n")
			if strings.HasPrefix(trimmed, "event:") {
				eventName = strings.TrimSpace(strings.TrimPrefix(trimmed, "event:"))
			} else if strings.HasPrefix(trimmed, "data:") {
				raw := strings.TrimSpace(strings.TrimPrefix(trimmed, "data:"))
				var payload map[string]any
				if json.Unmarshal([]byte(raw), &payload) == nil {
					switch eventName {
					case "token":
						if text, ok := payload["text"].(string); ok {
							assistant.WriteString(text)
						}
						if emit != nil {
							emit("token", payload)
						}
					case "status":
						if emit != nil {
							emit("status", payload)
						}
					case "meta":
						if summaryNew, _ := payload["summary_new"].(bool); summaryNew {
							if sum, ok := payload["summary"].(string); ok && strings.TrimSpace(sum) != "" {
								pendingSummary = sum
							}
						}
						if rid := runIDFromRuntimeMeta(payload); rid != "" {
							runID = rid
						}
						if recallCtx != nil {
							s.persistMemoryRecallFromMeta(payload, *recallCtx)
						}
						if emit != nil {
							emit("meta", payload)
						}
					case "error":
						if emit != nil {
							emit("error", payload)
						}
						// Remember SSE error even if done frame is omitted / swallowed.
						if streamErr == nil {
							if msg := strings.TrimSpace(asString(payload["message"])); msg != "" {
								streamErr = fmt.Errorf("%s", msg)
							} else {
								streamErr = fmt.Errorf("runtime error")
							}
						}
					case "done":
						usage = usageFromDonePayload(payload)
						if rid := runIDFromRuntimeMeta(payload); rid != "" {
							runID = rid
						}
						// Per-agent done is swallowed for the client, but ok=false must
						// still become runErr or handleSendMessage thinks the turn succeeded.
						if derr := runtimeDoneFailure(payload); derr != nil && streamErr == nil {
							streamErr = derr
						}
					default:
						if emit != nil && eventName != "" {
							emit(eventName, payload)
						}
					}
				}
			} else if trimmed == "" {
				eventName = ""
			}
		}
		if err != nil {
			if err != io.EOF {
				if ctx.Err() != nil {
					return stripThinkTags(assistant.String()), pendingSummary, runID, usage, ctx.Err()
				}
				return stripThinkTags(assistant.String()), pendingSummary, runID, usage, err
			}
			break
		}
	}
	return stripThinkTags(assistant.String()), pendingSummary, runID, usage, streamErr
}

// runIDFromRuntimeMeta pulls the runtime run id from a meta/done payload
// (top-level run_id, or nested under memory_recall).
func runIDFromRuntimeMeta(payload map[string]any) string {
	if payload == nil {
		return ""
	}
	if id := strings.TrimSpace(asString(payload["run_id"])); id != "" {
		return id
	}
	if block, ok := payload["memory_recall"].(map[string]any); ok {
		return strings.TrimSpace(asString(block["run_id"]))
	}
	return ""
}

func isCancelErr(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	// net/http often wraps disconnect as url.Error / OpError with context canceled.
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "context canceled") || strings.Contains(msg, "request canceled")
}

// runtimeDoneFailure extracts a failure from a runtime SSE done payload.
// waiting_approval / cancelled are not treated as hard failures here.
// Success may omit ok; only explicit ok=false counts as failure.
func runtimeDoneFailure(payload map[string]any) error {
	if payload == nil {
		return nil
	}
	ok, hasOK := payload["ok"].(bool)
	if !hasOK || ok {
		return nil
	}
	if waiting, _ := payload["waiting_approval"].(bool); waiting {
		return nil
	}
	if cancelled, _ := payload["cancelled"].(bool); cancelled {
		return nil
	}
	errMsg := strings.TrimSpace(asString(payload["error"]))
	if errMsg == "" {
		errMsg = "runtime run failed"
	}
	return fmt.Errorf("%s", errMsg)
}

// formatAssistantRunFailure builds the persisted / client-visible failure bubble text.
func formatAssistantRunFailure(err error) string {
	msg := "运行失败"
	if err != nil {
		if t := strings.TrimSpace(err.Error()); t != "" {
			msg = t
		}
	}
	runes := []rune(msg)
	if len(runes) > 300 {
		msg = string(runes[:300]) + "…"
	}
	return "（失败）" + msg
}

func hostConfirmRuntimeNote(content string) string {
	var payload hostConfirmPayload
	if json.Unmarshal([]byte(content), &payload) != nil {
		return ""
	}
	op := strings.TrimSpace(payload.Op)
	if op == "" {
		return ""
	}
	path := strings.TrimSpace(payload.Path)
	if path == "" {
		path = "(无路径)"
	}
	status := strings.TrimSpace(payload.Status)
	switch status {
	case "allowed":
		status = "已允许"
	case "denied":
		status = "已拒绝"
	case "pending":
		status = "等待用户在对话里点允许/拒绝"
	case "":
		status = "未知"
	}
	return "[本机操作确认] op=" + op + " path=" + path + " 结果=" + status +
		"。这是系统记录。禁止编造与此相反的批准/拒绝；用户要重试删除时必须再次调用 host_delete（或 host_ssh_delete）。"
}

// mergeHandoffContext inserts prior-thread turns before the latest user message
// so the receiving bot can continue with shared context without storing it in its thread.
func mergeHandoffContext(history, handoff []runtimeMsg) []runtimeMsg {
	if len(handoff) == 0 {
		return history
	}
	cleaned := make([]runtimeMsg, 0, len(handoff))
	for _, m := range handoff {
		role := strings.TrimSpace(m.Role)
		content := strings.TrimSpace(m.Content)
		if content == "" {
			continue
		}
		switch role {
		case "user", "assistant", "system", "summary":
			cleaned = append(cleaned, runtimeMsg{Role: role, Content: content})
		}
	}
	if len(cleaned) == 0 {
		return history
	}
	if len(history) > 0 && history[len(history)-1].Role == "user" {
		base := history[:len(history)-1]
		last := history[len(history)-1]
		out := make([]runtimeMsg, 0, len(base)+len(cleaned)+1)
		out = append(out, base...)
		out = append(out, cleaned...)
		out = append(out, last)
		return out
	}
	return append(cleaned, history...)
}

func (s *Server) handleCompactConfig(w http.ResponseWriter, r *http.Request) {
	// Prefer runtime live config; fall back to local env.
	s.proxyJSON(w, http.MethodGet, "/v1/compact-config", nil, nil, "")
}

func (s *Server) handleListChannels(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	list, err := s.db.ListChannels(uid)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if list == nil {
		list = []*db.Channel{}
	}
	activeTasks, _ := s.db.ActiveTaskConversationIDs(uid)
	for _, ch := range list {
		if conv, e := s.db.GetConversationByChannel(uid, ch.ID); e == nil && conv != nil {
			ch.ConversationID = conv.ID
			if _, ok := activeTasks[conv.ID]; ok {
				ch.TaskActive = true
			}
		}
		s.enrichChannelOnline(uid, ch)
	}
	writeJSON(w, http.StatusOK, map[string]any{"channels": list})
}

func (s *Server) handleCreateChannel(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	var body struct {
		Name      string   `json:"name"`
		MemberIDs []string `json:"member_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	c, err := s.db.CreateChannel(uid, body.Name)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	for _, aid := range body.MemberIDs {
		aid = strings.TrimSpace(aid)
		if aid == "" {
			continue
		}
		_ = s.db.AddChannelMember(uid, c.ID, aid)
	}
	// Reload members and bind a real conversation so sidebar 群聊 opens like a thread.
	c, _ = s.db.GetChannel(uid, c.ID)
	if c == nil {
		writeJSON(w, http.StatusCreated, body)
		return
	}
	agentID := ""
	if len(c.Members) > 0 {
		agentID = c.Members[0]
	}
	if agentID == "" {
		var aerr error
		agentID, aerr = s.db.FirstAgentID(uid)
		if aerr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": aerr.Error()})
			return
		}
	}
	conv, err := s.db.EnsureChannelConversation(uid, c.ID, agentID, c.Name)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	c.ConversationID = conv.ID
	s.enrichChannelOnline(uid, c)
	writeJSON(w, http.StatusCreated, c)
}

func (s *Server) handleDeleteChannel(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	if err := s.db.DeleteChannel(uid, id); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleAddChannelMember(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	var body struct {
		AgentID string `json:"agent_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if err := s.db.AddChannelMember(uid, id, body.AgentID); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	c, err := s.db.GetChannel(uid, id)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	agentID := strings.TrimSpace(body.AgentID)
	if agentID == "" && len(c.Members) > 0 {
		agentID = c.Members[0]
	}
	if agentID == "" {
		agentID, _ = s.db.FirstAgentID(uid)
	}
	if agentID != "" {
		if conv, e := s.db.EnsureChannelConversation(uid, c.ID, agentID, c.Name); e == nil {
			c.ConversationID = conv.ID
		}
	}
	s.enrichChannelOnline(uid, c)
	writeJSON(w, http.StatusOK, c)
}

func (s *Server) handleChannelConversation(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	ch, err := s.db.GetChannel(uid, id)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "channel not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	agentID := ""
	if len(ch.Members) > 0 {
		agentID = ch.Members[0]
	}
	if agentID == "" {
		var aerr error
		agentID, aerr = s.db.FirstAgentID(uid)
		if aerr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": aerr.Error()})
			return
		}
	}
	conv, err := s.db.EnsureChannelConversation(uid, ch.ID, agentID, ch.Name)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.enrichChannelOnline(uid, ch)
	s.enrichConversationOnline(uid, conv)
	writeJSON(w, http.StatusOK, map[string]any{
		"channel":      ch,
		"conversation": conv,
	})
}

func (s *Server) handlePostAgentBusMessage(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	var body struct {
		FromAgentID string `json:"from_agent_id"`
		ToAgentID   string `json:"to_agent_id"`
		ChannelID   string `json:"channel_id"`
		Priority    bool   `json:"priority"`
		Body        string `json:"body"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	var toPtr, chPtr *string
	if strings.TrimSpace(body.ToAgentID) != "" {
		v := strings.TrimSpace(body.ToAgentID)
		toPtr = &v
	}
	if strings.TrimSpace(body.ChannelID) != "" {
		v := strings.TrimSpace(body.ChannelID)
		chPtr = &v
	}
	from := strings.TrimSpace(body.FromAgentID)
	if from == "" {
		var ferr error
		from, ferr = s.db.FirstAgentID(uid)
		if ferr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": ferr.Error()})
			return
		}
	}
	m, err := s.deliverAgentMessage(uid, from, toPtr, chPtr, body.Priority, body.Body, nil)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, m)
}

func (s *Server) handleAgentBusInbox(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	q := r.URL.Query()
	unread := q.Get("unread") == "1" || strings.EqualFold(q.Get("unread"), "true")
	agentID := strings.TrimSpace(q.Get("agent_id"))
	list, err := s.db.ListAgentInbox(uid, unread, agentID, 50)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if list == nil {
		list = []*db.AgentBusMessage{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": list})
}

func (s *Server) handleMarkAgentBusRead(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	if err := s.db.MarkAgentMessageRead(uid, id); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleListMCPServers(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	list, err := s.db.ListMCPServers(uid)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	pub := make([]db.MCPServerPublic, 0, len(list))
	for _, c := range list {
		pub = append(pub, c.Public())
	}
	writeJSON(w, http.StatusOK, map[string]any{"servers": pub})
}

type mcpServerBody struct {
	Name      string            `json:"name"`
	Transport string            `json:"transport"`
	Command   string            `json:"command"`
	Args      []string          `json:"args"`
	URL       string            `json:"url"`
	Env       map[string]string `json:"env"`
	Enabled   *bool             `json:"enabled"`
}

func (s *Server) handleCreateMCPServer(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	var body mcpServerBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	enabled := true
	if body.Enabled != nil {
		enabled = *body.Enabled
	}
	c, err := s.db.CreateMCPServer(uid, body.Name, body.Transport, body.Command, body.URL, body.Args, body.Env, enabled)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, c.Public())
}

func (s *Server) handlePatchMCPServer(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	var body map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	upd := db.MCPUpdate{}
	if raw, ok := body["name"]; ok {
		var v string
		_ = json.Unmarshal(raw, &v)
		upd.Name = &v
	}
	if raw, ok := body["transport"]; ok {
		var v string
		_ = json.Unmarshal(raw, &v)
		upd.Transport = &v
	}
	if raw, ok := body["command"]; ok {
		var v string
		_ = json.Unmarshal(raw, &v)
		upd.Command = &v
	}
	if raw, ok := body["args"]; ok {
		var v []string
		_ = json.Unmarshal(raw, &v)
		upd.Args = &v
	}
	if raw, ok := body["url"]; ok {
		var v string
		_ = json.Unmarshal(raw, &v)
		upd.URL = &v
	}
	if raw, ok := body["env"]; ok {
		var v map[string]string
		_ = json.Unmarshal(raw, &v)
		upd.Env = &v
	}
	if raw, ok := body["enabled"]; ok {
		var v bool
		_ = json.Unmarshal(raw, &v)
		upd.Enabled = &v
	}
	c, err := s.db.UpdateMCPServer(uid, id, upd)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, c.Public())
}

func (s *Server) handleDeleteMCPServer(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	if err := s.db.DeleteMCPServer(uid, id); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func mcpServerToRuntime(c *db.MCPServer) map[string]any {
	args := c.Args
	if args == nil {
		args = []string{}
	}
	env := c.Env
	if env == nil {
		env = map[string]string{}
	}
	return map[string]any{
		"id":        c.ID,
		"name":      c.Name,
		"transport": c.Transport,
		"command":   c.Command,
		"args":      args,
		"url":       c.URL,
		"env":       env,
		"enabled":   c.Enabled,
	}
}

func (s *Server) handleTestMCPServer(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	c, err := s.db.GetMCPServer(uid, id)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	payload, _ := json.Marshal(map[string]any{
		"user_id": uid,
		"server":  mcpServerToRuntime(c),
	})
	s.proxyJSON(w, http.MethodPost, "/v1/mcp/test", nil, bytes.NewReader(payload), "application/json")
}

func (s *Server) handleMCPListTools(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body == nil {
		body = map[string]any{}
	}
	body["user_id"] = uid
	// Prefer DB configs for the user so runtime does not need direct auth.
	list, err := s.db.ListMCPServers(uid)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	servers := make([]map[string]any, 0, len(list))
	for _, c := range list {
		if !c.Enabled {
			continue
		}
		if sid, _ := body["server_id"].(string); strings.TrimSpace(sid) != "" && c.ID != sid {
			continue
		}
		servers = append(servers, mcpServerToRuntime(c))
	}
	body["servers"] = servers
	b, _ := json.Marshal(body)
	s.proxyJSON(w, http.MethodPost, "/v1/mcp/list-tools", nil, bytes.NewReader(b), "application/json")
}

func (s *Server) handleMCPCallTool(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if body == nil {
		body = map[string]any{}
	}
	body["user_id"] = uid
	serverID, _ := body["server_id"].(string)
	serverID = strings.TrimSpace(serverID)
	if serverID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "server_id required"})
		return
	}
	c, err := s.db.GetMCPServer(uid, serverID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "server not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	body["server"] = mcpServerToRuntime(c)
	b, _ := json.Marshal(body)
	s.proxyJSON(w, http.MethodPost, "/v1/mcp/call-tool", nil, bytes.NewReader(b), "application/json")
}

func autoTitleFromContent(content string) string {
	s := strings.TrimSpace(content)
	s = strings.ReplaceAll(s, "\r\n", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.ReplaceAll(s, "\r", " ")
	for strings.Contains(s, "  ") {
		s = strings.ReplaceAll(s, "  ", " ")
	}
	s = strings.TrimSpace(s)
	runes := []rune(s)
	if len(runes) == 0 {
		return ""
	}
	limit := 28
	if len(runes) <= limit {
		return string(runes)
	}
	return string(runes[:limit]) + "…"
}

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
