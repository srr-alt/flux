use tauri::State;

use crate::monitor::{self, system_info::SystemInfo, TickSnapshot};
use crate::state::AppState;

#[tauri::command]
pub fn get_system_info(state: State<'_, AppState>) -> SystemInfo {
    let mut sys = state.sys.lock().unwrap();
    sys.refresh_cpu_list(sysinfo::CpuRefreshKind::everything());
    sys.refresh_memory();
    monitor::system_info::collect(&sys)
}

#[tauri::command]
pub fn get_initial_snapshot(state: State<'_, AppState>) -> Option<TickSnapshot> {
    state.last_snapshot.lock().unwrap().clone()
}

#[tauri::command]
pub fn get_cpu_details() -> monitor::cpu::CpuDetails {
    monitor::cpu::details().clone()
}

#[tauri::command]
pub fn get_gpu_processes() -> Vec<monitor::gpu::GpuProcess> {
    monitor::gpu::processes()
}

/// Read persisted history for one host. `host_id` is "local" for this
/// machine. Runs on the blocking pool — SQLite reads are file I/O.
#[tauri::command]
pub async fn history_query(
    state: State<'_, crate::history::HistoryState>,
    host_id: String,
    range_secs: u64,
) -> Result<Vec<crate::history::HistoryPoint>, String> {
    let Some(handle) = &state.0 else {
        return Ok(Vec::new()); // history disabled: empty, not an error
    };
    let db_path = handle.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::history::query(&db_path, &host_id, range_secs)
    })
    .await
    .map_err(|e| e.to_string())?
}
