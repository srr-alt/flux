//! Local metrics history: SQLite ring buffer with downsample tiers.
//!
//! One writer thread owns the connection. The tick loops (local monitor +
//! per-host remote pollers) send `Sample`s over a channel; the writer
//! accumulates them and flushes one averaged row per host every
//! `RAW_STEP_SECS`. A periodic compaction pass rolls raw rows into 1-minute
//! and 10-minute tiers and enforces retention, so the DB stays bounded:
//!   raw (10s)  kept 3 hours
//!   1m rollup  kept 48 hours
//!   10m rollup kept 30 days
//!
//! Queries open their own read-only connection (WAL mode) so they never
//! block the writer.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::time::Duration;

use rusqlite::Connection;
use serde::Serialize;

use flux_core::TickSnapshot;

pub const RAW_STEP_SECS: u64 = 10;
const RAW_KEEP_SECS: u64 = 3 * 3600;
const M1_KEEP_SECS: u64 = 48 * 3600;
const M10_KEEP_SECS: u64 = 30 * 24 * 3600;
const COMPACT_EVERY_SECS: u64 = 300;

/// One metrics sample, host-agnostic. `host_id` is `"local"` for this
/// machine, the remote host id otherwise.
pub struct Sample {
    pub host_id: String,
    pub ts: u64,
    pub cpu_pct: f64,
    pub mem_used_kb: u64,
    pub mem_total_kb: u64,
    pub net_rx_bps: f64,
    pub net_tx_bps: f64,
    pub temp_c: Option<f64>,
}

impl Sample {
    /// Build a sample from a tick snapshot. Network sums all interfaces
    /// except loopback; temperature is the mean of per-core readings.
    pub fn from_tick(host_id: &str, tick: &TickSnapshot) -> Self {
        let (rx, tx) = tick
            .network
            .iter()
            .filter(|i| i.name != "lo")
            .fold((0.0, 0.0), |(rx, tx), i| {
                (rx + i.rx_bytes_per_sec, tx + i.tx_bytes_per_sec)
            });
        let temp_c = tick.cpu.per_core_temp_c.as_ref().and_then(|temps| {
            if temps.is_empty() {
                None
            } else {
                Some(temps.iter().map(|&t| t as f64).sum::<f64>() / temps.len() as f64)
            }
        });
        Sample {
            host_id: host_id.to_string(),
            ts: tick.timestamp_ms / 1000,
            cpu_pct: tick.cpu.global_usage_pct as f64,
            mem_used_kb: tick
                .memory
                .total_kb
                .saturating_sub(tick.memory.available_kb),
            mem_total_kb: tick.memory.total_kb,
            net_rx_bps: rx,
            net_tx_bps: tx,
            temp_c,
        }
    }
}

/// Tauri-managed wrapper; `None` when the DB could not be opened.
pub struct HistoryState(pub Option<HistoryHandle>);

/// Cloneable handle for producers. Send failures are ignored — history is
/// best-effort and must never break monitoring.
#[derive(Clone)]
pub struct HistoryHandle {
    tx: Sender<Sample>,
    pub db_path: PathBuf,
}

impl HistoryHandle {
    pub fn record(&self, sample: Sample) {
        let _ = self.tx.send(sample);
    }
}

/// Spawn the writer thread. Returns None (with a logged reason) if the DB
/// cannot be opened — the app runs fine without history.
pub fn spawn(data_dir: &Path) -> Option<HistoryHandle> {
    let db_path = data_dir.join("history.db");
    let conn = match open_writer(&db_path) {
        Ok(conn) => conn,
        Err(err) => {
            eprintln!("history: disabled, cannot open {db_path:?}: {err}");
            return None;
        }
    };
    let (tx, rx) = std::sync::mpsc::channel::<Sample>();
    let handle = HistoryHandle {
        tx,
        db_path: db_path.clone(),
    };
    std::thread::Builder::new()
        .name("flux-history".into())
        .spawn(move || writer_loop(conn, rx))
        .ok()?;
    Some(handle)
}

fn open_writer(db_path: &Path) -> Result<Connection, rusqlite::Error> {
    let conn = Connection::open(db_path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS samples_raw (
            host_id     TEXT NOT NULL,
            ts          INTEGER NOT NULL,
            cpu_pct     REAL NOT NULL,
            cpu_max_pct REAL NOT NULL,
            mem_used_kb INTEGER NOT NULL,
            mem_total_kb INTEGER NOT NULL,
            net_rx_bps  REAL NOT NULL,
            net_tx_bps  REAL NOT NULL,
            temp_c      REAL,
            PRIMARY KEY (host_id, ts)
        ) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS samples_1m (
            host_id TEXT NOT NULL, ts INTEGER NOT NULL,
            cpu_pct REAL NOT NULL, cpu_max_pct REAL NOT NULL,
            mem_used_kb INTEGER NOT NULL, mem_total_kb INTEGER NOT NULL,
            net_rx_bps REAL NOT NULL, net_tx_bps REAL NOT NULL,
            temp_c REAL,
            PRIMARY KEY (host_id, ts)
        ) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS samples_10m (
            host_id TEXT NOT NULL, ts INTEGER NOT NULL,
            cpu_pct REAL NOT NULL, cpu_max_pct REAL NOT NULL,
            mem_used_kb INTEGER NOT NULL, mem_total_kb INTEGER NOT NULL,
            net_rx_bps REAL NOT NULL, net_tx_bps REAL NOT NULL,
            temp_c REAL,
            PRIMARY KEY (host_id, ts)
        ) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY, value INTEGER NOT NULL
        );",
    )?;
    Ok(conn)
}

