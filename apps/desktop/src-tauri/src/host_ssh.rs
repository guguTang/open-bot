use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::client::{self, Handler};
use russh::keys::{self, HashAlg, PrivateKeyWithHashAlg};
use russh::{ChannelMsg, Disconnect};
use serde_json::{json, Value};
use tokio::io::AsyncReadExt;
use tokio::time::timeout;

const READ_LIMIT: usize = 200_000;
const WRITE_LIMIT: usize = 1 << 20;
const EXEC_LIMIT: usize = 16_000;
const LIST_LIMIT: usize = 200;

#[derive(Clone)]
struct TrustInfo {
    status: String,
    fingerprint: String,
    key: Option<keys::PublicKey>,
}

struct SshHandler {
    alias: String,
    hostname: String,
    port: u16,
    trust: Arc<Mutex<TrustInfo>>,
}

impl Handler for SshHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let key = server_public_key.public_key();
        let fingerprint = key.fingerprint(HashAlg::Sha256).to_string();
        let status = host_key_status(&self.alias, &self.hostname, self.port, &key);
        if let Ok(mut slot) = self.trust.lock() {
            slot.status = status.to_string();
            slot.fingerprint = fingerprint;
            slot.key = Some(key);
        }
        Ok(status != "changed")
    }
}

pub(crate) fn is_remote_ssh_command(command: &str) -> bool {
    let tokens: Vec<&str> = command.split_whitespace().collect();
    if tokens.is_empty() {
        return false;
    }
    let mut index = 0;
    if matches!(command_base(tokens[0]), "sudo" | "command" | "exec") {
        index = 1;
    }
    if index >= tokens.len() {
        return false;
    }
    if matches!(command_base(tokens[index]), "sh" | "bash" | "zsh") {
        let rest = tokens[index + 1..].join(" ");
        return rest.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '/' || c == '\\')).any(|word| {
            matches!(command_base(word), "ssh" | "scp" | "sftp")
        });
    }
    matches!(command_base(tokens[index]), "ssh" | "scp" | "sftp")
}

fn command_base(token: &str) -> &str {
    token.rsplit(['/', '\\']).next().unwrap_or(token)
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from).filter(|p| p.is_dir())
}

fn host_key_status(alias: &str, hostname: &str, port: u16, key: &keys::PublicKey) -> &'static str {
    let primary = known_status(alias, port, key);
    if alias == hostname {
        return primary;
    }
    merge_status(primary, known_status(hostname, port, key))
}

fn known_status(host: &str, port: u16, key: &keys::PublicKey) -> &'static str {
    if host.is_empty() {
        return "unknown";
    }
    match keys::check_known_hosts(host, port, key) {
        Ok(true) => "known",
        Ok(false) => "unknown",
        Err(keys::Error::KeyChanged { .. }) => "changed",
        Err(_) => "unknown",
    }
}

fn merge_status(left: &'static str, right: &'static str) -> &'static str {
    if left == "changed" || right == "changed" {
        "changed"
    } else if left == "known" || right == "known" {
        "known"
    } else {
        "unknown"
    }
}

struct ResolvedTarget {
    alias: String,
    hostname: String,
    user: String,
    port: u16,
    identity_files: Vec<PathBuf>,
    identities_only: bool,
}

fn resolve_target(host: &str, user: &str, port: u16) -> Result<ResolvedTarget, String> {
    let (user_from_host, host) = split_user_host(user, host)?;
    let (alias, inline_port) = split_host_port(&host, port)?;
    validate_label(&alias, 253, "主机名")?;
    let home = home_dir().ok_or_else(|| "找不到用户主目录".to_string())?;
    let config_text = std::fs::read_to_string(home.join(".ssh/config")).unwrap_or_default();
    let parsed = parse_ssh_config(&config_text, &alias)?;
    if let Some(proxy) = parsed.proxy {
        return Err(format!("SSH 配置使用了跳板（{proxy}）。当前客户端只直接连接目标主机，这次没有连上"));
    }
    let user = if !user_from_host.is_empty() {
        user_from_host
    } else if let Some(value) = parsed.user {
        value
    } else {
        std::env::var("USER")
            .or_else(|_| std::env::var("LOGNAME"))
            .map_err(|_| "需要用户名。可在参数或 ~/.ssh/config 里写 User".to_string())?
    };
    validate_label(&user, 64, "用户名")?;
    let port = if inline_port != 0 {
        inline_port
    } else {
        parsed.port.unwrap_or(22)
    };
    if port == 0 {
        return Err("端口无效".into());
    }
    let hostname = parsed.hostname.unwrap_or_else(|| alias.clone());
    validate_label(&hostname, 253, "主机名")?;
    let mut identity_files = parsed
        .identity_files
        .iter()
        .map(|raw| expand_token_path(raw, &home, &hostname, &user, port))
        .collect::<Vec<_>>();
    if !parsed.identities_only {
        for name in ["id_ed25519", "id_ecdsa", "id_rsa"] {
            push_identity(&mut identity_files, home.join(".ssh").join(name));
        }
        for path in scan_extra_identity_files(&home.join(".ssh")) {
            push_identity(&mut identity_files, path);
        }
    }
    Ok(ResolvedTarget {
        alias,
        hostname,
        user,
        port,
        identity_files,
        identities_only: parsed.identities_only,
    })
}

