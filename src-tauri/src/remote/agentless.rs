//! Agentless collection: one batched command per poll over the SSH session,
//! parsed locally into the same snapshot structs the local monitor emits.

use std::collections::{HashMap, HashSet};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use flux_core::cpu::{self, CpuTicks};
use flux_core::disk::{self, DiskSnapshot, IoCounters};
use flux_core::memory;
use flux_core::network::{self, NetCounters, NetworkInterfaceSnapshot};
use flux_core::process::{ProcessInfo, ProcessQuery};
use flux_core::system_info::SystemInfo;
use flux_core::TickSnapshot;

use super::session::SshSession;

/// Marker-delimited batch: every section is best-effort so one missing
/// file (e.g. no cpufreq on VMs) doesn't kill the whole sample.
const BATCH_CMD: &str = r#"LC_ALL=C sh -c '
echo @@stat;      cat /proc/stat 2>/dev/null
echo @@loadavg;   cat /proc/loadavg 2>/dev/null
echo @@meminfo;   cat /proc/meminfo 2>/dev/null
echo @@swaps;     cat /proc/swaps 2>/dev/null
echo @@netdev;    cat /proc/net/dev 2>/dev/null
echo @@freq;      cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq 2>/dev/null
echo @@diskstats; cat /proc/diskstats 2>/dev/null
echo @@blocks;    ls /sys/block 2>/dev/null
echo @@df;        df -kPT -x tmpfs -x devtmpfs -x squashfs -x overlay -x efivarfs 2>/dev/null
'"#;

pub struct AgentlessDeltas {
    prev_cpu: Vec<CpuTicks>,
    prev_net: HashMap<String, NetCounters>,
    prev_disk_io: HashMap<String, IoCounters>,
    /// pid -> cumulative cpu seconds, for process CPU% between list calls.
    prev_proc_cpu: HashMap<u32, (u64, Instant)>,
    last_sample: Option<Instant>,
    /// uid -> username, fetched once per connection.
    pub uid_names: HashMap<u32, String>,
}

impl AgentlessDeltas {
    pub fn new() -> Self {
        Self {
            prev_cpu: Vec::new(),
            prev_net: HashMap::new(),
            prev_disk_io: HashMap::new(),
            prev_proc_cpu: HashMap::new(),
            last_sample: None,
            uid_names: HashMap::new(),
        }
    }
}

fn sections(raw: &str) -> HashMap<&str, String> {
    let mut out = HashMap::new();
    let mut current: Option<&str> = None;
    let mut buf = String::new();
    for line in raw.lines() {
        if let Some(name) = line.strip_prefix("@@") {
            if let Some(section) = current {
                out.insert(section, std::mem::take(&mut buf));
            }
            current = Some(name.trim());
        } else if current.is_some() {
            buf.push_str(line);
            buf.push('\n');
        }
    }
    if let Some(section) = current {
        out.insert(section, buf);
    }
    out
}

