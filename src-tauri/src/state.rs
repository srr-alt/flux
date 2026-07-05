use std::collections::HashMap;
use std::fs::File;
use std::io::BufWriter;
use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use std::sync::Mutex;
use sysinfo::{Disks, Networks, System};

use crate::monitor::disk::IoCounters;
use crate::monitor::gpu::GpuSnapshot;
use crate::monitor::{process, TickSnapshot};

/// An in-progress CSV usage log.
pub struct UsageLog {
    pub path: PathBuf,
    pub writer: BufWriter<File>,
    pub rows: u64,
    pub started_ms: u64,
}

pub struct AppState {
    pub sys: Mutex<System>,
    /// Dedicated System for the process table. sysinfo derives per-process
    /// CPU% from the global jiffies delta since *this instance's* previous
    /// refresh; the tick loop's refresh_cpu on the shared `sys` would reset
    /// that baseline and inflate process CPU% far past 100.
    pub proc_sys: Mutex<System>,
    pub networks: Mutex<Networks>,
    pub disks: Mutex<Disks>,
    /// Previous /proc/diskstats counters for I/O rate calculation.
    pub prev_disk_io: Mutex<HashMap<String, IoCounters>>,
    /// Last emitted snapshot so a freshly mounted frontend can render
    /// immediately instead of waiting for the next tick.
    pub last_snapshot: Mutex<Option<TickSnapshot>>,
    pub uid_cache: Mutex<HashMap<u32, String>>,
    /// Monitor tick interval in milliseconds; read by the tick loop each
    /// iteration so changes apply without restarting the loop.
    pub tick_interval_ms: AtomicU64,
    /// Latest GPU snapshot, cached so the usage logger (which runs on the
    /// 1s tick) can include GPU columns collected at half cadence.
    pub last_gpus: Mutex<Vec<GpuSnapshot>>,
    pub usage_log: Mutex<Option<UsageLog>>,
    /// When the process table was last refreshed; io-counter deltas since
    /// then become per-process disk rates.
    pub last_proc_refresh: Mutex<Option<std::time::Instant>>,
    /// Saved remote host configs (mirrors hosts.json).
    pub hosts: Mutex<Vec<crate::remote::hosts::HostConfig>>,
    /// Control handles for the per-host poller threads.
    pub host_runtimes: Mutex<HashMap<crate::remote::HostId, crate::commands_hosts::HostRuntime>>,
    /// Last status event per host, so a reloaded frontend can seed itself.
    pub host_status_cache:
        Mutex<HashMap<crate::remote::HostId, crate::remote::HostStatusEvent>>,
}

impl AppState {
    pub fn new() -> Self {
        // Populate the CPU list once so process::list's per-core
        // normalization (sys.cpus().len()) works on the process System,
        // which otherwise never refreshes CPUs.
        let mut proc_sys = System::new();
        proc_sys.refresh_cpu_list(sysinfo::CpuRefreshKind::nothing());
        Self {
            sys: Mutex::new(System::new()),
            proc_sys: Mutex::new(proc_sys),
            networks: Mutex::new(Networks::new_with_refreshed_list()),
            disks: Mutex::new(Disks::new_with_refreshed_list()),
            prev_disk_io: Mutex::new(HashMap::new()),
            last_snapshot: Mutex::new(None),
            uid_cache: Mutex::new(process::uid_table()),
            tick_interval_ms: AtomicU64::new(1000),
            last_gpus: Mutex::new(Vec::new()),
            usage_log: Mutex::new(None),
            last_proc_refresh: Mutex::new(None),
            hosts: Mutex::new(Vec::new()),
            host_runtimes: Mutex::new(HashMap::new()),
            host_status_cache: Mutex::new(HashMap::new()),
        }
    }
}