fn push_identity(files: &mut Vec<PathBuf>, path: PathBuf) {
    if !files.iter().any(|item| item == &path) {
        files.push(path);
    }
}

fn scan_extra_identity_files(ssh_dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(ssh_dir) else {
        return Vec::new();
    };
    let skip = [
        "config",
        "known_hosts",
        "known_hosts.old",
        "authorized_keys",
        "authorized_keys2",
        "environment",
        "rc",
    ];
    let mut found = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if name.starts_with('.') || name.ends_with(".pub") || skip.iter().any(|s| name.eq_ignore_ascii_case(s)) {
            continue;
        }
        if name.starts_with("known_hosts") {
            continue;
        }
        if matches!(name, "id_ed25519" | "id_ecdsa" | "id_rsa") {
            continue;
        }
        found.push(path);
    }
    found.sort();
    found
}

fn split_user_host(user: &str, host: &str) -> Result<(String, String), String> {
    let host = host.trim();
    let user = user.trim();
    if user.is_empty() {
        if let Some((name, rest)) = host.split_once('@') {
            if !name.is_empty() && !rest.is_empty() && !rest.contains('@') {
                return Ok((name.to_string(), rest.to_string()));
            }
        }
    }
    if host.is_empty() {
        return Err("需要主机名、IP，或 ~/.ssh/config 里的 Host".into());
    }
    Ok((user.to_string(), host.to_string()))
}

fn split_host_port(host: &str, port: u16) -> Result<(String, u16), String> {
    if let Some(rest) = host.strip_prefix('[') {
        let Some((addr, tail)) = rest.split_once(']') else {
            return Err("主机名无效".into());
        };
        if let Some(value) = tail.strip_prefix(':') {
            let parsed = value.parse::<u16>().map_err(|_| "端口无效".to_string())?;
            if parsed == 0 {
                return Err("端口无效".into());
            }
            return Ok((addr.to_string(), if port == 0 { parsed } else { port }));
        }
        if tail.is_empty() {
            return Ok((addr.to_string(), port));
        }
        return Err("主机名无效".into());
    }
    if port == 0 {
        if let Some((name, value)) = host.rsplit_once(':') {
            if !name.is_empty() && !name.contains(':') && value.chars().all(|c| c.is_ascii_digit()) {
                let parsed = value.parse::<u16>().map_err(|_| "端口无效".to_string())?;
                if parsed == 0 {
                    return Err("端口无效".into());
                }
                return Ok((name.to_string(), parsed));
            }
        }
    }
    Ok((host.to_string(), port))
}

fn validate_label(raw: &str, limit: usize, name: &str) -> Result<(), String> {
    if raw.is_empty() || raw.chars().any(|c| c.is_control() || c.is_whitespace()) || raw.len() > limit {
        return Err(format!("{name}无效"));
    }
    Ok(())
}

struct ParsedConfig {
    hostname: Option<String>,
    user: Option<String>,
    port: Option<u16>,
    identity_files: Vec<String>,
    identities_only: bool,
    proxy: Option<String>,
}

fn parse_ssh_config(text: &str, alias: &str) -> Result<ParsedConfig, String> {
    let mut parsed = ParsedConfig {
        hostname: None,
        user: None,
        port: None,
        identity_files: Vec::new(),
        identities_only: false,
        proxy: None,
    };
    let mut matched = true;
    let mut identities_set = false;
    for raw_line in text.lines() {
        let Some((key, value)) = parse_config_line(raw_line) else {
            continue;
        };
        if key == "host" {
            matched = host_patterns_match(&value, alias);
            continue;
        }
        if key == "match" {
            matched = false;
            continue;
        }
        if !matched || value.is_empty() {
            continue;
        }
        match key.as_str() {
            "hostname" if parsed.hostname.is_none() => parsed.hostname = Some(value),
            "user" if parsed.user.is_none() => parsed.user = Some(value),
            "port" if parsed.port.is_none() => {
                parsed.port = Some(value.parse::<u16>().map_err(|_| "ssh config 里的 Port 无效".to_string())?);
            }
            "identityfile" => parsed.identity_files.push(value),
            "identitiesonly" if !identities_set => {
                parsed.identities_only = matches!(value.to_ascii_lowercase().as_str(), "yes" | "true");
                identities_set = true;
            }
            "proxyjump" | "proxycommand" if parsed.proxy.is_none() => parsed.proxy = Some(value),
            _ => {}
        }
    }
    Ok(parsed)
}

