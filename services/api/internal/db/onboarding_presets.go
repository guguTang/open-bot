package db

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
)

// SkillsUnsetMarker in skills_json means "do not rewrite agent_skills" (historical C).
const SkillsUnsetMarker = "null"

// SkillsCuratedMarker expands to CuratedBuiltinSlugs() at apply time (historical E).
const SkillsCuratedMarker = "__curated__"

var onboardingPresetIDRe = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_-]{0,63}$`)

// OnboardingPreset is one job-focus option for empty-chat onboarding.
type OnboardingPreset struct {
	ID               string    `json:"id"`
	Title            string    `json:"title"`
	CardDesc         string    `json:"card_desc"`
	UserPrompt       string    `json:"user_prompt"`
	Description      string    `json:"description"`
	SystemPrompt     string    `json:"system_prompt"`
	SkillsJSON       string    `json:"skills_json"` // "null" | "__curated__" | JSON array
	SortOrder        int       `json:"sort_order"`
	Enabled          bool      `json:"enabled"`
	IsCustomFallback bool      `json:"is_custom_fallback"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// OnboardingPresetPublic is the client-facing card payload (no prompts written to agent).
type OnboardingPresetPublic struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	CardDesc   string `json:"card_desc"`
	UserPrompt string `json:"user_prompt"`
	SortOrder  int    `json:"sort_order"`
}

func (p *OnboardingPreset) Public() OnboardingPresetPublic {
	return OnboardingPresetPublic{
		ID:         p.ID,
		Title:      p.Title,
		CardDesc:   p.CardDesc,
		UserPrompt: p.UserPrompt,
		SortOrder:  p.SortOrder,
	}
}

// ResolveSkills returns (skills, set). set=false means leave agent_skills untouched.
func (p *OnboardingPreset) ResolveSkills() (skills []string, set bool) {
	raw := strings.TrimSpace(p.SkillsJSON)
	if raw == "" || raw == SkillsUnsetMarker {
		return nil, false
	}
	if raw == SkillsCuratedMarker {
		return CuratedBuiltinSlugs(), true
	}
	var list []string
	if err := json.Unmarshal([]byte(raw), &list); err != nil {
		return nil, false
	}
	out := make([]string, 0, len(list))
	seen := map[string]bool{}
	for _, s := range list {
		s = strings.TrimSpace(s)
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out, true
}

func NormalizeOnboardingPresetID(id string) (string, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return "", fmt.Errorf("id 必填")
	}
	if !onboardingPresetIDRe.MatchString(id) {
		return "", fmt.Errorf("id 须以字母开头，仅含字母数字_-/，最长 64")
	}
	// Keep single-letter focus keys uppercase (A–F); slugs stay as typed but lowercased if all-lower intent.
	if len(id) == 1 {
		return strings.ToUpper(id), nil
	}
	return id, nil
}

func (d *DB) migrateOnboardingPresets() error {
	_, err := d.SQL.Exec(`
CREATE TABLE IF NOT EXISTS onboarding_presets (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  card_desc TEXT NOT NULL DEFAULT '',
  user_prompt TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  skills_json TEXT NOT NULL DEFAULT 'null',
  sort_order INT NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_custom_fallback BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_onboarding_presets_sort
  ON onboarding_presets(enabled, sort_order, id);
`)
	if err != nil {
		return err
	}
	return d.seedOnboardingPresets()
}

type onboardingSeed struct {
	ID               string
	Title            string
	CardDesc         string
	UserPrompt       string
	Description      string
	SystemPrompt     string
	SkillsJSON       string
	SortOrder        int
	IsCustomFallback bool
}

