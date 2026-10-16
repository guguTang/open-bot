use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};

/// Bounded host_shell limit. Not infinite: a stuck find -exec is killed with its
/// process group. API hostExecTimeout (150s) and runtime HOST_EXEC_TIMEOUT_SEC (180s)
/// must stay strictly above this so they do not cut the tool off first.
const HOST_SHELL_TIMEOUT_SECS: u64 = 120;

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

fn validate_label(raw: &str, limit: usize) -> Result<String, String> {
    let text = raw.trim();
    if text.is_empty() {
        return Err("内容是空的".into());
    }
    if text.chars().any(|c| c.is_control()) || text.len() > limit {
        return Err("内容无效或太长".into());
    }
    Ok(text.to_string())
}

fn command_ok(cmd: &mut Command) -> Result<(), String> {
    let status = cmd.status().map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("启动失败（{status}）"))
    }
}

fn consider_app(path: PathBuf, query: &str, exact: &mut Option<PathBuf>, fuzzy: &mut Option<PathBuf>) {
    let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
        return;
    };
    let Some(stem) = name.strip_suffix(".app") else {
        return;
    };
    if stem.eq_ignore_ascii_case(query) {
        *exact = Some(path);
        return;
    }
    if fuzzy.is_none() && stem.to_lowercase().contains(&query.to_lowercase()) {
        *fuzzy = Some(path);
    }
}

fn scan_apps(dir: &Path, query: &str, depth: u8, exact: &mut Option<PathBuf>, fuzzy: &mut Option<PathBuf>) {
    if exact.is_some() || depth > 1 {
        return;
    }
    let Ok(rd) = fs::read_dir(dir) else {
        return;
    };
    for ent in rd.flatten() {
        if exact.is_some() {
            return;
        }
        let path = ent.path();
        let name = ent.file_name().to_string_lossy().to_string();
        if name.ends_with(".app") {
            consider_app(path, query, exact, fuzzy);
        } else if path.is_dir() && !name.starts_with('.') {
            scan_apps(&path, query, depth + 1, exact, fuzzy);
        }
    }
}

fn find_macos_app(query: &str) -> Option<PathBuf> {
    let query = query.trim().trim_end_matches(".app");
    let mut dirs = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/System/Applications"),
    ];
    if let Some(home) = home_dir() {
        dirs.insert(0, home.join("Applications"));
    }
    let mut exact = None;
    let mut fuzzy = None;
    for dir in dirs {
        scan_apps(&dir, query, 0, &mut exact, &mut fuzzy);
        if exact.is_some() {
            break;
        }
    }
    exact.or(fuzzy)
}

#[tauri::command]
pub fn host_open(name: String) -> Result<Value, String> {
    let name = validate_label(&name, 200)?;
    #[cfg(target_os = "macos")]
    {
        let mut cmd = Command::new("open");
        cmd.arg("-a");
        if let Some(app) = find_macos_app(&name) {
            cmd.arg(&app);
            command_ok(&mut cmd)?;
            return Ok(json!({ "ok": true, "name": name, "app": app.display().to_string() }));
        }
        cmd.arg(&name);
        command_ok(&mut cmd)?;
        return Ok(json!({ "ok": true, "name": name }));
    }
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "start", "", &name]);
        command_ok(&mut cmd)?;
        return Ok(json!({ "ok": true, "name": name }));
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if Command::new("gtk-launch")
            .arg(&name)
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
            return Ok(json!({ "ok": true, "name": name }));
        }
        let mut cmd = Command::new("xdg-open");
        cmd.arg(&name);
        command_ok(&mut cmd)?;
        return Ok(json!({ "ok": true, "name": name }));
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", unix)))]
    {
        let _ = name;
        Err("当前系统不能打开软件".into())
    }
}

fn applescript_quote(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

fn open_terminal(command: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "tell application \"Terminal\" to activate\ntell application \"Terminal\" to do script {}",
            applescript_quote(command)
        );
        let mut cmd = Command::new("osascript");
        cmd.args(["-e", &script]);
        return command_ok(&mut cmd);
    }
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "start", "cmd", "/K", command]);
        return command_ok(&mut cmd);
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if Command::new("x-terminal-emulator")
            .args(["-e", "bash", "-lc", command])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
            return Ok(());
        }
        let mut cmd = Command::new("gnome-terminal");
        cmd.args(["--", "bash", "-lc", command]);
        return command_ok(&mut cmd);
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", unix)))]
    {
        let _ = command;
        Err("当前系统不能打开终端".into())
    }
}

