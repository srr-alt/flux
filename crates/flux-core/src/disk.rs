use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::time::Instant;
use sysinfo::Disks;

#[derive(Serialize, Deserialize, Clone)]
pub struct DiskMountSnapshot {
    pub mount_point: String,
    pub device: String,
    pub fs_type: String,
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub is_removable: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DiskIoSnapshot {
    pub device: String,
    pub read_bytes_per_sec: f64,
    pub write_bytes_per_sec: f64,
    pub read_iops: f64,
    pub write_iops: f64,
    /// Fraction of the interval the device spent doing I/O.
    pub util_pct: f64,
    pub model: Option<String>,
    pub size_bytes: u64,
    pub rotational: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DiskSnapshot {
    pub mounts: Vec<DiskMountSnapshot>,
    pub io: Vec<DiskIoSnapshot>,
}

pub fn mounts(disks: &Disks) -> Vec<DiskMountSnapshot> {
    disks
        .iter()
        .map(|d| DiskMountSnapshot {
            mount_point: d.mount_point().to_string_lossy().into_owned(),
            device: d.name().to_string_lossy().into_owned(),
            fs_type: d.file_system().to_string_lossy().into_owned(),
            total_bytes: d.total_space(),
            available_bytes: d.available_space(),
            is_removable: d.is_removable(),
        })
        .collect()
}

/// Raw counters from one /proc/diskstats line we track between ticks.
#[derive(Clone, Copy)]
pub struct IoCounters {
    pub reads_completed: u64,
    pub sectors_read: u64,
    pub writes_completed: u64,
    pub sectors_written: u64,
    pub io_ticks_ms: u64,
    pub at: Instant,
}

fn read_io_counters() -> HashMap<String, IoCounters> {
    let raw = fs::read_to_string("/proc/diskstats").unwrap_or_default();
    parse_diskstats(&raw, Instant::now(), |name| {
        Path::new("/sys/block").join(name).exists()
    })
}

/// Pure /proc/diskstats parser. `is_whole_disk` filters partitions/virtual
/// devices — locally that's a /sys/block lookup; the agentless collector
/// passes a set built from a remote `ls /sys/block`.
pub fn parse_diskstats(
    raw: &str,
    now: Instant,
    is_whole_disk: impl Fn(&str) -> bool,
) -> HashMap<String, IoCounters> {
    raw.lines()
        .filter_map(|line| {
            let fields: Vec<&str> = line.split_whitespace().collect();
            let name = *fields.get(2)?;
            if name.starts_with("loop") || name.starts_with("ram") {
                return None;
            }
            if !is_whole_disk(name) {
                return None;
            }
            Some((
                name.to_string(),
                IoCounters {
                    reads_completed: fields.get(3)?.parse().ok()?,
                    sectors_read: fields.get(5)?.parse().ok()?,
                    writes_completed: fields.get(7)?.parse().ok()?,
                    sectors_written: fields.get(9)?.parse().ok()?,
                    io_ticks_ms: fields.get(12)?.parse().ok()?,
                    at: now,
                },
            ))
        })
        .collect()
}

fn device_model(device: &str) -> Option<String> {
    fs::read_to_string(Path::new("/sys/block").join(device).join("device/model"))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn device_size_bytes(device: &str) -> u64 {
    fs::read_to_string(Path::new("/sys/block").join(device).join("size"))
        .ok()
        .and_then(|s| s.trim().parse::<u64>().ok())
        .map(|sectors| sectors * 512)
        .unwrap_or(0)
}

fn device_rotational(device: &str) -> bool {
    fs::read_to_string(Path::new("/sys/block").join(device).join("queue/rotational"))
        .map(|s| s.trim() == "1")
        .unwrap_or(false)
}

pub fn io_rates(prev: &mut HashMap<String, IoCounters>) -> Vec<DiskIoSnapshot> {
    let current = read_io_counters();
    let rates = rates_from(prev, &current, |device| {
        (
            device_model(device),
            device_size_bytes(device),
            device_rotational(device),
        )
    });
    *prev = current;
    rates
}

/// Rates between two counter samples. `meta` supplies (model, size,
/// rotational) — sysfs locally, remote command output for agentless.
pub fn rates_from(
    prev: &HashMap<String, IoCounters>,
    current: &HashMap<String, IoCounters>,
    meta: impl Fn(&str) -> (Option<String>, u64, bool),
) -> Vec<DiskIoSnapshot> {
    let mut rates = Vec::new();
    for (device, now) in current {
        if let Some(before) = prev.get(device) {
            let elapsed = now.at.duration_since(before.at).as_secs_f64().max(0.001);
            let (model, size_bytes, rotational) = meta(device);
            // diskstats sector counts are always in 512-byte units
            rates.push(DiskIoSnapshot {
                device: device.clone(),
                read_bytes_per_sec: now.sectors_read.saturating_sub(before.sectors_read) as f64
                    * 512.0
                    / elapsed,
                write_bytes_per_sec: now.sectors_written.saturating_sub(before.sectors_written)
                    as f64
                    * 512.0
                    / elapsed,
                read_iops: now.reads_completed.saturating_sub(before.reads_completed) as f64
                    / elapsed,
                write_iops: now.writes_completed.saturating_sub(before.writes_completed) as f64
                    / elapsed,
                util_pct: (now.io_ticks_ms.saturating_sub(before.io_ticks_ms) as f64
                    / (elapsed * 1000.0)
                    * 100.0)
                    .min(100.0),
                model,
                size_bytes,
                rotational,
            });
        }
    }
    rates.sort_by(|a, b| a.device.cmp(&b.device));
    rates
}

/// Parse `df -kPT` output (POSIX format + Type column) into mount snapshots.
pub fn parse_df(raw: &str) -> Vec<DiskMountSnapshot> {
    raw.lines()
        .skip(1)
        .filter_map(|line| {
            let fields: Vec<&str> = line.split_whitespace().collect();
            // Filesystem Type 1024-blocks Used Available Capacity Mounted-on
            if fields.len() < 7 {
                return None;
            }
            let total_kb: u64 = fields[2].parse().ok()?;
            let avail_kb: u64 = fields[4].parse().ok()?;
            Some(DiskMountSnapshot {
                device: fields[0].to_string(),
                fs_type: fields[1].to_string(),
                total_bytes: total_kb * 1024,
                available_bytes: avail_kb * 1024,
                // df has no removable notion; irrelevant for remote hosts
                is_removable: false,
                mount_point: fields[6..].join(" "),
            })
        })
        .collect()
}
