//! Docker container management via the docker CLI (JSON format output,
//! docker 20+). CLI over the socket API: no new dependency, and pkexec-free —
//! the desktop user is expected to be in the docker group.

use serde::{Deserialize, Serialize};

use super::run;

#[derive(Serialize, Clone)]
pub struct ContainerInfo {
    pub id: String,
    pub name: String,
    pub image: String,
    /// running | exited | paused | restarting | created | dead
    pub state: String,
    /// Human status, e.g. "Up 2 hours", "Exited (0) 3 days ago".
    pub status: String,
    pub ports: String,
    pub created_at: String,
}

#[derive(Serialize, Clone)]
pub struct ContainerStats {
    pub id: String,
    pub cpu_pct: f64,
    pub mem_pct: f64,
    /// Raw docker rendering, e.g. "12.3MiB / 15.5GiB".
    pub mem_usage: String,
    pub net_io: String,
    pub block_io: String,
    pub pids: u32,
}

#[derive(Deserialize)]
struct PsLine {
    #[serde(rename = "ID")]
    id: String,
    #[serde(rename = "Names")]
    names: String,
    #[serde(rename = "Image")]
    image: String,
    #[serde(rename = "State")]
    state: String,
    #[serde(rename = "Status")]
    status: String,
    #[serde(rename = "Ports", default)]
    ports: String,
    #[serde(rename = "CreatedAt", default)]
    created_at: String,
}

#[derive(Deserialize)]
struct StatsLine {
    #[serde(rename = "ID", alias = "Container")]
    id: String,
    #[serde(rename = "CPUPerc")]
    cpu_perc: String,
    #[serde(rename = "MemPerc")]
    mem_perc: String,
    #[serde(rename = "MemUsage")]
    mem_usage: String,
    #[serde(rename = "NetIO", default)]
    net_io: String,
    #[serde(rename = "BlockIO", default)]
    block_io: String,
    #[serde(rename = "PIDs", default)]
    pids: String,
}

/// Map raw CLI failures to something a user can act on.
fn friendly(err: String) -> String {
    if err.contains("No such file or directory") || err.contains("Failed to run docker") {
        "Docker CLI not found — is Docker installed?".into()
    } else if err.contains("permission denied") && err.contains("docker.sock") {
        "Permission denied on the Docker socket. Add your user to the docker group: sudo usermod -aG docker $USER (then log out and back in).".into()
    } else if err.contains("Cannot connect to the Docker daemon") {
        "Docker daemon is not running. Start it with: sudo systemctl start docker".into()
    } else {
        err
    }
}

pub fn list() -> Result<Vec<ContainerInfo>, String> {
    let out = run("docker", &["ps", "-a", "--no-trunc", "--format", "{{json .}}"])
        .map_err(friendly)?;
    Ok(out
        .lines()
        .filter_map(|line| serde_json::from_str::<PsLine>(line).ok())
        .map(|p| ContainerInfo {
            id: p.id,
            name: p.names,
            image: p.image,
            state: p.state,
            status: p.status,
            ports: p.ports,
            created_at: p.created_at,
        })
        .collect())
}

/// One-shot stats for running containers. docker blocks ~1s collecting the
/// deltas, so callers poll this on a slower cadence than list().
pub fn stats() -> Result<Vec<ContainerStats>, String> {
    let out = run("docker", &["stats", "--no-stream", "--format", "{{json .}}"])
        .map_err(friendly)?;
    fn pct(s: &str) -> f64 {
        s.trim_end_matches('%').parse().unwrap_or(0.0)
    }
    Ok(out
        .lines()
        .filter_map(|line| serde_json::from_str::<StatsLine>(line).ok())
        .map(|s| ContainerStats {
            id: s.id,
            cpu_pct: pct(&s.cpu_perc),
            mem_pct: pct(&s.mem_perc),
            mem_usage: s.mem_usage,
            net_io: s.net_io,
            block_io: s.block_io,
            pids: s.pids.parse().unwrap_or(0),
        })
        .collect())
}

pub fn action(id: &str, verb: &str) -> Result<(), String> {
    // Fixed verb set — never interpolate arbitrary strings into the CLI.
    let verb = match verb {
        "start" | "stop" | "restart" | "pause" | "unpause" => verb,
        "remove" => return run("docker", &["rm", id]).map_err(friendly).map(drop),
        other => return Err(format!("unsupported container action: {other}")),
    };
    run("docker", &[verb, id]).map_err(friendly).map(drop)
}

pub fn logs(id: &str, tail: u32) -> Result<String, String> {
    // docker logs writes to both streams; run() only captures stdout, so
    // spawn manually and merge.
    let output = std::process::Command::new("docker")
        .args(["logs", "--tail", &tail.to_string(), id])
        .output()
        .map_err(|e| friendly(format!("Failed to run docker: {e}")))?;
    if !output.status.success() {
        return Err(friendly(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !stderr.trim().is_empty() {
        if !text.is_empty() && !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str(&stderr);
    }
    Ok(text)
}
