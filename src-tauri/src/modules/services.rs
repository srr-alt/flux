use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::{run, run_privileged};

#[derive(Serialize, Clone)]
pub struct ServiceInfo {
    pub name: String,
    pub description: String,
    pub active_state: String,
    pub sub_state: String,
    pub unit_file_state: String,
}

#[derive(Deserialize)]
struct UnitEntry {
    unit: String,
    description: String,
    active: String,
    sub: String,
}

#[derive(Deserialize)]
struct UnitFileEntry {
    unit_file: String,
    state: String,
}

pub fn list() -> Result<Vec<ServiceInfo>, String> {
    let units_json = run(
        "systemctl",
        &[
            "list-units",
            "--type=service",
            "--all",
            "--no-pager",
            "--output=json",
        ],
    )?;
    let files_json = run(
        "systemctl",
        &[
            "list-unit-files",
            "--type=service",
            "--no-pager",
            "--output=json",
        ],
    )?;

    let units: Vec<UnitEntry> =
        serde_json::from_str(&units_json).map_err(|e| format!("Bad systemctl JSON: {e}"))?;
    let files: Vec<UnitFileEntry> =
        serde_json::from_str(&files_json).map_err(|e| format!("Bad systemctl JSON: {e}"))?;
    let file_states: HashMap<String, String> = files
        .into_iter()
        .map(|f| (f.unit_file, f.state))
        .collect();

    let mut services: Vec<ServiceInfo> = units
        .into_iter()
        .map(|u| {
            let unit_file_state = file_states.get(&u.unit).cloned().unwrap_or_default();
            ServiceInfo {
                name: u.unit.trim_end_matches(".service").to_string(),
                description: u.description,
                active_state: u.active,
                sub_state: u.sub,
                unit_file_state,
            }
        })
        .collect();
    services.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(services)
}

const ALLOWED_ACTIONS: &[&str] = &["start", "stop", "restart", "enable", "disable"];

pub fn action(service: &str, verb: &str) -> Result<(), String> {
    if !ALLOWED_ACTIONS.contains(&verb) {
        return Err(format!("Unsupported action: {verb}"));
    }
    // Unit names are passed to pkexec/systemctl as a single argv entry, but
    // reject anything that isn't a plain unit name to keep the surface tight.
    if !service
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '@' | ':' | '\\'))
    {
        return Err("Invalid service name.".into());
    }
    let unit = format!("{service}.service");
    run_privileged("systemctl", &[verb, &unit]).map(|_| ())
}
