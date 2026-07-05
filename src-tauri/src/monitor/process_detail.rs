//! On-demand deep dive into one local process: /proc/[pid] plus socket
//! resolution against /proc/net. Local-only (like gpu.rs) — remote parity
//! would go through a new AgentRequest, deliberately not added yet.
//!
//! Permission failures degrade to None/empty rather than erroring, matching
//! ProcessInfo's "zeros for other users' processes" philosophy. environ is
//! intentionally NOT exposed: env vars routinely hold secrets.

use std::collections::HashMap;
use std::fs;

use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct SocketInfo {
    pub proto: String,
    pub local: String,
    pub remote: String,
    pub state: String,
}

#[derive(Serialize, Clone)]
pub struct ProcessDetail {
    pub pid: u32,
    pub cmdline: Vec<String>,
    pub exe: Option<String>,
    pub cwd: Option<String>,
    pub cgroup: Option<String>,
    pub threads: Option<u32>,
    pub vm_rss_kb: Option<u64>,
    pub vm_swap_kb: Option<u64>,
    /// None when /proc/pid/fd is unreadable (other users' processes).
    pub open_fds: Option<u32>,
    /// First few non-socket fd targets, deduplicated.
    pub fd_sample: Vec<String>,
    pub sockets: Vec<SocketInfo>,
}

const FD_SAMPLE_LIMIT: usize = 20;

pub fn detail(pid: u32) -> Result<ProcessDetail, String> {
    let proc_dir = format!("/proc/{pid}");
    if !std::path::Path::new(&proc_dir).exists() {
        return Err(format!("process {pid} not found"));
    }

    let status = fs::read_to_string(format!("{proc_dir}/status")).unwrap_or_default();
    let status_field = |key: &str| -> Option<u64> {
        status
            .lines()
            .find(|l| l.starts_with(key))?
            .split_whitespace()
            .nth(1)?
            .parse()
            .ok()
    };

    let cmdline = read_cmdline(&proc_dir, &status);
    let (open_fds, fd_sample, socket_inodes) = read_fds(&proc_dir);
    let sockets = if socket_inodes.is_empty() {
        Vec::new()
    } else {
        resolve_sockets(&socket_inodes)
    };

    Ok(ProcessDetail {
        pid,
        cmdline,
        exe: fs::read_link(format!("{proc_dir}/exe"))
            .ok()
            .map(|p| p.to_string_lossy().into_owned()),
        cwd: fs::read_link(format!("{proc_dir}/cwd"))
            .ok()
            .map(|p| p.to_string_lossy().into_owned()),
        cgroup: read_cgroup(&proc_dir),
        threads: status_field("Threads:").map(|v| v as u32),
        vm_rss_kb: status_field("VmRSS:"),
        vm_swap_kb: status_field("VmSwap:"),
        open_fds,
        fd_sample,
        sockets,
    })
}

fn read_cmdline(proc_dir: &str, status: &str) -> Vec<String> {
    let raw = fs::read(format!("{proc_dir}/cmdline")).unwrap_or_default();
    let args: Vec<String> = raw
        .split(|b| *b == 0)
        .filter(|part| !part.is_empty())
        .map(|part| String::from_utf8_lossy(part).into_owned())
        .collect();
    if !args.is_empty() {
        return args;
    }
    // Kernel threads and zombies have an empty cmdline; fall back to comm.
    let comm = status
        .lines()
        .find_map(|l| l.strip_prefix("Name:"))
        .map(|s| s.trim())
        .unwrap_or("?");
    vec![format!("[{comm}]")]
}

fn read_cgroup(proc_dir: &str) -> Option<String> {
    let raw = fs::read_to_string(format!("{proc_dir}/cgroup")).ok()?;
    // cgroup v2 unified line "0::<path>"; fall back to the first line's path.
    raw.lines()
        .find_map(|l| l.strip_prefix("0::"))
        .or_else(|| raw.lines().next().and_then(|l| l.splitn(3, ':').nth(2)))
        .map(|s| s.to_string())
}

