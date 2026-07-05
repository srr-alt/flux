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
