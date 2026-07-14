use tauri::{AppHandle, Manager, State};

use crate::state::AppState;
use crate::terminal::{self, TerminalSessions};

/// Open a shell on a host; `host_id` "local" is this machine. Returns the
/// session id for the write/resize/close calls and the output event filter.
#[tauri::command]
pub async fn terminal_open(
    app: AppHandle,
    host_id: String,
    cols: u16,
    rows: u16,
) -> Result<u32, String> {
    let data_dir = crate::commands_hosts::data_dir(&app);
    if host_id == "local" {
        let sessions = app.state::<TerminalSessions>();
        return terminal::open_local(app.clone(), &sessions, data_dir, cols, rows);
    }
    let config = app
        .state::<AppState>()
        .hosts
        .lock()
        .unwrap()
        .iter()
        .find(|h| h.id == host_id)
        .cloned()
        .ok_or("unknown host")?;
    let known_hosts = data_dir.join("known_hosts");
    // SSH connect + handshake block; keep them off the async runtime.
    tauri::async_runtime::spawn_blocking(move || {
        let sessions = app.state::<TerminalSessions>();
        terminal::open_ssh(
            app.clone(),
            &sessions,
            &config,
            &known_hosts,
            data_dir,
            cols,
            rows,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn terminal_write(
    sessions: State<'_, TerminalSessions>,
    session: u32,
    data: Vec<u8>,
) -> Result<(), String> {
    terminal::write(&sessions, session, data)
}

#[tauri::command]
pub fn terminal_resize(
    sessions: State<'_, TerminalSessions>,
    session: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    terminal::resize(&sessions, session, cols, rows)
}

#[tauri::command]
pub fn terminal_close(sessions: State<'_, TerminalSessions>, session: u32) {
    terminal::close(&sessions, session);
}

/// Commands previously typed in shells on this host, oldest first.
#[tauri::command]
pub fn terminal_history(app: AppHandle, host_id: String) -> Vec<String> {
    crate::modules::docker_prefs::shell_history(
        &crate::commands_hosts::data_dir(&app),
        &terminal::history_key(&host_id),
    )
}
