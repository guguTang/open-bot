use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde_json::{json, Value};

fn home_dir() -> Option<PathBuf> {
    for key in ["HOME", "USERPROFILE"] {
        if let Ok(v) = std::env::var(key) {
            let p = PathBuf::from(v);
            if p.is_dir() {
                return Some(p);
            }
        }
    }
    None
}

fn under_root(path: &Path, root: &Path) -> bool {
    path == root || path.starts_with(root)
}

fn normalize_components(path: PathBuf) -> Result<PathBuf, String> {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => out.push(prefix.as_os_str()),
            Component::RootDir => out.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    return Err("路径无效".into());
                }
            }
            Component::Normal(part) => out.push(part),
        }
    }
    if out.as_os_str().is_empty() {
        return Err("路径无效".into());
    }
    Ok(out)
}

fn logical_path(raw: &str) -> Result<PathBuf, String> {
    let raw = raw.trim();
    if raw.is_empty() || raw.contains('\0') {
        if raw.is_empty() {
            return home_dir().ok_or_else(|| "找不到用户主目录".to_string());
        }
        return Err("路径无效".into());
    }
    if raw == "~" || raw == "home" {
        return home_dir().ok_or_else(|| "找不到用户主目录".to_string());
    }
    let path = if let Some(rest) = raw.strip_prefix("~/") {
        let home = home_dir().ok_or_else(|| "找不到用户主目录".to_string())?;
        home.join(rest)
    } else {
        let p = PathBuf::from(raw);
        if p.is_absolute() {
            p
        } else if let Some(home) = home_dir() {
            home.join(raw)
        } else {
            p
        }
    };
    normalize_components(path)
}

fn resolve_path(raw: &str) -> Result<PathBuf, String> {
    let path = logical_path(raw)?;
    if path.exists() {
        return fs::canonicalize(&path).map_err(|e| e.to_string());
    }
    if let Some(parent) = path.parent() {
        if parent.as_os_str().is_empty() {
            return Ok(path);
        }
        if parent.exists() {
            let canon_parent = fs::canonicalize(parent).map_err(|e| e.to_string())?;
            let name = path
                .file_name()
                .ok_or_else(|| "路径无效".to_string())?;
            return Ok(canon_parent.join(name));
        }
    }
    Ok(path)
}

fn is_under_home(path: &Path) -> bool {
    let Some(home) = home_dir() else {
        return false;
    };
    let home_canon = fs::canonicalize(&home).unwrap_or(home);
    under_root(path, &home_canon)
}

fn display_path(path: &Path) -> String {
    let Some(home) = home_dir() else {
        return path.display().to_string();
    };
    let home_canon = fs::canonicalize(&home).unwrap_or(home.clone());
    if path == home_canon || path == home {
        return "~".into();
    }
    if let Ok(rest) = path.strip_prefix(&home_canon).or_else(|_| path.strip_prefix(&home)) {
        return format!("~/{}", rest.display());
    }
    path.display().to_string()
}

#[tauri::command(rename_all = "snake_case")]
pub fn host_stat(path: String) -> Result<Value, String> {
    let resolved = resolve_path(&path)?;
    let exists = resolved.exists();
    Ok(json!({
        "ok": true,
        "exists": exists,
        "is_dir": exists && resolved.is_dir(),
        "under_home": is_under_home(&resolved),
        "path": display_path(&resolved),
    }))
}

fn name_glob_match(pattern: &str, name: &str) -> bool {
    let pat = pattern.trim();
    if pat.is_empty() || pat == "*" {
        return true;
    }
    let name_l = name.to_ascii_lowercase();
    let pat_l = pat.to_ascii_lowercase();
    // Simple * and ? matcher (filename only, not path).
    fn match_rec(p: &[u8], t: &[u8]) -> bool {
        let mut i = 0;
        let mut j = 0;
        let mut star_p: Option<usize> = None;
        let mut star_t: usize = 0;
        while j < t.len() {
            if i < p.len() && (p[i] == b'?' || p[i] == t[j]) {
                i += 1;
                j += 1;
            } else if i < p.len() && p[i] == b'*' {
                star_p = Some(i);
                star_t = j;
                i += 1;
            } else if let Some(sp) = star_p {
                i = sp + 1;
                star_t += 1;
                j = star_t;
            } else {
                return false;
            }
        }
        while i < p.len() && p[i] == b'*' {
            i += 1;
        }
        i == p.len()
    }
    match_rec(pat_l.as_bytes(), name_l.as_bytes())
}

const HOST_LS_DEFAULT_LIMIT: usize = 50;
const HOST_LS_MAX_LIMIT: usize = 200;

