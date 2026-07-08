use crate::modules::{cleaner, docker, hardware, services, startup, uninstaller};

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

// --- Hardware info ---

#[tauri::command]
pub async fn get_hardware_info() -> Vec<hardware::InfoSection> {
    // Spawns lscpu/lspci/lsusb and walks sysfs; keep it off the async pool.
    tauri::async_runtime::spawn_blocking(hardware::collect)
        .await
        .unwrap_or_default()
}