fn run_captured(command: &str) -> Result<Value, String> {
    let mut cmd = if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.args(["/C", command]);
        c
    } else {
        let mut c = Command::new("sh");
        c.args(["-c", command]);
        c
    };
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(home) = home_dir() {
        cmd.current_dir(home);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    let child = cmd.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();
    let (tx, rx) = std::sync::mpsc::channel();
    thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });
    let output = match rx.recv_timeout(Duration::from_secs(HOST_SHELL_TIMEOUT_SECS)) {
        Ok(Ok(output)) => output,
        Ok(Err(e)) => return Err(e.to_string()),
        Err(_) => {
            #[cfg(unix)]
            {
                let _ = Command::new("kill").args(["-9", &format!("-{pid}")]).status();
            }
            #[cfg(windows)]
            {
                let _ = Command::new("taskkill")
                    .args(["/F", "/T", "/PID", &pid.to_string()])
                    .status();
            }
            return Err(format!("命令超过 {HOST_SHELL_TIMEOUT_SECS} 秒还没结束"));
        }
    };
    let mut text = String::from_utf8_lossy(&output.stdout).to_string();
    let err = String::from_utf8_lossy(&output.stderr);
    if !err.trim().is_empty() {
        if !text.is_empty() && !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str(&err);
    }
    let chars: Vec<char> = text.chars().collect();
    if chars.len() > 4000 {
        text = chars[..4000].iter().collect();
        text.push_str("\n…");
    }
    Ok(json!({
        "ok": output.status.success(),
        "exit_code": output.status.code(),
        "output": text,
    }))
}

#[tauri::command]
pub fn host_shell(command: String, terminal: bool) -> Result<Value, String> {
    let command = validate_label(&command, 2000)?;
    if crate::host_ssh::is_remote_ssh_command(&command) {
        return Err("远程连接由应用自己完成，请改用 host_ssh_exec、host_ssh_ls、host_ssh_read、host_ssh_write 或 host_ssh_delete".into());
    }
    if terminal {
        open_terminal(&command)?;
        return Ok(json!({ "ok": true, "terminal": true, "command": command }));
    }
    let mut result = run_captured(&command)?;
    if let Some(obj) = result.as_object_mut() {
        obj.insert("command".into(), json!(command));
        obj.insert("terminal".into(), json!(false));
    }
    Ok(result)
}

fn trim_cmd_out(raw: &[u8]) -> String {
    String::from_utf8_lossy(raw).trim().to_string()
}

/// Best-effort computer / device display name for machine registration.
#[tauri::command]
pub fn host_device_name() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        for args in [["--get", "ComputerName"], ["--get", "LocalHostName"]] {
            if let Ok(out) = Command::new("scutil").args(args).output() {
                if out.status.success() {
                    let name = trim_cmd_out(&out.stdout);
                    if !name.is_empty() {
                        return Ok(name);
                    }
                }
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(v) = std::env::var("COMPUTERNAME") {
            let name = v.trim().to_string();
            if !name.is_empty() {
                return Ok(name);
            }
        }
    }
    if let Ok(out) = Command::new("hostname").output() {
        if out.status.success() {
            let name = trim_cmd_out(&out.stdout);
            if !name.is_empty() {
                return Ok(name);
            }
        }
    }
    if let Ok(v) = std::env::var("HOSTNAME") {
        let name = v.trim().to_string();
        if !name.is_empty() {
            return Ok(name);
        }
    }
    Err("无法读取设备名称".into())
}

fn extract_quoted_value(line: &str) -> Option<String> {
    let parts = line.split('"');
    // skip until after key quote pair; take last quoted segment as value
    let chunks: Vec<&str> = parts.collect();
    if chunks.len() >= 4 {
        let val = chunks[chunks.len() - 2].trim();
        if !val.is_empty() {
            return Some(val.to_string());
        }
    }
    None
}