#[tauri::command(rename_all = "snake_case")]
pub fn host_ls(
    path: String,
    limit: Option<u32>,
    sort: Option<String>,
    glob: Option<String>,
) -> Result<Value, String> {
    let dir = resolve_path(&path)?;
    if !dir.is_dir() {
        return Err("不是目录".into());
    }
    let sort_key = sort
        .as_deref()
        .unwrap_or("mtime")
        .trim()
        .to_ascii_lowercase();
    if !matches!(sort_key.as_str(), "mtime" | "size" | "name") {
        return Err("sort 只能是 mtime、size 或 name".into());
    }
    let max = limit
        .map(|n| (n as usize).clamp(1, HOST_LS_MAX_LIMIT))
        .unwrap_or(HOST_LS_DEFAULT_LIMIT);
    let glob_pat = glob.as_deref().unwrap_or("").trim().to_string();

    let mut entries = Vec::new();
    for item in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        let name = item.file_name().to_string_lossy().to_string();
        if !glob_pat.is_empty() && !name_glob_match(&glob_pat, &name) {
            continue;
        }
        let meta = item.metadata().map_err(|e| e.to_string())?;
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        entries.push(json!({
            "name": name,
            "path": display_path(&item.path()),
            "is_dir": meta.is_dir(),
            "size": meta.len(),
            "modified": modified,
        }));
    }
    let total = entries.len();
    match sort_key.as_str() {
        "size" => entries.sort_by(|a, b| {
            let sb = b.get("size").and_then(|v| v.as_u64()).unwrap_or(0);
            let sa = a.get("size").and_then(|v| v.as_u64()).unwrap_or(0);
            sb.cmp(&sa)
        }),
        "name" => entries.sort_by(|a, b| {
            let na = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let nb = b.get("name").and_then(|v| v.as_str()).unwrap_or("");
            na.to_ascii_lowercase()
                .cmp(&nb.to_ascii_lowercase())
        }),
        _ => entries.sort_by(|a, b| {
            let mb = b.get("modified").and_then(|v| v.as_u64()).unwrap_or(0);
            let ma = a.get("modified").and_then(|v| v.as_u64()).unwrap_or(0);
            mb.cmp(&ma)
        }),
    }
    let truncated = total > max;
    if truncated {
        entries.truncate(max);
    }
    Ok(json!({
        "ok": true,
        "path": display_path(&dir),
        "entries": entries,
        "total": total,
        "truncated": truncated,
        "limit": max,
        "sort": sort_key,
        "glob": if glob_pat.is_empty() { Value::Null } else { json!(glob_pat) },
    }))
}

#[tauri::command(rename_all = "snake_case")]
pub fn host_read(path: String) -> Result<Value, String> {
    let file = resolve_path(&path)?;
    if !file.is_file() {
        return Err("不是文件".into());
    }
    let bytes = fs::read(&file).map_err(|e| e.to_string())?;
    if bytes.len() > 200_000 {
        return Err("文件太大，只支持读取 200KB 以内的文本".into());
    }
    let text = String::from_utf8(bytes).map_err(|_| "不是文本文件".to_string())?;
    Ok(json!({ "ok": true, "path": display_path(&file), "content": text }))
}

#[tauri::command(rename_all = "snake_case")]
pub fn host_write(path: String, content: String) -> Result<Value, String> {
    let file = resolve_path(&path)?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&file, content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true, "path": display_path(&file) }))
}

#[tauri::command(rename_all = "snake_case")]
pub fn host_delete(path: String) -> Result<Value, String> {
    let paths: Vec<String> = path
        .split('\n')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if paths.is_empty() {
        return Err("需要文件路径".into());
    }
    let mut deleted: Vec<String> = Vec::new();
    let mut errors: Vec<Value> = Vec::new();
    for raw in &paths {
        match delete_one_file(raw) {
            Ok(display) => deleted.push(display),
            Err(err) => errors.push(json!({ "path": raw, "error": err })),
        }
    }
    if deleted.is_empty() {
        let msg = errors
            .first()
            .and_then(|e| e.get("error"))
            .and_then(|e| e.as_str())
            .unwrap_or("删除失败");
        return Err(msg.to_string());
    }
    if paths.len() == 1 {
        return Ok(json!({ "ok": errors.is_empty(), "path": deleted[0] }));
    }
    Ok(json!({
        "ok": errors.is_empty(),
        "paths": deleted,
        "errors": errors,
    }))
}

fn delete_one_file(path: &str) -> Result<String, String> {
    let file = resolve_path(path)?;
    if file.is_dir() {
        return Err("只能删除文件".into());
    }
    fs::remove_file(&file).map_err(|e| e.to_string())?;
    Ok(display_path(&file))
}

#[tauri::command(rename_all = "snake_case")]
pub fn host_move(path: String, dest: String) -> Result<Value, String> {
    let from = resolve_path(&path)?;
    let to = resolve_path(&dest)?;
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(&from, &to).map_err(|e| e.to_string())?;
    Ok(json!({
        "ok": true,
        "path": display_path(&from),
        "dest": display_path(&to),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_paths_resolve_under_home() {
        let home = home_dir().unwrap();
        let path = logical_path("Projects/demo").unwrap();
        assert_eq!(path, home.join("Projects/demo"));
        let tilde = logical_path("~/Library").unwrap();
        assert_eq!(tilde, home.join("Library"));
    }

    #[test]
    fn absolute_paths_are_allowed() {
        let path = logical_path("/tmp/open-bot-demo").unwrap();
        assert_eq!(path, PathBuf::from("/tmp/open-bot-demo"));
    }

    #[test]
    fn normalizes_parent_components() {
        let path = logical_path("/tmp/a/../b").unwrap();
        assert_eq!(path, PathBuf::from("/tmp/b"));
    }

    #[test]
    fn name_glob_matches_simple_patterns() {
        assert!(name_glob_match("*.mp4", "clip.MP4"));
        assert!(name_glob_match("report.*", "report.pdf"));
        assert!(!name_glob_match("*.mp4", "clip.mov"));
        assert!(name_glob_match("*", "anything"));
    }
}
