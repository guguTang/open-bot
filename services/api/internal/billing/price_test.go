package billing

import (
	"testing"
	"time"
)

func i64(n int64) *int64 { return &n }

func TestCostUsesCachedInputRateWhenUnset(t *testing.T) {
	p := Price{
		ID:                    1,
		Model:                 "gpt-4o-mini",
		MatchKind:             MatchExact,
		InputPerMillionMinor:  1_000_000,
		OutputPerMillionMinor: 2_000_000,
		Currency:              "CNY",
		EffectiveFrom:         time.Unix(0, 0),
	}
	call := Call{
		Model:            "gpt-4o-mini",
		UsageSource:      SourceProvider,
		PromptTokens:     100,
		CachedTokens:     40,
		CompletionTokens: 10,
	}
	got := PriceCall(call, []Price{p}, "", time.Now())
	if !got.Priced || got.EstimatedCostMinor == nil {
		t.Fatalf("expected a price, got %+v", got)
	}
	// uncached 60 * 1 + cached 40 * 1 + completion 10 * 2 = 120
	if *got.EstimatedCostMinor != 120 {
		t.Fatalf("cost=%d", *got.EstimatedCostMinor)
	}
	if got.CachedPerMillionMinor == nil || *got.CachedPerMillionMinor != 1_000_000 {
		t.Fatalf("cached snapshot=%v", got.CachedPerMillionMinor)
	}
}

func TestExplicitCachedRate(t *testing.T) {
	p := Price{
		ID:                    2,
		Model:                 "gpt-4o-mini",
		MatchKind:             MatchExact,
		InputPerMillionMinor:  1_000_000,
		OutputPerMillionMinor: 0,
		CachedPerMillionMinor: i64(0),
		Currency:              "CNY",
		EffectiveFrom:         time.Unix(0, 0),
	}
	call := Call{
		Model:        "gpt-4o-mini",
		UsageSource:  SourceEstimated,
		PromptTokens: 100,
		CachedTokens: 40,
	}
	got := PriceCall(call, []Price{p}, "", time.Now())
	// uncached 60 * 1 + cached 40 * 0 = 60
	if got.EstimatedCostMinor == nil || *got.EstimatedCostMinor != 60 {
		t.Fatalf("cost=%v", got.EstimatedCostMinor)
	}
}

func TestUnpricedIsNilNotZero(t *testing.T) {
	call := Call{
		Model:        "local-model",
		UsageSource:  SourceEstimated,
		PromptTokens: 50,
		TotalTokens:  50,
	}
	got := PriceCall(call, nil, "", time.Now())
	if got.Priced || got.EstimatedCostMinor != nil {
		t.Fatalf("unpriced should have nil cost, got %+v", got)
	}
	if got.PromptTokens != 50 {
		t.Fatalf("tokens dropped: %+v", got)
	}
}

func TestUnknownIsNeverPriced(t *testing.T) {
	p := Price{
		ID:                   3,
		Model:                "gpt-4o-mini",
		MatchKind:            MatchExact,
		InputPerMillionMinor: 1_000_000,
		Currency:             "CNY",
		EffectiveFrom:        time.Unix(0, 0),
	}
	got := PriceCall(Call{Model: "gpt-4o-mini", UsageSource: SourceUnknown}, []Price{p}, "", time.Now())
	if got.Priced || got.EstimatedCostMinor != nil {
		t.Fatalf("unknown must not be priced, got %+v", got)
	}
	if got.UsageSource != SourceUnknown {
		t.Fatalf("source=%s", got.UsageSource)
	}
}

func TestZeroProviderTokensAreNotSpend(t *testing.T) {
	p := Price{
		ID:                   4,
		Model:                "gpt-4o-mini",
		MatchKind:            MatchExact,
		InputPerMillionMinor: 5_000_000,
		Currency:             "CNY",
		EffectiveFrom:        time.Unix(0, 0),
	}
	got := PriceCall(Call{Model: "gpt-4o-mini", UsageSource: SourceProvider}, []Price{p}, "", time.Now())
	if got.UsageSource != SourceUnknown || got.EstimatedCostMinor != nil {
		t.Fatalf("zero-token row priced as spend: %+v", got)
	}
}

func TestPriceChangeDoesNotRewriteSnapshot(t *testing.T) {
	at := time.Now()
	old := Price{
		ID:                    1,
		Model:                 "gpt-4o-mini",
		MatchKind:             MatchExact,
		InputPerMillionMinor:  1_000_000,
		OutputPerMillionMinor: 1_000_000,
		Currency:              "CNY",
		EffectiveFrom:         at.Add(-time.Hour),
	}
	call := Call{
		Model:            "gpt-4o-mini",
		CallKind:         KindChat,
		UsageSource:      SourceProvider,
		PromptTokens:     1_000_000,
		CompletionTokens: 0,
		TotalTokens:      1_000_000,
	}
	first := PriceCall(call, []Price{old}, "", at)
	if first.EstimatedCostMinor == nil || *first.EstimatedCostMinor != 1_000_000 {
		t.Fatalf("first=%v", first.EstimatedCostMinor)
	}
	updated := old
	updated.ID = 2
	updated.InputPerMillionMinor = 9_000_000
	updated.EffectiveFrom = at
	second := PriceCall(call, []Price{updated}, "", at.Add(time.Minute))
	if second.EstimatedCostMinor == nil || *second.EstimatedCostMinor != 9_000_000 {
		t.Fatalf("second=%v", second.EstimatedCostMinor)
	}
	if *first.EstimatedCostMinor != 1_000_000 {
		t.Fatalf("historical cost rewritten to %d", *first.EstimatedCostMinor)
	}
}

