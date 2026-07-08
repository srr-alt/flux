use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use sysinfo::Networks;

#[derive(Serialize, Deserialize, Clone)]
pub struct NetworkInterfaceSnapshot {
    pub name: String,
    pub rx_bytes_per_sec: f64,
    pub tx_bytes_per_sec: f64,
    pub total_rx_bytes: u64,
    pub total_tx_bytes: u64,
    pub rx_packets_per_sec: f64,
    pub tx_packets_per_sec: f64,
    pub total_rx_errors: u64,
    pub total_tx_errors: u64,
    pub mac: String,
    pub ips: Vec<String>,
    pub mtu: u64,
    /// From /sys/class/net/<if>/speed; absent for wifi and down links.
    pub speed_mbps: Option<u64>,
    pub operstate: String,
    pub is_wireless: bool,
}

/// Cumulative per-interface counters from one /proc/net/dev line.
#[derive(Clone, Copy, Default)]
pub struct NetCounters {
    pub rx_bytes: u64,
    pub rx_packets: u64,
    pub rx_errors: u64,
    pub tx_bytes: u64,
    pub tx_packets: u64,
    pub tx_errors: u64,
}

/// Container/VM plumbing interfaces (docker bridges, veth pairs, libvirt).
/// Their traffic is already counted on the physical uplink; listing them
/// only buries the real NICs. tun/tap stay — VPNs are real user traffic.
pub fn is_virtual(name: &str) -> bool {
    name == "docker0"
        || name.starts_with("veth")
        || name.starts_with("br-")
        || name.starts_with("virbr")
        || name.starts_with("vnet")
}

/// Parse /proc/net/dev (skips the two header lines, `lo`, and virtual
/// container interfaces).
pub fn parse_net_dev(raw: &str) -> std::collections::HashMap<String, NetCounters> {
    raw.lines()
        .skip(2)
        .filter_map(|line| {
            let (name, rest) = line.split_once(':')?;
            let name = name.trim();
            if name == "lo" || is_virtual(name) {
                return None;
            }
            let f: Vec<u64> = rest
                .split_whitespace()
                .map(|v| v.parse().unwrap_or(0))
                .collect();
            Some((
                name.to_string(),
                NetCounters {
                    rx_bytes: f.first().copied().unwrap_or(0),
                    rx_packets: f.get(1).copied().unwrap_or(0),
                    rx_errors: f.get(2).copied().unwrap_or(0),
                    tx_bytes: f.get(8).copied().unwrap_or(0),
                    tx_packets: f.get(9).copied().unwrap_or(0),
                    tx_errors: f.get(10).copied().unwrap_or(0),
                },
            ))
        })
        .collect()
}

fn sysfs(name: &str, file: &str) -> Option<String> {
    fs::read_to_string(Path::new("/sys/class/net").join(name).join(file))
        .ok()
        .map(|s| s.trim().to_string())
}

/// `Networks` delta counters (received()/packets_received()/…) cover the
/// span since the previous refresh; divide by elapsed for per-second rates.
pub fn snapshot(networks: &Networks, elapsed_secs: f64) -> Vec<NetworkInterfaceSnapshot> {
    let elapsed = elapsed_secs.max(0.001);
    let mut interfaces: Vec<NetworkInterfaceSnapshot> = networks
        .iter()
        .filter(|(name, _)| *name != "lo" && !is_virtual(name))
        .map(|(name, data)| NetworkInterfaceSnapshot {
            name: name.clone(),
            rx_bytes_per_sec: data.received() as f64 / elapsed,
            tx_bytes_per_sec: data.transmitted() as f64 / elapsed,
            total_rx_bytes: data.total_received(),
            total_tx_bytes: data.total_transmitted(),
            rx_packets_per_sec: data.packets_received() as f64 / elapsed,
            tx_packets_per_sec: data.packets_transmitted() as f64 / elapsed,
            total_rx_errors: data.total_errors_on_received(),
            total_tx_errors: data.total_errors_on_transmitted(),
            mac: data.mac_address().to_string(),
            ips: data.ip_networks().iter().map(|ip| ip.to_string()).collect(),
            mtu: data.mtu(),
            speed_mbps: sysfs(name, "speed").and_then(|s| s.parse::<i64>().ok()).and_then(
                |v| if v > 0 { Some(v as u64) } else { None },
            ),
            operstate: sysfs(name, "operstate").unwrap_or_else(|| "unknown".into()),
            is_wireless: Path::new("/sys/class/net").join(name).join("wireless").exists(),
        })
        .collect();
    interfaces.sort_by(|a, b| a.name.cmp(&b.name));
    interfaces
}
