//! Run smartctl for a device — locally or over a one-shot SSH session —
//! and classify failures so the UI can offer the right next step
//! (install hint, pkexec retry, sudo hint).

use std::process::Command;

use serde::Serialize;

use flux_core::smart::{parse_report, SmartDisk, SmartFailure};

use crate::remote::hosts::HostConfig;
use crate::remote::session::{HostKeyStatus, SshSession};

/// Command result for the frontend. `failure` kinds: not_installed,
/// permission_denied, error.
#[derive(Serialize)]
pub struct SmartOutcome {
    pub disk: Option<SmartDisk>,
    pub failure: Option<String>,
    pub message: Option<String>,
}

impl SmartOutcome {
    fn ok(disk: SmartDisk) -> Self {
        SmartOutcome {
            disk: Some(disk),
            failure: None,
            message: None,
        }
    }
    fn fail(f: SmartFailure) -> Self {
        let (kind, message) = match f {
            SmartFailure::NotInstalled => ("not_installed", None),
            SmartFailure::PermissionDenied => ("permission_denied", None),
            SmartFailure::Error(msg) => ("error", Some(msg)),
        };
        SmartOutcome {
            disk: None,
            failure: Some(kind.into()),
            message,
        }
    }
}

/// Kernel block-device name → /dev path, refusing anything that could
/// escape into shell metacharacters (the name reaches a remote `sh -c`).
fn device_path(device: &str) -> Result<String, String> {
    if device.is_empty()
        || !device
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("invalid device name: {device}"));
    }
    Ok(format!("/dev/{device}"))
}

/// smartctl on this machine. `privileged` retries through pkexec after a
/// permission failure (explicit user click — never automatic).
pub fn local(device: &str, privileged: bool) -> Result<SmartOutcome, String> {
    let path = device_path(device)?;
    let output = if privileged {
        Command::new("pkexec").args(["smartctl", "-aj", &path]).output()
    } else {
        Command::new("smartctl").args(["-aj", &path]).output()
    };
    let output = match output {
        Ok(out) => out,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(SmartOutcome::fail(SmartFailure::NotInstalled));
        }
        Err(e) => return Err(e.to_string()),
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.trim().is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        // pkexec: 126 = dialog dismissed, 127 = not authorized.
        return Ok(SmartOutcome::fail(match output.status.code() {
            Some(126) | Some(127) if privileged => {
                SmartFailure::Error("authorization cancelled".into())
            }
            _ if stderr.contains("not found") => SmartFailure::NotInstalled,
            _ => SmartFailure::Error(if stderr.is_empty() {
                "smartctl produced no output".into()
            } else {
                stderr
            }),
        }));
    }
    Ok(match parse_report(&path, &stdout) {
        Ok(disk) => SmartOutcome::ok(disk),
        Err(f) => SmartOutcome::fail(f),
    })
}

/// smartctl over SSH on a dedicated one-shot session. Tries passwordless
/// sudo first (full attribute access), falls back to plain smartctl.
pub fn remote(
    config: &HostConfig,
    known_hosts: &std::path::Path,
    device: &str,
) -> Result<SmartOutcome, String> {
    let path = device_path(device)?;
    let ssh = SshSession::connect(&config.address, config.port)?;
    match ssh.check_host_key(known_hosts)? {
        HostKeyStatus::Known => {}
        _ => return Err("host key not trusted".into()),
    }
    ssh.auth_key(&config.username, &config.key_path)?;

    // Non-interactive SSH exec often lacks /usr/sbin in PATH, where Debian
    // and friends put smartctl for everyone.
    let script = format!(
        "PATH=$PATH:/usr/sbin:/sbin; \
         command -v smartctl >/dev/null 2>&1 || {{ echo __NOSMARTCTL__; exit 0; }}; \
         out=$(sudo -n smartctl -aj {path} 2>/dev/null); \
         [ -n \"$out\" ] || out=$(smartctl -aj {path} 2>/dev/null); \
         printf %s \"$out\""
    );
    let stdout = ssh.exec_capture(&format!("sh -c '{script}'"))?;
    if stdout.contains("__NOSMARTCTL__") {
        return Ok(SmartOutcome::fail(SmartFailure::NotInstalled));
    }
    if stdout.trim().is_empty() {
        return Ok(SmartOutcome::fail(SmartFailure::Error(
            "smartctl produced no output".into(),
        )));
    }
    Ok(match parse_report(&path, &stdout) {
        Ok(disk) => SmartOutcome::ok(disk),
        Err(f) => SmartOutcome::fail(f),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_names_are_sanitized() {
        assert_eq!(device_path("nvme0n1").unwrap(), "/dev/nvme0n1");
        assert_eq!(device_path("sda").unwrap(), "/dev/sda");
        assert!(device_path("sda; rm -rf /").is_err());
        assert!(device_path("../etc/shadow").is_err());
        assert!(device_path("").is_err());
        assert!(device_path("sda$(id)").is_err());
    }
}
