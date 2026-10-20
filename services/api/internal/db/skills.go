package db

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var skillNameRe = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

type UserSkill struct {
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Enabled     bool              `json:"enabled"`
	Custom      bool              `json:"custom"`
	FileCount   int               `json:"file_count,omitempty"`
	Files       []SkillFileRecord `json:"files,omitempty"`
	// AlwaysOn / DisableBlocked: curated role=always_on discovery entry (find-skills).
	AlwaysOn       bool `json:"always_on,omitempty"`
	DisableBlocked bool `json:"disable_blocked,omitempty"`
}

// SkillsRoot resolves the global skills directory (repo skills/).
func SkillsRoot() string {
	if v := strings.TrimSpace(os.Getenv("SKILLS_DIR")); v != "" {
		return v
	}
	if root := strings.TrimSpace(os.Getenv("OPEN_BOT_ROOT")); root != "" {
		return filepath.Join(root, "skills")
	}
	here, err := os.Getwd()
	if err == nil {
		dir := here
		for i := 0; i < 6; i++ {
			candidate := filepath.Join(dir, "skills")
			if st, err := os.Stat(candidate); err == nil && st.IsDir() {
				abs, _ := filepath.Abs(candidate)
				return abs
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	return filepath.Clean(filepath.Join("..", "..", "..", "skills"))
}

// UserSkillsDir is the legacy on-disk path for custom skills (skills/users/<id>).
// New uploads go to Postgres only; this helper remains for delete-time cleanup.
func UserSkillsDir(userID string) string {
	safe := sanitizePathSegment(userID)
	return filepath.Join(SkillsRoot(), "users", safe)
}

func SanitizeUserSegment(s string) string { return sanitizePathSegment(s) }

func sanitizePathSegment(s string) string {
	var b strings.Builder
	for _, r := range strings.TrimSpace(s) {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			b.WriteRune(r)
		} else {
			b.WriteByte('_')
		}
	}
	out := b.String()
	if out == "" {
		return "_unknown"
	}
	return out
}

func ValidSkillName(name string) bool {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 64 {
		return false
	}
	return skillNameRe.MatchString(name)
}

type GlobalSkill struct {
	Name        string
	Description string
	Custom      bool
	Path        string
}

func listSkillsFromDir(root string, custom bool) ([]GlobalSkill, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var out []GlobalSkill
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		// skip users/ bucket under global root
		if !custom && e.Name() == "users" {
			continue
		}
		skillMD := filepath.Join(root, e.Name(), "SKILL.md")
		data, err := os.ReadFile(skillMD)
		if err != nil {
			continue
		}
		name, desc := parseSkillFrontmatter(string(data), e.Name())
		if name == "" || desc == "" {
			continue
		}
		out = append(out, GlobalSkill{Name: name, Description: desc, Custom: custom, Path: skillMD})
	}
	return out, nil
}

func ListGlobalSkillsFromDisk() ([]GlobalSkill, error) {
	return listSkillsFromDir(SkillsRoot(), false)
}

func parseSkillFrontmatter(text, fallbackName string) (name, desc string) {
	name = fallbackName
	if !strings.HasPrefix(strings.TrimSpace(text), "---") {
		return name, ""
	}
	rest := strings.TrimSpace(text)
	rest = strings.TrimPrefix(rest, "---")
	parts := strings.SplitN(rest, "\n---", 2)
	if len(parts) < 1 {
		return name, ""
	}
	for _, line := range strings.Split(parts[0], "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || !strings.Contains(line, ":") {
			continue
		}
		k, v, _ := strings.Cut(line, ":")
		k = strings.TrimSpace(k)
		v = strings.Trim(strings.TrimSpace(v), `"'`)
		switch k {
		case "name":
			if v != "" {
				name = v
			}
		case "description":
			desc = v
		}
	}
	return name, desc
}

// BuildSkillMarkdown ensures Agent Skills frontmatter (name + description).
func BuildSkillMarkdown(name, description, body string) string {
	name = strings.TrimSpace(name)
	description = strings.TrimSpace(description)
	body = strings.TrimSpace(body)
	// strip existing frontmatter from body if present
	if strings.HasPrefix(body, "---") {
		rest := strings.TrimPrefix(body, "---")
		parts := strings.SplitN(rest, "\n---", 2)
		if len(parts) == 2 {
			body = strings.TrimSpace(parts[1])
		}
	}
	if description == "" {
		description = "User-uploaded skill: " + name
	}
	var b strings.Builder
	b.WriteString("---\n")
	b.WriteString("name: ")
	b.WriteString(name)
	b.WriteString("\n")
	b.WriteString("description: ")
	b.WriteString(description)
	b.WriteString("\n")
	b.WriteString("---\n\n")
	if body != "" {
		b.WriteString(body)
		if !strings.HasSuffix(body, "\n") {
			b.WriteString("\n")
		}
	} else {
		b.WriteString("# ")
		b.WriteString(name)
		b.WriteString("\n\n")
		b.WriteString(description)
		b.WriteString("\n")
	}
	return b.String()
}

func (d *DB) ListUserSkills(userID string) ([]UserSkill, error) {
	all, err := d.listCatalogSkills(userID)
	if err != nil {
		return nil, err
	}
	if err := d.SeedUserSkills(userID, all); err != nil {
		return nil, err
	}
	rows, err := d.SQL.Query(
		`SELECT skill_name, enabled FROM user_skills WHERE user_id = $1`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	enabledMap := map[string]bool{}
	for rows.Next() {
		var n string
		var en bool
		if err := rows.Scan(&n, &en); err != nil {
			return nil, err
		}
		enabledMap[n] = en
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]UserSkill, 0, len(all))
	for _, g := range all {
		en, ok := enabledMap[g.Name]
		if !ok {
			en = true
		}
		alwaysOn := IsAlwaysOnBuiltin(g.Name)
		if alwaysOn {
			en = true
		}
		sk := UserSkill{
			Name:           g.Name,
			Description:    g.Description,
			Enabled:        en,
			Custom:         g.Custom,
			AlwaysOn:       alwaysOn,
			DisableBlocked: alwaysOn,
		}
		if g.Custom {
			n, _ := d.countUserSkillPackageFiles(userID, g.Name)
			if n == 0 {
				n = 1 // body_markdown only
			}
			sk.FileCount = n
		}
		out = append(out, sk)
	}
	return out, nil
}

