//! Agent-mode collection: run the deployed flux-agent over an SSH channel,
//! stream its JSON-lines stdout into the same events the agentless path
//! emits, and forward process/kill/renice requests over its stdin.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

use flux_core::process::ProcessInfo;
use flux_core::protocol::{AgentEvent, AgentRequest};

use super::poller::Control;
use super::session::SshSession;
use super::{CollectionMode, HostStatus, RemoteEvent, EVENT_REMOTE_DISKS, EVENT_REMOTE_TICK};

pub const AGENT_REMOTE_PATH: &str = ".local/share/flux/flux-agent";

pub enum AgentOutcome {
    /// Control channel asked us to stop (host disconnect/remove).
    Stopped,
    /// Agent stream ended or errored; caller falls back to agentless.
    Died,
}

enum Pending {
    Processes(Sender<Result<Vec<ProcessInfo>, String>>),
    Unit(Sender<Result<(), String>>),
}

/// Runs until the agent dies or Stop arrives. The session is switched to
/// non-blocking for reads and back to blocking on exit so the agentless
/// fallback can keep using it.
pub fn run(
    app: &AppHandle,
    host_id: &str,
    session: &SshSession,
    control: &Receiver<Control>,
    interval_ms: u64,
) -> AgentOutcome {
    let mut channel = match session.session.channel_session() {
        Ok(c) => c,
        Err(_) => return AgentOutcome::Died,
    };
    if channel
        .exec(&format!(
            "\"$HOME\"/{AGENT_REMOTE_PATH} --interval-ms {interval_ms}"
        ))
        .is_err()
    {
        return AgentOutcome::Died;
    }

    let mut pending: HashMap<u64, Pending> = HashMap::new();
    let mut next_id: u64 = 1;
    let mut line_buf = String::new();
    let mut read_buf = [0u8; 16 * 1024];
    let mut saw_hello = false;
    let started = Instant::now();

    let outcome = loop {
        // Drain whatever the agent has written.
        session.session.set_blocking(false);
        let mut stream_ended = false;
        loop {
            match channel.read(&mut read_buf) {
                Ok(0) => {
                    stream_ended = true;
                    break;
                }
                Ok(n) => {
                    line_buf.push_str(&String::from_utf8_lossy(&read_buf[..n]));
                }
                Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => break,
                Err(_) => {
                    stream_ended = true;
                    break;
                }
            }
        }
        session.session.set_blocking(true);

        while let Some(pos) = line_buf.find('\n') {
            let line: String = line_buf.drain(..=pos).collect();
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            match serde_json::from_str::<AgentEvent>(line) {
                Ok(event) => {
                    saw_hello |= matches!(event, AgentEvent::Hello { .. });
                    handle_event(app, host_id, event, &mut pending);
                }
                Err(_) => {} // tolerate stray output (motd, shell noise)
            }
        }

        if stream_ended {
            break AgentOutcome::Died;
        }
        // No hello within 10s = wrong binary/arch, treat as dead.
        if !saw_hello && started.elapsed() > Duration::from_secs(10) {
            break AgentOutcome::Died;
        }

        match control.recv_timeout(Duration::from_millis(100)) {
            Ok(Control::Stop) | Err(RecvTimeoutError::Disconnected) => {
                break AgentOutcome::Stopped;
            }
            Ok(Control::Processes(query, reply)) => {
                let id = next_id;
                next_id += 1;
                if write_request(&mut channel, &AgentRequest::Processes { id, query }).is_ok() {
                    pending.insert(id, Pending::Processes(reply));
                } else {
                    let _ = reply.send(Err("agent write failed".into()));
                    break AgentOutcome::Died;
                }
            }
            Ok(Control::Kill(pid, force, reply)) => {
                let id = next_id;
                next_id += 1;
                if write_request(&mut channel, &AgentRequest::Kill { id, pid, force }).is_ok() {
                    pending.insert(id, Pending::Unit(reply));
                } else {
                    let _ = reply.send(Err("agent write failed".into()));
                    break AgentOutcome::Died;
                }
            }
            Ok(Control::SwitchToAgent) => {} // already in agent mode
            Err(RecvTimeoutError::Timeout) => {}
        }
    };

    // Close our side; the agent exits on stdin EOF.
    let _ = channel.send_eof();
    let _ = channel.close();
    outcome
}

fn write_request(
    channel: &mut ssh2::Channel,
    request: &AgentRequest,
) -> Result<(), std::io::Error> {
    let mut line = serde_json::to_string(request).map_err(std::io::Error::other)?;
    line.push('\n');
    channel.write_all(line.as_bytes())
}

fn handle_event(
    app: &AppHandle,
    host_id: &str,
    event: AgentEvent,
    pending: &mut HashMap<u64, Pending>,
) {
    match event {
        AgentEvent::Hello {
            version: _,
            system_info,
        } => {
            super::publish_status(
                app,
                host_id,
                HostStatus::Connected {
                    mode: CollectionMode::Agent,
                },
                Some(system_info),
            );
        }
        AgentEvent::Tick(snapshot) => {
            let _ = app.emit(
                EVENT_REMOTE_TICK,
                RemoteEvent {
                    host_id: host_id.to_string(),
                    snapshot,
                },
            );
        }
        AgentEvent::Disks(snapshot) => {
            let _ = app.emit(
                EVENT_REMOTE_DISKS,
                RemoteEvent {
                    host_id: host_id.to_string(),
                    snapshot,
                },
            );
        }
        AgentEvent::Response {
            id,
            ok,
            data,
            error,
        } => {
            let Some(entry) = pending.remove(&id) else {
                return;
            };
            match entry {
                Pending::Processes(reply) => {
                    let result = if ok {
                        data.ok_or_else(|| "empty response".to_string())
                            .and_then(|v| {
                                serde_json::from_value::<Vec<ProcessInfo>>(v)
                                    .map_err(|e| e.to_string())
                            })
                    } else {
                        Err(error.unwrap_or_else(|| "agent error".into()))
                    };
                    let _ = reply.send(result);
                }
                Pending::Unit(reply) => {
                    let result = if ok {
                        Ok(())
                    } else {
                        Err(error.unwrap_or_else(|| "agent error".into()))
                    };
                    let _ = reply.send(result);
                }
            }
        }
    }
}
