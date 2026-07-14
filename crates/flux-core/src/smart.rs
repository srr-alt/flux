//! S.M.A.R.T. disk health: parse `smartctl -aj` JSON into one flat struct.
//!
//! Parsing only — running smartctl (locally or over SSH) lives in the app;
//! this module is pure so it can be tested against canned smartctl output.
//! Covers both NVMe (`nvme_smart_health_information_log`) and ATA
//! (`ata_smart_attributes` table) shapes; every field is optional because
//! drives and bridges omit freely.

use serde::Serialize;
use serde_json::Value;

#[derive(Serialize, Clone, Debug, Default)]
pub struct SmartDisk {
    pub device: String,
    pub model: Option<String>,
    pub serial: Option<String>,
    pub firmware: Option<String>,
    pub capacity_bytes: Option<u64>,
    /// `smart_status.passed` — the headline verdict.
    pub healthy: Option<bool>,
    pub temp_c: Option<f64>,
    pub power_on_hours: Option<u64>,
    pub power_cycles: Option<u64>,
    // NVMe wear
    pub percentage_used: Option<u64>,
    pub available_spare_pct: Option<u64>,
    pub media_errors: Option<u64>,
    // ATA reliability
    pub reallocated_sectors: Option<u64>,
    pub pending_sectors: Option<u64>,
    pub offline_uncorrectable: Option<u64>,
}

/// Why a report could not be produced, classified for the UI.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SmartFailure {
    /// smartctl missing on the machine.
    NotInstalled,
    /// Device open needs root.
    PermissionDenied,
    Error(String),
}

/// Messages smartctl embeds in its JSON when something went wrong.
fn failure_from_messages(v: &Value) -> Option<SmartFailure> {
    let messages = v
        .get("smartctl")
        .and_then(|s| s.get("messages"))
        .and_then(|m| m.as_array())?;
    let text: String = messages
        .iter()
        .filter_map(|m| m.get("string").and_then(|s| s.as_str()))
        .collect::<Vec<_>>()
        .join("; ");
    if text.is_empty() {
        return None;
    }
    if text.contains("Permission denied") {
        Some(SmartFailure::PermissionDenied)
    } else if messages.iter().any(|m| {
        m.get("severity").and_then(|s| s.as_str()) == Some("error")
    }) {
        Some(SmartFailure::Error(text))
    } else {
        None
    }
}

fn u64_at<'a>(v: &'a Value, path: &[&str]) -> Option<u64> {
    let mut cur = v;
    for key in path {
        cur = cur.get(key)?;
    }
    cur.as_u64()
}

/// Raw value of an ATA attribute by id (5, 197, 198…).
fn ata_attr(v: &Value, id: u64) -> Option<u64> {
    v.get("ata_smart_attributes")?
        .get("table")?
        .as_array()?
        .iter()
        .find(|a| a.get("id").and_then(|i| i.as_u64()) == Some(id))?
        .get("raw")?
        .get("value")?
        .as_u64()
}