/// Stable platform machine id for machine_key registration.
/// macOS IOPlatformUUID / Windows MachineGuid / Linux /etc/machine-id (or dbus).
#[tauri::command]
pub fn host_machine_id() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = Command::new("ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()
        {
            if out.status.success() {
                let text = String::from_utf8_lossy(&out.stdout);
                for line in text.lines() {
                    if line.contains("IOPlatformUUID") {
                        if let Some(id) = extract_quoted_value(line) {
                            return Ok(id);
                        }
                    }
                }
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(out) = Command::new("reg")
            .args([
                "query",
                r"HKLM\SOFTWARE\Microsoft\Cryptography",
                "/v",
                "MachineGuid",
            ])
            .output()
        {
            if out.status.success() {
                let text = String::from_utf8_lossy(&out.stdout);
                for line in text.lines() {
                    let trimmed = line.trim();
                    if trimmed.to_ascii_lowercase().starts_with("machineguid") {
                        let parts: Vec<&str> = trimmed.split_whitespace().collect();
                        if let Some(id) = parts.last() {
                            let id = id.trim();
                            if !id.is_empty()
                                && !id.eq_ignore_ascii_case("REG_SZ")
                                && !id.eq_ignore_ascii_case("MachineGuid")
                            {
                                return Ok(id.to_string());
                            }
                        }
                    }
                }
            }
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        for path in ["/etc/machine-id", "/var/lib/dbus/machine-id"] {
            if let Ok(s) = fs::read_to_string(path) {
                let id = s.trim();
                if !id.is_empty() {
                    return Ok(id.to_string());
                }
            }
        }
    }
    Err("无法读取平台机器码".into())
}

/// JPEG we will actually put on the exec socket. Stay well under the 8MB read limit.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const SCREENSHOT_MAX_BYTES: usize = 1_200_000;
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const SCREENSHOT_TIMEOUT_SECS: u64 = 20;

const SCREEN_RECORDING_DENIED_MSG: &str = "没有屏幕录制权限。请到「系统设置 → 隐私与安全性 → 屏幕录制」允许已安装的 Open Bot，然后重试。请打开 DMG 或「应用程序」里的 Open Bot，不要直接运行 Contents/MacOS 里的二进制。桌面设置里也可以打开这一页。若还要让助手操作界面，请同时允许「辅助功能」；若系统列出「输入监控」或「事件发布」，也允许 Open Bot。";

fn screenshot_error(code: &str, error: &str) -> Value {
    json!({ "ok": false, "error": error, "code": code })
}

/// `screencapture` argv. `display` (1-based) wins over scope. Empty scope is main.
fn screenshot_capture_args(scope: &str, display: Option<u32>, out_path: &str) -> Result<Vec<String>, String> {
    let scope = scope.trim().to_ascii_lowercase();
    if !scope.is_empty() && scope != "main" && scope != "all" {
        return Err("scope 只能是 main 或 all".into());
    }
    if let Some(d) = display {
        if !(1..=16).contains(&d) {
            return Err("display 需为 1 到 16".into());
        }
    }
    let mut args = vec!["-x".to_string(), "-t".to_string(), "jpg".to_string()];
    if let Some(d) = display {
        args.push("-D".to_string());
        args.push(d.to_string());
    } else if scope != "all" {
        args.push("-m".to_string());
    }
    args.push(out_path.to_string());
    Ok(args)
}

fn encode_base64(data: &[u8]) -> String {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    let mut i = 0;
    while i + 3 <= data.len() {
        let n = ((data[i] as u32) << 16) | ((data[i + 1] as u32) << 8) | (data[i + 2] as u32);
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(T[((n >> 6) & 63) as usize] as char);
        out.push(T[(n & 63) as usize] as char);
        i += 3;
    }
    let rest = data.len() - i;
    if rest == 1 {
        let n = (data[i] as u32) << 16;
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push('=');
        out.push('=');
    } else if rest == 2 {
        let n = ((data[i] as u32) << 16) | ((data[i + 1] as u32) << 8);
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(T[((n >> 6) & 63) as usize] as char);
        out.push('=');
    }
    out
}

fn parse_sips_pixels(text: &str) -> (Option<u32>, Option<u32>) {
    let mut width = None;
    let mut height = None;
    for line in text.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("pixelWidth:") {
            width = rest.trim().parse().ok();
        } else if let Some(rest) = line.strip_prefix("pixelHeight:") {
            height = rest.trim().parse().ok();
        }
    }
    (width, height)
}

fn parse_display_index(display: Option<i64>) -> Result<Option<u32>, String> {
    let Some(raw) = display else {
        return Ok(None);
    };
    if !(1..=16).contains(&raw) {
        return Err("display 需为 1 到 16".into());
    }
    Ok(Some(raw as u32))
}

#[cfg(target_os = "macos")]
mod screen_access {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
    }

    pub fn screen_recording_allowed() -> bool {
        unsafe { CGPreflightScreenCaptureAccess() }
    }
}

