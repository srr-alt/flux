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
    // No alias for "Container": docker emits BOTH keys with the same value,
    // and serde treats a second hit on one field as a duplicate-field error,
    // silently killing the whole line in filter_map.
    #[serde(rename = "ID")]
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
    // --no-trunc: full 64-char ids so they match list()'s ps --no-trunc keys.
    let out = run(
        "docker",
        &["stats", "--no-stream", "--no-trunc", "--format", "{{json .}}"],
    )
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

// --- Images ---

#[derive(Serialize, Clone)]
pub struct ImageInfo {
    pub id: String,
    pub repository: String,
    pub tag: String,
    pub size: String,
    pub created_since: String,
    /// Number of containers using this image (docker returns "N/A" pre-df).
    pub containers: String,
}

#[derive(Deserialize)]
struct ImageLine {
    #[serde(rename = "ID")]
    id: String,
    #[serde(rename = "Repository")]
    repository: String,
    #[serde(rename = "Tag")]
    tag: String,
    #[serde(rename = "Size", default)]
    size: String,
    #[serde(rename = "CreatedSince", default)]
    created_since: String,
    #[serde(rename = "Containers", default)]
    containers: String,
}

pub fn images() -> Result<Vec<ImageInfo>, String> {
    let out = run("docker", &["images", "--format", "{{json .}}"]).map_err(friendly)?;
    Ok(out
        .lines()
        .filter_map(|line| serde_json::from_str::<ImageLine>(line).ok())
        .map(|i| ImageInfo {
            id: i.id,
            repository: i.repository,
            tag: i.tag,
            size: i.size,
            created_since: i.created_since,
            containers: i.containers,
        })
        .collect())
}

/// Reject values that could be misread as CLI flags when passed as argv.
pub(crate) fn safe_ref(value: &str) -> Result<&str, String> {
    let v = value.trim();
    if v.is_empty() || v.starts_with('-') || v.chars().any(char::is_whitespace) {
        return Err(format!("invalid reference: {value:?}"));
    }
    Ok(v)
}

pub fn image_remove(id: &str) -> Result<(), String> {
    run("docker", &["rmi", safe_ref(id)?]).map_err(friendly).map(drop)
}

/// Pull blocks until the image is downloaded; callers run it off-thread and
/// show a busy state.
pub fn image_pull(reference: &str) -> Result<(), String> {
    run("docker", &["pull", safe_ref(reference)?])
        .map_err(friendly)
        .map(drop)
}

// --- Volumes ---

#[derive(Serialize, Clone)]
pub struct VolumeInfo {
    pub name: String,
    pub driver: String,
    pub mountpoint: String,
}

#[derive(Deserialize)]
struct VolumeLine {
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "Driver")]
    driver: String,
    #[serde(rename = "Mountpoint", default)]
    mountpoint: String,
}

pub fn volumes() -> Result<Vec<VolumeInfo>, String> {
    let out = run("docker", &["volume", "ls", "--format", "{{json .}}"]).map_err(friendly)?;
    Ok(out
        .lines()
        .filter_map(|line| serde_json::from_str::<VolumeLine>(line).ok())
        .map(|v| VolumeInfo {
            name: v.name,
            driver: v.driver,
            mountpoint: v.mountpoint,
        })
        .collect())
}

pub fn volume_remove(name: &str) -> Result<(), String> {
    run("docker", &["volume", "rm", safe_ref(name)?])
        .map_err(friendly)
        .map(drop)
}

// --- Networks ---

#[derive(Serialize, Clone)]
pub struct NetworkInfo {
    pub id: String,
    pub name: String,
    pub driver: String,
    pub scope: String,
    /// bridge/host/none can't be removed.
    pub builtin: bool,
}

#[derive(Deserialize)]
struct NetworkLine {
    #[serde(rename = "ID")]
    id: String,
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "Driver")]
    driver: String,
    #[serde(rename = "Scope", default)]
    scope: String,
}

