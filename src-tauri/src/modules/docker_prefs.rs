//! Persisted Docker page state: compose files the user has added (so they
//! survive `compose down` and app restarts) and per-container shell command
//! history. One JSON file in the app data dir, hosts.json-style atomic writes.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

const HISTORY_CAP: usize = 50;

/// Serializes read-modify-write cycles; the file is shared by compose
/// bookkeeping and every open shell session.
static LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct DockerPrefs {
    #[serde(default)]
    pub compose_files: Vec<String>,
    /// Container name -> commands, oldest first.
    #[serde(default)]
    pub shell_history: HashMap<String, Vec<String>>,
}

fn prefs_file(data_dir: &Path) -> PathBuf {
    data_dir.join("docker_prefs.json")
}

fn load(data_dir: &Path) -> DockerPrefs {
    let Ok(raw) = fs::read_to_string(prefs_file(data_dir)) else {
        return DockerPrefs::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn save(data_dir: &Path, prefs: &DockerPrefs) -> Result<(), String> {
    fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    let tmp = data_dir.join("docker_prefs.json.tmp");
    let json = serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?;
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, prefs_file(data_dir)).map_err(|e| e.to_string())
}

pub fn compose_files(data_dir: &Path) -> Vec<String> {
    let _g = LOCK.lock().unwrap();
    load(data_dir).compose_files
}

pub fn remember_compose_file(data_dir: &Path, file: &str) -> Result<(), String> {
    let _g = LOCK.lock().unwrap();
    let mut prefs = load(data_dir);
    if !prefs.compose_files.iter().any(|f| f == file) {
        prefs.compose_files.push(file.to_string());
        save(data_dir, &prefs)?;
    }
    Ok(())
}

pub fn forget_compose_file(data_dir: &Path, file: &str) -> Result<(), String> {
    let _g = LOCK.lock().unwrap();
    let mut prefs = load(data_dir);
    prefs.compose_files.retain(|f| f != file);
    save(data_dir, &prefs)
}

pub fn shell_history(data_dir: &Path, container: &str) -> Vec<String> {
    let _g = LOCK.lock().unwrap();
    load(data_dir)
        .shell_history
        .get(container)
        .cloned()
        .unwrap_or_default()
}

pub fn push_shell_history(data_dir: &Path, container: &str, commands: &[String]) {
    if commands.is_empty() {
        return;
    }
    let _g = LOCK.lock().unwrap();
    let mut prefs = load(data_dir);
    let hist = prefs.shell_history.entry(container.to_string()).or_default();
    for cmd in commands {
        if hist.last() != Some(cmd) {
            hist.push(cmd.clone());
        }
    }
    let len = hist.len();
    if len > HISTORY_CAP {
        hist.drain(..len - HISTORY_CAP);
    }
    // History is best-effort; never fail a shell write over it.
    let _ = save(data_dir, &prefs);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_caps() {
        let dir = std::env::temp_dir().join(format!("flux-prefs-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);

        remember_compose_file(&dir, "/a/compose.yml").unwrap();
        remember_compose_file(&dir, "/a/compose.yml").unwrap(); // dedupe
        remember_compose_file(&dir, "/b/compose.yml").unwrap();
        assert_eq!(compose_files(&dir), vec!["/a/compose.yml", "/b/compose.yml"]);
        forget_compose_file(&dir, "/a/compose.yml").unwrap();
        assert_eq!(compose_files(&dir), vec!["/b/compose.yml"]);

        let many: Vec<String> = (0..60).map(|i| format!("cmd {i}")).collect();
        push_shell_history(&dir, "box", &many);
        push_shell_history(&dir, "box", &["cmd 59".into()]); // consecutive dupe dropped
        let hist = shell_history(&dir, "box");
        assert_eq!(hist.len(), HISTORY_CAP);
        assert_eq!(hist.last().unwrap(), "cmd 59");
        assert_eq!(hist.first().unwrap(), "cmd 10");

        let _ = fs::remove_dir_all(&dir);
    }
}
