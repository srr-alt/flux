use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::OnceLock;
use sysinfo::System;

#[derive(Serialize, Deserialize, Clone)]
pub struct CpuSnapshot {
    pub global_usage_pct: f32,
    pub per_core_usage_pct: Vec<f32>,
    pub per_core_freq_mhz: Vec<u64>,
    pub per_core_temp_c: Option<Vec<f32>>,
    pub load_avg_1: f64,
    pub load_avg_5: f64,
    pub load_avg_15: f64,
    pub frequency_mhz: Option<u64>,
    /// From /proc/loadavg 4th field: "running/total" scheduler entities.
    pub tasks_running: u64,
    pub tasks_total: u64,
}

pub fn snapshot(sys: &System) -> CpuSnapshot {
    let load = System::load_average();
    let cpus = sys.cpus();
    let (tasks_running, tasks_total) = read_task_counts();
    CpuSnapshot {
        global_usage_pct: sys.global_cpu_usage(),
        per_core_usage_pct: cpus.iter().map(|c| c.cpu_usage()).collect(),
        per_core_freq_mhz: cpus.iter().map(|c| c.frequency()).collect(),
        per_core_temp_c: read_core_temps(),
        load_avg_1: load.one,
        load_avg_5: load.five,
        load_avg_15: load.fifteen,
        frequency_mhz: cpus.first().map(|c| c.frequency()),
        tasks_running,
        tasks_total,
    }
}

fn read_task_counts() -> (u64, u64) {
    let raw = fs::read_to_string("/proc/loadavg").unwrap_or_default();
    let parsed = parse_loadavg(&raw);
    (parsed.tasks_running, parsed.tasks_total)
}

/// Parsed /proc/loadavg line.
#[derive(Default, Clone, Copy)]
pub struct LoadAvg {
    pub one: f64,
    pub five: f64,
    pub fifteen: f64,
    pub tasks_running: u64,
    pub tasks_total: u64,
}

pub fn parse_loadavg(raw: &str) -> LoadAvg {
    let mut fields = raw.split_whitespace();
    let mut load = LoadAvg::default();
    load.one = fields.next().and_then(|f| f.parse().ok()).unwrap_or(0.0);
    load.five = fields.next().and_then(|f| f.parse().ok()).unwrap_or(0.0);
    load.fifteen = fields.next().and_then(|f| f.parse().ok()).unwrap_or(0.0);
    if let Some((running, total)) = fields.next().and_then(|f| f.split_once('/')) {
        load.tasks_running = running.parse().unwrap_or(0);
        load.tasks_total = total.parse().unwrap_or(0);
    }
    load
}

/// One "cpu…" line of /proc/stat, reduced to what usage% needs.
#[derive(Clone, Copy, Default, PartialEq)]
pub struct CpuTicks {
    pub total: u64,
    pub idle: u64,
}

/// Parse /proc/stat "cpu"/"cpuN" lines. Index 0 is the aggregate line,
/// the rest are per-core in order. idle = idle + iowait.
pub fn parse_stat(raw: &str) -> Vec<CpuTicks> {
    raw.lines()
        .filter(|l| l.starts_with("cpu"))
        .map(|line| {
            let fields: Vec<u64> = line
                .split_whitespace()
                .skip(1)
                .map(|f| f.parse().unwrap_or(0))
                .collect();
            CpuTicks {
                total: fields.iter().sum(),
                idle: fields.get(3).copied().unwrap_or(0) + fields.get(4).copied().unwrap_or(0),
            }
        })
        .collect()
}

/// Usage% per entry between two parse_stat samples (same ordering).
pub fn usage_between(prev: &[CpuTicks], cur: &[CpuTicks]) -> Vec<f32> {
    cur.iter()
        .zip(prev)
        .map(|(c, p)| {
            let total = c.total.saturating_sub(p.total);
            let idle = c.idle.saturating_sub(p.idle);
            if total == 0 {
                0.0
            } else {
                (total - idle) as f32 / total as f32 * 100.0
            }
        })
        .collect()
}

/// Static CPU facts from lscpu, resolved once.
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct CpuDetails {
    pub architecture: Option<String>,
    pub vendor: Option<String>,
    pub virtualization: Option<String>,
    pub max_mhz: Option<String>,
    pub min_mhz: Option<String>,
    pub l1d_cache: Option<String>,
    pub l1i_cache: Option<String>,
    pub l2_cache: Option<String>,
    pub l3_cache: Option<String>,
    pub sockets: Option<String>,
    pub stepping: Option<String>,
}

pub fn details() -> &'static CpuDetails {
    static DETAILS: OnceLock<CpuDetails> = OnceLock::new();
    DETAILS.get_or_init(|| {
        let Ok(output) = Command::new("lscpu").output() else {
            return CpuDetails::default();
        };
        let text = String::from_utf8_lossy(&output.stdout).into_owned();
        let get = |key: &str| -> Option<String> {
            text.lines()
                .find(|l| l.split(':').next().map(str::trim) == Some(key))
                .and_then(|l| l.split_once(':'))
                .map(|(_, v)| v.trim().to_string())
        };
        CpuDetails {
            architecture: get("Architecture"),
            vendor: get("Vendor ID"),
            virtualization: get("Virtualization"),
            max_mhz: get("CPU max MHz"),
            min_mhz: get("CPU min MHz"),
            l1d_cache: get("L1d cache"),
            l1i_cache: get("L1i cache"),
            l2_cache: get("L2 cache"),
            l3_cache: get("L3 cache"),
            sockets: get("Socket(s)"),
            stepping: get("Stepping"),
        }
    })
}

/// hwmon directory for the CPU temperature sensor, detected once.
/// Numbering varies per machine/boot, so match on the driver name file.
fn cpu_hwmon_dir() -> Option<&'static PathBuf> {
    static DIR: OnceLock<Option<PathBuf>> = OnceLock::new();
    DIR.get_or_init(|| {
        const CPU_SENSORS: &[&str] = &["coretemp", "k10temp", "zenpower", "cpu_thermal"];
        let entries = fs::read_dir("/sys/class/hwmon").ok()?;
        for entry in entries.flatten() {
            let path = entry.path();
            let name = fs::read_to_string(path.join("name")).ok()?;
            if CPU_SENSORS.contains(&name.trim()) {
                return Some(path);
            }
        }
        None
    })
    .as_ref()
}

fn read_core_temps() -> Option<Vec<f32>> {
    let dir = cpu_hwmon_dir()?;
    let mut temps: Vec<(u32, f32)> = Vec::new();
    for entry in fs::read_dir(dir).ok()?.flatten() {
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();
        let Some(idx) = name
            .strip_prefix("temp")
            .and_then(|rest| rest.strip_suffix("_input"))
            .and_then(|n| n.parse::<u32>().ok())
        else {
            continue;
        };
        if let Ok(raw) = fs::read_to_string(entry.path()) {
            if let Ok(millideg) = raw.trim().parse::<f32>() {
                temps.push((idx, millideg / 1000.0));
            }
        }
    }
    if temps.is_empty() {
        return None;
    }
    temps.sort_by_key(|(idx, _)| *idx);
    Some(temps.into_iter().map(|(_, t)| t).collect())
}