/// Per-host accumulator over one RAW_STEP window.
#[derive(Default)]
struct Accum {
    n: u32,
    cpu_sum: f64,
    cpu_max: f64,
    mem_used_kb: u64,
    mem_total_kb: u64,
    rx_sum: f64,
    tx_sum: f64,
    temp_sum: f64,
    temp_n: u32,
}

impl Accum {
    fn add(&mut self, s: &Sample) {
        self.n += 1;
        self.cpu_sum += s.cpu_pct;
        self.cpu_max = self.cpu_max.max(s.cpu_pct);
        self.mem_used_kb = s.mem_used_kb; // last wins; memory moves slowly
        self.mem_total_kb = s.mem_total_kb;
        self.rx_sum += s.net_rx_bps;
        self.tx_sum += s.net_tx_bps;
        if let Some(t) = s.temp_c {
            self.temp_sum += t;
            self.temp_n += 1;
        }
    }
}

fn writer_loop(conn: Connection, rx: Receiver<Sample>) {
    let mut accums: HashMap<String, Accum> = HashMap::new();
    let mut last_flush = std::time::Instant::now();
    let mut last_compact = std::time::Instant::now();

    loop {
        match rx.recv_timeout(Duration::from_secs(1)) {
            Ok(sample) => accums.entry(sample.host_id.clone()).or_default().add(&sample),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }

        if last_flush.elapsed().as_secs() >= RAW_STEP_SECS && !accums.is_empty() {
            let ts = now_secs() / RAW_STEP_SECS * RAW_STEP_SECS;
            flush(&conn, ts, &mut accums);
            last_flush = std::time::Instant::now();
        }
        if last_compact.elapsed().as_secs() >= COMPACT_EVERY_SECS {
            if let Err(err) = compact(&conn) {
                eprintln!("history: compaction failed: {err}");
            }
            last_compact = std::time::Instant::now();
        }
    }
}

fn flush(conn: &Connection, ts: u64, accums: &mut HashMap<String, Accum>) {
    let result: Result<(), rusqlite::Error> = (|| {
        let mut stmt = conn.prepare_cached(
            "INSERT OR REPLACE INTO samples_raw
             (host_id, ts, cpu_pct, cpu_max_pct, mem_used_kb, mem_total_kb,
              net_rx_bps, net_tx_bps, temp_c)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )?;
        for (host, a) in accums.iter() {
            let n = a.n.max(1) as f64;
            stmt.execute(rusqlite::params![
                host,
                ts as i64,
                a.cpu_sum / n,
                a.cpu_max,
                a.mem_used_kb as i64,
                a.mem_total_kb as i64,
                a.rx_sum / n,
                a.tx_sum / n,
                (a.temp_n > 0).then(|| a.temp_sum / a.temp_n as f64),
            ])?;
        }
        Ok(())
    })();
    if let Err(err) = result {
        eprintln!("history: flush failed: {err}");
    }
    accums.clear();
}

/// Roll complete windows into the next tier, then trim per retention.
/// `meta` tracks the high-water mark per tier so windows roll exactly once.
fn compact(conn: &Connection) -> Result<(), rusqlite::Error> {
    let now = now_secs();
    rollup(conn, "samples_raw", "samples_1m", "rolled_1m", 60, now)?;
    rollup(conn, "samples_1m", "samples_10m", "rolled_10m", 600, now)?;
    conn.execute(
        "DELETE FROM samples_raw WHERE ts < ?1",
        [now.saturating_sub(RAW_KEEP_SECS) as i64],
    )?;
    conn.execute(
        "DELETE FROM samples_1m WHERE ts < ?1",
        [now.saturating_sub(M1_KEEP_SECS) as i64],
    )?;
    conn.execute(
        "DELETE FROM samples_10m WHERE ts < ?1",
        [now.saturating_sub(M10_KEEP_SECS) as i64],
    )?;
    Ok(())
}

