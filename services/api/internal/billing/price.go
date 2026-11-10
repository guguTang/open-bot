// Package billing prices model calls at write time.
//
// Historical usage rows store estimated_cost_minor and the unit-price snapshot.
// Later edits to the price table must not be applied by re-running this math
// on old rows. Callers persist the returned minor amount.
//
// Cached-token policy: when a price row leaves cached_per_million_minor empty,
// cached tokens are billed at the input rate. The rate actually used is copied
// onto the call so the policy at write time stays visible.
//
// Reasoning tokens are recorded but not added on top of completion tokens.
// Providers that report them already include them in completion_tokens.
//
// A call with usage_source=unknown is never priced, even when tokens are 0
// and a price row exists. Zero tokens are not treated as a real spend.
package billing

import (
	"math"
	"strings"
	"time"
	"unicode"
)

const (
	SourceProvider  = "provider"
	SourceEstimated = "estimated"
	SourceUnknown   = "unknown"
	SourceMixed     = "mixed"

	KindChat      = "chat"
	KindCompress  = "compress"
	KindDecision  = "decision"
	KindVision    = "vision"
	KindEmbedding = "embedding"
	KindDream     = "dream"
	KindMem0      = "mem0"

	MatchExact  = "exact"
	MatchPrefix = "prefix"

	DefaultCurrency = "CNY"
)

// Call is one model invocation before pricing.
type Call struct {
	Model            string
	Provider         string
	LLMConnectionID  string
	CallKind         string
	UsageSource      string
	PromptTokens     int64
	CompletionTokens int64
	CachedTokens     int64
	ReasoningTokens  int64
	TotalTokens      int64
}

// Price is one effective unit-price row. Amounts are minor units per 1,000,000 tokens.
type Price struct {
	ID                    int64
	OrgID                 string
	Provider              string
	Model                 string
	MatchKind             string
	InputPerMillionMinor  int64
	OutputPerMillionMinor int64
	CachedPerMillionMinor *int64
	Currency              string
	EffectiveFrom         time.Time
	EffectiveTo           *time.Time
}

// PricedCall is a call plus the write-time cost snapshot.
type PricedCall struct {
	Call
	EstimatedCostMinor    *int64
	Currency              string
	PriceID               *int64
	InputPerMillionMinor  *int64
	OutputPerMillionMinor *int64
	CachedPerMillionMinor *int64
	Priced                bool
}

// Totals is the run-level sum of priced calls. Cost is nil when nothing was priced.
type Totals struct {
	PromptTokens       int64
	CompletionTokens   int64
	CachedTokens       int64
	ReasoningTokens    int64
	TotalTokens        int64
	EstimatedCostMinor *int64
	Currency           string
	UsageSource        string
	PricedCalls        int64
	UnpricedCalls      int64
	ProviderTokens     int64
	EstimatedTokens    int64
	UnknownTokens      int64
	UnpricedTokens     int64
}

// NormalizeCall fills total tokens and canonical source / kind.
// It does not invent token counts.
func NormalizeCall(c Call) Call {
	c.Model = strings.TrimSpace(c.Model)
	c.Provider = strings.TrimSpace(c.Provider)
	c.LLMConnectionID = strings.TrimSpace(c.LLMConnectionID)
	c.CallKind = normalizeKind(c.CallKind)
	c.UsageSource = normalizeSource(c.UsageSource)
	if c.PromptTokens < 0 {
		c.PromptTokens = 0
	}
	if c.CompletionTokens < 0 {
		c.CompletionTokens = 0
	}
	if c.CachedTokens < 0 {
		c.CachedTokens = 0
	}
	if c.ReasoningTokens < 0 {
		c.ReasoningTokens = 0
	}
	if c.TotalTokens <= 0 && (c.PromptTokens > 0 || c.CompletionTokens > 0) {
		c.TotalTokens = c.PromptTokens + c.CompletionTokens
	}
	if c.TotalTokens < 0 {
		c.TotalTokens = 0
	}
	if c.UsageSource == SourceUnknown {
		// An unknown call may keep zeros. It must not be priced later.
		return c
	}
	if c.PromptTokens == 0 && c.CompletionTokens == 0 && c.TotalTokens == 0 {
		c.UsageSource = SourceUnknown
	}
	return c
}

