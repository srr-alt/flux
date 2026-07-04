use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

use super::run_privileged;

#[derive(Serialize, Clone)]
pub struct CleanCategory {
    pub id: String,
    pub label: String,
    pub description: String,
    pub size_bytes: u64,
    pub item_count: u64,
    pub needs_root: bool,
}

fn dir_size(path: &Path) -> (u64, u64) {
    let mut size = 0u64;
    let mut count = 0u64;
    let mut stack = vec![path.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() {
                stack.push(entry.path());
            } else {
                size += meta.len();
                count += 1;
            }
        }
    }
    (size, count)
}

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/root".into()))
}

pub fn scan() -> Vec<CleanCategory> {
    let mut categories = Vec::new();

    let (apt_size, apt_count) = dir_size(Path::new("/var/cache/apt/archives"));
    categories.push(CleanCategory {
        id: "apt-cache".into(),
        label: "Package cache".into(),
        description: "Downloaded .deb files kept by APT after installation".into(),
        size_bytes: apt_size,
        item_count: apt_count,
        needs_root: true,
    });

    let (crash_size, crash_count) = dir_size(Path::new("/var/crash"));
    categories.push(CleanCategory {
        id: "crash-reports".into(),
        label: "Crash reports".into(),
        description: "Apport crash dumps in /var/crash".into(),
        size_bytes: crash_size,
        item_count: crash_count,
        needs_root: true,
    });

    let journal_size = journal_size_bytes();
    categories.push(CleanCategory {
        id: "journal-logs".into(),
        label: "System journal".into(),
        description: "systemd journal logs (cleaned back to the last 2 weeks)".into(),
        size_bytes: journal_size,
        item_count: 0,
        needs_root: true,
    });

    let (trash_size, trash_count) = dir_size(&home().join(".local/share/Trash"));
    categories.push(CleanCategory {
        id: "trash".into(),
        label: "Trash".into(),
        description: "Files in your desktop trash".into(),
        size_bytes: trash_size,
        item_count: trash_count,
        needs_root: false,
    });

    let (thumb_size, thumb_count) = dir_size(&home().join(".cache/thumbnails"));
    categories.push(CleanCategory {
        id: "thumbnails".into(),
        label: "Thumbnail cache".into(),
        description: "Cached image/video thumbnails (regenerated on demand)".into(),
        size_bytes: thumb_size,
        item_count: thumb_count,
        needs_root: false,
    });

    categories
}

fn journal_size_bytes() -> u64 {
    let (size, _) = dir_size(Path::new("/var/log/journal"));
    if size > 0 {
        size
    } else {
        dir_size(Path::new("/run/log/journal")).0
    }
}

fn clear_dir_contents(path: &Path) -> Result<(), String> {
    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let p = entry.path();
        let result = if p.is_dir() {
            fs::remove_dir_all(&p)
        } else {
            fs::remove_file(&p)
        };
        result.map_err(|e| format!("{}: {e}", p.display()))?;
    }
    Ok(())
}

/// Clean one category. Root-owned categories go through a single pkexec
/// call; user-owned ones are plain filesystem operations.
pub fn clean(id: &str) -> Result<(), String> {
    match id {
        "apt-cache" => run_privileged("apt-get", &["clean"]).map(|_| ()),
        "crash-reports" => {
            run_privileged("sh", &["-c", "rm -rf /var/crash/* /var/crash/.[!.]*"]).map(|_| ())
        }
        "journal-logs" => {
            run_privileged("journalctl", &["--vacuum-time=2weeks"]).map(|_| ())
        }
        "trash" => {
            let trash = home().join(".local/share/Trash");
            for sub in ["files", "info"] {
                let dir = trash.join(sub);
                if dir.exists() {
                    clear_dir_contents(&dir)?;
                }
            }
            Ok(())
        }
        "thumbnails" => {
            let dir = home().join(".cache/thumbnails");
            if dir.exists() {
                clear_dir_contents(&dir)?;
            }
            Ok(())
        }
        other => Err(format!("Unknown category: {other}")),
    }
}