fn rollup(
    conn: &Connection,
    src: &str,
    dst: &str,
    mark: &str,
    step: u64,
    now: u64,
) -> Result<(), rusqlite::Error> {
    let since: u64 = conn
        .query_row(
            "SELECT value FROM meta WHERE key = ?1",
            [mark],
            |r| r.get::<_, i64>(0),
        )
        .unwrap_or(0) as u64;
    // Only roll windows that have fully elapsed.
    let upto = now / step * step;
    if upto <= since {
        return Ok(());
    }
    conn.execute(
        &format!(
            "INSERT OR REPLACE INTO {dst}
             (host_id, ts, cpu_pct, cpu_max_pct, mem_used_kb, mem_total_kb,
              net_rx_bps, net_tx_bps, temp_c)
             SELECT host_id, ts / {step} * {step},
                    AVG(cpu_pct), MAX(cpu_max_pct),
                    CAST(AVG(mem_used_kb) AS INTEGER), MAX(mem_total_kb),
                    AVG(net_rx_bps), AVG(net_tx_bps), AVG(temp_c)
             FROM {src}
             WHERE ts >= {since} AND ts < {upto}
             GROUP BY host_id, ts / {step}"
        ),
        [],
    )?;
    conn.execute(
        "INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)",
        rusqlite::params![mark, upto as i64],
    )?;
    Ok(())
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Queries (read-only connection, safe alongside the writer thanks to WAL)
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct HistoryPoint {
    pub ts: u64,
    pub cpu_pct: f64,
    pub cpu_max_pct: f64,
    pub mem_used_kb: u64,
    pub mem_total_kb: u64,
    pub net_rx_bps: f64,
    pub net_tx_bps: f64,
    pub temp_c: Option<f64>,
}

/// Pick the tier whose retention covers the range, then read points.
pub fn query(
    db_path: &Path,
    host_id: &str,
    range_secs: u64,
) -> Result<Vec<HistoryPoint>, String> {
    let table = if range_secs <= RAW_KEEP_SECS {
        "samples_raw"
    } else if range_secs <= M1_KEEP_SECS {
        "samples_1m"
    } else {
        "samples_10m"
    };
    let conn = Connection::open_with_flags(
        db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|e| e.to_string())?;
    let since = now_secs().saturating_sub(range_secs);
    let mut stmt = conn
        .prepare(&format!(
            "SELECT ts, cpu_pct, cpu_max_pct, mem_used_kb, mem_total_kb,
                    net_rx_bps, net_tx_bps, temp_c
             FROM {table} WHERE host_id = ?1 AND ts >= ?2 ORDER BY ts"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![host_id, since as i64], |r| {
            Ok(HistoryPoint {
                ts: r.get::<_, i64>(0)? as u64,
                cpu_pct: r.get(1)?,
                cpu_max_pct: r.get(2)?,
                mem_used_kb: r.get::<_, i64>(3)? as u64,
                mem_total_kb: r.get::<_, i64>(4)? as u64,
                net_rx_bps: r.get(5)?,
                net_tx_bps: r.get(6)?,
                temp_c: r.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(host: &str, ts: u64, cpu: f64) -> Sample {
        Sample {
            host_id: host.into(),
            ts,
            cpu_pct: cpu,
            mem_used_kb: 4_000_000,
            mem_total_kb: 8_000_000,
            net_rx_bps: 1000.0,
            net_tx_bps: 500.0,
            temp_c: Some(50.0),
        }
    }

    #[test]
    fn flush_compact_query_roundtrip() {
        let dir = std::env::temp_dir().join(format!("flux-hist-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("history.db");
        let conn = open_writer(&db).unwrap();

        // Two hosts, samples over several raw windows in the recent past.
        let base = now_secs() - 600;
        let mut accums: HashMap<String, Accum> = HashMap::new();
        for w in 0..30 {
            let ts = (base + w * RAW_STEP_SECS) / RAW_STEP_SECS * RAW_STEP_SECS;
            for host in ["local", "remote-1"] {
                accums.entry(host.into()).or_default().add(&sample(host, ts, 25.0 + w as f64));
            }
            flush(&conn, ts, &mut accums);
        }
        compact(&conn).unwrap();

        // Raw tier query returns all windows for the right host only.
        let pts = query(&db, "local", RAW_KEEP_SECS).unwrap();
        assert_eq!(pts.len(), 30);
        assert!(pts.windows(2).all(|w| w[0].ts < w[1].ts), "ordered by ts");
        assert_eq!(pts[0].mem_total_kb, 8_000_000);
        assert_eq!(pts[0].temp_c, Some(50.0));

        // 1m tier has rollups (complete minutes only) and averaged cpu.
        let m1 = query(&db, "local", M1_KEEP_SECS + 1).unwrap();
        assert!(!m1.is_empty(), "1m rollup produced rows");
        assert!(m1.iter().all(|p| p.ts % 60 == 0));
        assert!(m1.iter().all(|p| p.cpu_max_pct >= p.cpu_pct));

        // Unknown host: empty, not an error.
        assert!(query(&db, "nope", RAW_KEEP_SECS).unwrap().is_empty());

        std::fs::remove_dir_all(&dir).ok();
    }
}