/// Parse one `smartctl -aj <device>` output.
pub fn parse_report(device: &str, json: &str) -> Result<SmartDisk, SmartFailure> {
    let v: Value = serde_json::from_str(json)
        .map_err(|e| SmartFailure::Error(format!("bad smartctl JSON: {e}")))?;
    if let Some(failure) = failure_from_messages(&v) {
        return Err(failure);
    }

    let nvme = v.get("nvme_smart_health_information_log");
    let disk = SmartDisk {
        device: device.to_string(),
        model: v
            .get("model_name")
            .and_then(|s| s.as_str())
            .map(String::from),
        serial: v
            .get("serial_number")
            .and_then(|s| s.as_str())
            .map(String::from),
        firmware: v
            .get("firmware_version")
            .and_then(|s| s.as_str())
            .map(String::from),
        capacity_bytes: u64_at(&v, &["user_capacity", "bytes"])
            .or_else(|| u64_at(&v, &["nvme_total_capacity"])),
        healthy: v
            .get("smart_status")
            .and_then(|s| s.get("passed"))
            .and_then(|p| p.as_bool()),
        temp_c: u64_at(&v, &["temperature", "current"]).map(|t| t as f64),
        power_on_hours: u64_at(&v, &["power_on_time", "hours"])
            .or_else(|| nvme.and_then(|n| u64_at(n, &["power_on_hours"]))),
        power_cycles: u64_at(&v, &["power_cycle_count"])
            .or_else(|| nvme.and_then(|n| u64_at(n, &["power_cycles"]))),
        percentage_used: nvme.and_then(|n| u64_at(n, &["percentage_used"])),
        available_spare_pct: nvme.and_then(|n| u64_at(n, &["available_spare"])),
        media_errors: nvme.and_then(|n| u64_at(n, &["media_errors"])),
        reallocated_sectors: ata_attr(&v, 5),
        pending_sectors: ata_attr(&v, 197),
        offline_uncorrectable: ata_attr(&v, 198),
    };
    // A report with neither a verdict nor an identity is useless — treat as
    // unsupported rather than rendering an empty card.
    if disk.healthy.is_none() && disk.model.is_none() {
        return Err(SmartFailure::Error(
            "device reports no SMART data".into(),
        ));
    }
    Ok(disk)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NVME: &str = r#"{
        "smartctl": {"version": [7, 4], "exit_status": 0, "messages": []},
        "model_name": "Samsung SSD 970 EVO 500GB",
        "serial_number": "S466NB0K123456",
        "firmware_version": "2B2QEXE7",
        "user_capacity": {"blocks": 976773168, "bytes": 500107862016},
        "smart_status": {"passed": true, "nvme": {"value": 0}},
        "temperature": {"current": 43},
        "power_cycle_count": 1893,
        "power_on_time": {"hours": 12345},
        "nvme_smart_health_information_log": {
            "critical_warning": 0,
            "temperature": 43,
            "available_spare": 100,
            "available_spare_threshold": 10,
            "percentage_used": 7,
            "power_cycles": 1893,
            "power_on_hours": 12345,
            "media_errors": 0,
            "num_err_log_entries": 211
        }
    }"#;

    const ATA: &str = r#"{
        "smartctl": {"version": [7, 4], "exit_status": 64, "messages": []},
        "model_name": "ST1000LM048-2E7172",
        "serial_number": "WKP2RKAV",
        "firmware_version": "SDM1",
        "user_capacity": {"blocks": 1953525168, "bytes": 1000204886016},
        "smart_status": {"passed": false},
        "temperature": {"current": 38},
        "power_cycle_count": 4211,
        "power_on_time": {"hours": 30001},
        "ata_smart_attributes": {"table": [
            {"id": 5, "name": "Reallocated_Sector_Ct", "value": 92,
             "raw": {"value": 344, "string": "344"}},
            {"id": 194, "name": "Temperature_Celsius", "value": 38,
             "raw": {"value": 38, "string": "38"}},
            {"id": 197, "name": "Current_Pending_Sector", "value": 100,
             "raw": {"value": 16, "string": "16"}},
            {"id": 198, "name": "Offline_Uncorrectable", "value": 100,
             "raw": {"value": 8, "string": "8"}}
        ]}
    }"#;

    const DENIED: &str = r#"{
        "smartctl": {"version": [7, 4], "exit_status": 2, "messages": [
            {"string": "Smartctl open device: /dev/nvme0 failed: Permission denied",
             "severity": "error"}
        ]}
    }"#;

    #[test]
    fn parses_nvme_report() {
        let d = parse_report("/dev/nvme0", NVME).unwrap();
        assert_eq!(d.model.as_deref(), Some("Samsung SSD 970 EVO 500GB"));
        assert_eq!(d.healthy, Some(true));
        assert_eq!(d.temp_c, Some(43.0));
        assert_eq!(d.capacity_bytes, Some(500107862016));
        assert_eq!(d.percentage_used, Some(7));
        assert_eq!(d.available_spare_pct, Some(100));
        assert_eq!(d.media_errors, Some(0));
        assert_eq!(d.power_on_hours, Some(12345));
        assert!(d.reallocated_sectors.is_none());
    }

    #[test]
    fn parses_failing_ata_report() {
        let d = parse_report("/dev/sda", ATA).unwrap();
        assert_eq!(d.healthy, Some(false));
        assert_eq!(d.reallocated_sectors, Some(344));
        assert_eq!(d.pending_sectors, Some(16));
        assert_eq!(d.offline_uncorrectable, Some(8));
        assert!(d.percentage_used.is_none());
        // Non-zero smartctl exit_status must not fail the parse — bit 6 etc.
        // just flag attribute history.
        assert_eq!(d.power_on_hours, Some(30001));
    }

    #[test]
    fn classifies_permission_denied() {
        assert_eq!(
            parse_report("/dev/nvme0", DENIED).unwrap_err(),
            SmartFailure::PermissionDenied
        );
    }

    #[test]
    fn rejects_garbage_and_empty() {
        assert!(matches!(
            parse_report("/dev/sda", "not json"),
            Err(SmartFailure::Error(_))
        ));
        assert!(matches!(
            parse_report("/dev/sda", "{}"),
            Err(SmartFailure::Error(_))
        ));
    }
}