fn parse_config_line(raw: &str) -> Option<(String, String)> {
    let line = strip_comment(raw).trim().to_string();
    if line.is_empty() {
        return None;
    }
    let (key, value) = if let Some((key, value)) = line.split_once('=') {
        (key.trim(), value.trim())
    } else {
        let mut parts = line.splitn(2, char::is_whitespace);
        (parts.next()?.trim(), parts.next().unwrap_or("").trim())
    };
    if key.is_empty() {
        return None;
    }
    Some((key.to_ascii_lowercase(), unquote(value)))
}

fn strip_comment(raw: &str) -> &str {
    let mut quote = '\0';
    for (index, ch) in raw.char_indices() {
        if quote != '\0' {
            if ch == quote {
                quote = '\0';
            }
            continue;
        }
        if ch == '"' || ch == '\'' {
            quote = ch;
            continue;
        }
        if ch == '#' {
            return &raw[..index];
        }
    }
    raw
}

fn unquote(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.len() >= 2 {
        let bytes = trimmed.as_bytes();
        if (bytes[0] == b'"' && bytes[trimmed.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[trimmed.len() - 1] == b'\'')
        {
            return trimmed[1..trimmed.len() - 1].to_string();
        }
    }
    trimmed.to_string()
}

fn host_patterns_match(patterns: &str, host: &str) -> bool {
    let mut any_positive = false;
    let mut positive_hit = false;
    for pattern in patterns.split_whitespace() {
        if let Some(negated) = pattern.strip_prefix('!') {
            if glob_match(negated, host) {
                return false;
            }
        } else {
            any_positive = true;
            if glob_match(pattern, host) {
                positive_hit = true;
            }
        }
    }
    positive_hit || !any_positive
}

fn glob_match(pattern: &str, text: &str) -> bool {
    fn rec(pattern: &[u8], text: &[u8]) -> bool {
        if pattern.is_empty() {
            return text.is_empty();
        }
        if pattern[0] == b'*' {
            return rec(&pattern[1..], text) || (!text.is_empty() && rec(pattern, &text[1..]));
        }
        if text.is_empty() {
            return false;
        }
        (pattern[0] == b'?' || pattern[0].eq_ignore_ascii_case(&text[0])) && rec(&pattern[1..], &text[1..])
    }
    rec(pattern.as_bytes(), text.as_bytes())
}

fn expand_token_path(raw: &str, home: &Path, host: &str, user: &str, port: u16) -> PathBuf {
    let expanded = expand_tokens(raw, home, host, user, port);
    let path = PathBuf::from(&expanded);
    if path.is_absolute() {
        path
    } else {
        home.join(".ssh").join(path)
    }
}

fn expand_tokens(raw: &str, home: &Path, host: &str, user: &str, port: u16) -> String {
    let home_text = home.to_string_lossy();
    let chars: Vec<char> = raw.chars().collect();
    let mut out = String::new();
    let mut index = 0;
    if chars.first() == Some(&'~') && (chars.len() == 1 || chars.get(1) == Some(&'/')) {
        out.push_str(&home_text);
        index = 1;
    }
    while index < chars.len() {
        if chars[index] == '%' && index + 1 < chars.len() {
            match chars[index + 1] {
                '%' => out.push('%'),
                'h' => out.push_str(host),
                'p' => out.push_str(&port.to_string()),
                'r' => out.push_str(user),
                'd' => out.push_str(&home_text),
                other => {
                    out.push('%');
                    out.push(other);
                }
            }
            index += 2;
            continue;
        }
        out.push(chars[index]);
        index += 1;
    }
    out
}

fn trust_snapshot(trust: &Mutex<TrustInfo>) -> TrustInfo {
    match trust.lock() {
        Ok(info) => info.clone(),
        Err(err) => err.into_inner().clone(),
    }
}

fn remember_host(target: &ResolvedTarget, info: &TrustInfo) -> bool {
    let Some(key) = info.key.as_ref() else {
        return false;
    };
    if keys::known_hosts::learn_known_hosts(&target.alias, target.port, key).is_err() {
        return false;
    }
    if target.hostname != target.alias {
        let _ = keys::known_hosts::learn_known_hosts(&target.hostname, target.port, key);
    }
    true
}

#[derive(Clone)]
struct AuthOk {
    method: &'static str,
    key: String,
}

struct AuthFail {
    tried: Vec<Value>,
    agent: String,
    error: String,
}

fn key_label(path: &Path) -> String {
    path.file_name()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| path.display().to_string())
}

