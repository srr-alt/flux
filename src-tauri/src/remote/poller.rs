use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::time::Duration;

use tauri::{AppHandle, Emitter};

use flux_core::process::{ProcessInfo, ProcessQuery};

use super::agentless::{self, AgentlessDeltas};
use super::hosts::HostConfig;
use super::session::{HostKeyStatus, SshSession};
use super::{
    CollectionMode, HostStatus, HostStatusEvent, RemoteEvent, EVENT_HOST_STATUS,
    EVENT_REMOTE_DISKS, EVENT_REMOTE_TICK,
};

pub enum Control {
    Stop,
    Processes(ProcessQuery, Sender<Result<Vec<ProcessInfo>, String>>),
    Kill(u32, bool, Sender<Result<(), String>>),
    /// Phase B: switch the poll loop to the deployed agent binary.
    #[allow(dead_code)]
    SwitchToAgent,
}

const BACKOFF_STEPS: &[u64] = &[1, 2, 5, 15, 30];
/// Poll failures tolerated before the host is marked Degraded.
const DEGRADE_AFTER: u32 = 3;

fn emit_status(app: &AppHandle, host_id: &str, status: HostStatus) {
    let _ = app.emit(
        EVENT_HOST_STATUS,
        HostStatusEvent {
            host_id: host_id.to_string(),
            status,
            system_info: None,
        },
    );
}

/// Entry point for the per-host thread. Owns the SSH session, the delta
/// state, and the control channel. Exits only on `Control::Stop` or when
/// the channel is dropped (host removed).
pub fn run(
    app: AppHandle,
    config: HostConfig,
    known_hosts: std::path::PathBuf,
    interval_ms: u64,
    control: Receiver<Control>,
) {
    let host_id = config.id.clone();
    let mut backoff_idx = 0usize;

    'reconnect: loop {
        emit_status(&app, &host_id, HostStatus::Connecting);

        let session = match connect(&config, &known_hosts) {
            Ok(session) => {
                backoff_idx = 0;
                session
            }
            Err(err) => {
                emit_status(&app, &host_id, HostStatus::Error { message: err });
                let wait = BACKOFF_STEPS[backoff_idx.min(BACKOFF_STEPS.len() - 1)];
                backoff_idx += 1;
                // Sleep in channel-recv slices so Stop still lands promptly.
                match control.recv_timeout(Duration::from_secs(wait)) {
                    Ok(Control::Stop) | Err(RecvTimeoutError::Disconnected) => return,
                    Ok(_) | Err(RecvTimeoutError::Timeout) => continue 'reconnect,
                }
            }
        };

        let mut deltas = AgentlessDeltas::new();
        deltas.uid_names = agentless::uid_table(&session);

        match agentless::statics(&session) {
            Ok(info) => {
                let _ = app.emit(
                    EVENT_HOST_STATUS,
                    HostStatusEvent {
                        host_id: host_id.clone(),
                        status: HostStatus::Connected {
                            mode: CollectionMode::Agentless,
                        },
                        system_info: Some(info),
                    },
                );
            }
            Err(err) => {
                emit_status(&app, &host_id, HostStatus::Error { message: err });
                continue 'reconnect;
            }
        }

        let mut consecutive_failures = 0u32;
        loop {
            match agentless::poll(&session, &mut deltas) {
                Ok(Some((tick, disks))) => {
                    consecutive_failures = 0;
                    let _ = app.emit(
                        EVENT_REMOTE_TICK,
                        RemoteEvent {
                            host_id: host_id.clone(),
                            snapshot: tick,
                        },
                    );
                    let _ = app.emit(
                        EVENT_REMOTE_DISKS,
                        RemoteEvent {
                            host_id: host_id.clone(),
                            snapshot: disks,
                        },
                    );
                }
                Ok(None) => {} // first sample: baseline only
                Err(_err) => {
                    consecutive_failures += 1;
                    if consecutive_failures >= DEGRADE_AFTER {
                        emit_status(&app, &host_id, HostStatus::Degraded);
                        continue 'reconnect;
                    }
                }
            }

            // The interval doubles as the control-message poll point, so
            // process queries piggyback on the same session between ticks.
            match control.recv_timeout(Duration::from_millis(interval_ms)) {
                Ok(Control::Stop) | Err(RecvTimeoutError::Disconnected) => {
                    emit_status(&app, &host_id, HostStatus::Disconnected);
                    return;
                }
                Ok(Control::Processes(query, reply)) => {
                    let _ = reply.send(agentless::processes(&session, &mut deltas, &query));
                }
                Ok(Control::Kill(pid, force, reply)) => {
                    let _ = reply.send(agentless::kill(&session, pid, force));
                }
                Ok(Control::SwitchToAgent) => {
                    // Phase B lands here.
                }
                Err(RecvTimeoutError::Timeout) => {}
            }
        }
    }
}

fn connect(config: &HostConfig, known_hosts: &std::path::Path) -> Result<SshSession, String> {
    let session = SshSession::connect(&config.address, config.port)?;
    match session.check_host_key(known_hosts)? {
        HostKeyStatus::Known => {}
        HostKeyStatus::Unknown => {
            return Err("host key not yet trusted — re-add the host".into());
        }
        HostKeyStatus::Changed => {
            return Err(
                "HOST KEY CHANGED — possible man-in-the-middle; remove and re-add the host to trust the new key".into(),
            );
        }
    }
    session.auth_key(&config.username, &config.key_path)?;
    Ok(session)
}
