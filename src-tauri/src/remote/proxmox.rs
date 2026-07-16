//! Proxmox VE awareness: detect a PVE node over the poller's SSH session,
//! list its guests (QEMU VMs + LXC containers), and run start/shutdown/stop
//! actions over a dedicated one-shot session (they can block for a while —
//! never on the poller thread).
//!
//! Primary source is `pvesh get /cluster/resources` (rich JSON: live cpu/mem
//! per guest); `qm list` + `pct list` are the fallback when pvesh is
//! unavailable to the login user (names + state only).

use serde::Serialize;

use super::hosts::HostConfig;
use super::session::{HostKeyStatus, SshSession};

/// PVE CLI tools live in /usr/sbin; non-interactive SSH often lacks it.
const PATH_FIX: &str = "PATH=$PATH:/usr/sbin:/sbin";

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ProxmoxGuest {
    pub vmid: u64,
    pub name: String,
    /// "qemu" (VM) or "lxc" (container).
    pub kind: String,
    /// "running" | "stopped" | anything else PVE reports (e.g. "paused").
    pub status: String,
    /// Live CPU as percent of the guest's allotted cores. pvesh only.
    pub cpu_pct: Option<f64>,
    pub mem_bytes: Option<u64>,
    pub max_mem_bytes: Option<u64>,
    pub uptime_secs: Option<u64>,
}

/// One probe per connection: is this host a Proxmox node?
pub fn detect(session: &SshSession) -> bool {
    session
        .exec_capture(&format!(
            "sh -c '{PATH_FIX}; command -v pveversion >/dev/null 2>&1 && echo __PVE__ || true'"
        ))
        .map(|out| out.contains("__PVE__"))
        .unwrap_or(false)
}

/// Guest list over the existing poller session. `node_hint` (the host's
/// hostname) filters cluster-wide pvesh output down to this node's guests;
/// if nothing matches (hostname mismatch) the full list is kept rather
/// than showing an empty tile.
pub fn guests(session: &SshSession, node_hint: &str) -> Result<Vec<ProxmoxGuest>, String> {
    let cmd = format!(
        "sh -c '{PATH_FIX}; \
         out=$(sudo -n pvesh get /cluster/resources --type vm --output-format json 2>/dev/null); \
         [ -n \"$out\" ] || out=$(pvesh get /cluster/resources --type vm --output-format json 2>/dev/null); \
         printf %s \"$out\"'"
    );
    let raw = session.exec_capture(&cmd)?;
    if !raw.trim().is_empty() {
        if let Some(list) = parse_pvesh(&raw, node_hint) {
            return Ok(list);
        }
    }
    // pvesh denied/absent: names + state via the per-type CLIs.
    let qm = session
        .exec_capture(&format!("sh -c '{PATH_FIX}; sudo -n qm list 2>/dev/null || qm list 2>/dev/null; true'"))
        .unwrap_or_default();
    let pct = session
        .exec_capture(&format!("sh -c '{PATH_FIX}; sudo -n pct list 2>/dev/null || pct list 2>/dev/null; true'"))
        .unwrap_or_default();
    let mut list = parse_qm_list(&qm);
    list.extend(parse_pct_list(&pct));
    Ok(list)
}

/// pvesh /cluster/resources JSON → guests. None = not parseable as the
/// expected array (caller falls back to qm/pct).
fn parse_pvesh(json: &str, node_hint: &str) -> Option<Vec<ProxmoxGuest>> {
    let value: serde_json::Value = serde_json::from_str(json.trim()).ok()?;
    let items = value.as_array()?;
    let all: Vec<(Option<String>, ProxmoxGuest)> = items
        .iter()
        .filter_map(|item| {
            // Templates are images, not runnable guests.
            if item.get("template").and_then(|v| v.as_u64()) == Some(1) {
                return None;
            }
            let kind = item.get("type")?.as_str()?;
            if kind != "qemu" && kind != "lxc" {
                return None;
            }
            let node = item
                .get("node")
                .and_then(|v| v.as_str())
                .map(String::from);
            let guest = ProxmoxGuest {
                vmid: item.get("vmid")?.as_u64()?,
                name: item
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                kind: kind.to_string(),
                status: item
                    .get("status")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string(),
                // pvesh cpu is a 0..1-per-allotted-core fraction; percent.
                cpu_pct: item.get("cpu").and_then(|v| v.as_f64()).map(|v| v * 100.0),
                mem_bytes: item.get("mem").and_then(|v| v.as_u64()),
                max_mem_bytes: item.get("maxmem").and_then(|v| v.as_u64()),
                uptime_secs: item.get("uptime").and_then(|v| v.as_u64()),
            };
            Some((node, guest))
        })
        .collect();
    // Cluster output lists every node's guests; keep this node's. A
    // hostname that matches nothing (or an empty hint) keeps the full
    // list rather than showing an empty tile.
    let mine: Vec<ProxmoxGuest> = all
        .iter()
        .filter(|(node, _)| node.as_deref() == Some(node_hint))
        .map(|(_, g)| g.clone())
        .collect();
    Some(if mine.is_empty() {
        all.into_iter().map(|(_, g)| g).collect()
    } else {
        mine
    })
}

/// `qm list` text: "VMID NAME STATUS MEM(MB) BOOTDISK(GB) PID" rows.
fn parse_qm_list(text: &str) -> Vec<ProxmoxGuest> {
    text.lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let vmid: u64 = fields.next()?.parse().ok()?; // header fails here
            let name = fields.next()?.to_string();
            let status = fields.next()?.to_lowercase();
            Some(ProxmoxGuest {
                vmid,
                name,
                kind: "qemu".into(),
                status,
                cpu_pct: None,
                mem_bytes: None,
                max_mem_bytes: None,
                uptime_secs: None,
            })
        })
        .collect()
}