/// One poll: run the batch, parse, and produce a tick + disks pair.
/// Returns None on the first sample (rates need a baseline).
pub fn poll(
    session: &SshSession,
    deltas: &mut AgentlessDeltas,
) -> Result<Option<(TickSnapshot, DiskSnapshot)>, String> {
    let raw = session.exec_capture(BATCH_CMD)?;
    let now = Instant::now();
    let sections = sections(&raw);
    let get = |name: &str| sections.get(name).map(String::as_str).unwrap_or("");

    let cur_cpu = cpu::parse_stat(get("stat"));
    let cur_net = network::parse_net_dev(get("netdev"));
    let blocks: HashSet<&str> = get("blocks").split_whitespace().collect();
    let cur_disk = disk::parse_diskstats(get("diskstats"), now, |name| blocks.contains(name));

    let first_sample = deltas.last_sample.is_none();
    let elapsed = deltas
        .last_sample
        .map(|t| now.duration_since(t).as_secs_f64())
        .unwrap_or(1.0)
        .max(0.001);

    let result = if first_sample {
        None
    } else {
        let usage = cpu::usage_between(&deltas.prev_cpu, &cur_cpu);
        let load = cpu::parse_loadavg(get("loadavg"));
        let freqs: Vec<u64> = get("freq")
            .lines()
            .filter_map(|l| l.trim().parse::<u64>().ok())
            .map(|khz| khz / 1000)
            .collect();

        let mem = memory::parse(get("meminfo"), get("swaps"));

        let net: Vec<NetworkInterfaceSnapshot> = cur_net
            .iter()
            .map(|(name, cur)| {
                let prev = deltas.prev_net.get(name).copied().unwrap_or(*cur);
                NetworkInterfaceSnapshot {
                    name: name.clone(),
                    rx_bytes_per_sec: cur.rx_bytes.saturating_sub(prev.rx_bytes) as f64 / elapsed,
                    tx_bytes_per_sec: cur.tx_bytes.saturating_sub(prev.tx_bytes) as f64 / elapsed,
                    total_rx_bytes: cur.rx_bytes,
                    total_tx_bytes: cur.tx_bytes,
                    rx_packets_per_sec: cur.rx_packets.saturating_sub(prev.rx_packets) as f64
                        / elapsed,
                    tx_packets_per_sec: cur.tx_packets.saturating_sub(prev.tx_packets) as f64
                        / elapsed,
                    total_rx_errors: cur.rx_errors,
                    total_tx_errors: cur.tx_errors,
                    // Detail fields need extra roundtrips; not worth it agentless.
                    mac: String::new(),
                    ips: Vec::new(),
                    mtu: 0,
                    speed_mbps: None,
                    operstate: "unknown".into(),
                    is_wireless: false,
                }
            })
            .collect();

        let tick = TickSnapshot {
            timestamp_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
            cpu: flux_core::cpu::CpuSnapshot {
                global_usage_pct: usage.first().copied().unwrap_or(0.0),
                per_core_usage_pct: usage.iter().skip(1).copied().collect(),
                per_core_freq_mhz: freqs.clone(),
                per_core_temp_c: None,
                load_avg_1: load.one,
                load_avg_5: load.five,
                load_avg_15: load.fifteen,
                frequency_mhz: freqs.first().copied(),
                tasks_running: load.tasks_running,
                tasks_total: load.tasks_total,
            },
            memory: mem,
            network: net,
        };

        let io = disk::rates_from(&deltas.prev_disk_io, &cur_disk, |_| (None, 0, false));
        let disks = DiskSnapshot {
            mounts: disk::parse_df(get("df")),
            io,
        };
        Some((tick, disks))
    };

    deltas.prev_cpu = cur_cpu;
    deltas.prev_net = cur_net;
    deltas.prev_disk_io = cur_disk;
    deltas.last_sample = Some(now);
    Ok(result)
}

/// Static facts fetched once per connection.
pub fn statics(session: &SshSession) -> Result<SystemInfo, String> {
    let raw = session.exec_capture(
        r#"LC_ALL=C sh -c '
echo @@hostname; hostname 2>/dev/null
echo @@kernel;   uname -r 2>/dev/null
echo @@os;       . /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"
echo @@cpumodel; grep -m1 "^model name" /proc/cpuinfo 2>/dev/null | cut -d: -f2-
echo @@cores;    nproc 2>/dev/null
echo @@phys;     lscpu -p=CORE 2>/dev/null | grep -v "^#" | sort -u | wc -l
echo @@mem;      grep -m1 MemTotal /proc/meminfo 2>/dev/null
echo @@uptime;   cat /proc/uptime 2>/dev/null
'"#,
    )?;
    let sections = sections(&raw);
    let get = |name: &str| {
        sections
            .get(name)
            .map(|s| s.trim().to_string())
            .unwrap_or_default()
    };
    Ok(SystemInfo {
        hostname: get("hostname"),
        kernel_version: get("kernel"),
        os_pretty_name: get("os"),
        cpu_model: get("cpumodel"),
        logical_cores: get("cores").parse().unwrap_or(0),
        physical_cores: get("phys").parse().unwrap_or(0),
        total_memory_kb: get("mem")
            .split_whitespace()
            .nth(1)
            .and_then(|v| v.parse().ok())
            .unwrap_or(0),
        uptime_secs: get("uptime")
            .split_whitespace()
            .next()
            .and_then(|v| v.parse::<f64>().ok())
            .map(|v| v as u64)
            .unwrap_or(0),
    })
}

