use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::State;

use crate::state::{AppState, UsageLog};

/// Clamp bounds for the monitor tick interval.
const MIN_INTERVAL_MS: u64 = 100;
const MAX_INTERVAL_MS: u64 = 10_000;

#[tauri::command]
pub fn set_refresh_interval(state: State<'_, AppState>, ms: u64) -> u64 {
    let clamped = ms.clamp(MIN_INTERVAL_MS, MAX_INTERVAL_MS);
    state.tick_interval_ms.store(clamped, Ordering::Relaxed);
    clamped
}

#[derive(Serialize, Clone)]
pub struct UsageLogStatus {
    pub active: bool,
    pub path: Option<String>,
    pub rows: u64,
    pub started_ms: Option<u64>,
}

fn status_from(log: &Option<UsageLog>) -> UsageLogStatus {
    match log {
        Some(l) => UsageLogStatus {
            active: true,
            path: Some(l.path.display().to_string()),
            rows: l.rows,
            started_ms: Some(l.started_ms),
        },
        None => UsageLogStatus {
            active: false,
            path: None,
            rows: 0,
            started_ms: None,
        },
    }
}

fn log_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let dir = PathBuf::from(home)
        .join(".local/share/flux/logs");
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    Ok(dir)
}

pub const LOG_HEADER: &str = "timestamp_ms,local_time,cpu_pct,mem_used_pct,gpu_util_pct,gpu_temp_c,gpu_mem_used_mb,net_rx_bytes_per_sec,net_tx_bytes_per_sec\n";

#[tauri::command]
pub fn start_usage_log(state: State<'_, AppState>) -> Result<UsageLogStatus, String> {
    let mut log = state.usage_log.lock().unwrap();
    if log.is_some() {
        return Ok(status_from(&log));
    }
    let name = format!(
        "usage-{}.csv",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    );
    let path = log_dir()?.join(name);
    let file = File::create(&path).map_err(|e| format!("cannot create {}: {e}", path.display()))?;
    let mut writer = BufWriter::new(file);
    writer
        .write_all(LOG_HEADER.as_bytes())
        .map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())?;
    *log = Some(UsageLog {
        path,
        writer,
        rows: 0,
        started_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
    });
    Ok(status_from(&log))
}

#[tauri::command]
pub fn stop_usage_log(state: State<'_, AppState>) -> UsageLogStatus {
    let mut log = state.usage_log.lock().unwrap();
    let final_status = status_from(&log);
    if let Some(mut l) = log.take() {
        let _ = l.writer.flush();
    }
    final_status
}

#[tauri::command]
pub fn get_usage_log_status(state: State<'_, AppState>) -> UsageLogStatus {
    status_from(&state.usage_log.lock().unwrap())
}