func defaultOnboardingSeeds() []onboardingSeed {
	return []onboardingSeed{
		{
			ID:           "A",
			Title:        "日常事务与提醒",
			CardDesc:     "日程、待办、定时提醒",
			UserPrompt:   "我想先用你来做：日常事务与提醒（日程、待办、定时提醒）。请按这个方向协助我，之后我还可以随时改。",
			Description:  "负责日常事务与提醒：日程、待办、定时提醒。保持简洁可执行；未经确认不代发外部消息。",
			SystemPrompt: "你主攻日常事务与提醒（日程、待办、定时提醒）。优先给出可执行的下一步；涉及外发或删除需先征得用户同意。",
			SkillsJSON:   `["daily-brief"]`,
			SortOrder:    10,
		},
		{
			ID:           "B",
			Title:        "查资料与总结",
			CardDesc:     "搜索、阅读、整理要点",
			UserPrompt:   "我想先用你来做：查资料与总结（搜索、阅读、整理要点）。请按这个方向协助我，之后我还可以随时改。",
			Description:  "负责查资料与总结：搜索、阅读、整理要点。输出需可核对；重要结论注明来源或依据。",
			SystemPrompt: "你主攻查资料与总结。先澄清问题边界，再整理要点；区分事实与推测。",
			SkillsJSON:   `["summarize-text"]`,
			SortOrder:    20,
		},
		{
			ID:           "C",
			Title:        "写东西与改稿",
			CardDesc:     "邮件、文档、文案",
			UserPrompt:   "我想先用你来做：写东西与改稿（邮件、文档、文案）。请按这个方向协助我，之后我还可以随时改。",
			Description:  "负责写东西与改稿：邮件、文档、文案。尊重用户语气；定稿外发前先给草稿。",
			SystemPrompt: "你主攻写作与改稿。先确认受众与用途，再出草稿；不擅自代发。",
			SkillsJSON:   SkillsUnsetMarker,
			SortOrder:    30,
		},
		{
			ID:           "D",
			Title:        "写代码与排障",
			CardDesc:     "改项目、查 bug、联调",
			UserPrompt:   "我想先用你来做：写代码与排障（改项目、查 bug、联调）。请按这个方向协助我，之后我还可以随时改。",
			Description:  "负责写代码与排障：改项目、查 bug、联调。小步验证；危险操作需确认。远程 SSH 先 load_skill host-ssh。",
			SystemPrompt: "你主攻写代码与排障。优先小步修改与可验证结果；本机项目用 host_*。复杂编码流程先 load_skill dev-assist（再按需加载排障/TDD/实现/评审等）。远程先 load_skill host-ssh。",
			SkillsJSON: `[
  "dev-assist","diagnosing-bugs","tdd","implement","code-review","host-ssh","summarize-text",
  "grill-me","grill-with-docs","improve-codebase-architecture","codebase-design","domain-modeling",
  "prototype","triage","find-skills","generative-ui","frontend-design","vercel-react-best-practices","handoff","teach"
]`,
			SortOrder: 40,
		},
		{
			ID:               "E",
			Title:            "先随便聊聊",
			CardDesc:         "",
			UserPrompt:       "先随便聊聊就好，不用急着定方向。",
			Description:      "通用助手：按用户当下话题协助，保持灵活。",
			SystemPrompt:     "你是通用助手，先理解用户意图再行动，不强行套用固定流程。需要深挖需求时 load_skill grill-me；找生态技能用 find-skills。",
			SkillsJSON:       SkillsCuratedMarker,
			SortOrder:        50,
			IsCustomFallback: true,
		},
		{
			ID:           "F",
			Title:        "微应用与本机工具",
			CardDesc:     "微应用、本机能力、授权闸门",
			UserPrompt:   "我想先用你来做：微应用与本机工具（搭建/配置微应用、本机能力与授权）。请按这个方向协助我，之后我还可以随时改。",
			Description:  "负责微应用与本机工具：搭建与配置微应用、本机能力调用、授权与能力闸门。涉及敏感操作需先征得用户同意。",
			SystemPrompt: "你主攻微应用与本机工具。协助用户起草/固定微应用、声明能力与授权；本机操作走 host_*；未经确认不扩大授权范围。需要找生态技能时 load_skill find-skills。",
			SkillsJSON:   `["prototype","handoff","find-skills"]`,
			SortOrder:    60,
		},
	}
}

func (d *DB) seedOnboardingPresets() error {
	now := Now()
	for _, s := range defaultOnboardingSeeds() {
		_, err := d.SQL.Exec(`
INSERT INTO onboarding_presets (
  id, title, card_desc, user_prompt, description, system_prompt,
  skills_json, sort_order, enabled, is_custom_fallback, created_at, updated_at
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9,$10,$10)
ON CONFLICT (id) DO NOTHING
`, s.ID, s.Title, s.CardDesc, s.UserPrompt, s.Description, s.SystemPrompt,
			s.SkillsJSON, s.SortOrder, s.IsCustomFallback, now)
		if err != nil {
			return fmt.Errorf("seed onboarding preset %s: %w", s.ID, err)
		}
	}
	// Ensure exactly one custom fallback when none marked (e.g. admin deleted E).
	var n int
	if err := d.SQL.QueryRow(`SELECT COUNT(*) FROM onboarding_presets WHERE is_custom_fallback = TRUE`).Scan(&n); err != nil {
		return err
	}
	if n == 0 {
		_, _ = d.SQL.Exec(`
UPDATE onboarding_presets SET is_custom_fallback = TRUE, updated_at = $1
WHERE id = (
  SELECT id FROM onboarding_presets WHERE enabled = TRUE ORDER BY sort_order, id LIMIT 1
)
`, now)
	}
	return nil
}

