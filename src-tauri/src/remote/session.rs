use std::io::Read;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::Engine;
use ssh2::{CheckResult, HashType, KnownHostFileKind, KnownHostKeyFormat, Session};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// Blocking-op timeout on the session; a hung TCP link fails into the
/// poller's backoff path instead of freezing the thread for minutes.
const IO_TIMEOUT_MS: u32 = 10_000;

pub struct SshSession {
    pub session: Session,
    pub address: String,
    pub port: u16,
}

pub enum HostKeyStatus {
    Known,
    /// Never seen before — wizard must show the fingerprint for TOFU.
    Unknown,
    /// Key differs from the recorded one. Hard fail, possible MITM.
    Changed,
}

fn resolve(address: &str, port: u16) -> Result<std::net::SocketAddr, String> {
    (address, port)
        .to_socket_addrs()
        .map_err(|e| format!("resolve {address}: {e}"))?
        .next()
        .ok_or_else(|| format!("no address for {address}"))
}

impl SshSession {
    /// TCP connect + SSH handshake. No auth yet.
    pub fn connect(address: &str, port: u16) -> Result<Self, String> {
        let sockaddr = resolve(address, port)?;
        let tcp = TcpStream::connect_timeout(&sockaddr, CONNECT_TIMEOUT)
            .map_err(|e| format!("connect {address}:{port}: {e}"))?;
        tcp.set_nodelay(true).ok();
        let mut session = Session::new().map_err(|e| e.to_string())?;
        session.set_tcp_stream(tcp);
        session.set_timeout(IO_TIMEOUT_MS);
        session
            .handshake()
            .map_err(|e| format!("ssh handshake: {e}"))?;
        Ok(Self {
            session,
            address: address.to_string(),
            port,
        })
    }

    /// OpenSSH-style SHA256 fingerprint of the server host key.
    pub fn fingerprint(&self) -> Result<String, String> {
        let hash = self
            .session
            .host_key_hash(HashType::Sha256)
            .ok_or("no host key hash")?;
        let b64 = base64::engine::general_purpose::STANDARD_NO_PAD.encode(hash);
        Ok(format!("SHA256:{b64}"))
    }

    /// Check the server key against the Flux-owned known_hosts file.
    pub fn check_host_key(&self, known_hosts_path: &Path) -> Result<HostKeyStatus, String> {
        let (key, _key_type) = self.session.host_key().ok_or("no host key")?;
        let mut kh = self.session.known_hosts().map_err(|e| e.to_string())?;
        if known_hosts_path.exists() {
            kh.read_file(known_hosts_path, KnownHostFileKind::OpenSSH)
                .map_err(|e| format!("read known_hosts: {e}"))?;
        }
        match kh.check_port(&self.address, self.port, key) {
            CheckResult::Match => Ok(HostKeyStatus::Known),
            CheckResult::NotFound => Ok(HostKeyStatus::Unknown),
            CheckResult::Mismatch => Ok(HostKeyStatus::Changed),
            CheckResult::Failure => Err("known_hosts check failed".into()),
        }
    }

    /// Record the current server key (TOFU accept).
    pub fn remember_host_key(&self, known_hosts_path: &Path) -> Result<(), String> {
        let (key, key_type) = self.session.host_key().ok_or("no host key")?;
        let format: KnownHostKeyFormat = key_type.into();
        let mut kh = self.session.known_hosts().map_err(|e| e.to_string())?;
        if known_hosts_path.exists() {
            kh.read_file(known_hosts_path, KnownHostFileKind::OpenSSH)
                .map_err(|e| e.to_string())?;
        }
        let host = if self.port == 22 {
            self.address.clone()
        } else {
            format!("[{}]:{}", self.address, self.port)
        };
        kh.add(&host, key, "flux", format)
            .map_err(|e| e.to_string())?;
        if let Some(parent) = known_hosts_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        kh.write_file(known_hosts_path, KnownHostFileKind::OpenSSH)
            .map_err(|e| format!("write known_hosts: {e}"))
    }

    pub fn auth_key(&self, username: &str, key_path: &Path) -> Result<(), String> {
        self.session
            .userauth_pubkey_file(username, None, key_path, None)
            .map_err(|e| format!("key auth: {e}"))
    }

    pub fn auth_password(&self, username: &str, password: &str) -> Result<(), String> {
        self.session
            .userauth_password(username, password)
            .map_err(|e| format!("password auth: {e}"))
    }

    /// Run a command, capture stdout. Non-zero exit = Err with stderr.
    pub fn exec_capture(&self, cmd: &str) -> Result<String, String> {
        let mut channel = self
            .session
            .channel_session()
            .map_err(|e| format!("channel: {e}"))?;
        channel.exec(cmd).map_err(|e| format!("exec: {e}"))?;
        let mut stdout = String::new();
        channel
            .read_to_string(&mut stdout)
            .map_err(|e| format!("read: {e}"))?;
        let mut stderr = String::new();
        channel.stderr().read_to_string(&mut stderr).ok();
        channel.wait_close().ok();
        let status = channel.exit_status().unwrap_or(-1);
        if status == 0 {
            Ok(stdout)
        } else {
            Err(format!(
                "exit {status}: {}",
                if stderr.trim().is_empty() {
                    stdout.trim()
                } else {
                    stderr.trim()
                }
            ))
        }
    }

    /// Upload bytes to a remote path via SFTP, then chmod.
    pub fn upload(&self, data: &[u8], remote_path: &str, mode: i32) -> Result<(), String> {
        use std::io::Write;
        let sftp = self.session.sftp().map_err(|e| format!("sftp: {e}"))?;
        // Create parent directories best-effort.
        let mut prefix = PathBuf::new();
        if let Some(parent) = Path::new(remote_path).parent() {
            for part in parent.components() {
                prefix.push(part);
                sftp.mkdir(&prefix, 0o755).ok();
            }
        }
        let mut file = sftp
            .open_mode(
                Path::new(remote_path),
                ssh2::OpenFlags::WRITE | ssh2::OpenFlags::CREATE | ssh2::OpenFlags::TRUNCATE,
                mode,
                ssh2::OpenType::File,
            )
            .map_err(|e| format!("sftp open {remote_path}: {e}"))?;
        file.write_all(data)
            .map_err(|e| format!("sftp write: {e}"))?;
        Ok(())
    }
}