// SeedUserSkills inserts missing user_skills rows.
// Brand-new accounts: enable all catalog skills (first-party disk + curated default-on batch).
// Existing accounts: newly appeared skills default to enabled=false, EXCEPT curated/default-on
// (public/common, e.g. generative-ui) and always_on discovery entries which insert as enabled=true.
// Does not rewrite existing user_skills / agent_skills rows (no backfill). ON CONFLICT DO NOTHING.
func (d *DB) SeedUserSkills(userID string, global []GlobalSkill) error {
	var n int
	if err := d.SQL.QueryRow(`SELECT COUNT(*) FROM user_skills WHERE user_id = $1`, userID).Scan(&n); err != nil {
		return err
	}
	brandNew := n == 0
	for _, g := range global {
		enabled := true
		if !brandNew {
			// Existing user: do not auto-enable non-curated skills that just appeared.
			enabled = false
		}
		// Public/common curated default-on + always_on discovery: enable on insert.
		if IsAlwaysOnBuiltin(g.Name) || IsCuratedBuiltin(g.Name) {
			enabled = true
		}
		_, err := d.SQL.Exec(
			`INSERT INTO user_skills (user_id, skill_name, enabled)
			 VALUES ($1, $2, $3)
			 ON CONFLICT (user_id, skill_name) DO NOTHING`,
			userID, g.Name, enabled,
		)
		if err != nil {
			return err
		}
	}
	// Keep always-on discovery skills enabled even if an older row was disabled.
	for _, slug := range AlwaysOnBuiltinSlugs() {
		_, err := d.SQL.Exec(
			`UPDATE user_skills SET enabled = TRUE WHERE user_id = $1 AND skill_name = $2 AND enabled = FALSE`,
			userID, slug,
		)
		if err != nil {
			return err
		}
	}
	return nil
}

// SeedNewAgentDefaultSkills materializes agent_skills for a newly created bot.
// Default-on = curated default-on list (skills.sh batch + first-party public/common such as
// generative-ui; always, when present on disk) ∪ currently account-enabled first-party skills.
// role=always_on (find-skills) is always mounted as the discovery entry.
// Does not rewrite existing agent_skills rows. Old bots are untouched (no backfill).
func (d *DB) SeedNewAgentDefaultSkills(userID, agentID string) error {
	var n int
	if err := d.SQL.QueryRow(`SELECT COUNT(*) FROM agent_skills WHERE agent_id = $1`, agentID).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	userList, err := d.ListUserSkills(userID)
	if err != nil {
		return err
	}
	curated := map[string]bool{}
	for _, s := range CuratedBuiltinSlugs() {
		curated[s] = true
	}
	inCatalog := map[string]bool{}
	for _, s := range userList {
		inCatalog[s.Name] = true
	}
	seen := map[string]bool{}
	var names []string
	for _, s := range userList {
		if curated[s.Name] {
			if !seen[s.Name] {
				seen[s.Name] = true
				names = append(names, s.Name)
			}
			continue
		}
		// First-party (not in curated skills.sh batch): keep account-enabled ones.
		if s.Enabled && !seen[s.Name] {
			seen[s.Name] = true
			names = append(names, s.Name)
		}
	}
	// Curated always default-on for new bots even if account toggle is still off
	// (existing users may have received curated rows as enabled=false).
	for _, slug := range CuratedBuiltinSlugs() {
		if !inCatalog[slug] || seen[slug] {
			continue
		}
		seen[slug] = true
		names = append(names, slug)
	}
	// Discovery entry: always mount find-skills (and any other role=always_on).
	for _, slug := range AlwaysOnBuiltinSlugs() {
		if !inCatalog[slug] || seen[slug] {
			continue
		}
		seen[slug] = true
		names = append(names, slug)
	}
	names = EnsureAlwaysOnSkills(names)
	names = EnsurePublicCommonSkills(names)
	// Public/common curated (e.g. generative-ui): enable account row so agent∩account effective=on.
	// Existing false rows (skill appeared before it became curated/public) would otherwise gate runtime off.
	for _, slug := range PublicCommonBuiltinSlugs() {
		_, err := d.SQL.Exec(
			`INSERT INTO user_skills (user_id, skill_name, enabled)
			 VALUES ($1, $2, TRUE)
			 ON CONFLICT (user_id, skill_name) DO UPDATE SET enabled = TRUE`,
			userID, slug,
		)
		if err != nil {
			return err
		}
	}
	if len(names) == 0 {
		return nil
	}
	return d.ReplaceAgentSkills(userID, agentID, names)
}

func (d *DB) findSkillMeta(userID, name string) (GlobalSkill, bool, error) {
	all, err := d.listCatalogSkills(userID)
	if err != nil {
		return GlobalSkill{}, false, err
	}
	for _, g := range all {
		if g.Name == name {
			return g, true, nil
		}
	}
	return GlobalSkill{}, false, nil
}

