use std::path::PathBuf;
use std::sync::mpsc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use flux_core::process::{ProcessInfo, ProcessQuery};

use crate::remote::hosts::{self, HostConfig};
use crate::remote::poller::{self, Control};
use crate::remote::session::{HostKeyStatus, SshSession};
use crate::remote::HostId;
use crate::state::AppState;

/// Live runtime handle for a connected (or connecting) host.
pub struct HostRuntime {
    pub control_tx: mpsc::Sender<Control>,
}

#[derive(Serialize, Clone)]
pub struct HostView {
    pub id: HostId,
    pub name: String,
    pub address: String,
    pub port: u16,
    pub username: String,
    pub running: bool,
    /// MAC known → the Wake button can appear on the offline tile.
    pub mac: Option<String>,
}

#[derive(Deserialize)]
pub struct NewHost {
    pub name: String,
    pub address: String,
    pub port: u16,
    pub username: String,
}

#[derive(Serialize)]
pub struct TestResult {
    pub fingerprint: String,
    pub host_key_known: bool,
    pub host_key_changed: bool,
    pub auth_ok: bool,
    pub hostname: String,
    pub os_pretty_name: String,
    pub kernel: String,
}

pub(crate) fn data_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("app data dir unavailable")
}

fn known_hosts_path(app: &AppHandle) -> PathBuf {
    data_dir(app).join("known_hosts")
}

fn key_dir(app: &AppHandle) -> PathBuf {
    data_dir(app).join("keys")
}

fn private_key_path(app: &AppHandle) -> PathBuf {
    key_dir(app).join("flux_ed25519")
}