fn classify_key_load_error(err: &keys::Error) -> &'static str {
    match err {
        keys::Error::KeyIsEncrypted => "encrypted",
        _ => "unreadable",
    }
}

async fn authenticate(session: &mut client::Handle<SshHandler>, target: &ResolvedTarget) -> Result<AuthOk, AuthFail> {
    let hash_alg = session.best_supported_rsa_hash().await.ok().flatten().flatten();
    let mut tried = Vec::new();
    let mut had_encrypted = false;
    for path in &target.identity_files {
        let label = key_label(path);
        if !path.is_file() {
            tried.push(json!({ "path": label, "result": "missing" }));
            continue;
        }
        let key = match keys::load_secret_key(path, None) {
            Ok(key) => key,
            Err(err) => {
                let result = classify_key_load_error(&err);
                if result == "encrypted" {
                    had_encrypted = true;
                }
                tried.push(json!({ "path": label, "result": result }));
                continue;
            }
        };
        match session
            .authenticate_publickey(&target.user, PrivateKeyWithHashAlg::new(Arc::new(key), hash_alg))
            .await
        {
            Ok(result) if result.success() => {
                return Ok(AuthOk {
                    method: "file",
                    key: label,
                });
            }
            Ok(_) => {
                tried.push(json!({ "path": label, "result": "rejected" }));
            }
            Err(err) => {
                tried.push(json!({ "path": label, "result": format!("error:{err}") }));
                return Err(AuthFail {
                    tried,
                    agent: "skipped".into(),
                    error: format!("认证中断：{err}"),
                });
            }
        }
    }

    let mut agent_status = if target.identities_only {
        "skipped_identities_only".to_string()
    } else {
        "unavailable".to_string()
    };
    if !target.identities_only {
        #[cfg(unix)]
        {
            match keys::agent::client::AgentClient::connect_env().await {
                Ok(mut agent) => match agent.request_identities().await {
                    Ok(identities) if identities.is_empty() => {
                        agent_status = "empty".into();
                    }
                    Ok(identities) => {
                        let public_keys: Vec<keys::PublicKey> = identities
                            .into_iter()
                            .map(|item| item.public_key().into_owned())
                            .collect();
                        agent_status = format!("tried_{}", public_keys.len());
                        for (index, key) in public_keys.into_iter().enumerate() {
                            let label = format!("agent#{index}");
                            match session
                                .authenticate_publickey_with(&target.user, key, hash_alg, &mut agent)
                                .await
                            {
                                Ok(result) if result.success() => {
                                    return Ok(AuthOk {
                                        method: "agent",
                                        key: label,
                                    });
                                }
                                Ok(_) => tried.push(json!({ "path": label, "result": "rejected" })),
                                Err(_) => tried.push(json!({ "path": label, "result": "error" })),
                            }
                        }
                    }
                    Err(_) => agent_status = "unavailable".into(),
                },
                Err(_) => agent_status = "unavailable".into(),
            }
        }
        #[cfg(windows)]
        {
            if let Ok(mut agent) = keys::agent::client::AgentClient::connect_named_pipe(r"\\.\pipe\openssh-ssh-agent").await {
                if let Ok(identities) = agent.request_identities().await {
                    if identities.is_empty() {
                        agent_status = "empty".into();
                    } else {
                        let public_keys: Vec<keys::PublicKey> = identities
                            .into_iter()
                            .map(|item| item.public_key().into_owned())
                            .collect();
                        agent_status = format!("tried_{}", public_keys.len());
                        for (index, key) in public_keys.into_iter().enumerate() {
                            let label = format!("agent#{index}");
                            match session
                                .authenticate_publickey_with(&target.user, key, hash_alg, &mut agent)
                                .await
                            {
                                Ok(result) if result.success() => {
                                    return Ok(AuthOk {
                                        method: "agent",
                                        key: label,
                                    });
                                }
                                Ok(_) => tried.push(json!({ "path": label, "result": "rejected" })),
                                Err(_) => tried.push(json!({ "path": label, "result": "error" })),
                            }
                        }
                    }
                }
            } else if let Ok(mut agent) = keys::agent::client::AgentClient::connect_pageant().await {
                if let Ok(identities) = agent.request_identities().await {
                    if identities.is_empty() {
                        agent_status = "empty".into();
                    } else {
                        let public_keys: Vec<keys::PublicKey> = identities
                            .into_iter()
                            .map(|item| item.public_key().into_owned())
                            .collect();
                        agent_status = format!("tried_{}", public_keys.len());
                        for (index, key) in public_keys.into_iter().enumerate() {
                            let label = format!("agent#{index}");
                            match session
                                .authenticate_publickey_with(&target.user, key, hash_alg, &mut agent)
                                .await
                            {
                                Ok(result) if result.success() => {
                                    return Ok(AuthOk {
                                        method: "agent",
                                        key: label,
                                    });
                                }
                                Ok(_) => tried.push(json!({ "path": label, "result": "rejected" })),
                                Err(_) => tried.push(json!({ "path": label, "result": "error" })),
                            }
                        }
                    }
                }
            }
        }
    }

    let error = if had_encrypted {
        "有私钥带口令，当前不支持输入口令。请用无口令密钥，或先 ssh-add 进 agent。".to_string()
    } else {
        "没有可用的密钥完成登录。已自动尝试 ~/.ssh/config、默认钥和目录里其它私钥。当前支持公钥，不弹出密码框。"
            .to_string()
    };
    Err(AuthFail {
        tried,
        agent: agent_status,
        error,
    })
}