func (d *DB) SetUserSkillEnabled(userID, name string, enabled bool) (*UserSkill, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("skill name required")
	}
	if !enabled && IsAlwaysOnBuiltin(name) {
		return nil, ErrSkillDisableBlocked
	}
	meta, found, err := d.findSkillMeta(userID, name)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, ErrNotFound
	}
	_, err = d.SQL.Exec(
		`INSERT INTO user_skills (user_id, skill_name, enabled)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (user_id, skill_name) DO UPDATE SET enabled = EXCLUDED.enabled`,
		userID, name, enabled,
	)
	if err != nil {
		return nil, err
	}
	alwaysOn := IsAlwaysOnBuiltin(name)
	return &UserSkill{
		Name: name, Description: meta.Description, Enabled: enabled, Custom: meta.Custom,
		AlwaysOn: alwaysOn, DisableBlocked: alwaysOn,
	}, nil
}

func (d *DB) ListEnabledSkillNames(userID string) ([]string, error) {
	list, err := d.ListUserSkills(userID)
	if err != nil {
		return nil, err
	}
	var out []string
	for _, s := range list {
		if s.Enabled {
			out = append(out, s.Name)
		}
	}
	return out, nil
}

// ListEnabledSkillNamesForAgent returns user-enabled skills intersected with the
// bot allowlist. If the agent has no agent_skills rows yet, all user-enabled skills apply.
func (d *DB) ListEnabledSkillNamesForAgent(userID, agentID string) ([]string, error) {
	userEnabled, err := d.ListEnabledSkillNames(userID)
	if err != nil {
		return nil, err
	}
	agentID = strings.TrimSpace(agentID)
	if agentID == "" {
		return userEnabled, nil
	}
	rows, err := d.SQL.Query(
		`SELECT skill_name, enabled FROM agent_skills WHERE agent_id = $1`,
		agentID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	agentMap := map[string]bool{}
	anyRow := false
	for rows.Next() {
		var name string
		var en bool
		if err := rows.Scan(&name, &en); err != nil {
			return nil, err
		}
		anyRow = true
		agentMap[name] = en
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if !anyRow {
		return EnsureAlwaysOnSkills(userEnabled), nil
	}
	userSet := map[string]bool{}
	for _, name := range userEnabled {
		userSet[name] = true
	}
	var out []string
	seen := map[string]bool{}
	for _, name := range userEnabled {
		if agentMap[name] || IsAlwaysOnBuiltin(name) {
			if !seen[name] {
				seen[name] = true
				out = append(out, name)
			}
		}
	}
	for _, slug := range AlwaysOnBuiltinSlugs() {
		if userSet[slug] && !seen[slug] {
			seen[slug] = true
			out = append(out, slug)
		}
	}
	// Parity with empty-allowlist path: always-on discovery skills stay mounted.
	return EnsureAlwaysOnSkills(out), nil
}

type AgentSkill struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Enabled     bool   `json:"enabled"`
	Custom      bool   `json:"custom"`
	// AccountEnabled is the account-level toggle (settings「技能」); Enabled is already the intersection.
	AccountEnabled bool `json:"account_enabled"`
	// AlwaysOn / DisableBlocked: curated role=always_on discovery entry (find-skills).
	AlwaysOn       bool `json:"always_on,omitempty"`
	DisableBlocked bool `json:"disable_blocked,omitempty"`
}

func (d *DB) ListAgentSkills(userID, agentID string) ([]AgentSkill, error) {
	if _, err := d.GetAgent(userID, agentID); err != nil {
		return nil, err
	}
	userList, err := d.ListUserSkills(userID)
	if err != nil {
		return nil, err
	}
	rows, err := d.SQL.Query(
		`SELECT skill_name, enabled FROM agent_skills WHERE agent_id = $1`,
		agentID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	override := map[string]bool{}
	anyRow := false
	for rows.Next() {
		var n string
		var en bool
		if err := rows.Scan(&n, &en); err != nil {
			return nil, err
		}
		anyRow = true
		override[n] = en
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]AgentSkill, 0, len(userList))
	for _, u := range userList {
		en := u.Enabled
		if anyRow {
			if v, ok := override[u.Name]; ok {
				en = u.Enabled && v
			} else {
				en = false
			}
		}
		alwaysOn := IsAlwaysOnBuiltin(u.Name)
		if alwaysOn {
			en = true
		}
		out = append(out, AgentSkill{
			Name:           u.Name,
			Description:    u.Description,
			Enabled:        en,
			Custom:         u.Custom,
			AccountEnabled: u.Enabled,
			AlwaysOn:       alwaysOn,
			DisableBlocked: alwaysOn,
		})
	}
	return out, nil
}

func (d *DB) SetAgentSkillEnabled(userID, agentID, name string, enabled bool) (*AgentSkill, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("skill name required")
	}
	if !enabled && IsAlwaysOnBuiltin(name) {
		return nil, ErrSkillDisableBlocked
	}
	if _, err := d.GetAgent(userID, agentID); err != nil {
		return nil, err
	}
	// Ensure catalog row exists for this user.
	all, err := d.ListUserSkills(userID)
	if err != nil {
		return nil, err
	}
	var meta UserSkill
	found := false
	for _, s := range all {
		if s.Name == name {
			meta = s
			found = true
			break
		}
	}
	if !found {
		return nil, ErrNotFound
	}
	// Materialize full allowlist if first toggle (copy current effective = all user-enabled).
	var n int
	_ = d.SQL.QueryRow(`SELECT COUNT(*) FROM agent_skills WHERE agent_id = $1`, agentID).Scan(&n)
	if n == 0 {
		for _, s := range all {
			_, _ = d.SQL.Exec(
				`INSERT INTO agent_skills (agent_id, skill_name, enabled) VALUES ($1, $2, $3)
				 ON CONFLICT (agent_id, skill_name) DO NOTHING`,
				agentID, s.Name, s.Enabled,
			)
		}
	}
	_, err = d.SQL.Exec(
		`INSERT INTO agent_skills (agent_id, skill_name, enabled)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (agent_id, skill_name) DO UPDATE SET enabled = EXCLUDED.enabled`,
		agentID, name, enabled,
	)
	if err != nil {
		return nil, err
	}
	alwaysOn := IsAlwaysOnBuiltin(name)
	en := enabled && meta.Enabled
	if alwaysOn {
		en = true
	}
	return &AgentSkill{
		Name:           name,
		Description:    meta.Description,
		Enabled:        en,
		Custom:         meta.Custom,
		AccountEnabled: meta.Enabled || alwaysOn,
		AlwaysOn:       alwaysOn,
		DisableBlocked: alwaysOn,
	}, nil
}

