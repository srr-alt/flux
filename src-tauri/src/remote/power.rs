//! Wake-on-LAN and graceful power actions for remote hosts.
//!
//! WoL is a raw UDP magic packet (6×0xFF + 16×MAC) broadcast to port 9 —
//! no dependencies, works while the target is off, which is the point.
//! The MAC is captured automatically from `ip -o link` the first time a
//! host connects. Reboot/poweroff run `systemctl` over a one-shot SSH
//! session, trying passwordless sudo first.

use std::net::UdpSocket;

use super::hosts::HostConfig;
use super::session::{HostKeyStatus, SshSession};

/// "aa:bb:cc:dd:ee:ff" → bytes. Also accepts dashes.
pub fn parse_mac(mac: &str) -> Result<[u8; 6], String> {
    let parts: Vec<&str> = mac.split([':', '-']).collect();
    if parts.len() != 6 {
        return Err(format!("bad MAC: {mac}"));
    }
    let mut out = [0u8; 6];
    for (i, p) in parts.iter().enumerate() {
        out[i] = u8::from_str_radix(p, 16).map_err(|_| format!("bad MAC: {mac}"))?;
    }
    Ok(out)
}

/// 102-byte magic packet: 6×0xFF then the MAC 16 times.
pub fn magic_packet(mac: [u8; 6]) -> Vec<u8> {
    let mut pkt = vec![0xFFu8; 6];
    for _ in 0..16 {
        pkt.extend_from_slice(&mac);
    }
    pkt
}

/// Broadcast the magic packet. Sent to the global broadcast address on
/// ports 9 and 7 (different NICs listen on different discard ports).
pub fn wake(mac: &str) -> Result<(), String> {
    let pkt = magic_packet(parse_mac(mac)?);
    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    socket.set_broadcast(true).map_err(|e| e.to_string())?;
    for port in [9u16, 7] {
        socket
            .send_to(&pkt, ("255.255.255.255", port))
            .map_err(|e| format!("wol send: {e}"))?;
    }
    Ok(())
}

/// First physical-looking MAC from "name mac" lines (one interface per
/// line): skip loopback, all-zero MACs, and the virtual prefixes Flux
/// already filters in metrics.
pub fn parse_primary_mac(name_mac_lines: &str) -> Option<String> {
    for line in name_mac_lines.lines() {
        let mut parts = line.split_whitespace();
        let (Some(name), Some(mac)) = (parts.next(), parts.next()) else {
            continue;
        };
        if name == "lo"
            || ["veth", "docker", "br-", "virbr", "vnet", "tun", "tap"]
                .iter()
                .any(|p| name.starts_with(p))
        {
            continue;
        }
        match parse_mac(mac) {
            Ok(bytes) if bytes != [0u8; 6] => return Some(mac.to_lowercase()),
            _ => {}
        }
    }
    None
}

/// Read the primary MAC over an existing (poller) session. Walks
/// /sys/class/net instead of `ip` — iproute2 isn't guaranteed (containers,
/// minimal images).
pub fn capture_mac(session: &SshSession) -> Result<String, String> {
    let out = session.exec_capture(
        "for d in /sys/class/net/*; do \
           [ \"$(cat \"$d/operstate\" 2>/dev/null)\" = up ] && \
           echo \"$(basename \"$d\") $(cat \"$d/address\" 2>/dev/null)\"; \
         done; true",
    )?;
    parse_primary_mac(&out).ok_or_else(|| "no physical interface found".into())
}

/// Graceful reboot / poweroff over a dedicated SSH session. The connection
/// usually dies as the host goes down — read errors after a successful
/// exec are expected, not failures.
pub fn power_action(
    config: &HostConfig,
    known_hosts: &std::path::Path,
    verb: &str,
) -> Result<(), String> {
    if !matches!(verb, "reboot" | "poweroff") {
        return Err(format!("unsupported power action: {verb}"));
    }
    let ssh = SshSession::connect(&config.address, config.port)?;
    match ssh.check_host_key(known_hosts)? {
        HostKeyStatus::Known => {}
        _ => return Err("host key not trusted".into()),
    }
    ssh.auth_key(&config.username, &config.key_path)?;
    let cmd = format!("sudo -n systemctl {verb} 2>/dev/null || systemctl {verb}");
    match ssh.exec_capture(&cmd) {
        Ok(_) => Ok(()),
        // Session torn down mid-shutdown = the action worked.
        Err(e) if e.contains("read:") || e.contains("channel") || e.contains("timeout") => Ok(()),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mac_parsing() {
        assert_eq!(
            parse_mac("aa:bb:cc:dd:ee:ff").unwrap(),
            [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]
        );
        assert_eq!(parse_mac("AA-BB-CC-00-11-22").unwrap()[0], 0xaa);
        assert!(parse_mac("aa:bb:cc:dd:ee").is_err());
        assert!(parse_mac("zz:bb:cc:dd:ee:ff").is_err());
    }

    #[test]
    fn magic_packet_layout() {
        let pkt = magic_packet([0xde, 0xad, 0xbe, 0xef, 0x00, 0x01]);
        assert_eq!(pkt.len(), 102);
        assert!(pkt[..6].iter().all(|&b| b == 0xFF));
        assert_eq!(&pkt[6..12], &[0xde, 0xad, 0xbe, 0xef, 0x00, 0x01]);
        assert_eq!(&pkt[96..102], &[0xde, 0xad, 0xbe, 0xef, 0x00, 0x01]);
    }

    #[test]
    fn primary_mac_skips_virtual() {
        let out = "\
lo 00:00:00:00:00:00
docker0 02:42:ac:11:00:01
veth12ab 3e:11:22:33:44:55
enp3s0 A4:BB:6D:11:22:33";
        assert_eq!(
            parse_primary_mac(out).as_deref(),
            Some("a4:bb:6d:11:22:33")
        );
        assert_eq!(parse_primary_mac("lo 00:00:00:00:00:00"), None);
        // Interfaces with missing address files produce bare names — skip.
        assert_eq!(parse_primary_mac("enp3s0\nwlan0 "), None);
    }
}