func normalizeKind(kind string) string {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case KindCompress:
		return KindCompress
	case KindDecision:
		return KindDecision
	case KindVision:
		return KindVision
	case KindEmbedding:
		return KindEmbedding
	case KindDream:
		return KindDream
	case KindMem0:
		return KindMem0
	case "", KindChat:
		return KindChat
	default:
		k := strings.ToLower(strings.TrimSpace(kind))
		if k == "" {
			return KindChat
		}
		return k
	}
}

func normalizeSource(source string) string {
	switch strings.ToLower(strings.TrimSpace(source)) {
	case SourceProvider, "official":
		return SourceProvider
	case SourceEstimated, "estimate":
		return SourceEstimated
	default:
		return SourceUnknown
	}
}

// Match picks the price in effect at `at`. Exact model wins over prefix.
// An org row wins over a platform row of the same kind. A provider-specific
// row wins over a row whose provider is blank (blank matches any provider).
func Match(rows []Price, orgID, provider, model string, at time.Time) *Price {
	model = strings.TrimSpace(model)
	if model == "" || at.IsZero() {
		return nil
	}
	orgID = strings.TrimSpace(orgID)
	provider = strings.TrimSpace(provider)
	var best *Price
	var bestKey [4]int
	for i := range rows {
		p := &rows[i]
		if !effective(p, at) {
			continue
		}
		kind, ok := matchesModel(p, model)
		if !ok {
			continue
		}
		rowOrg := strings.TrimSpace(p.OrgID)
		if rowOrg != "" && rowOrg != orgID {
			continue
		}
		rowProvider := strings.TrimSpace(p.Provider)
		if rowProvider != "" && !strings.EqualFold(rowProvider, provider) {
			continue
		}
		key := rankKey(rowOrg != "", kind, rowProvider != "", len(strings.TrimSpace(p.Model)))
		if best == nil || keyBetter(key, bestKey) {
			best = p
			bestKey = key
		}
	}
	return best
}

func effective(p *Price, at time.Time) bool {
	if p.EffectiveFrom.After(at) {
		return false
	}
	if p.EffectiveTo != nil && !p.EffectiveTo.After(at) {
		return false
	}
	return true
}

func matchesModel(p *Price, model string) (kind string, ok bool) {
	name := strings.TrimSpace(p.Model)
	if name == "" {
		return "", false
	}
	kind = strings.ToLower(strings.TrimSpace(p.MatchKind))
	if kind == "" {
		kind = MatchExact
	}
	switch kind {
	case MatchPrefix:
		if strings.HasPrefix(strings.ToLower(model), strings.ToLower(name)) {
			return MatchPrefix, true
		}
	default:
		if strings.EqualFold(model, name) {
			return MatchExact, true
		}
	}
	return "", false
}

// rankKey is [tier, providerSpecific, prefixLen, 0]. Higher is better.
// Tiers: org+exact, platform+exact, org+prefix, platform+prefix.
func rankKey(org bool, kind string, specific bool, prefixLen int) [4]int {
	tier := 1
	switch {
	case org && kind == MatchExact:
		tier = 4
	case !org && kind == MatchExact:
		tier = 3
	case org && kind == MatchPrefix:
		tier = 2
	default:
		tier = 1
	}
	spec := 0
	if specific {
		spec = 1
	}
	plen := 0
	if kind == MatchPrefix {
		plen = prefixLen
	}
	return [4]int{tier, spec, plen, 0}
}

func keyBetter(a, b [4]int) bool {
	for i := 0; i < len(a); i++ {
		if a[i] != b[i] {
			return a[i] > b[i]
		}
	}
	return false
}

// PriceCall snapshots the matching price onto the call.
// Unknown calls and calls with no matching price leave cost nil.
func PriceCall(c Call, rows []Price, orgID string, at time.Time) PricedCall {
	c = NormalizeCall(c)
	out := PricedCall{Call: c, Currency: DefaultCurrency}
	if c.UsageSource == SourceUnknown {
		return out
	}
	p := Match(rows, orgID, c.Provider, c.Model, at)
	if p == nil {
		return out
	}
	cost := costMinor(c, p)
	cur := strings.ToUpper(strings.TrimSpace(p.Currency))
	if cur == "" {
		cur = DefaultCurrency
	}
	in := p.InputPerMillionMinor
	outRate := p.OutputPerMillionMinor
	cached := cachedRate(p)
	id := p.ID
	out.EstimatedCostMinor = &cost
	out.Currency = cur
	out.PriceID = &id
	out.InputPerMillionMinor = &in
	out.OutputPerMillionMinor = &outRate
	out.CachedPerMillionMinor = &cached
	out.Priced = true
	return out
}