// ReplaceAgentSkills sets the full per-bot allowlist (enabled names only get enabled=true).
// Always-on discovery skills (find-skills) are force-included.
func (d *DB) ReplaceAgentSkills(userID, agentID string, enabledNames []string) error {
	if _, err := d.GetAgent(userID, agentID); err != nil {
		return err
	}
	all, err := d.ListUserSkills(userID)
	if err != nil {
		return err
	}
	enabledNames = EnsureAlwaysOnSkills(enabledNames)
	allow := map[string]bool{}
	for _, n := range enabledNames {
		n = strings.TrimSpace(n)
		if n != "" {
			allow[n] = true
		}
	}
	for _, slug := range AlwaysOnBuiltinSlugs() {
		allow[slug] = true
	}
	_, err = d.SQL.Exec(`DELETE FROM agent_skills WHERE agent_id = $1`, agentID)
	if err != nil {
		return err
	}
	for _, s := range all {
		en := allow[s.Name]
		_, err = d.SQL.Exec(
			`INSERT INTO agent_skills (agent_id, skill_name, enabled) VALUES ($1, $2, $3)`,
			agentID, s.Name, en,
		)
		if err != nil {
			return err
		}
	}
	return nil
}

// ApplyAgentOnboarding updates description/system_prompt and optional skill defaults for a bot.
func (d *DB) ApplyAgentOnboarding(userID, agentID, description, systemPrompt string, skillNames []string) (*Agent, error) {
	a, err := d.GetAgent(userID, agentID)
	if err != nil {
		return nil, err
	}
	desc := strings.TrimSpace(description)
	if desc == "" {
		desc = a.Description
	}
	sp := strings.TrimSpace(systemPrompt)
	if sp == "" {
		sp = a.SystemPrompt
	} else if strings.TrimSpace(a.SystemPrompt) != "" && !strings.Contains(a.SystemPrompt, sp) {
		sp = strings.TrimSpace(a.SystemPrompt) + "\n\n" + sp
	}
	name := a.Name
	updated, err := d.UpdateAgent(userID, agentID, name, desc, sp)
	if err != nil {
		return nil, err
	}
	if skillNames != nil {
		if err := d.ReplaceAgentSkills(userID, agentID, skillNames); err != nil {
			return nil, err
		}
	}
	return updated, nil
}

func (d *DB) UploadUserSkill(userID, name, description, bodyMarkdown string) (*UserSkill, error) {
	name = strings.TrimSpace(strings.ToLower(name))
	md := BuildSkillMarkdown(name, description, bodyMarkdown)
	return d.UploadUserSkillPackage(userID, []SkillFileRecord{
		{Path: "SKILL.md", Content: md},
	}, name, description)
}

// UploadUserSkillPackage validates and stores a multi-file custom skill package.
func (d *DB) UploadUserSkillPackage(userID string, files []SkillFileRecord, nameHint, descHint string) (*UserSkill, error) {
	name, desc, normalized, err := ValidateSkillPackage(files, nameHint, descHint)
	if err != nil {
		return nil, err
	}
	if row, err := d.GetGlobalSkill(name); err == nil && row != nil {
		return nil, fmt.Errorf("skill name %q conflicts with a global skill", name)
	} else if err != nil && !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	diskGlobal, err := ListGlobalSkillsFromDisk()
	if err != nil {
		return nil, err
	}
	for _, g := range diskGlobal {
		if g.Name == name {
			return nil, fmt.Errorf("skill name %q conflicts with a global skill", name)
		}
	}

	var skillMD string
	for _, f := range normalized {
		if f.Path == "SKILL.md" {
			skillMD = f.Content
			break
		}
	}

	// Custom user skills live only in Postgres (user_skill_files + package files).
	// Do not write skills/users/ — that path is legacy and must not receive new uploads.

	_, err = d.SQL.Exec(
		`INSERT INTO user_skill_files (user_id, skill_name, description, body_markdown, updated_at)
		 VALUES ($1, $2, $3, $4, NOW())
		 ON CONFLICT (user_id, skill_name) DO UPDATE
		   SET description = EXCLUDED.description,
		       body_markdown = EXCLUDED.body_markdown,
		       updated_at = NOW()`,
		userID, name, desc, skillMD,
	)
	if err != nil {
		return nil, err
	}
	_, err = d.SQL.Exec(
		`DELETE FROM user_skill_package_files WHERE user_id = $1 AND skill_name = $2`,
		userID, name,
	)
	if err != nil {
		return nil, err
	}
	for _, f := range normalized {
		_, err = d.SQL.Exec(
			`INSERT INTO user_skill_package_files (user_id, skill_name, path, content, updated_at)
			 VALUES ($1, $2, $3, $4, NOW())`,
			userID, name, f.Path, f.Content,
		)
		if err != nil {
			return nil, err
		}
	}
	_, err = d.SQL.Exec(
		`INSERT INTO user_skills (user_id, skill_name, enabled)
		 VALUES ($1, $2, TRUE)
		 ON CONFLICT (user_id, skill_name) DO UPDATE SET enabled = TRUE`,
		userID, name,
	)
	if err != nil {
		return nil, err
	}
	return &UserSkill{
		Name:        name,
		Description: desc,
		Enabled:     true,
		Custom:      true,
		FileCount:   len(normalized),
		Files:       normalized,
	}, nil
}

