package db

import (
	"database/sql"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/tangxin/open-bot/services/api/internal/billing"
)

func TestLedgerSnapshotAndUserMatchesAdmin(t *testing.T) {
	d, err := Open("")
	if err != nil {
		t.Skip(err)
	}
	defer d.Close()

	org, err := d.EnsureDefaultOrg()
	if err != nil {
		t.Fatal(err)
	}
	userID := uuid.NewString()
	username := "usage-" + userID[:8]
	if _, err := d.SQL.Exec(`
INSERT INTO users (id, username, password_hash, org_id, role, email, created_at)
VALUES ($1, $2, 'x', $3, $4, $5, $6)
`, userID, username, org.ID, RoleMember, username+"@example.com", Now()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = d.SQL.Exec(`DELETE FROM usage_calls WHERE user_id = $1`, userID)
		_, _ = d.SQL.Exec(`DELETE FROM usage_runs WHERE user_id = $1`, userID)
		_, _ = d.SQL.Exec(`DELETE FROM model_prices WHERE model LIKE 'phase1-test-%'`)
		_, _ = d.SQL.Exec(`DELETE FROM users WHERE id = $1`, userID)
	})

	agentID := uuid.NewString()
	if _, err := d.SQL.Exec(`
INSERT INTO agents (id, user_id, name, created_at, updated_at)
VALUES ($1, $2, '用量助手', $3, $3)
`, agentID, userID, Now()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = d.SQL.Exec(`DELETE FROM agents WHERE id = $1`, agentID)
	})

	price, err := d.CreateModelPrice(ModelPriceInput{
		Model:                 "phase1-test-model",
		MatchKind:             billing.MatchExact,
		InputPerMillionMinor:  1_000_000,
		OutputPerMillionMinor: 2_000_000,
		Currency:              "CNY",
	})
	if err != nil {
		t.Fatal(err)
	}
	conv := uuid.NewString()
	err = d.RecordUsageLedger(UsageLedgerMeta{
		UserID: userID, AgentID: agentID, ConversationID: conv, Source: "chat",
	}, []billing.Call{
		{
			Model: "phase1-test-model", Provider: "openai", CallKind: billing.KindChat,
			UsageSource: billing.SourceProvider, PromptTokens: 10, CompletionTokens: 4, TotalTokens: 14,
		},
		{
			Model: "phase1-test-model", CallKind: billing.KindCompress,
			UsageSource: billing.SourceEstimated, PromptTokens: 3, CompletionTokens: 1, TotalTokens: 4,
		},
		{
			Model: "phase1-unpriced", CallKind: billing.KindEmbedding,
			UsageSource: billing.SourceEstimated, PromptTokens: 8, TotalTokens: 8,
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	var runPrompt, runCompletion, runTotal int64
	var runCost sql.NullInt64
	var runSource string
	var priced, unpriced int64
	err = d.SQL.QueryRow(`
SELECT prompt_tokens, completion_tokens, total_tokens, estimated_cost_minor, usage_source, priced_calls, unpriced_calls
FROM usage_runs WHERE user_id = $1 ORDER BY id DESC LIMIT 1
`, userID).Scan(&runPrompt, &runCompletion, &runTotal, &runCost, &runSource, &priced, &unpriced)
	if err != nil {
		t.Fatal(err)
	}
	if runPrompt != 21 || runCompletion != 5 || runTotal != 26 {
		t.Fatalf("run sum prompt=%d completion=%d total=%d", runPrompt, runCompletion, runTotal)
	}
	if runSource != billing.SourceMixed {
		t.Fatalf("source=%s", runSource)
	}
	if !runCost.Valid || priced != 2 || unpriced != 1 {
		t.Fatalf("cost valid=%v priced=%d unpriced=%d cost=%d", runCost.Valid, priced, unpriced, runCost.Int64)
	}
	// 10*1 + 4*2 + 3*1 + 1*2 = 10+8+3+2 = 23
	if runCost.Int64 != 23 {
		t.Fatalf("cost=%d", runCost.Int64)
	}

	var callSum int64
	if err := d.SQL.QueryRow(`SELECT COALESCE(SUM(total_tokens),0) FROM usage_calls WHERE user_id = $1`, userID).Scan(&callSum); err != nil {
		t.Fatal(err)
	}
	if callSum != runTotal {
		t.Fatalf("calls %d != run %d", callSum, runTotal)
	}
	var unpricedCost sql.NullInt64
	if err := d.SQL.QueryRow(`
SELECT estimated_cost_minor FROM usage_calls WHERE user_id = $1 AND model = 'phase1-unpriced'
`, userID).Scan(&unpricedCost); err != nil {
		t.Fatal(err)
	}
	if unpricedCost.Valid {
		t.Fatalf("unpriced cost = %d", unpricedCost.Int64)
	}

	firstCost := runCost.Int64
	if _, err := d.UpdateModelPrice(price.ID, ModelPriceInput{
		Model:                 "phase1-test-model",
		MatchKind:             billing.MatchExact,
		InputPerMillionMinor:  5_000_000,
		OutputPerMillionMinor: 5_000_000,
		Currency:              "CNY",
	}); err != nil {
		t.Fatal(err)
	}
	err = d.RecordUsageLedger(UsageLedgerMeta{
		UserID: userID, AgentID: agentID, ConversationID: conv, Source: "chat",
	}, []billing.Call{{
		Model: "phase1-test-model", CallKind: billing.KindChat, UsageSource: billing.SourceProvider,
		PromptTokens: 2, CompletionTokens: 0, TotalTokens: 2,
	}})
	if err != nil {
		t.Fatal(err)
	}
	var historical int64
	if err := d.SQL.QueryRow(`
SELECT estimated_cost_minor FROM usage_runs WHERE user_id = $1 ORDER BY id ASC LIMIT 1
`, userID).Scan(&historical); err != nil {
		t.Fatal(err)
	}
	if historical != firstCost {
		t.Fatalf("historical cost changed %d -> %d", firstCost, historical)
	}
	var newest int64
	if err := d.SQL.QueryRow(`
SELECT estimated_cost_minor FROM usage_runs WHERE user_id = $1 ORDER BY id DESC LIMIT 1
`, userID).Scan(&newest); err != nil {
		t.Fatal(err)
	}
	if newest != 10 { // 2 tokens * 5 minor
		t.Fatalf("new price cost=%d", newest)
	}

	month := time.Now().In(time.Local).Format("2006-01")
	mine, err := d.GetUserMonthUsage(userID, month)
	if err != nil {
		t.Fatal(err)
	}
	admin, err := d.GetOrgUsageDetailed(org.ID, 30)
	if err != nil {
		t.Fatal(err)
	}
	var adminUser *UsageRunDay
	for i := range admin.ByUser {
		if admin.ByUser[i].UserID == userID {
			adminUser = &admin.ByUser[i]
			break
		}
	}
	if adminUser == nil {
		t.Fatal("admin aggregate missing user")
	}
	if mine.PromptTokens != adminUser.PromptTokens || mine.CompletionTokens != adminUser.CompletionTokens || mine.TotalTokens != adminUser.TotalTokens {
		t.Fatalf("user %+v admin %+v", mine, adminUser)
	}
	if (mine.EstimatedCostMinor == nil) != (adminUser.EstimatedCostMinor == nil) {
		t.Fatalf("cost nil mismatch user=%v admin=%v", mine.EstimatedCostMinor, adminUser.EstimatedCostMinor)
	}
	if mine.EstimatedCostMinor != nil && *mine.EstimatedCostMinor != *adminUser.EstimatedCostMinor {
		t.Fatalf("cost user=%d admin=%d", *mine.EstimatedCostMinor, *adminUser.EstimatedCostMinor)
	}
	if mine.UsageSource == billing.SourceProvider {
		t.Fatal("mixed month labeled provider")
	}
}