pub fn networks() -> Result<Vec<NetworkInfo>, String> {
    let out = run("docker", &["network", "ls", "--format", "{{json .}}"]).map_err(friendly)?;
    Ok(out
        .lines()
        .filter_map(|line| serde_json::from_str::<NetworkLine>(line).ok())
        .map(|n| NetworkInfo {
            builtin: matches!(n.name.as_str(), "bridge" | "host" | "none"),
            id: n.id,
            name: n.name,
            driver: n.driver,
            scope: n.scope,
        })
        .collect())
}

pub fn network_remove(id: &str) -> Result<(), String> {
    run("docker", &["network", "rm", safe_ref(id)?])
        .map_err(friendly)
        .map(drop)
}

// --- Compose projects ---

#[derive(Serialize, Clone)]
pub struct ComposeProject {
    pub name: String,
    /// e.g. "running(2)", "exited(1)"
    pub status: String,
    pub config_files: Vec<String>,
}

#[derive(Deserialize)]
struct ComposeLine {
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "Status", default)]
    status: String,
    #[serde(rename = "ConfigFiles", default)]
    config_files: String,
}

pub fn compose_projects() -> Result<Vec<ComposeProject>, String> {
    // compose ls emits a JSON array (unlike the line-per-object ps/images).
    let out = run("docker", &["compose", "ls", "-a", "--format", "json"]).map_err(friendly)?;
    let lines: Vec<ComposeLine> = serde_json::from_str(out.trim()).unwrap_or_default();
    Ok(lines
        .into_iter()
        .map(|c| ComposeProject {
            name: c.name,
            status: c.status,
            config_files: c
                .config_files
                .split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(String::from)
                .collect(),
        })
        .collect())
}

/// `docker compose -f <file> up -d` for a user-picked compose file. The
/// project name derives from the file's directory. Blocks while images pull;
/// callers run it off-thread and show a busy state.
pub fn compose_up_file(file: &str) -> Result<(), String> {
    let file = file.trim();
    if file.is_empty() || file.starts_with('-') {
        return Err(format!("invalid compose file path: {file:?}"));
    }
    run("docker", &["compose", "-f", file, "up", "-d"])
        .map_err(friendly)
        .map(drop)
}

pub fn compose_action(name: &str, config_files: &[String], verb: &str) -> Result<(), String> {
    let name = safe_ref(name)?;
    let mut args: Vec<&str> = vec!["compose", "-p", name];
    // up needs the config files; the others resolve containers by project label.
    if verb == "up" {
        for f in config_files {
            if f.starts_with('-') {
                return Err(format!("invalid compose file path: {f:?}"));
            }
            args.push("-f");
            args.push(f);
        }
    }
    match verb {
        "up" => args.extend(["up", "-d"]),
        "down" | "stop" | "start" | "restart" => args.push(verb),
        other => return Err(format!("unsupported compose action: {other}")),
    }
    run("docker", &args).map_err(friendly).map(drop)
}

// --- Disk usage + prune ---

#[derive(Serialize, Clone)]
pub struct DiskUsageRow {
    /// Images | Containers | Local Volumes | Build Cache
    pub kind: String,
    pub total: String,
    pub active: String,
    pub size: String,
    pub reclaimable: String,
}

#[derive(Deserialize)]
struct DfLine {
    #[serde(rename = "Type")]
    kind: String,
    #[serde(rename = "TotalCount", default)]
    total: String,
    #[serde(rename = "Active", default)]
    active: String,
    #[serde(rename = "Size", default)]
    size: String,
    #[serde(rename = "Reclaimable", default)]
    reclaimable: String,
}

pub fn disk_usage() -> Result<Vec<DiskUsageRow>, String> {
    let out = run("docker", &["system", "df", "--format", "{{json .}}"]).map_err(friendly)?;
    Ok(out
        .lines()
        .filter_map(|line| serde_json::from_str::<DfLine>(line).ok())
        .map(|d| DiskUsageRow {
            kind: d.kind,
            total: d.total,
            active: d.active,
            size: d.size,
            reclaimable: d.reclaimable,
        })
        .collect())
}

