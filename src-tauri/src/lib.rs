pub mod alerts;
mod api_server;
mod commands_alerts;
pub mod commands_hosts;
mod commands_modules;
mod commands_monitor;
pub mod history;
mod commands_process;
mod commands_settings;
mod commands_terminal;
mod modules;
mod monitor;
pub mod remote;
pub mod state;
pub mod terminal;
pub mod tray;

use std::io::Write;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::{Emitter, Manager};

use crate::monitor::TickSnapshot;
use crate::state::AppState;
pub const EVENT_TICK: &str = "monitor://tick";
pub const EVENT_DISKS: &str = "monitor://disks";
pub const EVENT_GPU: &str = "monitor://gpu";
pub const EVENT_SENSORS: &str = "monitor://sensors";

/// WebKitGTK's DMA-BUF renderer crashes the WebKit process on the nouveau
/// driver (nouveau_pushbuf_data assertion). Fall back to software
/// compositing when nouveau is driving a GPU. Must run before the webview
/// is created; respects an explicit user override.
fn apply_nouveau_workaround() {
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_some() {
        return;
    }
    let nouveau_present = std::fs::read_dir("/sys/class/drm")
        .map(|entries| {
            entries.flatten().any(|e| {
                std::fs::read_link(e.path().join("device/driver"))
                    .map(|target| target.ends_with("nouveau"))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false);
    if nouveau_present {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    apply_nouveau_workaround();
    let builder = tauri::Builder::default();
    // Single-instance breaks the dev loop: `tauri dev` relaunches the app
    // after each backend rebuild, and the plugin makes the fresh (new) build
    // exit in favor of the stale running one. Release builds only.
    #[cfg(not(debug_assertions))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_focus();
        }
    }));
    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AppState::new())
        .manage(modules::docker_shell::ShellSessions::default())
        .manage(terminal::TerminalSessions::default())
        .invoke_handler(tauri::generate_handler![
            commands_monitor::get_system_info,
            commands_monitor::get_initial_snapshot,
            commands_monitor::get_cpu_details,
            commands_monitor::get_gpu_processes,
            commands_monitor::history_query,
            commands_monitor::gpu_history_query,
            commands_process::list_processes,
            commands_process::kill_process,
            commands_process::renice_process,
            commands_process::get_process_detail,
            commands_modules::list_services,
            commands_modules::service_action,
            commands_modules::list_startup_apps,
            commands_modules::set_startup_enabled,
            commands_modules::add_startup_app,
            commands_modules::remove_startup_app,
            commands_modules::scan_cleanable,
            commands_modules::clean_category,
            commands_modules::list_packages,
            commands_modules::uninstall_package,
            commands_modules::get_hardware_info,
            commands_modules::smart_report,
            commands_modules::list_containers,
            commands_modules::container_stats,
            commands_modules::container_action,
            commands_modules::container_logs,
            commands_modules::inspect_container,
            commands_modules::run_container,
            commands_modules::list_images,
            commands_modules::image_remove,
            commands_modules::image_pull,
            commands_modules::list_volumes,
            commands_modules::volume_remove,
            commands_modules::list_networks,
            commands_modules::network_remove,
            commands_modules::list_compose_projects,
            commands_modules::compose_action,
            commands_modules::compose_up_file,
            commands_modules::compose_logs,
            commands_modules::compose_files_list,
            commands_modules::compose_file_forget,
            commands_modules::docker_shell_history,
            commands_modules::docker_disk_usage,
            commands_modules::docker_prune,
            commands_modules::docker_shell_open,
            commands_modules::docker_shell_write,
            commands_modules::docker_shell_resize,
            commands_modules::docker_shell_close,
            commands_terminal::terminal_open,
            commands_terminal::terminal_write,
            commands_terminal::terminal_resize,
            commands_terminal::terminal_close,
            commands_terminal::terminal_history,
            commands_alerts::alerts_list_rules,
            commands_alerts::alerts_save_rule,
            commands_alerts::alerts_delete_rule,
            commands_alerts::alerts_active,
            commands_alerts::alerts_events,
            commands_alerts::alerts_test_notification,
            commands_settings::set_refresh_interval,
            commands_settings::start_usage_log,
            commands_settings::stop_usage_log,
            commands_settings::get_usage_log_status,
            commands_hosts::list_hosts,
            commands_hosts::get_host_statuses,
            commands_hosts::test_host_connection,
            commands_hosts::add_host,
            commands_hosts::connect_host,
            commands_hosts::disconnect_host,
            commands_hosts::remove_host,
            commands_hosts::list_remote_processes,
            commands_hosts::kill_remote_process,
            commands_hosts::deploy_agent,
            commands_hosts::install_flux_deb,
            commands_hosts::forget_host_key,
            commands_hosts::wake_host,
            commands_hosts::host_power,
        ])
        .setup(|app| {
            // History recorder: best-effort, app runs fine without it.
            let data_dir = app.path().app_data_dir().expect("app data dir");
            let _ = std::fs::create_dir_all(&data_dir);
            let history_handle = history::spawn(&data_dir);
            let db_path = history_handle.as_ref().map(|h| h.db_path.clone());
            app.manage(history::HistoryState(history_handle));
            app.manage(alerts::AlertsState(std::sync::Arc::new(alerts::Engine::new(
                app.handle().clone(),
                &data_dir,
                db_path,
            ))));
            tray::init(app)?;
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(monitor_loop(handle));
            commands_hosts::autoconnect_saved_hosts(app.handle());
            api_server::start(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

async fn monitor_loop(app: tauri::AppHandle) {
    let mut last_tick = Instant::now();
    let mut tick_count: u64 = 0;

    loop {
        // Re-read the interval every iteration so the Settings page can
        // change the refresh rate without restarting the loop.
        let interval_ms = app
            .state::<AppState>()
            .tick_interval_ms
            .load(Ordering::Relaxed);
        tokio::time::sleep(Duration::from_millis(interval_ms)).await;
        let elapsed = last_tick.elapsed().as_secs_f64();
        last_tick = Instant::now();
        tick_count += 1;

        // Skip collection entirely while minimized — a system monitor
        // shouldn't burn CPU when nobody is looking at it. The usage
        // logger still records (logging while away is its whole point),
        // and enabled alert rules keep collection alive too: firing at
        // 3pm-while-minimized is the whole point of alerts.
        let minimized = app
            .get_webview_window("main")
            .map(|w| w.is_minimized().unwrap_or(false))
            .unwrap_or(false);
        let logging = app
            .state::<AppState>()
            .usage_log
            .lock()
            .unwrap()
            .is_some();
        let alerting = app.state::<alerts::AlertsState>().0.has_enabled_rules();
        if minimized && !logging && !alerting {
            continue;
        }

        let state = app.state::<AppState>();
        let snapshot = collect_tick(&state, elapsed);
        *state.last_snapshot.lock().unwrap() = Some(snapshot.clone());
        write_log_row(&state, &snapshot);
        let sample = history::Sample::from_tick("local", &snapshot);
        app.state::<alerts::AlertsState>().0.observe(&sample);
        if let Some(history) = &app.state::<history::HistoryState>().0 {
            history.record(sample);
        }
        if !minimized {
            let _ = app.emit(EVENT_TICK, &snapshot);
        }

        // Disk usage changes slowly; refresh at half cadence.
        if tick_count % 2 == 0 {
            let disk_snapshot = {
                let mut disks = state.disks.lock().unwrap();
                disks.refresh(true);
                let mut prev_io = state.prev_disk_io.lock().unwrap();
                monitor::disk::DiskSnapshot {
                    mounts: monitor::disk::mounts(&disks),
                    io: monitor::disk::io_rates(&mut prev_io),
                }
            };
            let _ = app.emit(EVENT_DISKS, &disk_snapshot);

            // Sensors share the slow cadence too — pure sysfs reads, cheap.
            let _ = app.emit(EVENT_SENSORS, &monitor::sensors::snapshot());

            // GPU shares the slow cadence; nvidia-smi is a process spawn,
            // so keep it off the blocking tick path.
            let gpu_app = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let gpus = monitor::gpu::snapshot();
                // GPU rides this half-cadence path, so history samples it here
                // rather than from the CPU/mem tick. Local only — remote hosts
                // don't collect GPU agentlessly.
                if let Some(history) = &gpu_app.state::<history::HistoryState>().0 {
                    let ts = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    for (i, g) in gpus.iter().enumerate() {
                        history.record_gpu(history::GpuSample {
                            host_id: "local".into(),
                            gpu_index: i as u32,
                            ts,
                            util_pct: g.utilization_pct.map(|v| v as f64),
                            temp_c: g.temp_c.map(|v| v as f64),
                            mem_used_mb: g.mem_used_mb,
                            mem_total_mb: g.mem_total_mb,
                        });
                    }
                }
                *gpu_app.state::<AppState>().last_gpus.lock().unwrap() = gpus.clone();
                let _ = gpu_app.emit(EVENT_GPU, &gpus);
            });
        }
    }
}

/// Append one CSV row to the active usage log, if any. GPU columns come
/// from the half-cadence cache; network columns sum all interfaces.
fn write_log_row(state: &AppState, snapshot: &TickSnapshot) {
    let mut log = state.usage_log.lock().unwrap();
    let Some(log) = log.as_mut() else {
        return;
    };
    let mem = &snapshot.memory;
    let mem_pct = if mem.total_kb > 0 {
        (mem.total_kb - mem.available_kb) as f64 / mem.total_kb as f64 * 100.0
    } else {
        0.0
    };
    let (rx, tx) = snapshot
        .network
        .iter()
        .fold((0.0, 0.0), |(rx, tx), iface| {
            (rx + iface.rx_bytes_per_sec, tx + iface.tx_bytes_per_sec)
        });
    let opt =
        |v: Option<String>| v.unwrap_or_default();
    let (gpu_util, gpu_temp, gpu_mem) = {
        let gpus = state.last_gpus.lock().unwrap();
        match gpus.first() {
            Some(g) => (
                opt(g.utilization_pct.map(|v| format!("{v:.0}"))),
                opt(g.temp_c.map(|v| format!("{v:.0}"))),
                opt(g.mem_used_mb.map(|v| v.to_string())),
            ),
            None => (String::new(), String::new(), String::new()),
        }
    };
    let local_time = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    let row = format!(
        "{},{},{:.1},{:.1},{},{},{},{:.0},{:.0}\n",
        snapshot.timestamp_ms,
        local_time,
        snapshot.cpu.global_usage_pct,
        mem_pct,
        gpu_util,
        gpu_temp,
        gpu_mem,
        rx,
        tx
    );
    if log.writer.write_all(row.as_bytes()).is_ok() {
        log.rows += 1;
        // Flush per row (1/s) so the file is always tail-able.
        let _ = log.writer.flush();
    }
}

fn collect_tick(state: &AppState, elapsed_secs: f64) -> TickSnapshot {
    let cpu = {
        let mut sys = state.sys.lock().unwrap();
        sys.refresh_cpu_specifics(
            sysinfo::CpuRefreshKind::nothing()
                .with_cpu_usage()
                .with_frequency(),
        );
        monitor::cpu::snapshot(&sys)
    };
    let network = {
        let mut networks = state.networks.lock().unwrap();
        networks.refresh(true);
        monitor::network::snapshot(&networks, elapsed_secs)
    };
    TickSnapshot {
        timestamp_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
        cpu,
        memory: monitor::memory::snapshot(),
        network,
    }
}