fn auth_fail_value(target: &ResolvedTarget, fail: AuthFail) -> Value {
    json!({
        "ok": false,
        "error": fail.error,
        "host": target.hostname,
        "user": target.user,
        "port": target.port,
        "tried": fail.tried,
        "agent": fail.agent,
    })
}

enum ConnectOutcome {
    Ready {
        session: client::Handle<SshHandler>,
        info: TrustInfo,
        target: ResolvedTarget,
        auth: AuthOk,
    },
    Failed(Value),
}

async fn connect_authenticated(host: &str, user: &str, port: u16) -> ConnectOutcome {
    let target = match resolve_target(host, user, port) {
        Ok(target) => target,
        Err(error) => {
            return ConnectOutcome::Failed(json!({ "ok": false, "error": error }));
        }
    };
    let trust = Arc::new(Mutex::new(TrustInfo {
        status: "unknown".into(),
        fingerprint: String::new(),
        key: None,
    }));
    let handler = SshHandler {
        alias: target.alias.clone(),
        hostname: target.hostname.clone(),
        port: target.port,
        trust: trust.clone(),
    };
    let config = Arc::new(client::Config {
        nodelay: true,
        inactivity_timeout: Some(Duration::from_secs(60)),
        ..Default::default()
    });
    let mut session = match timeout(
        Duration::from_secs(20),
        client::connect(config, (target.hostname.as_str(), target.port), handler),
    )
    .await
    {
        Err(_) => {
            return ConnectOutcome::Failed(json!({
                "ok": false,
                "error": format!("连接 {}:{} 超时", target.hostname, target.port),
                "host": target.hostname,
                "user": target.user,
                "port": target.port,
            }));
        }
        Ok(Err(err)) => {
            let info = trust_snapshot(&trust);
            let error = if info.status == "changed" {
                format!("主机密钥和 known_hosts 不一致（{}）。连接已断开", info.fingerprint)
            } else {
                format!("连不上 {}:{}：{err}", target.hostname, target.port)
            };
            return ConnectOutcome::Failed(json!({
                "ok": false,
                "error": error,
                "host": target.hostname,
                "user": target.user,
                "port": target.port,
                "host_key_status": info.status,
                "fingerprint": info.fingerprint,
            }));
        }
        Ok(Ok(session)) => session,
    };
    match authenticate(&mut session, &target).await {
        Ok(auth) => ConnectOutcome::Ready {
            session,
            info: trust_snapshot(&trust),
            target,
            auth,
        },
        Err(fail) => {
            let _ = session
                .disconnect(Disconnect::AuthCancelledByUser, "authentication failed", "")
                .await;
            ConnectOutcome::Failed(auth_fail_value(&target, fail))
        }
    }
}

