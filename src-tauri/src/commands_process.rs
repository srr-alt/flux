use tauri::State;

use crate::monitor::process::{self, ProcessInfo, ProcessQuery};
use crate::monitor::process_actions;
use crate::state::AppState;

#[tauri::command]
pub fn list_processes(state: State<'_, AppState>, query: ProcessQuery) -> Vec<ProcessInfo> {
    // proc_sys, not sys: the tick loop's CPU refreshes on the shared System
    // would reset the jiffies baseline sysinfo uses for process CPU%.
    let mut sys = state.proc_sys.lock().unwrap();
    // without_tasks: only real processes — otherwise every thread shows up
    // as its own entry, each reporting the full process memory.
    sys.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::All,
        true,
        sysinfo::ProcessRefreshKind::everything().without_tasks(),
    );
    // sysinfo's per-process io counters are deltas since the previous
    // refresh; the wall-clock gap between refreshes turns them into rates.
    let elapsed = {
        let mut last = state.last_proc_refresh.lock().unwrap();
        let now = std::time::Instant::now();
        let elapsed = last.map(|t| now.duration_since(t).as_secs_f64()).unwrap_or(0.0);
        *last = Some(now);
        elapsed
    };
    let uids = state.uid_cache.lock().unwrap();
    process::list(&sys, &uids, &query, elapsed)
}

#[tauri::command]
pub fn kill_process(pid: u32, force: bool) -> Result<(), String> {
    process_actions::kill_process(pid, force)
}

#[tauri::command]
pub fn renice_process(pid: u32, niceness: i32) -> Result<(), String> {
    process_actions::renice_process(pid, niceness)
}