/// Returns the CLI's "Total reclaimed space: …" summary.
pub fn prune(target: &str) -> Result<String, String> {
    // Fixed target set — never interpolate arbitrary strings into the CLI.
    let args: &[&str] = match target {
        "system" => &["system", "prune", "-f"],
        "images" => &["image", "prune", "-af"],
        "volumes" => &["volume", "prune", "-af"],
        "builder" => &["builder", "prune", "-af"],
        other => return Err(format!("unsupported prune target: {other}")),
    };
    let out = run("docker", args).map_err(friendly)?;
    Ok(out
        .lines()
        .rev()
        .find(|l| l.starts_with("Total reclaimed"))
        .unwrap_or("Done")
        .to_string())
}

// --- Container inspect ---

#[derive(Serialize, Clone)]
pub struct MountInfo {
    pub kind: String,
    pub source: String,
    pub destination: String,
    pub rw: bool,
}

#[derive(Serialize, Clone)]
pub struct PortBinding {
    /// e.g. "80/tcp"
    pub container_port: String,
    /// e.g. "0.0.0.0:8080"; empty when unpublished.
    pub host: String,
}

#[derive(Serialize, Clone)]
pub struct ContainerDetail {
    pub id: String,
    pub name: String,
    pub image: String,
    pub created: String,
    pub restart_policy: String,
    pub cmd: Vec<String>,
    pub entrypoint: Vec<String>,
    pub env: Vec<String>,
    pub mounts: Vec<MountInfo>,
    pub ports: Vec<PortBinding>,
    /// network name -> IP address
    pub networks: Vec<(String, String)>,
}

pub fn inspect(id: &str) -> Result<ContainerDetail, String> {
    use serde_json::Value;
    let out = run("docker", &["inspect", safe_ref(id)?]).map_err(friendly)?;
    let parsed: Vec<Value> =
        serde_json::from_str(out.trim()).map_err(|e| format!("inspect parse: {e}"))?;
    let v = parsed.into_iter().next().ok_or("container not found")?;

    let str_at = |val: &Value, path: &[&str]| -> String {
        let mut cur = val;
        for p in path {
            cur = &cur[p];
        }
        cur.as_str().unwrap_or_default().to_string()
    };
    let str_vec = |val: &Value| -> Vec<String> {
        val.as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default()
    };

    let mounts = v["Mounts"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|m| MountInfo {
                    kind: str_at(m, &["Type"]),
                    // Named volumes carry Name instead of a host Source path.
                    source: if str_at(m, &["Source"]).is_empty() {
                        str_at(m, &["Name"])
                    } else {
                        str_at(m, &["Source"])
                    },
                    destination: str_at(m, &["Destination"]),
                    rw: m["RW"].as_bool().unwrap_or(true),
                })
                .collect()
        })
        .unwrap_or_default();

    let mut ports = Vec::new();
    if let Some(map) = v["NetworkSettings"]["Ports"].as_object() {
        for (cport, bindings) in map {
            match bindings.as_array().filter(|a| !a.is_empty()) {
                Some(binds) => {
                    for b in binds {
                        ports.push(PortBinding {
                            container_port: cport.clone(),
                            host: format!(
                                "{}:{}",
                                str_at(b, &["HostIp"]),
                                str_at(b, &["HostPort"])
                            ),
                        });
                    }
                }
                None => ports.push(PortBinding {
                    container_port: cport.clone(),
                    host: String::new(),
                }),
            }
        }
    }

    let networks = v["NetworkSettings"]["Networks"]
        .as_object()
        .map(|m| {
            m.iter()
                .map(|(name, net)| (name.clone(), str_at(net, &["IPAddress"])))
                .collect()
        })
        .unwrap_or_default();

    Ok(ContainerDetail {
        id: str_at(&v, &["Id"]),
        name: str_at(&v, &["Name"]).trim_start_matches('/').to_string(),
        image: str_at(&v, &["Config", "Image"]),
        created: str_at(&v, &["Created"]),
        restart_policy: str_at(&v, &["HostConfig", "RestartPolicy", "Name"]),
        cmd: str_vec(&v["Config"]["Cmd"]),
        entrypoint: str_vec(&v["Config"]["Entrypoint"]),
        env: str_vec(&v["Config"]["Env"]),
        mounts,
        ports,
        networks,
    })
}