// cachedRate is the input rate when the row does not set a cache price.
func cachedRate(p *Price) int64 {
	if p.CachedPerMillionMinor != nil {
		return *p.CachedPerMillionMinor
	}
	return p.InputPerMillionMinor
}

func costMinor(c Call, p *Price) int64 {
	prompt := c.PromptTokens
	cached := c.CachedTokens
	if cached > prompt {
		cached = prompt
	}
	uncached := prompt - cached
	raw := uncached*p.InputPerMillionMinor + cached*cachedRate(p) + c.CompletionTokens*p.OutputPerMillionMinor
	return divRound(raw, 1_000_000)
}

func divRound(n, d int64) int64 {
	if n <= 0 || d <= 0 {
		return 0
	}
	return (n + d/2) / d
}

// Rollup sums calls into one run. It does not add any external aggregate.
// Costs in different currencies are not added; the run cost stays nil.
func Rollup(calls []PricedCall) Totals {
	t := Totals{Currency: DefaultCurrency, UsageSource: SourceUnknown}
	if len(calls) == 0 {
		return t
	}
	var costSum int64
	var costCur string
	costMixed := false
	pricedN := 0
	sources := map[string]bool{}
	for _, c := range calls {
		c.Call = NormalizeCall(c.Call)
		t.PromptTokens += c.PromptTokens
		t.CompletionTokens += c.CompletionTokens
		t.CachedTokens += c.CachedTokens
		t.ReasoningTokens += c.ReasoningTokens
		t.TotalTokens += c.TotalTokens
		sources[c.UsageSource] = true
		switch c.UsageSource {
		case SourceProvider:
			t.ProviderTokens += c.TotalTokens
		case SourceEstimated:
			t.EstimatedTokens += c.TotalTokens
		default:
			t.UnknownTokens += c.TotalTokens
		}
		if !c.Priced || c.EstimatedCostMinor == nil {
			t.UnpricedCalls++
			t.UnpricedTokens += c.TotalTokens
			continue
		}
		t.PricedCalls++
		cur := strings.ToUpper(strings.TrimSpace(c.Currency))
		if cur == "" {
			cur = DefaultCurrency
		}
		if costCur == "" {
			costCur = cur
		}
		if cur != costCur {
			costMixed = true
			continue
		}
		costSum += *c.EstimatedCostMinor
		pricedN++
	}
	if pricedN > 0 && !costMixed {
		v := costSum
		t.EstimatedCostMinor = &v
		t.Currency = costCur
	}
	t.UsageSource = rollupSource(sources)
	return t
}

func rollupSource(sources map[string]bool) string {
	n := 0
	for _, on := range sources {
		if on {
			n++
		}
	}
	if n == 0 {
		return SourceUnknown
	}
	if n > 1 {
		return SourceMixed
	}
	for src := range sources {
		return src
	}
	return SourceUnknown
}

// EstimateTokens is the same heuristic as agent-runtime compact.estimate_tokens.
// Empty text is 0. Non-empty text is at least 1.
func EstimateTokens(text string) int64 {
	if text == "" {
		return 0
	}
	cjk := 0
	for _, r := range text {
		if isCJK(r) {
			cjk++
		}
	}
	ascii := len([]rune(text)) - cjk
	if ascii < 0 {
		ascii = 0
	}
	est := int64(math.Round(float64(cjk)*0.6 + float64(ascii)/4.0))
	n := int64(len([]rune(text)))
	if floor := n / 4; floor > est {
		est = floor
	}
	if int64(cjk) > est {
		est = int64(cjk)
	}
	if est < 1 {
		est = 1
	}
	return est
}

func isCJK(r rune) bool {
	if unicode.Is(unicode.Han, r) {
		return true
	}
	return (r >= 0x3000 && r <= 0x303f) || (r >= 0xff00 && r <= 0xffef)
}

// SourceLabel is the admin/user wording for a rolled-up source.
// Mixed totals are never described as official usage.
func SourceLabel(source string) string {
	switch strings.ToLower(strings.TrimSpace(source)) {
	case SourceProvider:
		return "官方"
	case SourceEstimated:
		return "估算"
	case SourceMixed:
		return "混合"
	default:
		return "未能估算"
	}
}
