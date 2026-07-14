//! System tray: a colored dot summarizing fleet health at a glance.
//!
//! green = all healthy, amber = a host is degraded/errored, red = an alert
//! rule is firing. The menu lists one status line per host plus Open/Quit.
//! Icons are drawn in code (anti-aliased filled circle) so no image assets
//! are needed and the dot can be retinted freely.
//!
//! `refresh` recomputes color + menu from AppState's host status cache and
//! the alert engine; it is safe to call from any thread (hops to the main
//! thread, as required by the tray APIs on some platforms).

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};

use crate::remote::HostStatus;

const TRAY_ID: &str = "flux-tray";

#[derive(Clone, Copy, PartialEq)]
enum Severity {
    Green,
    Amber,
    Red,
}

impl Severity {
    fn rgb(self) -> [u8; 3] {
        match self {
            Severity::Green => [0x34, 0xd3, 0x99],
            Severity::Amber => [0xfb, 0xbf, 0x24],
            Severity::Red => [0xf8, 0x71, 0x71],
        }
    }
}

/// 32×32 RGBA filled circle, edge-antialiased by alpha ramp.
fn dot(severity: Severity) -> Image<'static> {
    const SIZE: u32 = 32;
    let [r, g, b] = severity.rgb();
    let center = (SIZE - 1) as f64 / 2.0;
    let radius = SIZE as f64 / 2.0 - 2.0;
    let mut rgba = Vec::with_capacity((SIZE * SIZE * 4) as usize);
    for y in 0..SIZE {
        for x in 0..SIZE {
            let d = ((x as f64 - center).powi(2) + (y as f64 - center).powi(2)).sqrt();
            // 1px soft edge.
            let alpha = ((radius - d + 0.5).clamp(0.0, 1.0) * 255.0) as u8;
            rgba.extend_from_slice(&[r, g, b, alpha]);
        }
    }
    Image::new_owned(rgba, SIZE, SIZE)
}

pub fn init(app: &tauri::App) -> tauri::Result<()> {
    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(dot(Severity::Green))
        .tooltip("Flux")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    // Initial menu (no hosts connected yet, no alerts).
    let _ = tray.set_menu(Some(build_menu(app.handle())?));
    Ok(())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Retint the dot and rebuild the menu. Call on host status transitions and
/// alert fire/resolve.
pub fn refresh(app: &AppHandle) {
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        let Some(tray) = app.tray_by_id(TRAY_ID) else {
            return;
        };
        let (severity, tooltip) = current_severity(&app);
        let _ = tray.set_icon(Some(dot(severity)));
        let _ = tray.set_tooltip(Some(&tooltip));
        if let Ok(menu) = build_menu(&app) {
            let _ = tray.set_menu(Some(menu));
        }
    });
}

fn current_severity(app: &AppHandle) -> (Severity, String) {
    let firing = app.state::<crate::alerts::AlertsState>().0.firing_count();
    if firing > 0 {
        let s = if firing == 1 { "" } else { "s" };
        return (Severity::Red, format!("Flux — {firing} alert{s} firing"));
    }
    let unhealthy = {
        let state = app.state::<crate::state::AppState>();
        let cache = state.host_status_cache.lock().unwrap();
        cache
            .values()
            .filter(|e| {
                matches!(
                    e.status,
                    HostStatus::Degraded | HostStatus::Error { .. }
                )
            })
            .count()
    };
    if unhealthy > 0 {
        let s = if unhealthy == 1 { "" } else { "s" };
        (
            Severity::Amber,
            format!("Flux — {unhealthy} host{s} unreachable"),
        )
    } else {
        (Severity::Green, "Flux — all healthy".into())
    }
}

fn status_line(status: &HostStatus) -> &'static str {
    match status {
        HostStatus::Connecting => "connecting…",
        HostStatus::Connected { .. } => "connected",
        HostStatus::Degraded => "degraded",
        HostStatus::Disconnected => "disconnected",
        HostStatus::Error { .. } => "unreachable",
    }
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    let (_, header) = current_severity(app);
    menu.append(&MenuItem::with_id(app, "header", &header, false, None::<&str>)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;

    // One line per configured host: "name — status". Disabled items; the
    // tray is a glance surface, per-host actions live in the app.
    let lines: Vec<String> = {
        let state = app.state::<crate::state::AppState>();
        let hosts = state.hosts.lock().unwrap();
        let cache = state.host_status_cache.lock().unwrap();
        hosts
            .iter()
            .map(|h| {
                let status = cache
                    .get(&h.id)
                    .map(|e| status_line(&e.status))
                    .unwrap_or("idle");
                format!("{} — {status}", h.name)
            })
            .collect()
    };
    if !lines.is_empty() {
        for (i, line) in lines.iter().enumerate() {
            menu.append(&MenuItem::with_id(
                app,
                format!("host-{i}"),
                line,
                false,
                None::<&str>,
            )?)?;
        }
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }

    menu.append(&MenuItem::with_id(app, "open", "Open Flux", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?)?;
    Ok(menu)
}
