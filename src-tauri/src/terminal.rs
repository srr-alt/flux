//! Terminal drop-in: one keystroke to a shell on any host.
//!
//! Local host: `$SHELL` under a real PTY (portable-pty), same pattern as the
//! Docker container shell. Remote hosts: a dedicated SSH session (same key
//! and known_hosts as the poller, but its own connection so an interactive
//! shell never contends with polling) with a PTY channel, driven by one
//! thread in non-blocking mode — ssh2 channels can't be split into reader
//! and writer halves, so a single loop drains input, writes, and reads.
//!
//! Output streams to the frontend on `terminal://output` as raw bytes
//! (UTF-8 sequences may split across chunks; the terminal decodes them).
//! Typed command lines are captured into the shared shell history under a
//! `host:<id>` key.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{Receiver, Sender, TryRecvError};
use std::sync::Mutex;
use std::time::Duration;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::modules::docker_prefs;
use crate::modules::docker_shell::LineCapture;
use crate::remote::hosts::HostConfig;
use crate::remote::session::{HostKeyStatus, SshSession};

pub const TERMINAL_EVENT: &str = "terminal://output";

#[derive(Clone, Serialize)]
struct TermOutput {
    session: u32,
    /// Raw PTY bytes; UTF-8 sequences may split across chunks.
    data: Vec<u8>,
    exited: bool,
}

/// Control messages for the SSH io thread.
enum SshMsg {
    Input(Vec<u8>),
    Resize(u16, u16),
    Close,
}

enum Handle {
    Local {
        master: Box<dyn MasterPty + Send>,
        writer: Box<dyn Write + Send>,
        child: Box<dyn Child + Send + Sync>,
    },
    Ssh {
        tx: Sender<SshMsg>,
    },
}

struct Session {
    handle: Handle,
    capture: LineCapture,
    /// Shell-history key, `host:<id>` — shares the docker_prefs store.
    history_key: String,
    data_dir: PathBuf,
}

#[derive(Default)]
pub struct TerminalSessions {
    inner: Mutex<HashMap<u32, Session>>,
}

static NEXT_ID: AtomicU32 = AtomicU32::new(1);

pub fn history_key(host_id: &str) -> String {
    format!("host:{host_id}")
}

fn emit(app: &AppHandle, session: u32, data: Vec<u8>, exited: bool) {
    let _ = app.emit(
        TERMINAL_EVENT,
        TermOutput {
            session,
            data,
            exited,
        },
    );
}

/// Shell on this machine: `$SHELL` (fallback bash) in `$HOME`.
pub fn open_local(
    app: AppHandle,
    sessions: &TerminalSessions,
    data_dir: PathBuf,
    cols: u16,
    rows: u16,
) -> Result<u32, String> {
    let pty = native_pty_system();
    let pair = pty
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
    let mut cmd = CommandBuilder::new(shell);
    cmd.env("TERM", "xterm-256color");
    if let Ok(home) = std::env::var("HOME") {
        cmd.cwd(home);
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    sessions.inner.lock().unwrap().insert(
        id,
        Session {
            handle: Handle::Local {
                master: pair.master,
                writer,
                child,
            },
            capture: LineCapture::default(),
            history_key: history_key("local"),
            data_dir,
        },
    );

    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => emit(&app, id, buf[..n].to_vec(), false),
            }
        }
        emit(&app, id, Vec::new(), true);
    });

    Ok(id)
}