func (d *DB) countUserSkillPackageFiles(userID, name string) (int, error) {
	var n int
	err := d.SQL.QueryRow(
		`SELECT COUNT(*) FROM user_skill_package_files WHERE user_id = $1 AND skill_name = $2`,
		userID, name,
	).Scan(&n)
	return n, err
}

func (d *DB) ListUserSkillPackageFiles(userID, name string) ([]SkillFileRecord, error) {
	rows, err := d.SQL.Query(
		`SELECT path, content FROM user_skill_package_files
		 WHERE user_id = $1 AND skill_name = $2 ORDER BY path ASC`,
		userID, name,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SkillFileRecord
	for rows.Next() {
		var f SkillFileRecord
		if err := rows.Scan(&f.Path, &f.Content); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) > 0 {
		return out, nil
	}
	body, ok, err := d.GetUserSkillBody(userID, name)
	if err != nil {
		return nil, err
	}
	if ok && strings.TrimSpace(body) != "" {
		return []SkillFileRecord{{Path: "SKILL.md", Content: body}}, nil
	}
	return nil, nil
}

// GetUserSkillPackage returns a custom skill with all package files.
func (d *DB) GetUserSkillPackage(userID, name string) (*UserSkill, error) {
	name = strings.TrimSpace(name)
	meta, found, err := d.findSkillMeta(userID, name)
	if err != nil {
		return nil, err
	}
	if !found || !meta.Custom {
		return nil, ErrNotFound
	}
	files, err := d.ListUserSkillPackageFiles(userID, name)
	if err != nil {
		return nil, err
	}
	en := true
	_ = d.SQL.QueryRow(
		`SELECT enabled FROM user_skills WHERE user_id = $1 AND skill_name = $2`,
		userID, name,
	).Scan(&en)
	return &UserSkill{
		Name:        meta.Name,
		Description: meta.Description,
		Enabled:     en,
		Custom:      true,
		FileCount:   len(files),
		Files:       files,
	}, nil
}

func (d *DB) DeleteUserSkill(userID, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return errors.New("skill name required")
	}
	meta, found, err := d.findSkillMeta(userID, name)
	if err != nil {
		return err
	}
	if !found || !meta.Custom {
		return ErrNotFound
	}
	// Best-effort cleanup of any legacy on-disk copy under skills/users/.
	_ = os.RemoveAll(filepath.Join(UserSkillsDir(userID), name))
	_, _ = d.SQL.Exec(`DELETE FROM user_skill_package_files WHERE user_id = $1 AND skill_name = $2`, userID, name)
	_, _ = d.SQL.Exec(`DELETE FROM user_skill_files WHERE user_id = $1 AND skill_name = $2`, userID, name)
	_, err = d.SQL.Exec(`DELETE FROM user_skills WHERE user_id = $1 AND skill_name = $2`, userID, name)
	return err
}

type SkillFileRecord struct {
	Path    string `json:"path"`
	Content string `json:"content,omitempty"`
}

type GlobalSkillRecord struct {
	Name         string            `json:"name"`
	Description  string            `json:"description"`
	BodyMarkdown string            `json:"body_markdown,omitempty"`
	Enabled      bool              `json:"enabled"`
	Files        []SkillFileRecord `json:"files,omitempty"`
	CreatedAt    string            `json:"created_at,omitempty"`
	UpdatedAt    string            `json:"updated_at,omitempty"`
}

const (
	maxSkillFileBytes = 512 * 1024
	maxSkillFiles     = 128
)

// ValidSkillRelPath restricts package-relative paths (no .., absolute, or empty).
func ValidSkillRelPath(p string) bool {
	p = strings.TrimSpace(p)
	if p == "" || len(p) > 240 {
		return false
	}
	p = filepath.ToSlash(p)
	if strings.HasPrefix(p, "/") || strings.Contains(p, "\\") {
		return false
	}
	parts := strings.Split(p, "/")
	for _, part := range parts {
		if part == "" || part == "." || part == ".." {
			return false
		}
		for _, r := range part {
			ok := (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') ||
				r == '-' || r == '_' || r == '.'
			if !ok {
				return false
			}
		}
	}
	return true
}

// SkillFolderKeepFile marks an empty folder inside a skill package (settings editor).
const SkillFolderKeepFile = ".keep"

func skillFileSkip(name string) bool {
	lower := strings.ToLower(name)
	switch {
	case name == SkillFolderKeepFile:
		// Placeholder that keeps an otherwise empty folder in the editor tree.
		return false
	case strings.HasPrefix(name, "."):
		return true
	case strings.HasSuffix(lower, ".png"), strings.HasSuffix(lower, ".jpg"),
		strings.HasSuffix(lower, ".jpeg"), strings.HasSuffix(lower, ".gif"),
		strings.HasSuffix(lower, ".webp"), strings.HasSuffix(lower, ".ico"),
		strings.HasSuffix(lower, ".pdf"), strings.HasSuffix(lower, ".zip"),
		strings.HasSuffix(lower, ".gz"), strings.HasSuffix(lower, ".wasm"),
		strings.HasSuffix(lower, ".so"), strings.HasSuffix(lower, ".dylib"),
		strings.HasSuffix(lower, ".exe"), strings.HasSuffix(lower, ".bin"):
		return true
	default:
		return false
	}
}

// ReadSkillPackageFromDisk walks skillDir and returns text files as relative paths.
func ReadSkillPackageFromDisk(skillDir string) ([]SkillFileRecord, error) {
	skillDir = filepath.Clean(skillDir)
	var out []SkillFileRecord
	err := filepath.WalkDir(skillDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			base := d.Name()
			if base == ".git" || base == "node_modules" || base == "__pycache__" {
				return filepath.SkipDir
			}
			return nil
		}
		if skillFileSkip(d.Name()) {
			return nil
		}
		rel, err := filepath.Rel(skillDir, path)
		if err != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if !ValidSkillRelPath(rel) {
			return nil
		}
		info, err := d.Info()
		if err != nil || info.Size() > maxSkillFileBytes {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		if strings.ContainsRune(string(data), 0) {
			return nil
		}
		out = append(out, SkillFileRecord{Path: rel, Content: string(data)})
		if len(out) >= maxSkillFiles {
			return filepath.SkipAll
		}
		return nil
	})
	if err != nil {
		return out, err
	}
	return out, nil
}

