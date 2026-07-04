//! Headless Flux metrics agent. Runs on a remote host under SSH:
//! - stdout: JSON-lines `AgentEvent`s (hello, tick, disks, responses)
//! - stdin:  JSON-lines `AgentRequest`s (processes, kill, renice, interval)
//! Exits when stdin closes, so a dropped SSH session can't leave orphans.

use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use sysinfo::{Disks, Networks, System};

use flux_core::disk::IoCounters;
use flux_core::protocol::{AgentEvent, AgentRequest};
use flux_core::{cpu, disk, memory, network, process, process_actions, system_info, TickSnapshot};

static INTERVAL_MS: AtomicU64 = AtomicU64::new(1000);

fn emit(event: &AgentEvent) {
    let mut stdout = std::io::stdout().lock();
    if let Ok(line) = serde_json::to_string(event) {
        let _ = stdout.write_all(line.as_bytes());
        let _ = stdout.write_all(b"\n");
        let _ = stdout.flush();
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--version") {
        println!("flux-agent {}", env!("CARGO_PKG_VERSION"));
        return;
    }
    if let Some(idx) = args.iter().position(|a| a == "--interval-ms") {
        if let Some(ms) = args.get(idx + 1).and_then(|v| v.parse::<u64>().ok()) {
            INTERVAL_MS.store(ms.clamp(250, 10_000), Ordering::Relaxed);
        }
    }

    // stdin reader thread: requests come in, EOF ends the process.
    let (request_tx, request_rx) = mpsc::channel::<AgentRequest>();
    std::thread::spawn(move || {
        let stdin = std::io::stdin().lock();
        for line in stdin.lines() {
            let Ok(line) = line else { break };
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<AgentRequest>(&line) {
                Ok(request) => {
                    if request_tx.send(request).is_err() {
                        break;
                    }
                }
                Err(err) => emit(&AgentEvent::Response {
                    id: 0,
                    ok: false,
                    data: None,
                    error: Some(format!("bad request: {err}")),
                }),
            }
        }
        // stdin closed (session gone): dropping the sender makes the main
        // loop see Disconnected after draining queued requests, then exit.
    });

    let mut sys = System::new();
    let mut proc_sys = System::new();
    proc_sys.refresh_cpu_list(sysinfo::CpuRefreshKind::nothing());
    let mut networks = Networks::new_with_refreshed_list();
    let mut disks = Disks::new_with_refreshed_list();
    let mut prev_disk_io: HashMap<String, IoCounters> = HashMap::new();
    let uids = process::uid_table();
    let mut last_tick = Instant::now();
    let mut last_proc_refresh: Option<Instant> = None;
    let mut tick_count: u64 = 0;

    sys.refresh_cpu_specifics(sysinfo::CpuRefreshKind::nothing().with_cpu_usage());
    emit(&AgentEvent::Hello {
        version: env!("CARGO_PKG_VERSION").to_string(),
        system_info: system_info::collect(&sys),
    });

    loop {
        // Drain any pending requests, then sleep the remainder of the tick.
        let deadline = last_tick + Duration::from_millis(INTERVAL_MS.load(Ordering::Relaxed));
        loop {
            let now = Instant::now();
            let timeout = deadline.saturating_duration_since(now);
            match request_rx.recv_timeout(timeout) {
                Ok(request) => handle_request(request, &mut proc_sys, &uids, &mut last_proc_refresh),
                Err(mpsc::RecvTimeoutError::Timeout) => break,
                Err(mpsc::RecvTimeoutError::Disconnected) => return,
            }
        }

        let elapsed = last_tick.elapsed().as_secs_f64();
        last_tick = Instant::now();
        tick_count += 1;

        sys.refresh_cpu_specifics(
            sysinfo::CpuRefreshKind::nothing()
                .with_cpu_usage()
                .with_frequency(),
        );
        networks.refresh(true);
        let tick = TickSnapshot {
            timestamp_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
            cpu: cpu::snapshot(&sys),
            memory: memory::snapshot(),
            network: network::snapshot(&networks, elapsed),
        };
        emit(&AgentEvent::Tick(tick));

        // Disks at half cadence, mirroring the local monitor loop.
        if tick_count % 2 == 0 {
            disks.refresh(true);
            emit(&AgentEvent::Disks(disk::DiskSnapshot {
                mounts: disk::mounts(&disks),
                io: disk::io_rates(&mut prev_disk_io),
            }));
        }
    }
}

fn handle_request(
    request: AgentRequest,
    proc_sys: &mut System,
    uids: &HashMap<u32, String>,
    last_proc_refresh: &mut Option<Instant>,
) {
    match request {
        AgentRequest::Processes { id, query } => {
            proc_sys.refresh_processes_specifics(
                sysinfo::ProcessesToUpdate::All,
                true,
                sysinfo::ProcessRefreshKind::everything().without_tasks(),
            );
            let now = Instant::now();
            let elapsed = last_proc_refresh
                .map(|t| now.duration_since(t).as_secs_f64())
                .unwrap_or(0.0);
            *last_proc_refresh = Some(now);
            let list = process::list(proc_sys, uids, &query, elapsed);
            respond_json(id, &list);
        }
        AgentRequest::Kill { id, pid, force } => {
            respond_result(id, process_actions::kill_process(pid, force));
        }
        AgentRequest::Renice { id, pid, niceness } => {
            respond_result(id, process_actions::renice_process(pid, niceness));
        }
        AgentRequest::SetInterval { id, ms } => {
            INTERVAL_MS.store(ms.clamp(250, 10_000), Ordering::Relaxed);
            respond_result(id, Ok(()));
        }
    }
}

fn respond_json<T: serde::Serialize>(id: u64, data: &T) {
    match serde_json::to_value(data) {
        Ok(value) => emit(&AgentEvent::Response {
            id,
            ok: true,
            data: Some(value),
            error: None,
        }),
        Err(err) => emit(&AgentEvent::Response {
            id,
            ok: false,
            data: None,
            error: Some(err.to_string()),
        }),
    }
}

fn respond_result(id: u64, result: Result<(), String>) {
    match result {
        Ok(()) => emit(&AgentEvent::Response {
            id,
            ok: true,
            data: None,
            error: None,
        }),
        Err(err) => emit(&AgentEvent::Response {
            id,
            ok: false,
            data: None,
            error: Some(err),
        }),
    }
}
