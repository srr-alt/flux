use serde::Serialize;
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Clone)]
pub struct StartupApp {
    pub file_name: String,
    pub name: String,
    pub exec: String,
    pub comment: String,
    pub enabled: bool,
    /// True when the entry comes from /etc/xdg/autostart (needs a user
    /// override to toggle, cannot be deleted).
    pub is_system: bool,
}

fn user_autostart_dir() -> PathBuf {
    dirs_home().join(".config/autostart")
}

fn dirs_home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/root".into()))
}

fn desktop_field(content: &str, key: &str) -> Option<String> {
    // Only read from the [Desktop Entry] section, stop at the next section.
    let mut in_section = false;
    for line in content.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_section = line == "[Desktop Entry]";
            continue;
        }
        if !in_section {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            if k.trim() == key {
                return Some(v.trim().to_string());
            }
        }
    }
    None
}

fn parse_entry(path: &PathBuf, is_system: bool) -> Option<StartupApp> {
    let content = fs::read_to_string(path).ok()?;
    let hidden = desktop_field(&content, "Hidden").as_deref() == Some("true");
    let gnome_disabled =
        desktop_field(&content, "X-GNOME-Autostart-enabled").as_deref() == Some("false");
    Some(StartupApp {
        file_name: path.file_name()?.to_string_lossy().into_owned(),
        name: desktop_field(&content, "Name").unwrap_or_else(|| {
            path.file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default()
        }),
        exec: desktop_field(&content, "Exec").unwrap_or_default(),
        comment: desktop_field(&content, "Comment").unwrap_or_default(),
        enabled: !hidden && !gnome_disabled,
        is_system,
    })
}

pub fn list() -> Vec<StartupApp> {
    let mut apps: Vec<StartupApp> = Vec::new();
    let user_dir = user_autostart_dir();
    let mut user_files: Vec<String> = Vec::new();

    if let Ok(entries) = fs::read_dir(&user_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("desktop") {
                if let Some(app) = parse_entry(&path, false) {
                    user_files.push(app.file_name.clone());
                    apps.push(app);
                }
            }
        }
    }
    // System-wide entries, unless shadowed by a user file of the same name.
    if let Ok(entries) = fs::read_dir("/etc/xdg/autostart") {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("desktop") {
                if let Some(app) = parse_entry(&path, true) {
                    if !user_files.contains(&app.file_name) {
                        apps.push(app);
                    }
                }
            }
        }
    }
    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    apps
}

/// Toggling a system entry copies it into the user dir first (the standard
/// XDG override mechanism); user entries are edited in place.
pub fn set_enabled(file_name: &str, enabled: bool) -> Result<(), String> {
    if file_name.contains('/') || file_name.contains("..") {
        return Err("Invalid file name.".into());
    }
    let user_path = user_autostart_dir().join(file_name);
    let content = if user_path.exists() {
        fs::read_to_string(&user_path).map_err(|e| e.to_string())?
    } else {
        let system_path = PathBuf::from("/etc/xdg/autostart").join(file_name);
        fs::read_to_string(&system_path).map_err(|e| e.to_string())?
    };

    let flag = format!(
        "X-GNOME-Autostart-enabled={}",
        if enabled { "true" } else { "false" }
    );
    let mut lines: Vec<String> = content
        .lines()
        .filter(|line| {
            !line.starts_with("X-GNOME-Autostart-enabled=") && !line.starts_with("Hidden=")
        })
        .map(String::from)
        .collect();
    if let Some(idx) = lines.iter().position(|l| l.trim() == "[Desktop Entry]") {
        lines.insert(idx + 1, flag);
    } else {
        lines.push(flag);
    }

    fs::create_dir_all(user_autostart_dir()).map_err(|e| e.to_string())?;
    fs::write(&user_path, lines.join("\n") + "\n").map_err(|e| e.to_string())
}

pub fn add(name: &str, exec: &str) -> Result<(), String> {
    if name.trim().is_empty() || exec.trim().is_empty() {
        return Err("Name and command are required.".into());
    }
    let file_name = format!(
        "{}.desktop",
        name.to_lowercase()
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
            .collect::<String>()
    );
    let path = user_autostart_dir().join(&file_name);
    if path.exists() {
        return Err("A startup entry with this name already exists.".into());
    }
    let content = format!(
        "[Desktop Entry]\nType=Application\nName={name}\nExec={exec}\nX-GNOME-Autostart-enabled=true\n"
    );
    fs::create_dir_all(user_autostart_dir()).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

pub fn remove(file_name: &str) -> Result<(), String> {
    if file_name.contains('/') || file_name.contains("..") {
        return Err("Invalid file name.".into());
    }
    let path = user_autostart_dir().join(file_name);
    if !path.exists() {
        return Err("Only user startup entries can be deleted; system entries can be disabled.".into());
    }
    fs::remove_file(&path).map_err(|e| e.to_string())
}
