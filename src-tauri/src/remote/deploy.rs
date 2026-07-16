//! Deployment over SSH: push the bundled flux-agent binary, and install
//! the Flux .deb from the apt repo (Phase C).

use std::io::{Read, Write};
use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager};

use super::agent_client::AGENT_REMOTE_PATH;
use super::hosts::HostConfig;
use super::session::SshSession;
use super::EVENT_DEPLOY_PROGRESS;

#[derive(serde::Serialize, Clone)]
pub struct DeployProgress {
    pub host_id: String,
    pub step: String,
    pub pct: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<String>,
    pub done: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn progress(app: &AppHandle, host_id: &str, step: &str, pct: u8, line: Option<String>) {
    let _ = app.emit(
        EVENT_DEPLOY_PROGRESS,
        DeployProgress {
            host_id: host_id.to_string(),
            step: step.to_string(),
            pct,
            line,
            done: false,
            error: None,
        },
    );
}

fn finish(app: &AppHandle, host_id: &str, error: Option<String>) {
    let _ = app.emit(
        EVENT_DEPLOY_PROGRESS,
        DeployProgress {
            host_id: host_id.to_string(),
            step: if error.is_some() { "failed" } else { "done" }.into(),
            pct: 100,
            line: None,
            done: true,
            error,
        },
    );
}

/// Locate the agent binary: bundled resource in release, workspace target
/// dir during development.
fn agent_binary(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(dir) = app.path().resource_dir() {
        let bundled = dir.join("resources/flux-agent");
        if bundled.exists() {
            return Ok(bundled);
        }
    }
    let dev = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("flux-agent")))
        .filter(|p| p.exists());
    dev.ok_or_else(|| "flux-agent binary not found (build it with `cargo build -p flux-agent`)".into())
}

/// Upload the agent and sanity-check it. Returns the agent's --version.
pub fn deploy_agent(
    app: &AppHandle,
    host_id: &str,
    config: &HostConfig,
    known_hosts: &std::path::Path,
) -> Result<String, String> {
    let run = || -> Result<String, String> {
        progress(app, host_id, "reading agent binary", 5, None);
        let binary = std::fs::read(agent_binary(app)?).map_err(|e| e.to_string())?;

        progress(app, host_id, "connecting", 15, None);
        let session = SshSession::connect(&config.address, config.port)?;
        session.check_host_key(known_hosts)?;
        session.auth_key(&config.username, &config.key_path)?;

        progress(app, host_id, "uploading agent", 30, None);
        session.upload(&binary, AGENT_REMOTE_PATH, 0o755)?;

        progress(app, host_id, "verifying", 85, None);
        let version = session
            .exec_capture(&format!("\"$HOME\"/{AGENT_REMOTE_PATH} --version"))?
            .trim()
            .to_string();
        if !version.starts_with("flux-agent") {
            return Err(format!("unexpected --version output: {version}"));
        }
        Ok(version)
    };
    let result = run();
    match &result {
        Ok(_) => finish(app, host_id, None),
        Err(err) => finish(app, host_id, Some(err.clone())),
    }
    result
}

const APT_REPO_URL: &str = "https://srr-alt.github.io/flux-apt";
const SUPPORTED_CODENAMES: &[&str] = &["jammy", "noble", "resolute"];

/// Install the Flux .deb on the remote via the hosted apt repo.
/// The sudo password is written to sudo -S's stdin only, never argv.
pub fn install_flux_deb(
    app: &AppHandle,
    host_id: &str,
    config: &HostConfig,
    known_hosts: &std::path::Path,
    sudo_password: &str,
) -> Result<(), String> {
    let run = || -> Result<(), String> {
        progress(app, host_id, "connecting", 5, None);
        let session = SshSession::connect(&config.address, config.port)?;
        session.check_host_key(known_hosts)?;
        session.auth_key(&config.username, &config.key_path)?;

        progress(app, host_id, "checking distribution", 10, None);
        let codename = session
            .exec_capture(". /etc/os-release && echo \"$ID:$VERSION_CODENAME\"")?
            .trim()
            .to_string();
        let (id, codename) = codename.split_once(':').unwrap_or(("", ""));
        if id != "ubuntu" || !SUPPORTED_CODENAMES.contains(&codename) {
            return Err(format!(
                "unsupported distribution '{id} {codename}' — Flux .debs exist for Ubuntu {}",
                SUPPORTED_CODENAMES.join("/")
            ));
        }

        // Root either directly (root login) or via sudo -S; check sudo
        // exists first — minimal containers/servers often lack it and the
        // raw failure ("sudo: command not found", exit 127) is cryptic.
        let is_root = config.username == "root";
        if !is_root && session.exec_capture("command -v sudo").is_err() {
            return Err(format!(
                "sudo is not installed on {} — install it there first (as root: apt-get install sudo && usermod -aG sudo {}) or add the host as user root",
                config.address, config.username
            ));
        }

        // Everything root-requiring goes through one shell so the password
        // is sent once, via stdin.
        progress(app, host_id, "installing apt repo + flux", 25, None);
        let script = format!(
            "set -e\n\
             install -d -m 0755 /etc/apt/keyrings\n\
             curl -fsSL {APT_REPO_URL}/pubkey.gpg | gpg --dearmor --yes -o /etc/apt/keyrings/flux.gpg\n\
             echo \"deb [signed-by=/etc/apt/keyrings/flux.gpg] {APT_REPO_URL} {codename} main\" > /etc/apt/sources.list.d/flux.list\n\
             apt-get update -o Dir::Etc::sourcelist=sources.list.d/flux.list -o Dir::Etc::sourceparts=- -o APT::Get::List-Cleanup=0\n\
             DEBIAN_FRONTEND=noninteractive apt-get install -y flux\n"
        );

        let mut channel = session
            .session
            .channel_session()
            .map_err(|e| e.to_string())?;
        let (shell_cmd, stdin_payload) = if is_root {
            ("bash -s".to_string(), script)
        } else {
            ("sudo -S -p '' bash -s".to_string(), format!("{sudo_password}\n{script}"))
        };
        channel.exec(&shell_cmd).map_err(|e| e.to_string())?;
        channel
            .write_all(stdin_payload.as_bytes())
            .map_err(|e| format!("write: {e}"))?;
        channel.send_eof().map_err(|e| e.to_string())?;

        let mut output = String::new();
        channel.read_to_string(&mut output).ok();
        let mut stderr = String::new();
        channel.stderr().read_to_string(&mut stderr).ok();
        channel.wait_close().ok();
        let status = channel.exit_status().unwrap_or(-1);

        for line in output.lines().rev().take(12).collect::<Vec<_>>().into_iter().rev() {
            progress(app, host_id, "apt", 70, Some(line.to_string()));
        }
        if status != 0 {
            let hint = if stderr.contains("incorrect password")
                || stderr.contains("Sorry, try again")
            {
                "sudo password incorrect".to_string()
            } else {
                stderr.lines().rev().take(4).collect::<Vec<_>>().join(" | ")
            };
            return Err(format!("install failed (exit {status}): {hint}"));
        }
        Ok(())
    };
    let result = run();
    match &result {
        Ok(()) => finish(app, host_id, None),
        Err(err) => finish(app, host_id, Some(err.clone())),
    }
    result
}
