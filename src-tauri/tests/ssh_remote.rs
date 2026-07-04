//! Integration test against a live sshd (docker container).
//! Run explicitly:
//!   docker run -d --name flux-sshd -p 2299:22 ubuntu:22.04 ... (see GITHUB.md)
//!   cargo test -p flux --test ssh_remote -- --ignored --nocapture
//! Env overrides: FLUX_TEST_SSH_ADDR/PORT/USER/PASSWORD.

use flux_lib::remote::agentless::{self, AgentlessDeltas};
use flux_lib::remote::session::{HostKeyStatus, SshSession};

fn env(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

#[test]
#[ignore = "needs the flux-sshd docker container"]
fn full_remote_flow() {
    let addr = env("FLUX_TEST_SSH_ADDR", "127.0.0.1");
    let port: u16 = env("FLUX_TEST_SSH_PORT", "2299").parse().unwrap();
    let user = env("FLUX_TEST_SSH_USER", "test");
    let password = env("FLUX_TEST_SSH_PASSWORD", "test123");
    let tmp = std::env::temp_dir().join("flux-test-known-hosts");
    let _ = std::fs::remove_file(&tmp);

    // --- TOFU: unknown on first contact, known after remember ---
    let session = SshSession::connect(&addr, port).expect("connect");
    let fingerprint = session.fingerprint().expect("fingerprint");
    assert!(fingerprint.starts_with("SHA256:"), "{fingerprint}");
    assert!(matches!(
        session.check_host_key(&tmp).unwrap(),
        HostKeyStatus::Unknown
    ));
    session.remember_host_key(&tmp).expect("remember");
    assert!(matches!(
        session.check_host_key(&tmp).unwrap(),
        HostKeyStatus::Known
    ));

    // --- password auth + statics ---
    session.auth_password(&user, &password).expect("password auth");
    let info = agentless::statics(&session).expect("statics");
    assert!(!info.hostname.is_empty());
    assert!(info.logical_cores > 0);
    assert!(info.total_memory_kb > 0);
    println!("statics: {} {} {}", info.hostname, info.os_pretty_name, info.kernel_version);

    // --- key provisioning (mirrors add_host) ---
    let keydir = std::env::temp_dir().join("flux-test-keys");
    let _ = std::fs::remove_dir_all(&keydir);
    std::fs::create_dir_all(&keydir).unwrap();
    let key = keydir.join("id_ed25519");
    let out = std::process::Command::new("ssh-keygen")
        .args(["-t", "ed25519", "-N", "", "-q", "-f"])
        .arg(&key)
        .output()
        .unwrap();
    assert!(out.status.success());
    let pubkey = std::fs::read_to_string(key.with_extension("pub"))
        .unwrap()
        .trim()
        .to_string();
    session
        .exec_capture(&format!(
            "mkdir -p ~/.ssh && chmod 700 ~/.ssh && \
             grep -qxF '{pubkey}' ~/.ssh/authorized_keys 2>/dev/null || \
             printf '%s\\n' '{pubkey}' >> ~/.ssh/authorized_keys; \
             chmod 600 ~/.ssh/authorized_keys"
        ))
        .expect("install key");
    let keyed = SshSession::connect(&addr, port).expect("reconnect");
    keyed.auth_key(&user, &key).expect("key auth after provisioning");

    // --- agentless polling: baseline then real snapshot ---
    let mut deltas = AgentlessDeltas::new();
    deltas.uid_names = agentless::uid_table(&keyed);
    assert!(deltas.uid_names.values().any(|n| n == &user));
    let first = agentless::poll(&keyed, &mut deltas).expect("poll 1");
    assert!(first.is_none(), "first sample must only set the baseline");
    std::thread::sleep(std::time::Duration::from_millis(1200));
    let (tick, disks) = agentless::poll(&keyed, &mut deltas)
        .expect("poll 2")
        .expect("second sample must produce a snapshot");
    assert!(tick.memory.total_kb > 0);
    assert!(!tick.cpu.per_core_usage_pct.is_empty());
    assert!(tick.cpu.global_usage_pct >= 0.0 && tick.cpu.global_usage_pct <= 100.0);
    assert!(!disks.mounts.is_empty(), "df should list at least /");
    println!(
        "tick: cpu={:.1}% cores={} mem={}MB mounts={}",
        tick.cpu.global_usage_pct,
        tick.cpu.per_core_usage_pct.len(),
        tick.memory.total_kb / 1024,
        disks.mounts.len()
    );

    // --- processes + kill ---
    keyed
        .exec_capture("nohup sleep 500 >/dev/null 2>&1 & echo started")
        .expect("spawn sleep");
    std::thread::sleep(std::time::Duration::from_millis(600));
    let query = flux_core::process::ProcessQuery {
        sort_by: "cpu".into(),
        sort_desc: true,
        search: Some("sleep".into()),
        limit: None,
    };
    let procs = agentless::processes(&keyed, &mut deltas, &query).expect("ps");
    let victim = procs
        .iter()
        .find(|p| p.name == "sleep")
        .expect("sleep visible in remote process list");
    assert_eq!(victim.user, user);
    agentless::kill(&keyed, victim.pid, false).expect("kill");
    std::thread::sleep(std::time::Duration::from_millis(400));
    let after = agentless::processes(&keyed, &mut deltas, &query).expect("ps after kill");
    assert!(
        !after.iter().any(|p| p.pid == victim.pid),
        "victim survived TERM"
    );

    // --- agent deploy: upload + version + stream one tick ---
    let agent_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../target/debug/flux-agent");
    let binary = std::fs::read(&agent_path).expect("build flux-agent first");
    keyed
        .upload(&binary, ".local/share/flux/flux-agent", 0o755)
        .expect("sftp upload");
    let version = keyed
        .exec_capture("\"$HOME\"/.local/share/flux/flux-agent --version")
        .expect("agent --version");
    assert!(version.starts_with("flux-agent"), "{version}");
    let stream = keyed
        .exec_capture(
            "timeout 3 \"$HOME\"/.local/share/flux/flux-agent --interval-ms 500 </dev/null; true",
        )
        .expect("agent run");
    assert!(stream.contains("\"type\":\"hello\""), "no hello in: {stream}");
    println!("agent: {version}, hello OK, {} stdout bytes", stream.len());
}