func TestExactBeatsPrefixAndOrgBeatsPlatform(t *testing.T) {
	at := time.Now()
	rows := []Price{
		{ID: 1, Model: "gpt-4o", MatchKind: MatchPrefix, InputPerMillionMinor: 99, EffectiveFrom: at.Add(-time.Hour)},
		{ID: 2, Model: "gpt-4o-mini", MatchKind: MatchExact, InputPerMillionMinor: 11, EffectiveFrom: at.Add(-time.Hour)},
		{ID: 3, Model: "gpt-4o", MatchKind: MatchExact, InputPerMillionMinor: 50, EffectiveFrom: at.Add(-time.Hour)},
		{ID: 4, OrgID: "org-a", Model: "gpt-4o", MatchKind: MatchExact, InputPerMillionMinor: 7, EffectiveFrom: at.Add(-time.Hour)},
		{ID: 5, Model: "claude-3-5-sonnet", MatchKind: MatchPrefix, InputPerMillionMinor: 3, EffectiveFrom: at.Add(-time.Hour)},
		{
			ID: 6, Model: "expired", MatchKind: MatchExact, InputPerMillionMinor: 1,
			EffectiveFrom: at.Add(-2 * time.Hour), EffectiveTo: ptrTime(at.Add(-time.Minute)),
		},
	}
	mini := Match(rows, "", "", "gpt-4o-mini", at)
	if mini == nil || mini.ID != 2 {
		t.Fatalf("exact should win, got %+v", mini)
	}
	base := Match(rows, "", "", "gpt-4o", at)
	if base == nil || base.ID != 3 {
		t.Fatalf("exact gpt-4o, got %+v", base)
	}
	dated := Match(rows, "", "", "gpt-4o-2024-08-06", at)
	if dated == nil || dated.ID != 1 {
		t.Fatalf("prefix gpt-4o, got %+v", dated)
	}
	org := Match(rows, "org-a", "", "gpt-4o", at)
	if org == nil || org.ID != 4 {
		t.Fatalf("org override, got %+v", org)
	}
	other := Match(rows, "org-b", "", "gpt-4o", at)
	if other == nil || other.ID != 3 {
		t.Fatalf("other org should use platform exact, got %+v", other)
	}
	claude := Match(rows, "", "", "claude-3-5-sonnet-20241022", at)
	if claude == nil || claude.ID != 5 {
		t.Fatalf("prefix family, got %+v", claude)
	}
	if Match(rows, "", "", "expired", at) != nil {
		t.Fatal("expired price matched")
	}
	spec := Match([]Price{
		{ID: 8, Model: "gpt-4o-mini", Provider: "", MatchKind: MatchExact, InputPerMillionMinor: 1, EffectiveFrom: at.Add(-time.Hour)},
		{ID: 9, Model: "gpt-4o-mini", Provider: "openai", MatchKind: MatchExact, InputPerMillionMinor: 2, EffectiveFrom: at.Add(-time.Hour)},
	}, "", "openai", "gpt-4o-mini", at)
	if spec == nil || spec.ID != 9 {
		t.Fatalf("provider-specific exact, got %+v", spec)
	}
}

func TestRollupDoesNotAddExternalTotalAndSplitsSources(t *testing.T) {
	costA := int64(10)
	costB := int64(5)
	calls := []PricedCall{
		{
			Call: Call{
				CallKind: KindChat, UsageSource: SourceProvider,
				PromptTokens: 10, CompletionTokens: 4, TotalTokens: 14,
			},
			EstimatedCostMinor: &costA, Currency: "CNY", Priced: true,
		},
		{
			Call: Call{
				CallKind: KindCompress, UsageSource: SourceEstimated,
				PromptTokens: 3, CompletionTokens: 2, CachedTokens: 1, TotalTokens: 5,
			},
			EstimatedCostMinor: &costB, Currency: "CNY", Priced: true,
		},
		{
			Call: Call{CallKind: KindEmbedding, UsageSource: SourceEstimated, PromptTokens: 8, TotalTokens: 8},
		},
	}
	// A mistaken caller might also hold the done.usage sum (13/6/19). Rollup must ignore it.
	got := Rollup(calls)
	if got.PromptTokens != 21 || got.CompletionTokens != 6 || got.TotalTokens != 27 {
		t.Fatalf("sum=%+v", got)
	}
	if got.UsageSource != SourceMixed {
		t.Fatalf("source=%s", got.UsageSource)
	}
	if got.EstimatedCostMinor == nil || *got.EstimatedCostMinor != 15 {
		t.Fatalf("cost=%v", got.EstimatedCostMinor)
	}
	if got.PricedCalls != 2 || got.UnpricedCalls != 1 || got.UnpricedTokens != 8 {
		t.Fatalf("priced split=%+v", got)
	}
	if got.ProviderTokens != 14 || got.EstimatedTokens != 13 {
		t.Fatalf("token split provider=%d estimated=%d", got.ProviderTokens, got.EstimatedTokens)
	}
	if SourceLabel(got.UsageSource) == "官方" {
		t.Fatal("mixed total labeled official")
	}
}

func TestCallKindsStayDistinct(t *testing.T) {
	for _, kind := range []string{KindDecision, KindVision, KindEmbedding, KindCompress, KindDream, KindMem0} {
		got := NormalizeCall(Call{CallKind: kind, UsageSource: SourceEstimated, PromptTokens: 2, TotalTokens: 2})
		if got.CallKind != kind {
			t.Fatalf("kind %s became %s", kind, got.CallKind)
		}
	}
}

func ptrTime(t time.Time) *time.Time { return &t }