/// Interactive shell over SSH. Connects with the host's stored key; the
/// server key must already be trusted (added via the host wizard).
pub fn open_ssh(
    app: AppHandle,
    sessions: &TerminalSessions,
    config: &HostConfig,
    known_hosts: &std::path::Path,
    data_dir: PathBuf,
    cols: u16,
    rows: u16,
) -> Result<u32, String> {
    let ssh = SshSession::connect(&config.address, config.port)?;
    match ssh.check_host_key(known_hosts)? {
        HostKeyStatus::Known => {}
        HostKeyStatus::Unknown => {
            return Err("host key not yet trusted — re-add the host".into());
        }
        HostKeyStatus::Changed => {
            return Err("HOST KEY CHANGED — possible man-in-the-middle; refusing".into());
        }
    }
    ssh.auth_key(&config.username, &config.key_path)?;

    let mut channel = ssh
        .session
        .channel_session()
        .map_err(|e| format!("channel: {e}"))?;
    channel
        .request_pty(
            "xterm-256color",
            None,
            Some((cols as u32, rows as u32, 0, 0)),
        )
        .map_err(|e| format!("pty: {e}"))?;
    channel.shell().map_err(|e| format!("shell: {e}"))?;
    // The io loop multiplexes read/write on one thread.
    ssh.session.set_blocking(false);

    let (tx, rx) = std::sync::mpsc::channel::<SshMsg>();
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    sessions.inner.lock().unwrap().insert(
        id,
        Session {
            handle: Handle::Ssh { tx },
            capture: LineCapture::default(),
            history_key: history_key(&config.id),
            data_dir,
        },
    );

    std::thread::Builder::new()
        .name(format!("flux-term-{id}"))
        .spawn(move || {
            ssh_io_loop(&app, id, channel, rx);
            // Keep the SSH session alive for the channel's whole life.
            drop(ssh);
            emit(&app, id, Vec::new(), true);
        })
        .map_err(|e| e.to_string())?;

    Ok(id)
}

fn would_block(e: &std::io::Error) -> bool {
    e.kind() == std::io::ErrorKind::WouldBlock
}

/// Single-threaded read/write/resize pump over a non-blocking channel.
fn ssh_io_loop(app: &AppHandle, id: u32, mut channel: ssh2::Channel, rx: Receiver<SshMsg>) {
    let mut pending: Vec<u8> = Vec::new();
    let mut buf = [0u8; 8192];
    'outer: loop {
        let mut idle = true;
        loop {
            match rx.try_recv() {
                Ok(SshMsg::Input(data)) => {
                    pending.extend_from_slice(&data);
                    idle = false;
                }
                Ok(SshMsg::Resize(cols, rows)) => {
                    // Best-effort; EAGAIN here just drops one resize.
                    let _ = channel.request_pty_size(cols as u32, rows as u32, None, None);
                }
                Ok(SshMsg::Close) => break 'outer,
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => break 'outer,
            }
        }
        if !pending.is_empty() {
            match channel.write(&pending) {
                Ok(n) => {
                    pending.drain(..n);
                    idle = false;
                }
                Err(e) if would_block(&e) => {}
                Err(_) => break,
            }
        }
        match channel.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                emit(app, id, buf[..n].to_vec(), false);
                idle = false;
            }
            Err(e) if would_block(&e) => {}
            Err(_) => break,
        }
        if channel.eof() {
            break;
        }
        if idle {
            std::thread::sleep(Duration::from_millis(15));
        }
    }
    let _ = channel.close();
}

pub fn write(sessions: &TerminalSessions, session: u32, data: Vec<u8>) -> Result<(), String> {
    let mut map = sessions.inner.lock().unwrap();
    let s = map.get_mut(&session).ok_or("terminal session not found")?;
    let commands = s.capture.feed(&data);
    if !commands.is_empty() {
        docker_prefs::push_shell_history(&s.data_dir, &s.history_key, &commands);
    }
    match &mut s.handle {
        Handle::Local { writer, .. } => writer.write_all(&data).map_err(|e| e.to_string()),
        Handle::Ssh { tx } => tx
            .send(SshMsg::Input(data))
            .map_err(|_| "terminal session ended".to_string()),
    }
}

pub fn resize(
    sessions: &TerminalSessions,
    session: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let map = sessions.inner.lock().unwrap();
    let s = map.get(&session).ok_or("terminal session not found")?;
    match &s.handle {
        Handle::Local { master, .. } => master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string()),
        Handle::Ssh { tx } => tx
            .send(SshMsg::Resize(cols, rows))
            .map_err(|_| "terminal session ended".to_string()),
    }
}

pub fn close(sessions: &TerminalSessions, session: u32) {
    if let Some(mut s) = sessions.inner.lock().unwrap().remove(&session) {
        match &mut s.handle {
            Handle::Local { child, .. } => {
                let _ = child.kill();
            }
            Handle::Ssh { tx } => {
                let _ = tx.send(SshMsg::Close);
            }
        }
    }
}