/// `pct list` text: "VMID Status Lock Name" rows; Lock is often blank, so
/// name = last field.
fn parse_pct_list(text: &str) -> Vec<ProxmoxGuest> {
    text.lines()
        .filter_map(|line| {
            let fields: Vec<&str> = line.split_whitespace().collect();
            if fields.len() < 2 {
                return None;
            }
            let vmid: u64 = fields[0].parse().ok()?;
            let status = fields[1].to_lowercase();
            let name = if fields.len() >= 3 {
                fields[fields.len() - 1].to_string()
            } else {
                String::new()
            };
            Some(ProxmoxGuest {
                vmid,
                name,
                kind: "lxc".into(),
                status,
                cpu_pct: None,
                mem_bytes: None,
                max_mem_bytes: None,
                uptime_secs: None,
            })
        })
        .collect()
}

/// start / shutdown / stop one guest over a dedicated SSH session.
/// `shutdown` is graceful (guest OS shutdown), `stop` is the hard kill.
/// Blocks until the PVE CLI returns — shutdown can take tens of seconds.
pub fn guest_action(
    config: &HostConfig,
    known_hosts: &std::path::Path,
    vmid: u64,
    kind: &str,
    action: &str,
) -> Result<(), String> {
    let tool = match kind {
        "qemu" => "qm",
        "lxc" => "pct",
        other => return Err(format!("unknown guest kind: {other}")),
    };
    if !matches!(action, "start" | "shutdown" | "stop") {
        return Err(format!("unsupported guest action: {action}"));
    }
    let ssh = SshSession::connect(&config.address, config.port)?;
    match ssh.check_host_key(known_hosts)? {
        HostKeyStatus::Known => {}
        _ => return Err("host key not trusted".into()),
    }
    ssh.auth_key(&config.username, &config.key_path)?;
    let cmd = format!(
        "sh -c '{PATH_FIX}; sudo -n {tool} {action} {vmid} 2>&1 || {tool} {action} {vmid} 2>&1'"
    );
    let out = ssh.exec_capture(&cmd)?;
    let out = out.trim();
    // PVE CLIs are silent on success and print the reason on failure.
    if out.is_empty() || out.contains("UPID:") {
        Ok(())
    } else {
        Err(out.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PVESH_JSON: &str = r#"[
      {"cpu":0.0421,"disk":0,"id":"qemu/100","maxcpu":4,"maxdisk":34359738368,
       "maxmem":8589934592,"mem":3221225472,"name":"web-vm","node":"pve",
       "status":"running","template":0,"type":"qemu","uptime":86400,"vmid":100},
      {"cpu":0.0,"id":"lxc/101","maxmem":1073741824,"mem":0,"name":"dns",
       "node":"pve","status":"stopped","template":0,"type":"lxc","vmid":101},
      {"id":"qemu/9000","name":"tmpl","node":"pve","status":"stopped",
       "template":1,"type":"qemu","vmid":9000},
      {"cpu":0.5,"id":"qemu/200","name":"other-node-vm","node":"pve2",
       "status":"running","template":0,"type":"qemu","vmid":200},
      {"id":"storage/pve/local","node":"pve","status":"available","type":"storage"}
    ]"#;

    #[test]
    fn pvesh_parses_and_filters() {
        let list = parse_pvesh(PVESH_JSON, "pve").unwrap();
        assert_eq!(list.len(), 2); // template + other node + storage dropped
        assert_eq!(list[0].vmid, 100);
        assert_eq!(list[0].kind, "qemu");
        assert_eq!(list[0].status, "running");
        assert!((list[0].cpu_pct.unwrap() - 4.21).abs() < 0.01);
        assert_eq!(list[0].max_mem_bytes, Some(8589934592));
        assert_eq!(list[1].vmid, 101);
        assert_eq!(list[1].kind, "lxc");
    }

    #[test]
    fn pvesh_unknown_node_keeps_all() {
        // Hostname that matches no entry: fall back to the full list
        // rather than an empty tile.
        let list = parse_pvesh(PVESH_JSON, "").unwrap();
        assert_eq!(list.len(), 3);
    }

    #[test]
    fn pvesh_rejects_garbage() {
        assert!(parse_pvesh("not json", "pve").is_none());
        assert!(parse_pvesh("{\"a\":1}", "pve").is_none());
    }

    #[test]
    fn qm_list_parses() {
        let text = "\
      VMID NAME                 STATUS     MEM(MB)    BOOTDISK(GB) PID
       100 web-vm               running    8192              32.00 1234
       101 db-vm                stopped    4096              16.00 0";
        let list = parse_qm_list(text);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].vmid, 100);
        assert_eq!(list[0].name, "web-vm");
        assert_eq!(list[0].status, "running");
        assert_eq!(list[0].kind, "qemu");
    }

    #[test]
    fn pct_list_parses() {
        let text = "\
VMID       Status     Lock         Name
100        running                 dns
102        stopped    backup       files";
        let list = parse_pct_list(text);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].vmid, 100);
        assert_eq!(list[0].name, "dns");
        assert_eq!(list[0].kind, "lxc");
        assert_eq!(list[1].name, "files");
        assert_eq!(list[1].status, "stopped");
    }
}
