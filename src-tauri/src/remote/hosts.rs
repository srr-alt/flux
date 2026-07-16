use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::HostId;

#[derive(Serialize, Deserialize, Clone)]
pub struct HostConfig {
    pub id: HostId,
    pub name: String,
    pub address: String,
    pub port: u16,
    pub username: String,
    /// Private key used for auth; the shared app key by default.
    pub key_path: PathBuf,
    /// Primary interface MAC, auto-captured on first connect; enables
    /// Wake-on-LAN while the host is offline.
    #[serde(default)]
    pub mac: Option<String>,
}

pub fn hosts_file(data_dir: &Path) -> PathBuf {
    data_dir.join("hosts.json")
}

pub fn load(data_dir: &Path) -> Vec<HostConfig> {
    let Ok(raw) = fs::read_to_string(hosts_file(data_dir)) else {
        return Vec::new();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

pub fn save(data_dir: &Path, hosts: &[HostConfig]) -> Result<(), String> {
    fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    let tmp = data_dir.join("hosts.json.tmp");
    let json = serde_json::to_string_pretty(hosts).map_err(|e| e.to_string())?;
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, hosts_file(data_dir)).map_err(|e| e.to_string())
}