async fn run_ssh(op: &str, host: String, user: String, port: u16, path: String, content: String) -> Result<Value, String> {
    let (session, info, target, auth) = match connect_authenticated(&host, &user, port).await {
        ConnectOutcome::Failed(value) => return Ok(value),
        ConnectOutcome::Ready {
            session,
            info,
            target,
            auth,
        } => (session, info, target, auth),
    };
    let mutating = matches!(op, "write" | "delete" | "exec");
    if mutating && info.status == "changed" {
        let _ = session
            .disconnect(Disconnect::HostKeyNotVerifiable, "host key changed", "")
            .await;
        return Ok(json!({
            "ok": false,
            "error": format!("主机密钥和 known_hosts 不一致（{}）。连接已断开", info.fingerprint),
            "host": target.hostname,
            "user": target.user,
            "port": target.port,
            "host_key_status": "changed",
            "fingerprint": info.fingerprint,
        }));
    }
    let mut host_key_status = info.status.clone();
    if mutating && info.status == "unknown" && remember_host(&target, &info) {
        host_key_status = "known".into();
    }
    let outcome = match op {
        "ls" => ssh_ls(&session, &path).await,
        "read" => ssh_read(&session, &path).await,
        "write" => ssh_write(&session, &path, &content).await,
        "delete" => ssh_delete(&session, &path).await,
        "exec" => ssh_exec(&session, &path).await,
        _ => Err("不支持的远程操作".into()),
    };
    let _ = session.disconnect(Disconnect::ByApplication, "done", "").await;
    let mut value = match outcome {
        Ok(value) => value,
        Err(error) => json!({ "ok": false, "error": error }),
    };
    if let Some(obj) = value.as_object_mut() {
        obj.insert("host".into(), json!(target.hostname));
        obj.insert("user".into(), json!(target.user));
        obj.insert("port".into(), json!(target.port));
        obj.insert("host_key_status".into(), json!(host_key_status));
        obj.insert("auth".into(), json!(auth.method));
        obj.insert("auth_key".into(), json!(auth.key));
        if !info.fingerprint.is_empty() {
            obj.insert("fingerprint".into(), json!(info.fingerprint));
        }
    }
    Ok(value)
}

async fn sftp_session(session: &client::Handle<SshHandler>) -> Result<russh_sftp::client::SftpSession, String> {
    let channel = session.channel_open_session().await.map_err(|err| format!("打不开通道：{err}"))?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|err| format!("对方没有打开 SFTP：{err}"))?;
    russh_sftp::client::SftpSession::new(channel.into_stream())
        .await
        .map_err(|err| format!("SFTP 初始化失败：{err}"))
}

async fn remote_path(sftp: &russh_sftp::client::SftpSession, path: &str) -> String {
    let path = path.trim();
    if path.is_empty() {
        return ".".into();
    }
    if path.starts_with('~') {
        if let Ok(Some(expanded)) = sftp.expand_path(path).await {
            if !expanded.is_empty() {
                return expanded;
            }
        }
    }
    path.to_string()
}

async fn ssh_ls(session: &client::Handle<SshHandler>, path: &str) -> Result<Value, String> {
    let sftp = sftp_session(session).await?;
    let path = remote_path(&sftp, path).await;
    let mut entries = Vec::new();
    let mut truncated = false;
    for item in sftp.read_dir(&path).await.map_err(|err| format!("列目录失败：{err}"))? {
        if entries.len() >= LIST_LIMIT {
            truncated = true;
            break;
        }
        let kind = item.file_type();
        entries.push(json!({
            "name": item.file_name(),
            "path": item.path(),
            "is_dir": kind.is_dir(),
            "size": item.metadata().len(),
        }));
    }
    entries.sort_by(|left, right| {
        let lname = left.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let rname = right.get("name").and_then(|v| v.as_str()).unwrap_or("");
        lname.cmp(rname)
    });
    Ok(json!({ "ok": true, "path": path, "entries": entries, "truncated": truncated }))
}

async fn ssh_read(session: &client::Handle<SshHandler>, path: &str) -> Result<Value, String> {
    if path.trim().is_empty() {
        return Err("需要远程文件路径".into());
    }
    let sftp = sftp_session(session).await?;
    let path = remote_path(&sftp, path).await;
    let meta = sftp.metadata(&path).await.map_err(|err| format!("读取失败：{err}"))?;
    if meta.file_type().is_dir() {
        return Err("这是目录".into());
    }
    if meta.len() > READ_LIMIT as u64 {
        return Err("文件太大，只支持读取 200KB 以内的文本".into());
    }
    let mut file = sftp.open(&path).await.map_err(|err| format!("读取失败：{err}"))?;
    let mut bytes = Vec::new();
    let mut chunk = [0_u8; 8192];
    loop {
        let read = file.read(&mut chunk).await.map_err(|err| format!("读取失败：{err}"))?;
        if read == 0 {
            break;
        }
        if bytes.len() + read > READ_LIMIT {
            return Err("文件太大，只支持读取 200KB 以内的文本".into());
        }
        bytes.extend_from_slice(&chunk[..read]);
    }
    let _ = file.close().await;
    let text = String::from_utf8(bytes).map_err(|_| "不是文本文件".to_string())?;
    Ok(json!({ "ok": true, "path": path, "content": text }))
}

