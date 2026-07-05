//! Hardware sensors via /sys/class/hwmon: temperatures, fans, voltages.
//!
//! Enumerates every hwmon chip on each call — reads are a handful of tiny
//! sysfs files, and rescanning handles hotplug (USB sensors) for free.
//! cpu.rs and gpu.rs keep their own purpose-specific hwmon lookups; folding
//! them onto this module is a later cleanup.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct TempReading {
    pub label: String,
    pub c: f32,
    pub max_c: Option<f32>,
    pub crit_c: Option<f32>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct FanReading {
    pub label: String,
    pub rpm: u32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct VoltageReading {
    pub label: String,
    pub volts: f32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct HwmonChip {
    /// Directory name ("hwmon3") — stable within a boot; history series key.
    pub id: String,
    /// Driver name from the `name` file, e.g. "coretemp", "nvme".
    pub name: String,
    pub temps: Vec<TempReading>,
    pub fans: Vec<FanReading>,
    pub voltages: Vec<VoltageReading>,
}

pub fn snapshot() -> Vec<HwmonChip> {
    let Ok(entries) = fs::read_dir("/sys/class/hwmon") else {
        return Vec::new();
    };
    let mut chips: Vec<HwmonChip> = entries
        .flatten()
        .filter_map(|entry| read_chip(&entry.path()))
        .collect();
    chips.sort_by(|a, b| hwmon_index(&a.id).cmp(&hwmon_index(&b.id)));
    chips
}

fn hwmon_index(id: &str) -> u32 {
    id.strip_prefix("hwmon")
        .and_then(|n| n.parse().ok())
        .unwrap_or(u32::MAX)
}

fn read_chip(dir: &Path) -> Option<HwmonChip> {
    let id = dir.file_name()?.to_string_lossy().into_owned();
    let name = fs::read_to_string(dir.join("name")).ok()?.trim().to_string();

    let mut temps: Vec<(u32, TempReading)> = Vec::new();
    let mut fans: Vec<(u32, FanReading)> = Vec::new();
    let mut voltages: Vec<(u32, VoltageReading)> = Vec::new();

    for entry in fs::read_dir(dir).ok()?.flatten() {
        let file_name = entry.file_name();
        let file = file_name.to_string_lossy();
        if let Some(idx) = channel_index(&file, "temp") {
            if let Some(c) = read_scaled(dir, &format!("temp{idx}_input"), 1000.0) {
                temps.push((
                    idx,
                    TempReading {
                        label: channel_label(dir, "temp", idx),
                        c,
                        max_c: read_scaled(dir, &format!("temp{idx}_max"), 1000.0),
                        crit_c: read_scaled(dir, &format!("temp{idx}_crit"), 1000.0),
                    },
                ));
            }
        } else if let Some(idx) = channel_index(&file, "fan") {
            if let Some(rpm) = read_scaled(dir, &format!("fan{idx}_input"), 1.0) {
                fans.push((
                    idx,
                    FanReading {
                        label: channel_label(dir, "fan", idx),
                        rpm: rpm as u32,
                    },
                ));
            }
        } else if let Some(idx) = channel_index(&file, "in") {
            if let Some(volts) = read_scaled(dir, &format!("in{idx}_input"), 1000.0) {
                voltages.push((
                    idx,
                    VoltageReading {
                        label: channel_label(dir, "in", idx),
                        volts,
                    },
                ));
            }
        }
    }

    if temps.is_empty() && fans.is_empty() && voltages.is_empty() {
        return None;
    }
    temps.sort_by_key(|(idx, _)| *idx);
    fans.sort_by_key(|(idx, _)| *idx);
    voltages.sort_by_key(|(idx, _)| *idx);
    Some(HwmonChip {
        id,
        name,
        temps: temps.into_iter().map(|(_, t)| t).collect(),
        fans: fans.into_iter().map(|(_, f)| f).collect(),
        voltages: voltages.into_iter().map(|(_, v)| v).collect(),
    })
}

/// "temp3_input" with prefix "temp" -> Some(3); anything else -> None.
fn channel_index(file: &str, prefix: &str) -> Option<u32> {
    file.strip_prefix(prefix)?
        .strip_suffix("_input")?
        .parse()
        .ok()
}

fn channel_label(dir: &Path, prefix: &str, idx: u32) -> String {
    fs::read_to_string(dir.join(format!("{prefix}{idx}_label")))
        .map(|s| s.trim().to_string())
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| format!("{prefix}{idx}"))
}

fn read_scaled(dir: &Path, file: &str, divisor: f32) -> Option<f32> {
    let raw = fs::read_to_string(dir.join(file)).ok()?;
    let value: f32 = raw.trim().parse().ok()?;
    Some(value / divisor)
}