/// Generate the shared app keypair on first use. libssh2 can't generate
/// keys, so this shells out to ssh-keygen (openssh-client ships everywhere
/// Flux runs).
fn ensure_keypair(app: &AppHandle) -> Result<PathBuf, String> {
    let private = private_key_path(app);
    if private.exists() {
        return Ok(private);
    }
    std::fs::create_dir_all(key_dir(app)).map_err(|e| e.to_string())?;
    let output = std::process::Command::new("ssh-keygen")
        .args(["-t", "ed25519", "-N", "", "-C", "flux-monitor", "-f"])
        .arg(&private)
        .output()
        .map_err(|e| format!("ssh-keygen: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "ssh-keygen failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(private)
}

fn public_key(app: &AppHandle) -> Result<String, String> {
    let path = private_key_path(app).with_extension("pub");
    std::fs::read_to_string(path)
        .map(|s| s.trim().to_string())
        .map_err(|e| format!("read public key: {e}"))
}

fn spawn_poller(app: &AppHandle, state: &AppState, config: HostConfig) {
    let (tx, rx) = mpsc::channel();
    state
        .host_runtimes
        .lock()
        .unwrap()
        .insert(config.id.clone(), HostRuntime { control_tx: tx });
    let app = app.clone();
    let known_hosts = known_hosts_path(&app);
    let interval = state
        .tick_interval_ms
        .load(std::sync::atomic::Ordering::Relaxed);
    std::thread::spawn(move || poller::run(app, config, known_hosts, interval, rx));
}

pub fn autoconnect_saved_hosts(app: &AppHandle) {
    let state = app.state::<AppState>();
    let saved = hosts::load(&data_dir(app));
    *state.hosts.lock().unwrap() = saved.clone();
    for config in saved {
        spawn_poller(app, &state, config);
    }
}

pub fn views(state: &AppState) -> Vec<HostView> {
    let runtimes = state.host_runtimes.lock().unwrap();
    state
        .hosts
        .lock()
        .unwrap()
        .iter()
        .map(|h| HostView {
            id: h.id.clone(),
            name: h.name.clone(),
            address: h.address.clone(),
            port: h.port,
            username: h.username.clone(),
            running: runtimes.contains_key(&h.id),
            mac: h.mac.clone(),
        })
        .collect()
}

/// Persist an auto-captured MAC (poller thread, first connect).
pub fn store_host_mac(app: &AppHandle, host_id: &str, mac: &str) {
    let state = app.state::<AppState>();
    let mut hosts = state.hosts.lock().unwrap();
    let Some(host) = hosts.iter_mut().find(|h| h.id == host_id) else {
        return;
    };
    host.mac = Some(mac.to_string());
    if let Err(err) = hosts::save(&data_dir(app), &hosts) {
        eprintln!("hosts: cannot save captured MAC: {err}");
    }
}

/// Send a Wake-on-LAN magic packet to a host's stored MAC.
#[tauri::command]
pub fn wake_host(state: State<'_, AppState>, host_id: HostId) -> Result<(), String> {
    let mac = state
        .hosts
        .lock()
        .unwrap()
        .iter()
        .find(|h| h.id == host_id)
        .ok_or("unknown host")?
        .mac
        .clone()
        .ok_or("no MAC recorded for this host yet — connect it once first")?;
    crate::remote::power::wake(&mac)
}

/// Graceful reboot / poweroff over SSH (verb allowlisted in power.rs).
#[tauri::command]
pub async fn host_power(app: AppHandle, host_id: HostId, verb: String) -> Result<(), String> {
    let config = app
        .state::<AppState>()
        .hosts
        .lock()
        .unwrap()
        .iter()
        .find(|h| h.id == host_id)
        .cloned()
        .ok_or("unknown host")?;
    let known_hosts = known_hosts_path(&app);
    tauri::async_runtime::spawn_blocking(move || {
        crate::remote::power::power_action(&config, &known_hosts, &verb)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// start / shutdown / stop a Proxmox guest (kind + action allowlisted in
/// proxmox.rs). Dedicated SSH session — shutdown can block for a while.
#[tauri::command]
pub async fn proxmox_guest_action(
    app: AppHandle,
    host_id: HostId,
    vmid: u64,
    kind: String,
    action: String,
) -> Result<(), String> {
    let config = app
        .state::<AppState>()
        .hosts
        .lock()
        .unwrap()
        .iter()
        .find(|h| h.id == host_id)
        .cloned()
        .ok_or("unknown host")?;
    let known_hosts = known_hosts_path(&app);
    tauri::async_runtime::spawn_blocking(move || {
        crate::remote::proxmox::guest_action(&config, &known_hosts, vmid, &kind, &action)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn list_hosts(state: State<'_, AppState>) -> Vec<HostView> {
    views(&state)
}

/// Current status snapshot per host — lets a freshly loaded frontend seed
/// itself instead of waiting for the next status transition event.
#[tauri::command]
pub fn get_host_statuses(
    state: State<'_, AppState>,
) -> std::collections::HashMap<HostId, crate::remote::HostStatusEvent> {
    state.host_status_cache.lock().unwrap().clone()
}

/// Pre-add probe: connect, report fingerprint/TOFU state, try password
/// auth if given, grab a few identity facts.
#[tauri::command]
pub async fn test_host_connection(
    app: AppHandle,
    address: String,
    port: u16,
    username: String,
    password: Option<String>,
) -> Result<TestResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let session = SshSession::connect(&address, port)?;
        let fingerprint = session.fingerprint()?;
        let key_status = session.check_host_key(&known_hosts_path(&app))?;
        let mut result = TestResult {
            fingerprint,
            host_key_known: matches!(key_status, HostKeyStatus::Known),
            host_key_changed: matches!(key_status, HostKeyStatus::Changed),
            auth_ok: false,
            hostname: String::new(),
            os_pretty_name: String::new(),
            kernel: String::new(),
        };
        if result.host_key_changed {
            return Ok(result);
        }
        if let Some(password) = password {
            if session.auth_password(&username, &password).is_ok() {
                result.auth_ok = true;
                if let Ok(info) = crate::remote::agentless::statics(&session) {
                    result.hostname = info.hostname;
                    result.os_pretty_name = info.os_pretty_name;
                    result.kernel = info.kernel_version;
                }
            }
        }
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Add + provision in one step: TOFU-accept the host key, install the app
/// public key over password auth, verify key auth works, persist, connect.
/// The password lives only in this call's stack. Blocking — shared by the
/// Tauri command and the local HTTP API.
pub fn add_host_blocking(
    app: &AppHandle,
    new: NewHost,
    password: &str,
) -> Result<HostView, String> {
    let key_path = {
        let key_path = ensure_keypair(app)?;
        let known_hosts = known_hosts_path(app);

        let session = SshSession::connect(&new.address, new.port)?;
        if matches!(
            session.check_host_key(&known_hosts)?,
            HostKeyStatus::Changed
        ) {
            return Err(
                "Host key changed since last seen — refusing. Remove the old entry from known_hosts if this is expected.".into(),
            );
        }
        session.remember_host_key(&known_hosts)?;
        session.auth_password(&new.username, password)?;

        // Idempotent authorized_keys append. Interpolating the pubkey into
        // the shell line is safe only by PROVENANCE: it is ssh-keygen output
        // Flux generated itself. If a feature ever lets users supply their
        // own key material, this line becomes a shell-injection sink and
        // needs validation or a non-shell transport (SFTP) instead.
        let pubkey = public_key(app)?;
        session.exec_capture(&format!(
            "mkdir -p ~/.ssh && chmod 700 ~/.ssh && \
             grep -qxF '{pubkey}' ~/.ssh/authorized_keys 2>/dev/null || \
             printf '%s\\n' '{pubkey}' >> ~/.ssh/authorized_keys; \
             chmod 600 ~/.ssh/authorized_keys"
        ))?;

        // Verify the key actually works before saving anything.
        let verify = SshSession::connect(&new.address, new.port)?;
        verify.check_host_key(&known_hosts)?;
        verify
            .auth_key(&new.username, &key_path)
            .map_err(|e| format!("key installed but key auth failed: {e}"))?;
        key_path
    };

    let state = app.state::<AppState>();
    let config = HostConfig {
        id: uuid::Uuid::new_v4().to_string(),
        name: if new.name.trim().is_empty() {
            new.address.clone()
        } else {
            new.name.clone()
        },
        address: new.address,
        port: new.port,
        username: new.username,
        key_path,
        mac: None,
    };
    {
        let mut hosts = state.hosts.lock().unwrap();
        hosts.push(config.clone());
        hosts::save(&data_dir(app), &hosts)?;
    }
    spawn_poller(app, &state, config.clone());
    // Nudge the frontend to re-fetch the host list (API adds bypass the UI).
    let _ = tauri::Emitter::emit(app, "hosts://changed", ());
    Ok(HostView {
        id: config.id,
        name: config.name,
        address: config.address,
        port: config.port,
        username: config.username,
        running: true,
        mac: config.mac,
    })
}

#[tauri::command]
pub async fn add_host(
    app: AppHandle,
    new: NewHost,
    password: String,
) -> Result<HostView, String> {
    tauri::async_runtime::spawn_blocking(move || add_host_blocking(&app, new, &password))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn connect_host(app: AppHandle, state: State<'_, AppState>, host_id: HostId) -> Result<(), String> {
    if state.host_runtimes.lock().unwrap().contains_key(&host_id) {
        return Ok(());
    }
    let config = state
        .hosts
        .lock()
        .unwrap()
        .iter()
        .find(|h| h.id == host_id)
        .cloned()
        .ok_or("unknown host")?;
    spawn_poller(&app, &state, config);
    Ok(())
}

#[tauri::command]
pub fn disconnect_host(state: State<'_, AppState>, host_id: HostId) {
    if let Some(runtime) = state.host_runtimes.lock().unwrap().remove(&host_id) {
        let _ = runtime.control_tx.send(Control::Stop);
    }
}

pub fn remove_host_blocking(app: &AppHandle, host_id: &str) -> Result<(), String> {
    let state = app.state::<AppState>();
    if let Some(runtime) = state.host_runtimes.lock().unwrap().remove(host_id) {
        let _ = runtime.control_tx.send(Control::Stop);
    }
    state.host_status_cache.lock().unwrap().remove(host_id);
    let result = {
        let mut hosts = state.hosts.lock().unwrap();
        hosts.retain(|h| h.id != host_id);
        hosts::save(&data_dir(app), &hosts)
    };
    let _ = tauri::Emitter::emit(app, "hosts://changed", ());
    result
}

#[tauri::command]
pub fn remove_host(app: AppHandle, host_id: HostId) -> Result<(), String> {
    remove_host_blocking(&app, &host_id)
}

fn with_control<T: Send + 'static>(
    state: &AppState,
    host_id: &str,
    make: impl FnOnce(mpsc::Sender<Result<T, String>>) -> Control,
) -> Result<T, String> {
    let control_tx = state
        .host_runtimes
        .lock()
        .unwrap()
        .get(host_id)
        .ok_or("host not connected")?
        .control_tx
        .clone();
    let (reply_tx, reply_rx) = mpsc::channel();
    control_tx
        .send(make(reply_tx))
        .map_err(|_| "host worker gone")?;
    reply_rx
        .recv_timeout(std::time::Duration::from_secs(20))
        .map_err(|_| "timed out waiting for host".to_string())?
}

#[tauri::command]
pub async fn list_remote_processes(
    app: AppHandle,
    host_id: HostId,
    query: ProcessQuery,
) -> Result<Vec<ProcessInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        with_control(&state, &host_id, |reply| Control::Processes(query, reply))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Drop a recorded host key so a legitimately reinstalled machine can be
/// re-trusted. The file only ever contains entries Flux itself wrote.
#[tauri::command]
pub fn forget_host_key(app: AppHandle, address: String, port: u16) -> Result<(), String> {
    let path = known_hosts_path(&app);
    let Ok(contents) = std::fs::read_to_string(&path) else {
        return Ok(());
    };
    let needle_plain = address.as_str();
    let needle_bracketed = format!("[{address}]:{port}");
    let kept: Vec<&str> = contents
        .lines()
        .filter(|line| {
            let host_field = line.split_whitespace().next().unwrap_or("");
            !host_field
                .split(',')
                .any(|h| h == needle_plain || h == needle_bracketed)
        })
        .collect();
    std::fs::write(&path, kept.join("\n") + "\n").map_err(|e| e.to_string())
}

fn config_for(state: &AppState, host_id: &str) -> Result<HostConfig, String> {
    state
        .hosts
        .lock()
        .unwrap()
        .iter()
        .find(|h| h.id == host_id)
        .cloned()
        .ok_or_else(|| "unknown host".into())
}

/// Upload the bundled flux-agent, verify it, and switch the poller to
/// agent mode. Returns the agent version string.
#[tauri::command]
pub async fn deploy_agent(app: AppHandle, host_id: HostId) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let config = config_for(&state, &host_id)?;
        let version =
            crate::remote::deploy::deploy_agent(&app, &host_id, &config, &known_hosts_path(&app))?;
        if let Some(runtime) = state.host_runtimes.lock().unwrap().get(&host_id) {
            let _ = runtime.control_tx.send(Control::SwitchToAgent);
        }
        Ok(version)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Install the Flux .deb on the remote from the hosted apt repo.
#[tauri::command]
pub async fn install_flux_deb(
    app: AppHandle,
    host_id: HostId,
    sudo_password: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let config = config_for(&state, &host_id)?;
        crate::remote::deploy::install_flux_deb(
            &app,
            &host_id,
            &config,
            &known_hosts_path(&app),
            &sudo_password,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn kill_remote_process(
    app: AppHandle,
    host_id: HostId,
    pid: u32,
    force: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        with_control(&state, &host_id, |reply| Control::Kill(pid, force, reply))
    })
    .await
    .map_err(|e| e.to_string())?
}