#[cfg(target_os = "macos")]
fn run_timed(cmd: &mut Command, timeout: Duration) -> Result<std::process::Output, String> {
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    let child = cmd.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();
    let (tx, rx) = std::sync::mpsc::channel();
    thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });
    match rx.recv_timeout(timeout) {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => {
            let _ = Command::new("kill").args(["-9", &format!("-{pid}")]).status();
            Err(format!("超过 {SCREENSHOT_TIMEOUT_SECS} 秒还没结束"))
        }
    }
}

#[cfg(target_os = "macos")]
fn shrink_jpeg(path: &Path) -> Result<(), String> {
    let ladder = [(1600u32, 60u32), (1280, 45), (960, 35)];
    for (edge, quality) in ladder {
        let mut cmd = Command::new("sips");
        cmd.args([
            "-s",
            "format",
            "jpeg",
            "-s",
            "formatOptions",
            &quality.to_string(),
            "-Z",
            &edge.to_string(),
            path.to_str().ok_or("临时路径无效")?,
        ]);
        let output = run_timed(&mut cmd, Duration::from_secs(SCREENSHOT_TIMEOUT_SECS))?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            return Err(format!("压缩截图失败：{}", err.trim()));
        }
        let len = fs::metadata(path).map(|m| m.len()).unwrap_or(u64::MAX);
        if len <= SCREENSHOT_MAX_BYTES as u64 {
            return Ok(());
        }
    }
    Err("截图太大，没有把图像交给模型".into())
}

#[cfg(target_os = "macos")]
fn jpeg_pixels(path: &Path) -> (Option<u32>, Option<u32>) {
    let mut cmd = Command::new("sips");
    cmd.args(["-g", "pixelWidth", "-g", "pixelHeight"]);
    cmd.arg(path);
    match run_timed(&mut cmd, Duration::from_secs(10)) {
        Ok(output) if output.status.success() => {
            let text = String::from_utf8_lossy(&output.stdout);
            parse_sips_pixels(&text)
        }
        _ => (None, None),
    }
}

#[cfg(target_os = "macos")]
fn capture_screen(scope: &str, display: Option<u32>) -> Result<Value, String> {
    if !screen_access::screen_recording_allowed() {
        return Ok(screenshot_error(
            "screen_recording_denied",
            SCREEN_RECORDING_DENIED_MSG,
        ));
    }
    let file_name = format!(
        "open-bot-shot-{}-{}.jpg",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    let path = std::env::temp_dir().join(file_name);
    let path_str = path.to_str().ok_or("临时路径无效")?.to_string();
    struct ShotFile(PathBuf);
    impl Drop for ShotFile {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.0);
        }
    }
    let _cleanup = ShotFile(path.clone());
    let args = screenshot_capture_args(scope, display, &path_str)?;
    let mut cmd = Command::new("screencapture");
    cmd.args(&args);
    let output = run_timed(&mut cmd, Duration::from_secs(SCREENSHOT_TIMEOUT_SECS))?;
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let len = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    if !output.status.success() || len < 32 {
        if !screen_access::screen_recording_allowed()
            || stderr.to_lowercase().contains("could not create image")
            || stderr.to_lowercase().contains("not authorized")
        {
            return Ok(screenshot_error(
                "screen_recording_denied",
                SCREEN_RECORDING_DENIED_MSG,
            ));
        }
        let detail = if stderr.is_empty() {
            format!("screencapture 退出 {}", output.status)
        } else {
            stderr
        };
        return Ok(screenshot_error(
            "screenshot_failed",
            &format!("截屏失败。若系统设置里尚未允许 Open Bot 的屏幕录制，请先授权再试。{detail}"),
        ));
    }
    shrink_jpeg(&path)?;
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    if bytes.len() > SCREENSHOT_MAX_BYTES {
        return Ok(screenshot_error(
            "screenshot_too_large",
            "截图太大，没有把图像交给模型",
        ));
    }
    let (width, height) = jpeg_pixels(&path);
    let scope_out = if display.is_some() {
        "display"
    } else if scope.trim().eq_ignore_ascii_case("all") {
        "all"
    } else {
        "main"
    };
    Ok(json!({
        "ok": true,
        "mime": "image/jpeg",
        "width": width,
        "height": height,
        "scope": scope_out,
        "display": display,
        "bytes": bytes.len(),
        "image_base64": encode_base64(&bytes),
    }))
}