func scanOnboardingPreset(scanner interface {
	Scan(dest ...any) error
}) (*OnboardingPreset, error) {
	var p OnboardingPreset
	err := scanner.Scan(
		&p.ID, &p.Title, &p.CardDesc, &p.UserPrompt, &p.Description, &p.SystemPrompt,
		&p.SkillsJSON, &p.SortOrder, &p.Enabled, &p.IsCustomFallback, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

const onboardingPresetCols = `
  id, title, card_desc, user_prompt, description, system_prompt,
  skills_json, sort_order, enabled, is_custom_fallback, created_at, updated_at`

func (d *DB) ListOnboardingPresets(includeDisabled bool) ([]OnboardingPreset, error) {
	q := `SELECT` + onboardingPresetCols + ` FROM onboarding_presets`
	if !includeDisabled {
		q += ` WHERE enabled = TRUE`
	}
	q += ` ORDER BY sort_order ASC, id ASC`
	rows, err := d.SQL.Query(q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OnboardingPreset
	for rows.Next() {
		p, err := scanOnboardingPreset(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

func (d *DB) GetOnboardingPreset(id string) (*OnboardingPreset, error) {
	id = strings.TrimSpace(id)
	if len(id) == 1 {
		id = strings.ToUpper(id)
	}
	row := d.SQL.QueryRow(`SELECT`+onboardingPresetCols+` FROM onboarding_presets WHERE id = $1`, id)
	p, err := scanOnboardingPreset(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return p, nil
}

func (d *DB) GetCustomFallbackOnboardingPreset() (*OnboardingPreset, error) {
	row := d.SQL.QueryRow(`
SELECT` + onboardingPresetCols + `
FROM onboarding_presets
WHERE is_custom_fallback = TRUE AND enabled = TRUE
ORDER BY sort_order ASC, id ASC
LIMIT 1`)
	p, err := scanOnboardingPreset(row)
	if errors.Is(err, sql.ErrNoRows) {
		// Fallback: enabled E, else first enabled
		row = d.SQL.QueryRow(`SELECT` + onboardingPresetCols + ` FROM onboarding_presets WHERE id = 'E' AND enabled = TRUE`)
		p, err = scanOnboardingPreset(row)
		if errors.Is(err, sql.ErrNoRows) {
			row = d.SQL.QueryRow(`
SELECT` + onboardingPresetCols + `
FROM onboarding_presets WHERE enabled = TRUE ORDER BY sort_order ASC, id ASC LIMIT 1`)
			p, err = scanOnboardingPreset(row)
			if errors.Is(err, sql.ErrNoRows) {
				return nil, ErrNotFound
			}
		}
	}
	if err != nil {
		return nil, err
	}
	return p, nil
}

func (d *DB) clearCustomFallbackFlags(exceptID string) error {
	if exceptID == "" {
		_, err := d.SQL.Exec(`UPDATE onboarding_presets SET is_custom_fallback = FALSE WHERE is_custom_fallback = TRUE`)
		return err
	}
	_, err := d.SQL.Exec(`
UPDATE onboarding_presets SET is_custom_fallback = FALSE
WHERE is_custom_fallback = TRUE AND id <> $1
`, exceptID)
	return err
}

type OnboardingPresetInput struct {
	ID               string
	Title            string
	CardDesc         string
	UserPrompt       string
	Description      string
	SystemPrompt     string
	SkillsJSON       string
	SortOrder        int
	Enabled          *bool
	IsCustomFallback *bool
}

func normalizeSkillsJSON(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == SkillsUnsetMarker {
		return SkillsUnsetMarker, nil
	}
	if raw == SkillsCuratedMarker {
		return SkillsCuratedMarker, nil
	}
	var list []string
	if err := json.Unmarshal([]byte(raw), &list); err != nil {
		return "", fmt.Errorf("skills_json 须为 null、__curated__ 或 JSON 字符串数组")
	}
	b, err := json.Marshal(list)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func (d *DB) CreateOnboardingPreset(in OnboardingPresetInput) (*OnboardingPreset, error) {
	id, err := NormalizeOnboardingPresetID(in.ID)
	if err != nil {
		return nil, err
	}
	skills, err := normalizeSkillsJSON(in.SkillsJSON)
	if err != nil {
		return nil, err
	}
	enabled := true
	if in.Enabled != nil {
		enabled = *in.Enabled
	}
	custom := false
	if in.IsCustomFallback != nil {
		custom = *in.IsCustomFallback
	}
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return nil, fmt.Errorf("title 必填")
	}
	now := Now()
	if custom {
		if err := d.clearCustomFallbackFlags(""); err != nil {
			return nil, err
		}
	}
	_, err = d.SQL.Exec(`
INSERT INTO onboarding_presets (
  id, title, card_desc, user_prompt, description, system_prompt,
  skills_json, sort_order, enabled, is_custom_fallback, created_at, updated_at
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
`, id, title, strings.TrimSpace(in.CardDesc), strings.TrimSpace(in.UserPrompt),
		strings.TrimSpace(in.Description), strings.TrimSpace(in.SystemPrompt),
		skills, in.SortOrder, enabled, custom, now)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "duplicate") || strings.Contains(err.Error(), "unique") {
			return nil, fmt.Errorf("id %q 已存在", id)
		}
		return nil, err
	}
	return d.GetOnboardingPreset(id)
}

func (d *DB) UpdateOnboardingPreset(id string, in OnboardingPresetInput) (*OnboardingPreset, error) {
	cur, err := d.GetOnboardingPreset(id)
	if err != nil {
		return nil, err
	}
	title := strings.TrimSpace(in.Title)
	if title == "" {
		title = cur.Title
	}
	cardDesc := strings.TrimSpace(in.CardDesc)
	userPrompt := strings.TrimSpace(in.UserPrompt)
	if userPrompt == "" {
		userPrompt = cur.UserPrompt
	}
	desc := strings.TrimSpace(in.Description)
	sp := strings.TrimSpace(in.SystemPrompt)
	skills := cur.SkillsJSON
	if strings.TrimSpace(in.SkillsJSON) != "" {
		skills, err = normalizeSkillsJSON(in.SkillsJSON)
		if err != nil {
			return nil, err
		}
	}
	sortOrder := in.SortOrder
	enabled := cur.Enabled
	if in.Enabled != nil {
		enabled = *in.Enabled
	}
	custom := cur.IsCustomFallback
	if in.IsCustomFallback != nil {
		custom = *in.IsCustomFallback
	}
	if custom {
		if err := d.clearCustomFallbackFlags(cur.ID); err != nil {
			return nil, err
		}
	}
	now := Now()
	_, err = d.SQL.Exec(`
UPDATE onboarding_presets SET
  title = $2, card_desc = $3, user_prompt = $4, description = $5, system_prompt = $6,
  skills_json = $7, sort_order = $8, enabled = $9, is_custom_fallback = $10, updated_at = $11
WHERE id = $1
`, cur.ID, title, cardDesc, userPrompt, desc, sp,
		skills, sortOrder, enabled, custom, now)
	if err != nil {
		return nil, err
	}
	return d.GetOnboardingPreset(cur.ID)
}

func (d *DB) DeleteOnboardingPreset(id string) error {
	cur, err := d.GetOnboardingPreset(id)
	if err != nil {
		return err
	}
	res, err := d.SQL.Exec(`DELETE FROM onboarding_presets WHERE id = $1`, cur.ID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	if cur.IsCustomFallback {
		_, _ = d.SQL.Exec(`
UPDATE onboarding_presets SET is_custom_fallback = TRUE, updated_at = $1
WHERE id = (
  SELECT id FROM onboarding_presets WHERE enabled = TRUE ORDER BY sort_order, id LIMIT 1
)
`, Now())
	}
	return nil
}

// ReorderOnboardingPresets sets sort_order = (index+1)*10 for the given ids (enabled or not).
func (d *DB) ReorderOnboardingPresets(ids []string) error {
	if len(ids) == 0 {
		return fmt.Errorf("ids 不能为空")
	}
	tx, err := d.SQL.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	now := Now()
	for i, raw := range ids {
		id := strings.TrimSpace(raw)
		if len(id) == 1 {
			id = strings.ToUpper(id)
		}
		res, err := tx.Exec(`UPDATE onboarding_presets SET sort_order = $2, updated_at = $3 WHERE id = $1`, id, (i+1)*10, now)
		if err != nil {
			return err
		}
		n, _ := res.RowsAffected()
		if n == 0 {
			return fmt.Errorf("预设 %q 不存在", id)
		}
	}
	return tx.Commit()
}

// HardcodedOnboardingFallback returns compile-time A–F when DB is empty/unreachable (clients + apply).
func HardcodedOnboardingFallback() []OnboardingPreset {
	now := Now()
	seeds := defaultOnboardingSeeds()
	out := make([]OnboardingPreset, 0, len(seeds))
	for _, s := range seeds {
		out = append(out, OnboardingPreset{
			ID:               s.ID,
			Title:            s.Title,
			CardDesc:         s.CardDesc,
			UserPrompt:       s.UserPrompt,
			Description:      s.Description,
			SystemPrompt:     s.SystemPrompt,
			SkillsJSON:       s.SkillsJSON,
			SortOrder:        s.SortOrder,
			Enabled:          true,
			IsCustomFallback: s.IsCustomFallback,
			CreatedAt:        now,
			UpdatedAt:        now,
		})
	}
	return out
}
