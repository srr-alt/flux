use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use sysinfo::System;

#[derive(Serialize, Clone)]
pub struct ProcessInfo {
    pub pid: u32,
    pub ppid: u32,
    pub name: String,
    pub cmd: String,
    pub user: String,
    pub cpu_pct: f32,
    pub mem_bytes: u64,
    pub status: String,
    pub run_time_secs: u64,
    pub nice: i32,
    /// Read/write rates from /proc/[pid]/io deltas. Zero for other users'
    /// processes (the kernel hides their io file from non-root).
    pub disk_read_bytes_per_sec: f64,
    pub disk_write_bytes_per_sec: f64,
}

#[derive(Deserialize)]
pub struct ProcessQuery {
    pub sort_by: String,
    pub sort_desc: bool,
    pub search: Option<String>,
    pub limit: Option<usize>,
}

pub fn uid_table() -> HashMap<u32, String> {
    let Ok(raw) = fs::read_to_string("/etc/passwd") else {
        return HashMap::new();
    };
    raw.lines()
        .filter_map(|line| {
            let mut parts = line.split(':');
            let name = parts.next()?;
            let _passwd = parts.next()?;
            let uid: u32 = parts.next()?.parse().ok()?;
            Some((uid, name.to_string()))
        })
        .collect()
}

/// Private resident memory (RSS minus file-backed shared pages) from
/// /proc/[pid]/statm. Summing plain RSS across a process group counts every
/// shared library once per member and can exceed physical RAM; private
/// memory is what Task Manager's memory column shows.
fn private_mem_bytes(pid: u32, page_size: u64) -> Option<u64> {
    let statm = fs::read_to_string(format!("/proc/{pid}/statm")).ok()?;
    let mut fields = statm.split_whitespace();
    let resident: u64 = fields.nth(1)?.parse().ok()?;
    let shared: u64 = fields.next()?.parse().ok()?;
    Some(resident.saturating_sub(shared) * page_size)
}

fn nice_of(pid: u32) -> i32 {
    // -1 is both a valid nice value and getpriority's error return,
    // so errno must be cleared before and checked after the call.
    unsafe {
        *libc::__errno_location() = 0;
        let value = libc::getpriority(libc::PRIO_PROCESS, pid);
        if *libc::__errno_location() != 0 {
            0
        } else {
            value
        }
    }
}

pub fn list(
    sys: &System,
    uids: &HashMap<u32, String>,
    query: &ProcessQuery,
    elapsed_secs: f64,
) -> Vec<ProcessInfo> {
    let search = query.search.as_deref().unwrap_or("").to_lowercase();
    // First poll has no baseline for the io-counter deltas.
    let rate_divisor = if elapsed_secs > 0.1 { elapsed_secs } else { f64::INFINITY };
    // sysinfo reports per-core scale (one busy thread per core = 100 each);
    // normalize so 100% = the whole machine, like Task Manager.
    let n_cpus = sys.cpus().len().max(1) as f32;
    let page_size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) }.max(4096) as u64;
    let mut processes: Vec<ProcessInfo> = sys
        .processes()
        .iter()
        .filter_map(|(pid, p)| {
            // Defensive: skip thread entries even if a caller refreshed
            // with tasks enabled.
            if p.thread_kind().is_some() {
                return None;
            }
            let name = p.name().to_string_lossy().into_owned();
            let cmd = p
                .cmd()
                .iter()
                .map(|part| part.to_string_lossy())
                .collect::<Vec<_>>()
                .join(" ");
            if !search.is_empty()
                && !name.to_lowercase().contains(&search)
                && !cmd.to_lowercase().contains(&search)
            {
                return None;
            }
            let uid: Option<u32> = p.user_id().map(|u| **u);
            let io = p.disk_usage();
            Some(ProcessInfo {
                disk_read_bytes_per_sec: io.read_bytes as f64 / rate_divisor,
                disk_write_bytes_per_sec: io.written_bytes as f64 / rate_divisor,
                pid: pid.as_u32(),
                ppid: p.parent().map(|pp| pp.as_u32()).unwrap_or(0),
                user: uid
                    .and_then(|u| uids.get(&u).cloned())
                    .unwrap_or_else(|| uid.map(|u| u.to_string()).unwrap_or_default()),
                cpu_pct: p.cpu_usage() / n_cpus,
                mem_bytes: private_mem_bytes(pid.as_u32(), page_size).unwrap_or_else(|| p.memory()),
                status: p.status().to_string(),
                run_time_secs: p.run_time(),
                nice: nice_of(pid.as_u32()),
                name,
                cmd,
            })
        })
        .collect();

    match query.sort_by.as_str() {
        "disk" => processes.sort_by(|a, b| {
            (a.disk_read_bytes_per_sec + a.disk_write_bytes_per_sec)
                .total_cmp(&(b.disk_read_bytes_per_sec + b.disk_write_bytes_per_sec))
        }),
        "mem" => processes.sort_by_key(|p| p.mem_bytes),
        "pid" => processes.sort_by_key(|p| p.pid),
        "name" => processes.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase())),
        "user" => processes.sort_by(|a, b| a.user.cmp(&b.user)),
        // cpu (default)
        _ => processes.sort_by(|a, b| a.cpu_pct.total_cmp(&b.cpu_pct)),
    }
    if query.sort_desc {
        processes.reverse();
    }
    if let Some(limit) = query.limit {
        processes.truncate(limit);
    }
    processes
}