/// Capture the desktop and return JPEG bytes the agent runtime attaches as vision.
/// macOS uses `screencapture` (Screen Recording TCC on this app). Other desktops error.
#[tauri::command]
pub fn host_screenshot(scope: Option<String>, display: Option<i64>) -> Result<Value, String> {
    let scope = scope.unwrap_or_else(|| "main".to_string());
    let display = match parse_display_index(display) {
        Ok(v) => v,
        Err(e) => return Ok(screenshot_error("invalid_display", &e)),
    };
    if screenshot_capture_args(&scope, display, "/tmp/open-bot-shot.jpg").is_err() {
        return Ok(screenshot_error(
            "invalid_scope",
            "scope 只能是 main 或 all",
        ));
    }
    #[cfg(target_os = "macos")]
    {
        return capture_screen(&scope, display);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (scope, display);
        Ok(screenshot_error(
            "unsupported_platform",
            "当前系统暂不支持截屏（仅 macOS 桌面端）",
        ))
    }
}

/// Open the macOS Privacy pane. Settings UI only — not an agent tool.
#[tauri::command]
pub fn host_open_privacy(pane: String) -> Result<Value, String> {
    let pane = pane.trim().to_ascii_lowercase();
    let anchor = match pane.as_str() {
        "accessibility" | "assistive" => "Privacy_Accessibility",
        "screen" | "screen_recording" | "screencapture" => "Privacy_ScreenCapture",
        _ => return Err("未知的隐私设置页".into()),
    };
    #[cfg(target_os = "macos")]
    {
        let url = format!("x-apple.systempreferences:com.apple.preference.security?{anchor}");
        let mut cmd = Command::new("open");
        cmd.arg(&url);
        command_ok(&mut cmd)?;
        return Ok(json!({ "ok": true, "pane": pane }));
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = anchor;
        Err("请在 macOS「系统设置 → 隐私与安全性」里授权屏幕录制和辅助功能".into())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        encode_base64, extract_quoted_value, parse_sips_pixels, screenshot_capture_args,
        SCREEN_RECORDING_DENIED_MSG, HOST_SHELL_TIMEOUT_SECS,
    };

    #[test]
    fn host_shell_timeout_is_120s_and_bounded() {
        assert_eq!(HOST_SHELL_TIMEOUT_SECS, 120);
    }

    #[test]
    fn extract_quoted_value_reads_ioplatform_uuid_line() {
        let line = r#"    "IOPlatformUUID" = "CC87D070-8EC8-5EF4-B679-9048FCF29292""#;
        assert_eq!(
            extract_quoted_value(line).as_deref(),
            Some("CC87D070-8EC8-5EF4-B679-9048FCF29292")
        );
    }

    #[test]
    fn screenshot_args_main_display_and_all() {
        let main = screenshot_capture_args("main", None, "/tmp/a.jpg").unwrap();
        assert!(main.contains(&"-m".to_string()));
        assert!(!main.iter().any(|a| a == "-D"));
        assert_eq!(main.last().map(String::as_str), Some("/tmp/a.jpg"));
        let all = screenshot_capture_args("all", None, "/tmp/a.jpg").unwrap();
        assert!(!all.iter().any(|a| a == "-m" || a == "-D"));
        let display = screenshot_capture_args("main", Some(2), "/tmp/a.jpg").unwrap();
        assert!(!display.iter().any(|a| a == "-m"));
        assert!(display.windows(2).any(|w| w[0] == "-D" && w[1] == "2"));
        assert!(screenshot_capture_args("window", None, "/tmp/a.jpg").is_err());
        assert!(screenshot_capture_args("main", Some(0), "/tmp/a.jpg").is_err());
    }

    #[test]
    fn base64_and_sips_pixels() {
        assert_eq!(encode_base64(b"Man"), "TWFu");
        assert_eq!(encode_base64(b"Ma"), "TWE=");
        assert_eq!(encode_base64(b"M"), "TQ==");
        let text = "/tmp/a.jpg\n  pixelWidth: 1280\n  pixelHeight: 800\n";
        assert_eq!(parse_sips_pixels(text), (Some(1280), Some(800)));
    }

    #[test]
    fn screen_recording_denied_message_names_the_pane() {
        assert!(SCREEN_RECORDING_DENIED_MSG.contains("屏幕录制"));
        assert!(SCREEN_RECORDING_DENIED_MSG.contains("辅助功能"));
        assert!(SCREEN_RECORDING_DENIED_MSG.contains("Contents/MacOS"));
        assert!(SCREEN_RECORDING_DENIED_MSG.contains("输入监控"));
    }
}
