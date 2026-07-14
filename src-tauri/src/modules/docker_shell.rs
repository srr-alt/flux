//! Interactive shell into a container: `docker exec -it` under a real PTY
//! (portable-pty), streamed to the frontend terminal over a Tauri event.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::docker_prefs;

pub const SHELL_EVENT: &str = "docker://shell";

#[derive(Clone, Serialize)]
struct ShellOutput {
    session: u32,
    /// Raw PTY bytes; UTF-8 sequences may split across chunks, so the
    /// terminal decodes them, not serde.
    data: Vec<u8>,
    exited: bool,
}

/// Reassembles typed command lines from the keystroke stream so they can be
/// saved as history. Lines touched by escape sequences, tab completion, or
/// other control chars are dropped rather than recorded wrong (arrow-recalled
/// commands are already in history; full-screen apps like vim emit garbage).
#[derive(Default)]
pub(crate) struct LineCapture {
    buf: Vec<u8>,
    tainted: bool,
}

impl LineCapture {
    /// Feed raw input bytes; returns any completed command lines.
    pub(crate) fn feed(&mut self, data: &[u8]) -> Vec<String> {
        let mut done = Vec::new();
        for &b in data {
            match b {
                b'\r' | b'\n' => {
                    let line = String::from_utf8_lossy(&self.buf).trim().to_string();
                    if !self.tainted && !line.is_empty() {
                        done.push(line);
                    }
                    self.buf.clear();
                    self.tainted = false;
                }
                0x7f | 0x08 => {
                    self.buf.pop();
                }
                // Ctrl-C / Ctrl-U abandon the line.
                0x03 | 0x15 => {
                    self.buf.clear();
                    self.tainted = false;
                }
                b if b < 0x20 => self.tainted = true,
                _ => self.buf.push(b),
            }
        }
        done
    }
}

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    /// Container *name*: stable across recreations, unlike the id.
    container: String,
    capture: LineCapture,
    data_dir: PathBuf,
}

#[derive(Default)]
pub struct ShellSessions {
    inner: Mutex<HashMap<u32, Session>>,
}

static NEXT_ID: AtomicU32 = AtomicU32::new(1);

pub fn open(
    app: AppHandle,
    sessions: &ShellSessions,
    container_id: &str,
    container_name: &str,
    data_dir: PathBuf,
    cols: u16,
    rows: u16,
) -> Result<u32, String> {
    let container_id = super::docker::safe_ref(container_id)?;
    let pty = native_pty_system();
    let pair = pty
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new("docker");
    cmd.args([
        "exec",
        "-it",
        container_id,
        "/bin/sh",
        "-c",
        "command -v bash >/dev/null 2>&1 && exec bash || exec sh",
    ]);
    cmd.env("TERM", "xterm-256color");

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    sessions.inner.lock().unwrap().insert(
        id,
        Session {
            master: pair.master,
            writer,
            child,
            container: container_name.to_string(),
            capture: LineCapture::default(),
            data_dir,
        },
    );

    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let _ = app.emit(
                        SHELL_EVENT,
                        ShellOutput {
                            session: id,
                            data: buf[..n].to_vec(),
                            exited: false,
                        },
                    );
                }
            }
        }
        let _ = app.emit(
            SHELL_EVENT,
            ShellOutput {
                session: id,
                data: Vec::new(),
                exited: true,
            },
        );
    });

    Ok(id)
}

pub fn write(sessions: &ShellSessions, session: u32, data: Vec<u8>) -> Result<(), String> {
    let mut map = sessions.inner.lock().unwrap();
    let s = map.get_mut(&session).ok_or("shell session not found")?;
    let commands = s.capture.feed(&data);
    if !commands.is_empty() {
        docker_prefs::push_shell_history(&s.data_dir, &s.container, &commands);
    }
    s.writer.write_all(&data).map_err(|e| e.to_string())
}

pub fn resize(sessions: &ShellSessions, session: u32, cols: u16, rows: u16) -> Result<(), String> {
    let map = sessions.inner.lock().unwrap();
    let s = map.get(&session).ok_or("shell session not found")?;
    s.master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

pub fn close(sessions: &ShellSessions, session: u32) {
    if let Some(mut s) = sessions.inner.lock().unwrap().remove(&session) {
        let _ = s.child.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_capture_parses_input() {
        let mut c = LineCapture::default();
        assert_eq!(c.feed(b"ls -la\r"), vec!["ls -la"]);
        // Backspace edits apply.
        assert_eq!(c.feed(b"lss\x7f -l\r"), vec!["ls -l"]);
        // Ctrl-C abandons the line.
        assert!(c.feed(b"rm -rf /tmp/x\x03\r").is_empty());
        // Arrow-up recall (escape seq) and tab completion are not recorded.
        assert!(c.feed(b"\x1b[A\r").is_empty());
        assert!(c.feed(b"ls /us\t\r").is_empty());
        // Taint resets after commit.
        assert_eq!(c.feed(b"pwd\r"), vec!["pwd"]);
        // Chunked input accumulates.
        assert!(c.feed(b"echo ").is_empty());
        assert_eq!(c.feed(b"hi\r"), vec!["echo hi"]);
    }

    /// Round-trip through a real PTY into a running container. Needs the
    /// flux-noble test container started; run with --ignored.
    #[test]
    #[ignore = "needs docker + running flux-noble"]
    fn pty_echo_round_trip() {
        let pty = native_pty_system();
        let pair = pty
            .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .expect("openpty");
        let mut cmd = CommandBuilder::new("docker");
        cmd.args(["exec", "-it", "flux-noble", "/bin/sh"]);
        cmd.env("TERM", "xterm-256color");
        let mut child = pair.slave.spawn_command(cmd).expect("spawn");
        drop(pair.slave);

        let mut writer = pair.master.take_writer().expect("writer");
        let mut reader = pair.master.try_clone_reader().expect("reader");
        writer.write_all(b"echo pty_$((20+22))\n").expect("write");

        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut collected = Vec::new();
            let mut buf = [0u8; 4096];
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 {
                    break;
                }
                collected.extend_from_slice(&buf[..n]);
                if String::from_utf8_lossy(&collected).contains("pty_42") {
                    let _ = tx.send(true);
                    return;
                }
            }
            let _ = tx.send(false);
        });
        let ok = rx
            .recv_timeout(std::time::Duration::from_secs(10))
            .expect("timed out waiting for echo");
        let _ = child.kill();
        assert!(ok, "echo output never arrived through the PTY");
    }
}