func (d *DB) ListGlobalSkillsFromDB(includeDisabled bool) ([]GlobalSkillRecord, error) {
	q := `SELECT name, description, body_markdown, enabled, created_at, updated_at FROM global_skills`
	if !includeDisabled {
		q += ` WHERE enabled = TRUE`
	}
	q += ` ORDER BY name ASC`
	rows, err := d.SQL.Query(q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []GlobalSkillRecord
	for rows.Next() {
		var r GlobalSkillRecord
		var created, updated time.Time
		if err := rows.Scan(&r.Name, &r.Description, &r.BodyMarkdown, &r.Enabled, &created, &updated); err != nil {
			return nil, err
		}
		r.CreatedAt = FormatTime(created)
		r.UpdatedAt = FormatTime(updated)
		out = append(out, r)
	}
	return out, rows.Err()
}

func (d *DB) ListGlobalSkillFiles(name string) ([]SkillFileRecord, error) {
	name = strings.TrimSpace(name)
	rows, err := d.SQL.Query(
		`SELECT path, content FROM global_skill_files WHERE skill_name = $1 ORDER BY path ASC`,
		name,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SkillFileRecord
	for rows.Next() {
		var f SkillFileRecord
		if err := rows.Scan(&f.Path, &f.Content); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func (d *DB) ListGlobalSkillFilePaths(name string) ([]string, error) {
	name = strings.TrimSpace(name)
	rows, err := d.SQL.Query(
		`SELECT path FROM global_skill_files WHERE skill_name = $1 ORDER BY path ASC`,
		name,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (d *DB) GetGlobalSkillFile(name, path string) (*SkillFileRecord, error) {
	name = strings.TrimSpace(name)
	path = filepath.ToSlash(strings.TrimSpace(path))
	var f SkillFileRecord
	err := d.SQL.QueryRow(
		`SELECT path, content FROM global_skill_files WHERE skill_name = $1 AND path = $2`,
		name, path,
	).Scan(&f.Path, &f.Content)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &f, nil
}

func (d *DB) GetGlobalSkill(name string) (*GlobalSkillRecord, error) {
	name = strings.TrimSpace(name)
	var r GlobalSkillRecord
	var created, updated time.Time
	err := d.SQL.QueryRow(
		`SELECT name, description, body_markdown, enabled, created_at, updated_at FROM global_skills WHERE name = $1`,
		name,
	).Scan(&r.Name, &r.Description, &r.BodyMarkdown, &r.Enabled, &created, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	r.CreatedAt = FormatTime(created)
	r.UpdatedAt = FormatTime(updated)
	files, err := d.ListGlobalSkillFiles(name)
	if err != nil {
		return nil, err
	}
	if len(files) == 0 && strings.TrimSpace(r.BodyMarkdown) != "" {
		files = []SkillFileRecord{{Path: "SKILL.md", Content: r.BodyMarkdown}}
	}
	r.Files = files
	return &r, nil
}

func (d *DB) upsertSkillFileRow(skillName, path, content string) error {
	path = filepath.ToSlash(strings.TrimSpace(path))
	if !ValidSkillRelPath(path) {
		return fmt.Errorf("invalid skill file path")
	}
	if len(content) > maxSkillFileBytes {
		return fmt.Errorf("skill file too large (max %d bytes)", maxSkillFileBytes)
	}
	_, err := d.SQL.Exec(
		`INSERT INTO global_skill_files (skill_name, path, content, updated_at)
		 VALUES ($1, $2, $3, NOW())
		 ON CONFLICT (skill_name, path) DO UPDATE SET
		   content = EXCLUDED.content,
		   updated_at = NOW()`,
		skillName, path, content,
	)
	return err
}

func (d *DB) UpsertGlobalSkill(name, description, bodyMarkdown string, enabled bool) (*GlobalSkillRecord, error) {
	name = strings.TrimSpace(strings.ToLower(name))
	if !ValidSkillName(name) {
		return nil, fmt.Errorf("invalid skill name: use lowercase letters, digits, hyphens")
	}
	if !enabled && IsAlwaysOnBuiltin(name) {
		return nil, ErrSkillDisableBlocked
	}
	if IsAlwaysOnBuiltin(name) {
		enabled = true
	}
	md := BuildSkillMarkdown(name, description, bodyMarkdown)
	_, desc := parseSkillFrontmatter(md, name)
	_, err := d.SQL.Exec(
		`INSERT INTO global_skills (name, description, body_markdown, enabled, updated_at)
		 VALUES ($1, $2, $3, $4, NOW())
		 ON CONFLICT (name) DO UPDATE SET
		   description = EXCLUDED.description,
		   body_markdown = EXCLUDED.body_markdown,
		   enabled = EXCLUDED.enabled,
		   updated_at = NOW()`,
		name, desc, md, enabled,
	)
	if err != nil {
		return nil, err
	}
	if err := d.upsertSkillFileRow(name, "SKILL.md", md); err != nil {
		return nil, err
	}
	return d.GetGlobalSkill(name)
}

// ImportGlobalSkillPackage validates a multi-file package and replaces the platform skill contents.
func (d *DB) ImportGlobalSkillPackage(files []SkillFileRecord, nameHint, descHint string, enabled bool) (*GlobalSkillRecord, error) {
	name, desc, normalized, err := ValidateSkillPackage(files, nameHint, descHint)
	if err != nil {
		return nil, err
	}
	if !enabled && IsAlwaysOnBuiltin(name) {
		return nil, ErrSkillDisableBlocked
	}
	if IsAlwaysOnBuiltin(name) {
		enabled = true
	}
	var skillMD string
	for _, f := range normalized {
		if f.Path == "SKILL.md" {
			skillMD = f.Content
			break
		}
	}
	_, err = d.SQL.Exec(
		`INSERT INTO global_skills (name, description, body_markdown, enabled, updated_at)
		 VALUES ($1, $2, $3, $4, NOW())
		 ON CONFLICT (name) DO UPDATE SET
		   description = EXCLUDED.description,
		   body_markdown = EXCLUDED.body_markdown,
		   enabled = EXCLUDED.enabled,
		   updated_at = NOW()`,
		name, desc, skillMD, enabled,
	)
	if err != nil {
		return nil, err
	}
	_, err = d.SQL.Exec(`DELETE FROM global_skill_files WHERE skill_name = $1`, name)
	if err != nil {
		return nil, err
	}
	for _, f := range normalized {
		if err := d.upsertSkillFileRow(name, f.Path, f.Content); err != nil {
			return nil, err
		}
	}
	return d.GetGlobalSkill(name)
}

// ExportGlobalSkillZip returns a zip archive of the platform skill package.
func (d *DB) ExportGlobalSkillZip(name string) ([]byte, string, error) {
	sk, err := d.GetGlobalSkill(name)
	if err != nil {
		return nil, "", err
	}
	files := sk.Files
	if len(files) == 0 {
		return nil, "", fmt.Errorf("skill has no files")
	}
	data, err := BuildZipSkillPackage(sk.Name, files)
	if err != nil {
		return nil, "", err
	}
	return data, sk.Name + ".zip", nil
}

// UpsertGlobalSkillFile writes one package file. Path SKILL.md also updates body_markdown / description.
func (d *DB) UpsertGlobalSkillFile(name, path, content string) (*GlobalSkillRecord, error) {
	name = strings.TrimSpace(strings.ToLower(name))
	path = filepath.ToSlash(strings.TrimSpace(path))
	if !ValidSkillName(name) {
		return nil, fmt.Errorf("invalid skill name")
	}
	if !ValidSkillRelPath(path) {
		return nil, fmt.Errorf("invalid skill file path")
	}
	var exists bool
	if err := d.SQL.QueryRow(`SELECT TRUE FROM global_skills WHERE name = $1`, name).Scan(&exists); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	n, err := d.countSkillFiles(name)
	if err != nil {
		return nil, err
	}
	var already bool
	_ = d.SQL.QueryRow(
		`SELECT TRUE FROM global_skill_files WHERE skill_name = $1 AND path = $2`,
		name, path,
	).Scan(&already)
	if !already && n >= maxSkillFiles {
		return nil, fmt.Errorf("too many files in skill package (max %d)", maxSkillFiles)
	}
	if path == "SKILL.md" {
		existing, err := d.GetGlobalSkill(name)
		if err != nil {
			return nil, err
		}
		_, desc := parseSkillFrontmatter(content, name)
		if desc == "" {
			desc = existing.Description
		}
		return d.UpsertGlobalSkill(name, desc, content, existing.Enabled)
	}
	if err := d.upsertSkillFileRow(name, path, content); err != nil {
		return nil, err
	}
	_, _ = d.SQL.Exec(`UPDATE global_skills SET updated_at = NOW() WHERE name = $1`, name)
	return d.GetGlobalSkill(name)
}

func (d *DB) countSkillFiles(name string) (int, error) {
	var n int
	err := d.SQL.QueryRow(`SELECT COUNT(*) FROM global_skill_files WHERE skill_name = $1`, name).Scan(&n)
	return n, err
}

// DeleteGlobalSkillFile removes a companion file. SKILL.md cannot be deleted.
func (d *DB) DeleteGlobalSkillFile(name, path string) error {
	name = strings.TrimSpace(name)
	path = filepath.ToSlash(strings.TrimSpace(path))
	if path == "SKILL.md" {
		return fmt.Errorf("cannot delete SKILL.md; delete the skill instead")
	}
	if !ValidSkillRelPath(path) {
		return fmt.Errorf("invalid skill file path")
	}
	res, err := d.SQL.Exec(
		`DELETE FROM global_skill_files WHERE skill_name = $1 AND path = $2`,
		name, path,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	_, _ = d.SQL.Exec(`UPDATE global_skills SET updated_at = NOW() WHERE name = $1`, name)
	return nil
}

func (d *DB) SetGlobalSkillEnabled(name string, enabled bool) (*GlobalSkillRecord, error) {
	name = strings.TrimSpace(name)
	if !enabled && IsAlwaysOnBuiltin(name) {
		return nil, ErrSkillDisableBlocked
	}
	if IsAlwaysOnBuiltin(name) {
		enabled = true
	}
	res, err := d.SQL.Exec(`UPDATE global_skills SET enabled = $2, updated_at = NOW() WHERE name = $1`, name, enabled)
	if err != nil {
		return nil, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, ErrNotFound
	}
	return d.GetGlobalSkill(name)
}

func (d *DB) DeleteGlobalSkill(name string) error {
	name = strings.TrimSpace(name)
	if IsAlwaysOnBuiltin(name) {
		return ErrSkillDisableBlocked
	}
	res, err := d.SQL.Exec(`DELETE FROM global_skills WHERE name = $1`, name)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// SeedGlobalSkillsFromDisk upserts repo skills/ packages from disk on each API boot.
// Platform SKILL.md / description / body_markdown and package files are refreshed so
// local edits (and commits like host_screenshot window_id) reach load_skill; Admin-only
// skills that are not on disk are left alone. enabled is preserved on conflict.
func (d *DB) SeedGlobalSkillsFromDisk() error {
	disk, err := ListGlobalSkillsFromDisk()
	if err != nil {
		return err
	}
	for _, g := range disk {
		data, err := os.ReadFile(g.Path)
		if err != nil {
			continue
		}
		_, err = d.SQL.Exec(
			`INSERT INTO global_skills (name, description, body_markdown, enabled, updated_at)
			 VALUES ($1, $2, $3, TRUE, NOW())
			 ON CONFLICT (name) DO UPDATE SET
			   description = EXCLUDED.description,
			   body_markdown = EXCLUDED.body_markdown,
			   updated_at = NOW()`,
			g.Name, g.Description, string(data),
		)
		if err != nil {
			return err
		}
		skillDir := filepath.Dir(g.Path)
		files, err := ReadSkillPackageFromDisk(skillDir)
		if err != nil {
			continue
		}
		if len(files) == 0 {
			files = []SkillFileRecord{{Path: "SKILL.md", Content: string(data)}}
		}
		for _, f := range files {
			_, err = d.SQL.Exec(
				`INSERT INTO global_skill_files (skill_name, path, content, updated_at)
				 VALUES ($1, $2, $3, NOW())
				 ON CONFLICT (skill_name, path) DO UPDATE SET
				   content = EXCLUDED.content,
				   updated_at = NOW()`,
				g.Name, f.Path, f.Content,
			)
			if err != nil {
				return err
			}
		}
	}
	// Discovery entry: never leave role=always_on skills disabled in global_skills
	// (SetGlobalSkillEnabled used to allow it; UI overlays can hide the real DB flag).
	for _, slug := range AlwaysOnBuiltinSlugs() {
		if _, err := d.SQL.Exec(
			`UPDATE global_skills SET enabled = TRUE, updated_at = NOW() WHERE name = $1 AND enabled = FALSE`,
			slug,
		); err != nil {
			return err
		}
	}
	return d.BackfillGlobalSkillFilesFromBody()
}

// BackfillGlobalSkillFilesFromBody ensures every global_skills row has at least SKILL.md in the files table.
func (d *DB) BackfillGlobalSkillFilesFromBody() error {
	rows, err := d.SQL.Query(`SELECT name, body_markdown FROM global_skills`)
	if err != nil {
		return err
	}
	defer rows.Close()
	type row struct {
		name string
		body string
	}
	var list []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.name, &r.body); err != nil {
			return err
		}
		list = append(list, r)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, r := range list {
		var n int
		if err := d.SQL.QueryRow(
			`SELECT COUNT(*) FROM global_skill_files WHERE skill_name = $1`,
			r.name,
		).Scan(&n); err != nil {
			return err
		}
		if n > 0 {
			continue
		}
		if strings.TrimSpace(r.body) == "" {
			continue
		}
		if err := d.upsertSkillFileRow(r.name, "SKILL.md", r.body); err != nil {
			return err
		}
	}
	return nil
}

func (d *DB) listCatalogSkills(userID string) ([]GlobalSkill, error) {
	merged := map[string]GlobalSkill{}
	order := make([]string, 0)

	dbGlobals, err := d.ListGlobalSkillsFromDB(false)
	if err != nil {
		return nil, err
	}
	for _, g := range dbGlobals {
		merged[g.Name] = GlobalSkill{Name: g.Name, Description: g.Description, Custom: false, Path: ""}
		order = append(order, g.Name)
	}

	// Disk fills only names not already in DB (dev fallback / not yet seeded).
	disk, err := ListGlobalSkillsFromDisk()
	if err != nil {
		return nil, err
	}
	for _, g := range disk {
		if _, ok := merged[g.Name]; ok {
			continue
		}
		merged[g.Name] = g
		order = append(order, g.Name)
	}

	customDB, err := d.ListUserSkillFiles(userID)
	if err != nil {
		return nil, err
	}
	for _, c := range customDB {
		if _, ok := merged[c.Name]; !ok {
			order = append(order, c.Name)
		}
		merged[c.Name] = GlobalSkill{Name: c.Name, Description: c.Description, Custom: true, Path: ""}
	}

	all := make([]GlobalSkill, 0, len(order))
	for _, n := range order {
		all = append(all, merged[n])
	}
	return all, nil
}

func (d *DB) ListUserSkillFiles(userID string) ([]GlobalSkill, error) {
	rows, err := d.SQL.Query(
		`SELECT skill_name, description FROM user_skill_files WHERE user_id = $1 ORDER BY skill_name`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []GlobalSkill
	for rows.Next() {
		var g GlobalSkill
		if err := rows.Scan(&g.Name, &g.Description); err != nil {
			return nil, err
		}
		g.Custom = true
		out = append(out, g)
	}
	return out, rows.Err()
}

func (d *DB) GetUserSkillBody(userID, name string) (string, bool, error) {
	var body string
	err := d.SQL.QueryRow(
		`SELECT body_markdown FROM user_skill_files WHERE user_id = $1 AND skill_name = $2`,
		userID, name,
	).Scan(&body)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return body, true, nil
}