// --- Run new container ---

#[derive(Deserialize)]
pub struct RunSpec {
    pub image: String,
    pub name: Option<String>,
    /// "8080:80" host:container pairs.
    pub ports: Vec<String>,
    /// "KEY=value" pairs.
    pub env: Vec<String>,
    /// "/host/path:/container/path" pairs.
    pub volumes: Vec<String>,
}

pub fn run_container(spec: &RunSpec) -> Result<(), String> {
    let image = safe_ref(&spec.image)?;
    let mut args: Vec<String> = vec!["run".into(), "-d".into()];
    if let Some(name) = spec.name.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        args.push("--name".into());
        args.push(safe_ref(name)?.to_string());
    }
    for p in &spec.ports {
        let p = p.trim();
        if p.is_empty() {
            continue;
        }
        if !p
            .chars()
            .all(|c| c.is_ascii_digit() || c == ':' || c == '.' || c == '-' || c == '/')
        {
            return Err(format!("invalid port mapping: {p:?}"));
        }
        args.push("-p".into());
        args.push(p.to_string());
    }
    for e in &spec.env {
        let e = e.trim();
        if e.is_empty() {
            continue;
        }
        if !e.contains('=') || e.starts_with('-') {
            return Err(format!("invalid env entry (want KEY=value): {e:?}"));
        }
        args.push("-e".into());
        args.push(e.to_string());
    }
    for vol in &spec.volumes {
        let vol = vol.trim();
        if vol.is_empty() {
            continue;
        }
        if vol.starts_with('-') || !vol.contains(':') {
            return Err(format!("invalid volume mapping (want host:container): {vol:?}"));
        }
        args.push("-v".into());
        args.push(vol.to_string());
    }
    args.push(image.to_string());
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run("docker", &arg_refs).map_err(friendly).map(drop)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Integration tests against the local daemon; run with --ignored.
    #[test]
    #[ignore = "needs docker daemon"]
    fn inspect_first_container() {
        let containers = list().expect("list");
        let Some(c) = containers.first() else { return };
        let d = inspect(&c.id).expect("inspect");
        assert!(!d.id.is_empty());
        assert_eq!(d.name, c.name);
        assert!(!d.image.is_empty());
    }

    #[test]
    #[ignore = "needs docker daemon + a running container"]
    fn stats_ids_match_list_ids() {
        let listed: std::collections::HashSet<String> =
            list().expect("list").into_iter().map(|c| c.id).collect();
        let all = stats().expect("stats");
        assert!(!all.is_empty(), "start a container first");
        for s in all {
            assert!(
                listed.contains(&s.id),
                "stats id {} not found in ps ids (truncation mismatch?)",
                s.id
            );
        }
    }

    #[test]
    #[ignore = "needs docker daemon"]
    fn lists_parse() {
        images().expect("images");
        volumes().expect("volumes");
        networks().expect("networks");
        compose_projects().expect("compose");
        disk_usage().expect("df");
    }

    #[test]
    fn compose_up_file_rejects_flags() {
        assert!(compose_up_file("--privileged").is_err());
        assert!(compose_up_file("").is_err());
        assert!(compose_up_file("  ").is_err());
    }

    #[test]
    fn run_spec_rejects_flags() {
        let spec = RunSpec {
            image: "--privileged".into(),
            name: None,
            ports: vec![],
            env: vec![],
            volumes: vec![],
        };
        assert!(run_container(&spec).is_err());
        assert!(safe_ref("-rf").is_err());
        assert!(safe_ref("a b").is_err());
        assert!(safe_ref("nginx:latest").is_ok());
    }
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