/// Fetch uid -> name map once (used for the process table).
pub fn uid_table(session: &SshSession) -> HashMap<u32, String> {
    let Ok(raw) = session.exec_capture("getent passwd 2>/dev/null || cat /etc/passwd") else {
        return HashMap::new();
    };
    raw.lines()
        .filter_map(|line| {
            let mut parts = line.split(':');
            let name = parts.next()?;
            let _pw = parts.next()?;
            let uid: u32 = parts.next()?.parse().ok()?;
            Some((uid, name.to_string()))
        })
        .collect()
}

const PS_CMD: &str = "LC_ALL=C ps -eo pid=,ppid=,uid=,ni=,stat=,etimes=,cputimes=,rss=,comm=,args= --no-headers 2>/dev/null";

/// Process list via `ps`. CPU% is computed from cputimes deltas between
/// consecutive calls (ps's own %cpu is a lifetime average — useless live).
pub fn processes(
    session: &SshSession,
    deltas: &mut AgentlessDeltas,
    query: &ProcessQuery,
) -> Result<Vec<ProcessInfo>, String> {
    let raw = session.exec_capture(PS_CMD)?;
    let now = Instant::now();
    let search = query
        .search
        .as_deref()
        .unwrap_or("")
        .to_lowercase();

    let mut next_cpu: HashMap<u32, (u64, Instant)> = HashMap::new();
    let mut list: Vec<ProcessInfo> = raw
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let pid: u32 = fields.next()?.parse().ok()?;
            let ppid: u32 = fields.next()?.parse().ok()?;
            let uid: u32 = fields.next()?.parse().ok()?;
            let nice: i32 = fields.next().map(|n| n.parse().unwrap_or(0))?;
            let stat = fields.next()?.to_string();
            let etimes: u64 = fields.next()?.parse().ok()?;
            let cputimes: u64 = fields.next()?.parse().ok()?;
            let rss_kb: u64 = fields.next()?.parse().ok()?;
            let comm = fields.next()?.to_string();
            let cmd = fields.collect::<Vec<_>>().join(" ");

            next_cpu.insert(pid, (cputimes, now));
            let cpu_pct = match deltas.prev_proc_cpu.get(&pid) {
                Some((prev_secs, prev_at)) => {
                    let dt = now.duration_since(*prev_at).as_secs_f64();
                    if dt > 0.5 {
                        (cputimes.saturating_sub(*prev_secs) as f64 / dt * 100.0) as f32
                    } else {
                        0.0
                    }
                }
                None => 0.0,
            };

            if !search.is_empty()
                && !comm.to_lowercase().contains(&search)
                && !cmd.to_lowercase().contains(&search)
            {
                return None;
            }
            Some(ProcessInfo {
                pid,
                ppid,
                name: comm,
                cmd,
                user: deltas
                    .uid_names
                    .get(&uid)
                    .cloned()
                    .unwrap_or_else(|| uid.to_string()),
                cpu_pct,
                mem_bytes: rss_kb * 1024,
                status: stat,
                run_time_secs: etimes,
                nice,
                // Not derivable from ps; agent mode provides these.
                disk_read_bytes_per_sec: 0.0,
                disk_write_bytes_per_sec: 0.0,
            })
        })
        .collect();
    deltas.prev_proc_cpu = next_cpu;

    match query.sort_by.as_str() {
        "mem" => list.sort_by_key(|p| p.mem_bytes),
        "pid" => list.sort_by_key(|p| p.pid),
        "name" => list.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase())),
        "user" => list.sort_by(|a, b| a.user.cmp(&b.user)),
        _ => list.sort_by(|a, b| a.cpu_pct.total_cmp(&b.cpu_pct)),
    }
    if query.sort_desc {
        list.reverse();
    }
    if let Some(limit) = query.limit {
        list.truncate(limit);
    }
    Ok(list)
}

pub fn kill(session: &SshSession, pid: u32, force: bool) -> Result<(), String> {
    let signal = if force { "KILL" } else { "TERM" };
    session
        .exec_capture(&format!("kill -{signal} {pid}"))
        .map(|_| ())
}
