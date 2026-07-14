use crate::modules::{
    cleaner, docker, docker_prefs, docker_shell, hardware, services, smart, startup, uninstaller,
};

// --- Services ---

#[tauri::command]
pub fn list_services() -> Result<Vec<services::ServiceInfo>, String> {
    services::list()
}

#[tauri::command]
pub fn service_action(service: String, verb: String) -> Result<(), String> {
    services::action(&service, &verb)
}

// --- Startup apps ---

#[tauri::command]
pub fn list_startup_apps() -> Vec<startup::StartupApp> {
    startup::list()
}

#[tauri::command]
pub fn set_startup_enabled(file_name: String, enabled: bool) -> Result<(), String> {
    startup::set_enabled(&file_name, enabled)
}

#[tauri::command]
pub fn add_startup_app(name: String, exec: String) -> Result<(), String> {
    startup::add(&name, &exec)
}

#[tauri::command]
pub fn remove_startup_app(file_name: String) -> Result<(), String> {
    startup::remove(&file_name)
}

// --- Cleaner ---

#[tauri::command]
pub async fn scan_cleanable() -> Vec<cleaner::CleanCategory> {
    // Directory-size scans walk the filesystem; keep them off the main thread.
    tauri::async_runtime::spawn_blocking(cleaner::scan)
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub async fn clean_category(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || cleaner::clean(&id))
        .await
        .map_err(|e| e.to_string())?
}

// --- Uninstaller ---

#[tauri::command]
pub async fn list_packages() -> Result<Vec<uninstaller::PackageInfo>, String> {
    tauri::async_runtime::spawn_blocking(uninstaller::list)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn uninstall_package(package: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || uninstaller::uninstall(&package))
        .await
        .map_err(|e| e.to_string())?
}

// --- Docker ---

#[tauri::command]
pub async fn list_containers() -> Result<Vec<docker::ContainerInfo>, String> {
    tauri::async_runtime::spawn_blocking(docker::list)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn container_stats() -> Result<Vec<docker::ContainerStats>, String> {
    // docker stats --no-stream blocks ~1s sampling deltas.
    tauri::async_runtime::spawn_blocking(docker::stats)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn container_action(id: String, verb: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || docker::action(&id, &verb))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn container_logs(id: String, tail: u32) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || docker::logs(&id, tail))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn inspect_container(id: String) -> Result<docker::ContainerDetail, String> {
    tauri::async_runtime::spawn_blocking(move || docker::inspect(&id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn run_container(spec: docker::RunSpec) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || docker::run_container(&spec))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_images() -> Result<Vec<docker::ImageInfo>, String> {
    tauri::async_runtime::spawn_blocking(docker::images)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn image_remove(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || docker::image_remove(&id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn image_pull(reference: String) -> Result<(), String> {
    // Blocks for the whole download; UI shows a busy state.
    tauri::async_runtime::spawn_blocking(move || docker::image_pull(&reference))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_volumes() -> Result<Vec<docker::VolumeInfo>, String> {
    tauri::async_runtime::spawn_blocking(docker::volumes)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn volume_remove(name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || docker::volume_remove(&name))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_networks() -> Result<Vec<docker::NetworkInfo>, String> {
    tauri::async_runtime::spawn_blocking(docker::networks)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn network_remove(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || docker::network_remove(&id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_compose_projects() -> Result<Vec<docker::ComposeProject>, String> {
    tauri::async_runtime::spawn_blocking(docker::compose_projects)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn compose_action(
    name: String,
    config_files: Vec<String>,
    verb: String,
    build: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        docker::compose_action(&name, &config_files, &verb, build)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn compose_logs(name: String, tail: u32) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || docker::compose_logs(&name, tail))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn compose_up_file(
    app: tauri::AppHandle,
    file: String,
    build: bool,
) -> Result<(), String> {
    let data_dir = crate::commands_hosts::data_dir(&app);
    tauri::async_runtime::spawn_blocking(move || {
        docker::compose_up_file(&file, build)?;
        // Remember it so the project survives `down` and app restarts.
        docker_prefs::remember_compose_file(&data_dir, &file)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn compose_files_list(app: tauri::AppHandle) -> Vec<String> {
    docker_prefs::compose_files(&crate::commands_hosts::data_dir(&app))
}

#[tauri::command]
pub fn compose_file_forget(app: tauri::AppHandle, file: String) -> Result<(), String> {
    docker_prefs::forget_compose_file(&crate::commands_hosts::data_dir(&app), &file)
}

#[tauri::command]
pub async fn docker_disk_usage() -> Result<Vec<docker::DiskUsageRow>, String> {
    // system df walks image/layer sizes; slow on big daemons.
    tauri::async_runtime::spawn_blocking(docker::disk_usage)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn docker_prune(target: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || docker::prune(&target))
        .await
        .map_err(|e| e.to_string())?
}

// --- Docker shell (interactive exec) ---

#[tauri::command]
pub fn docker_shell_open(
    app: tauri::AppHandle,
    sessions: tauri::State<docker_shell::ShellSessions>,
    id: String,
    name: String,
    cols: u16,
    rows: u16,
) -> Result<u32, String> {
    let data_dir = crate::commands_hosts::data_dir(&app);
    docker_shell::open(app, &sessions, &id, &name, data_dir, cols, rows)
}

#[tauri::command]
pub fn docker_shell_history(app: tauri::AppHandle, container: String) -> Vec<String> {
    docker_prefs::shell_history(&crate::commands_hosts::data_dir(&app), &container)
}

#[tauri::command]
pub fn docker_shell_write(
    sessions: tauri::State<docker_shell::ShellSessions>,
    session: u32,
    data: Vec<u8>,
) -> Result<(), String> {
    docker_shell::write(&sessions, session, data)
}

#[tauri::command]
pub fn docker_shell_resize(
    sessions: tauri::State<docker_shell::ShellSessions>,
    session: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    docker_shell::resize(&sessions, session, cols, rows)
}

#[tauri::command]
pub fn docker_shell_close(sessions: tauri::State<docker_shell::ShellSessions>, session: u32) {
    docker_shell::close(&sessions, session)
}

// --- Hardware info ---

#[tauri::command]
pub async fn get_hardware_info() -> Vec<hardware::InfoSection> {
    // Spawns lscpu/lspci/lsusb and walks sysfs; keep it off the async pool.
    tauri::async_runtime::spawn_blocking(hardware::collect)
        .await
        .unwrap_or_default()
}

// --- SMART disk health ---

/// SMART report for one block device on a host. Remote hosts run smartctl
/// over a one-shot SSH session. `privileged` retries locally via pkexec.
#[tauri::command]
pub async fn smart_report(
    app: tauri::AppHandle,
    host_id: String,
    device: String,
    privileged: bool,
) -> Result<smart::SmartOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if host_id == "local" {
            smart::local(&device, privileged)
        } else {
            use tauri::Manager;
            let config = app
                .state::<crate::state::AppState>()
                .hosts
                .lock()
                .unwrap()
                .iter()
                .find(|h| h.id == host_id)
                .cloned()
                .ok_or("unknown host")?;
            let known_hosts = crate::commands_hosts::data_dir(&app).join("known_hosts");
            smart::remote(&config, &known_hosts, &device)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