async fn ssh_write(session: &client::Handle<SshHandler>, path: &str, content: &str) -> Result<Value, String> {
    if path.trim().is_empty() {
        return Err("需要远程文件路径".into());
    }
    if content.len() > WRITE_LIMIT {
        return Err("内容太大".into());
    }
    let sftp = sftp_session(session).await?;
    let path = remote_path(&sftp, path).await;
    let mut file = sftp.create(&path).await.map_err(|err| format!("写入失败：{err}"))?;
    tokio::io::AsyncWriteExt::write_all(&mut file, content.as_bytes())
        .await
        .map_err(|err| format!("写入失败：{err}"))?;
    file.close().await.map_err(|err| format!("写入失败：{err}"))?;
    Ok(json!({ "ok": true, "path": path }))
}

async fn ssh_delete(session: &client::Handle<SshHandler>, path: &str) -> Result<Value, String> {
    let paths: Vec<String> = path
        .split('\n')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if paths.is_empty() {
        return Err("需要远程文件路径".into());
    }
    let sftp = sftp_session(session).await?;
    let mut deleted: Vec<String> = Vec::new();
    let mut errors: Vec<Value> = Vec::new();
    for raw in &paths {
        match ssh_delete_one(&sftp, raw).await {
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

async fn ssh_delete_one(sftp: &russh_sftp::client::SftpSession, path: &str) -> Result<String, String> {
    let path = remote_path(sftp, path).await;
    let meta = sftp.metadata(&path).await.map_err(|err| format!("删除失败：{err}"))?;
    if meta.file_type().is_dir() {
        return Err("只能删除文件".into());
    }
    sftp.remove_file(&path).await.map_err(|err| format!("删除失败：{err}"))?;
    Ok(path)
}

async fn ssh_exec(session: &client::Handle<SshHandler>, command: &str) -> Result<Value, String> {
    let command = command.trim();
    if command.is_empty() || command.chars().any(|c| c != '\n' && c != '\t' && c.is_control()) || command.len() > 2000 {
        return Err("命令无效或太长".into());
    }
    let mut channel = session.channel_open_session().await.map_err(|err| format!("打不开通道：{err}"))?;
    channel.exec(true, command.as_bytes()).await.map_err(|err| format!("执行失败：{err}"))?;
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut exit_code: Option<u32> = None;
    let mut truncated = false;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    loop {
        let left = deadline.saturating_duration_since(tokio::time::Instant::now());
        if left.is_zero() {
            let _ = channel.close().await;
            return Err("命令超过 30 秒还没结束".into());
        }
        let message = match timeout(left, channel.wait()).await {
            Err(_) => {
                let _ = channel.close().await;
                return Err("命令超过 30 秒还没结束".into());
            }
            Ok(message) => message,
        };
        match message {
            Some(ChannelMsg::Data { data }) => {
                if push_limited(&mut stdout, &data, EXEC_LIMIT) {
                    truncated = true;
                }
            }
            Some(ChannelMsg::ExtendedData { data, ext }) => {
                let buf = if ext == 1 { &mut stderr } else { &mut stdout };
                if push_limited(buf, &data, EXEC_LIMIT) {
                    truncated = true;
                }
            }
            Some(ChannelMsg::ExitStatus { exit_status }) => exit_code = Some(exit_status),
            Some(ChannelMsg::Close) | None => {
                if exit_code.is_none() {
                    if let Ok(Some(ChannelMsg::ExitStatus { exit_status })) =
                        timeout(Duration::from_millis(200), channel.wait()).await
                    {
                        exit_code = Some(exit_status);
                    }
                }
                break;
            }
            _ => {}
        }
    }
    let mut text = String::from_utf8_lossy(&stdout).to_string();
    let err = String::from_utf8_lossy(&stderr);
    if !err.trim().is_empty() {
        if !text.is_empty() && !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str(&err);
    }
    let chars: Vec<char> = text.chars().collect();
    if chars.len() > 4000 {
        text = chars[..4000].iter().collect();
        truncated = true;
    }
    if truncated {
        text.push_str("\n…");
    }
    Ok(json!({
        "ok": exit_code.unwrap_or(1) == 0,
        "exit_code": exit_code,
        "output": text,
        "command": command,
    }))
}

fn push_limited(buf: &mut Vec<u8>, data: &[u8], cap: usize) -> bool {
    if buf.len() >= cap {
        return true;
    }
    let room = cap - buf.len();
    if data.len() > room {
        buf.extend_from_slice(&data[..room]);
        true
    } else {
        buf.extend_from_slice(data);
        false
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn host_ssh_probe(host: String, user: String, port: u16) -> Result<Value, String> {
    match connect_authenticated(&host, &user, port).await {
        ConnectOutcome::Failed(value) => Ok(value),
        ConnectOutcome::Ready {
            session,
            info,
            target,
            auth,
        } => {
            let _ = session.disconnect(Disconnect::ByApplication, "probe", "").await;
            Ok(json!({
                "ok": true,
                "host": target.hostname,
                "user": target.user,
                "port": target.port,
                "host_key_status": info.status,
                "fingerprint": info.fingerprint,
                "auth": auth.method,
                "auth_key": auth.key,
            }))
        }
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn host_ssh_ls(host: String, user: String, port: u16, path: String) -> Result<Value, String> {
    run_ssh("ls", host, user, port, path, String::new()).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn host_ssh_read(host: String, user: String, port: u16, path: String) -> Result<Value, String> {
    run_ssh("read", host, user, port, path, String::new()).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn host_ssh_write(host: String, user: String, port: u16, path: String, content: String) -> Result<Value, String> {
    run_ssh("write", host, user, port, path, content).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn host_ssh_delete(host: String, user: String, port: u16, path: String) -> Result<Value, String> {
    run_ssh("delete", host, user, port, path, String::new()).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn host_ssh_exec(host: String, user: String, port: u16, command: String) -> Result<Value, String> {
    run_ssh("exec", host, user, port, command, String::new()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_prefers_first_matching_value_and_collects_keys() {
        let text = "\
Host dev
  HostName 10.0.0.8
  User alice
  Port 2222
  IdentityFile ~/.ssh/dev

Host *
  User ubuntu
  IdentityFile ~/.ssh/id_ed25519
";
        let parsed = parse_ssh_config(text, "dev").unwrap();
        assert_eq!(parsed.hostname.as_deref(), Some("10.0.0.8"));
        assert_eq!(parsed.user.as_deref(), Some("alice"));
        assert_eq!(parsed.port, Some(2222));
        assert_eq!(parsed.identity_files, vec!["~/.ssh/dev".to_string(), "~/.ssh/id_ed25519".to_string()]);
        assert!(parsed.proxy.is_none());
    }

    #[test]
    fn negated_host_pattern_skips_the_block() {
        let text = "\
Host !bad.example.com *.example.com
  User bob
";
        let skipped = parse_ssh_config(text, "bad.example.com").unwrap();
        assert!(skipped.user.is_none());
        let matched = parse_ssh_config(text, "good.example.com").unwrap();
        assert_eq!(matched.user.as_deref(), Some("bob"));
    }

    #[test]
    fn proxy_jump_is_reported() {
        let text = "\
Host jumpbox
  HostName 10.1.1.1
  ProxyJump bastion
";
        let parsed = parse_ssh_config(text, "jumpbox").unwrap();
        assert_eq!(parsed.proxy.as_deref(), Some("bastion"));
    }

    #[test]
    fn shell_wrappers_do_not_count_as_the_ssh_client() {
        assert!(is_remote_ssh_command("ssh alice@10.0.0.8"));
        assert!(is_remote_ssh_command("/usr/bin/scp file host:"));
        assert!(is_remote_ssh_command("sh -c \"ssh alice@host\""));
        assert!(!is_remote_ssh_command("echo hello"));
        assert!(!is_remote_ssh_command("grep ssh notes.txt"));
    }

    #[test]
    fn scan_extra_keys_skips_pubs_and_known_hosts() {
        let dir = std::env::temp_dir().join(format!("openbot-ssh-scan-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("id_ed25519"), b"x").unwrap();
        std::fs::write(dir.join("work_key"), b"x").unwrap();
        std::fs::write(dir.join("work_key.pub"), b"x").unwrap();
        std::fs::write(dir.join("known_hosts"), b"x").unwrap();
        std::fs::write(dir.join("config"), b"x").unwrap();
        let found = scan_extra_identity_files(&dir);
        assert_eq!(found, vec![dir.join("work_key")]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn classify_encrypted_key_error() {
        assert_eq!(classify_key_load_error(&keys::Error::KeyIsEncrypted), "encrypted");
        assert_eq!(classify_key_load_error(&keys::Error::CouldNotReadKey), "unreadable");
    }
}