/// Walk /proc/pid/fd: count, sample non-socket targets, collect socket inodes.
fn read_fds(proc_dir: &str) -> (Option<u32>, Vec<String>, Vec<u64>) {
    let Ok(entries) = fs::read_dir(format!("{proc_dir}/fd")) else {
        return (None, Vec::new(), Vec::new());
    };
    let mut count = 0u32;
    let mut sample: Vec<String> = Vec::new();
    let mut inodes: Vec<u64> = Vec::new();
    for entry in entries.flatten() {
        count += 1;
        let Ok(target) = fs::read_link(entry.path()) else {
            continue;
        };
        let target = target.to_string_lossy().into_owned();
        if let Some(inode) = target
            .strip_prefix("socket:[")
            .and_then(|s| s.strip_suffix(']'))
            .and_then(|s| s.parse().ok())
        {
            inodes.push(inode);
        } else if sample.len() < FD_SAMPLE_LIMIT && !sample.contains(&target) {
            sample.push(target);
        }
    }
    (Some(count), sample, inodes)
}

/// Match socket inodes against the system-wide /proc/net tables. (These
/// tables are per-namespace, not per-process — inode matching is the only
/// way to attribute sockets to a pid without root tooling.)
fn resolve_sockets(inodes: &[u64]) -> Vec<SocketInfo> {
    let wanted: HashMap<u64, ()> = inodes.iter().map(|i| (*i, ())).collect();
    let mut sockets = Vec::new();
    for (file, proto, v6) in [
        ("/proc/net/tcp", "tcp", false),
        ("/proc/net/tcp6", "tcp6", true),
        ("/proc/net/udp", "udp", false),
        ("/proc/net/udp6", "udp6", true),
    ] {
        let Ok(table) = fs::read_to_string(file) else {
            continue;
        };
        for line in table.lines().skip(1) {
            let fields: Vec<&str> = line.split_whitespace().collect();
            if fields.len() < 10 {
                continue;
            }
            let Ok(inode) = fields[9].parse::<u64>() else {
                continue;
            };
            if !wanted.contains_key(&inode) {
                continue;
            }
            sockets.push(SocketInfo {
                proto: proto.to_string(),
                local: decode_addr(fields[1], v6),
                remote: decode_addr(fields[2], v6),
                state: if proto.starts_with("tcp") {
                    tcp_state(fields[3])
                } else {
                    String::new()
                },
            });
        }
    }
    sockets
}

/// "0100007F:1F90" -> "127.0.0.1:8080"; v6 hex is four 32-bit LE groups.
fn decode_addr(hex: &str, v6: bool) -> String {
    let Some((addr_hex, port_hex)) = hex.split_once(':') else {
        return hex.to_string();
    };
    let port = u16::from_str_radix(port_hex, 16).unwrap_or(0);
    if v6 {
        let Ok(raw) = u128::from_str_radix(addr_hex, 16) else {
            return hex.to_string();
        };
        let bytes = raw.to_be_bytes();
        // /proc/net encodes v6 as four little-endian u32 words.
        let mut fixed = [0u8; 16];
        for word in 0..4 {
            for byte in 0..4 {
                fixed[word * 4 + byte] = bytes[word * 4 + (3 - byte)];
            }
        }
        let ip = std::net::Ipv6Addr::from(fixed);
        // Render v4-mapped addresses (::ffff:a.b.c.d) as plain v4.
        if let Some(v4) = ip.to_ipv4_mapped() {
            return format!("{v4}:{port}");
        }
        format!("[{ip}]:{port}")
    } else {
        let Ok(raw) = u32::from_str_radix(addr_hex, 16) else {
            return hex.to_string();
        };
        let ip = std::net::Ipv4Addr::from(raw.swap_bytes());
        format!("{ip}:{port}")
    }
}

fn tcp_state(hex: &str) -> String {
    match u8::from_str_radix(hex, 16).unwrap_or(0) {
        1 => "ESTABLISHED",
        2 => "SYN_SENT",
        3 => "SYN_RECV",
        4 => "FIN_WAIT1",
        5 => "FIN_WAIT2",
        6 => "TIME_WAIT",
        7 => "CLOSE",
        8 => "CLOSE_WAIT",
        9 => "LAST_ACK",
        10 => "LISTEN",
        11 => "CLOSING",
        _ => "?",
    }
    .to_string()
}
