//! Alert rules evaluated against the live sample stream.
//!
//! Every metrics sample — the local tick loop and each remote poller — is
//! passed to [`Engine::observe`] before it goes to history. A rule fires
//! when its condition holds continuously for `duration_secs` (tracked as
//! streaming since-when state, no history queries needed) and resolves on
//! the first sample where the condition is false.
//!
//! Rules persist in `alerts.json` (hosts.json-style atomic writes); firings
//! are appended to an `alert_events` table in the history DB so the Alerts
//! page can show past incidents. Both are best-effort: alerting must never
//! break monitoring.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::history::Sample;

pub const EVENT_ALERTS: &str = "alerts://changed";

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum Metric {
    CpuPct,
    MemPct,
    TempC,
    NetRxBps,
    NetTxBps,
}

impl Metric {
    /// Extract this metric from a sample. None means "not measurable here"
    /// (e.g. temperature on a host that reports none) — the condition is
    /// treated as false so such rules never fire spuriously.
    fn value(self, s: &Sample) -> Option<f64> {
        match self {
            Metric::CpuPct => Some(s.cpu_pct),
            Metric::MemPct => (s.mem_total_kb > 0)
                .then(|| s.mem_used_kb as f64 / s.mem_total_kb as f64 * 100.0),
            Metric::TempC => s.temp_c,
            Metric::NetRxBps => Some(s.net_rx_bps),
            Metric::NetTxBps => Some(s.net_tx_bps),
        }
    }

    /// Stable key used in the alert_events table (matches the serde name).
    fn key(self) -> &'static str {
        match self {
            Metric::CpuPct => "cpu_pct",
            Metric::MemPct => "mem_pct",
            Metric::TempC => "temp_c",
            Metric::NetRxBps => "net_rx_bps",
            Metric::NetTxBps => "net_tx_bps",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Metric::CpuPct => "CPU",
            Metric::MemPct => "Memory",
            Metric::TempC => "Temperature",
            Metric::NetRxBps => "Net download",
            Metric::NetTxBps => "Net upload",
        }
    }

    /// Human-readable value for notifications.
    fn format(self, v: f64) -> String {
        match self {
            Metric::CpuPct | Metric::MemPct => format!("{v:.0}%"),
            Metric::TempC => format!("{v:.0}°C"),
            Metric::NetRxBps | Metric::NetTxBps => {
                if v >= 1e6 {
                    format!("{:.1} MB/s", v / 1e6)
                } else {
                    format!("{:.0} KB/s", v / 1e3)
                }
            }
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum Op {
    Gt,
    Lt,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AlertRule {
    pub id: String,
    pub name: String,
    pub metric: Metric,
    pub op: Op,
    pub threshold: f64,
    /// Condition must hold this long before the rule fires. 0 = immediately.
    pub duration_secs: u64,
    /// None applies the rule to every host (local + remote).
    pub host_id: Option<String>,
    pub enabled: bool,
}

impl AlertRule {
    fn matches_host(&self, host_id: &str) -> bool {
        self.host_id.as_deref().map_or(true, |h| h == host_id)
    }

    fn condition(&self, value: f64) -> bool {
        match self.op {
            Op::Gt => value > self.threshold,
            Op::Lt => value < self.threshold,
        }
    }

    fn describe(&self, value: f64) -> String {
        let op = match self.op {
            Op::Gt => ">",
            Op::Lt => "<",
        };
        format!(
            "{} {op} {} (now {})",
            self.metric.label(),
            self.metric.format(self.threshold),
            self.metric.format(value),
        )
    }
}

/// A currently-firing (rule, host) pair, shown on the Alerts page and used
/// for the tray severity.
#[derive(Serialize, Clone)]
pub struct ActiveAlert {
    pub rule_id: String,
    pub rule_name: String,
    pub host_id: String,
    pub metric: Metric,
    pub op: Op,
    pub threshold: f64,
    pub value: f64,
    pub since_ts: u64,
}

/// One row from the alert_events history table.
#[derive(Serialize, Clone)]
pub struct AlertEventRow {
    pub id: i64,
    pub rule_id: String,
    pub rule_name: String,
    pub host_id: String,
    pub metric: String,
    pub threshold: f64,
    pub peak_value: f64,
    pub started_ts: u64,
    pub resolved_ts: Option<u64>,
}

/// Per-(rule, host) evaluation state.
#[derive(Default)]
struct RuleState {
    /// Sample time since which the condition has been continuously true.
    true_since: Option<u64>,
    firing: bool,
    /// alert_events rowid of the open firing, for resolution.
    event_id: Option<i64>,
    /// Worst value seen while firing (max for Gt, min for Lt).
    peak: f64,
    last_value: f64,
    since_ts: u64,
}

struct Inner {
    rules: Vec<AlertRule>,
    states: HashMap<(String, String), RuleState>,
    /// Cached so the tick loop can check without locking on the hot path.
    enabled_count: usize,
}

pub struct Engine {
    app: AppHandle,
    data_dir: PathBuf,
    /// History DB path; None when history is disabled (events not recorded,
    /// live alerting still works).
    db_path: Option<PathBuf>,
    inner: Mutex<Inner>,
}

/// Tauri-managed wrapper.
pub struct AlertsState(pub std::sync::Arc<Engine>);

impl Engine {
    pub fn new(app: AppHandle, data_dir: &Path, db_path: Option<PathBuf>) -> Self {
        let rules = load_rules(data_dir);
        if let Some(db) = &db_path {
            if let Err(err) = ensure_table(db) {
                eprintln!("alerts: cannot create alert_events table: {err}");
            }
        }
        let enabled_count = rules.iter().filter(|r| r.enabled).count();
        Engine {
            app,
            data_dir: data_dir.to_path_buf(),
            db_path,
            inner: Mutex::new(Inner {
                rules,
                states: HashMap::new(),
                enabled_count,
            }),
        }
    }

    /// True when at least one rule is enabled — the tick loop uses this to
    /// keep collecting while minimized so alerts still evaluate.
    pub fn has_enabled_rules(&self) -> bool {
        self.inner.lock().unwrap().enabled_count > 0
    }

    /// Evaluate every matching rule against one sample. Called from the
    /// local tick loop and each remote poller thread.
    pub fn observe(&self, sample: &Sample) {
        let mut fired: Vec<(AlertRule, f64)> = Vec::new();
        let mut resolved: Vec<(AlertRule, i64, f64)> = Vec::new();
        {
            let inner = &mut *self.inner.lock().unwrap();
            for rule in inner.rules.iter().filter(|r| r.enabled) {
                if !rule.matches_host(&sample.host_id) {
                    continue;
                }
                let key = (rule.id.clone(), sample.host_id.clone());
                let state = inner.states.entry(key).or_default();
                let value = rule.metric.value(sample);
                let cond = value.map_or(false, |v| rule.condition(v));
                match (cond, value) {
                    (true, Some(v)) => {
                        let since = *state.true_since.get_or_insert(sample.ts);
                        state.last_value = v;
                        if state.firing {
                            state.peak = match rule.op {
                                Op::Gt => state.peak.max(v),
                                Op::Lt => state.peak.min(v),
                            };
                        } else if sample.ts.saturating_sub(since) >= rule.duration_secs {
                            state.firing = true;
                            state.peak = v;
                            state.since_ts = since;
                            fired.push((rule.clone(), v));
                        }
                    }
                    _ => {
                        state.true_since = None;
                        if state.firing {
                            state.firing = false;
                            resolved.push((
                                rule.clone(),
                                state.event_id.take().unwrap_or(-1),
                                state.peak,
                            ));
                        }
                    }
                }
            }
        }

        // Side effects outside the lock: SQLite, notifications, events.
        let changed = !fired.is_empty() || !resolved.is_empty();
        for (rule, value) in fired {
            let event_id = self.record_fire(&rule, &sample.host_id, value);
            if let Some(id) = event_id {
                let mut inner = self.inner.lock().unwrap();
                if let Some(state) = inner
                    .states
                    .get_mut(&(rule.id.clone(), sample.host_id.clone()))
                {
                    state.event_id = Some(id);
                }
            }
            self.notify(&rule, &sample.host_id, value);
        }
        // Resolution is silent (no notification); the tray going green and
        // the resolved_ts in history are the signal.
        for (_rule, event_id, peak) in &resolved {
            self.record_resolve(*event_id, *peak, sample.ts);
        }
        if changed {
            self.publish();
        }
    }

    /// Emit the active list to the frontend and retint the tray.
    fn publish(&self) {
        let _ = self.app.emit(EVENT_ALERTS, self.active());
        crate::tray::refresh(&self.app);
    }

    pub fn active(&self) -> Vec<ActiveAlert> {
        let inner = self.inner.lock().unwrap();
        let mut out = Vec::new();
        for ((rule_id, host_id), state) in inner.states.iter() {
            if !state.firing {
                continue;
            }
            let Some(rule) = inner.rules.iter().find(|r| &r.id == rule_id) else {
                continue;
            };
            out.push(ActiveAlert {
                rule_id: rule_id.clone(),
                rule_name: rule.name.clone(),
                host_id: host_id.clone(),
                metric: rule.metric,
                op: rule.op,
                threshold: rule.threshold,
                value: state.last_value,
                since_ts: state.since_ts,
            });
        }
        out.sort_by(|a, b| b.since_ts.cmp(&a.since_ts));
        out
    }

    pub fn firing_count(&self) -> usize {
        self.inner
            .lock()
            .unwrap()
            .states
            .values()
            .filter(|s| s.firing)
            .count()
    }

    pub fn rules(&self) -> Vec<AlertRule> {
        self.inner.lock().unwrap().rules.clone()
    }

    /// Insert or update a rule; assigns an id to new rules. Evaluation
    /// state for the rule resets so edits take effect cleanly.
    pub fn save_rule(&self, mut rule: AlertRule) -> Result<Vec<AlertRule>, String> {
        if rule.name.trim().is_empty() {
            return Err("rule name cannot be empty".into());
        }
        if !rule.threshold.is_finite() {
            return Err("threshold must be a number".into());
        }
        if rule.id.is_empty() {
            rule.id = uuid::Uuid::new_v4().to_string();
        }
        let rules = {
            let inner = &mut *self.inner.lock().unwrap();
            self.reset_rule_states(inner, &rule.id);
            match inner.rules.iter_mut().find(|r| r.id == rule.id) {
                Some(existing) => *existing = rule,
                None => inner.rules.push(rule),
            }
            inner.enabled_count = inner.rules.iter().filter(|r| r.enabled).count();
            inner.rules.clone()
        };
        save_rules(&self.data_dir, &rules)?;
        self.publish();
        Ok(rules)
    }

    pub fn delete_rule(&self, id: &str) -> Result<Vec<AlertRule>, String> {
        let rules = {
            let inner = &mut *self.inner.lock().unwrap();
            self.reset_rule_states(inner, id);
            inner.rules.retain(|r| r.id != id);
            inner.enabled_count = inner.rules.iter().filter(|r| r.enabled).count();
            inner.rules.clone()
        };
        save_rules(&self.data_dir, &rules)?;
        self.publish();
        Ok(rules)
    }

    /// Drop evaluation state for a rule, resolving any open firing so the
    /// history table doesn't keep dangling "still firing" rows.
    fn reset_rule_states(&self, inner: &mut Inner, rule_id: &str) {
        let now = now_secs();
        inner.states.retain(|(rid, _), state| {
            if rid != rule_id {
                return true;
            }
            if let Some(event_id) = state.event_id {
                self.record_resolve(event_id, state.peak, now);
            }
            false
        });
    }

    pub fn events(&self, limit: u32) -> Result<Vec<AlertEventRow>, String> {
        let Some(db) = &self.db_path else {
            return Ok(Vec::new());
        };
        let conn = open(db).map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, rule_id, rule_name, host_id, metric, threshold,
                        peak_value, started_ts, resolved_ts
                 FROM alert_events ORDER BY started_ts DESC LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([limit.min(1000)], |r| {
                Ok(AlertEventRow {
                    id: r.get(0)?,
                    rule_id: r.get(1)?,
                    rule_name: r.get(2)?,
                    host_id: r.get(3)?,
                    metric: r.get(4)?,
                    threshold: r.get(5)?,
                    peak_value: r.get(6)?,
                    started_ts: r.get::<_, i64>(7)? as u64,
                    resolved_ts: r.get::<_, Option<i64>>(8)?.map(|v| v as u64),
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    fn record_fire(&self, rule: &AlertRule, host_id: &str, value: f64) -> Option<i64> {
        let db = self.db_path.as_ref()?;
        let result = open(db).and_then(|conn| {
            conn.execute(
                "INSERT INTO alert_events
                 (rule_id, rule_name, host_id, metric, threshold, peak_value, started_ts)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    rule.id,
                    rule.name,
                    host_id,
                    rule.metric.key(),
                    rule.threshold,
                    value,
                    now_secs() as i64,
                ],
            )?;
            Ok(conn.last_insert_rowid())
        });
        match result {
            Ok(id) => Some(id),
            Err(err) => {
                eprintln!("alerts: cannot record firing: {err}");
                None
            }
        }
    }

    fn record_resolve(&self, event_id: i64, peak: f64, ts: u64) {
        if event_id < 0 {
            return;
        }
        let Some(db) = &self.db_path else { return };
        let result = open(db).and_then(|conn| {
            conn.execute(
                "UPDATE alert_events SET resolved_ts = ?1, peak_value = ?2 WHERE id = ?3",
                rusqlite::params![ts as i64, peak, event_id],
            )?;
            Ok(())
        });
        if let Err(err) = result {
            eprintln!("alerts: cannot resolve event {event_id}: {err}");
        }
    }

    fn notify(&self, rule: &AlertRule, host_id: &str, value: f64) {
        let host = host_label(&self.app, host_id);
        let result = self
            .app
            .notification()
            .builder()
            .title(format!("Flux alert: {}", rule.name))
            .body(format!("{} on {host}", rule.describe(value)))
            .show();
        if let Err(err) = result {
            eprintln!("alerts: notification failed: {err}");
        }
    }

    /// Send a throwaway notification so the user can check their desktop
    /// shows them (Settings/Alerts page "Test" button).
    pub fn test_notification(&self) -> Result<(), String> {
        self.app
            .notification()
            .builder()
            .title("Flux alert test")
            .body("Notifications are working.")
            .show()
            .map_err(|e| e.to_string())
    }
}

/// Display name for a host id: configured name for remotes, hostname for
/// "local".
pub fn host_label(app: &AppHandle, host_id: &str) -> String {
    if host_id == "local" {
        return sysinfo::System::host_name().unwrap_or_else(|| "this machine".into());
    }
    app.state::<crate::state::AppState>()
        .hosts
        .lock()
        .unwrap()
        .iter()
        .find(|h| h.id == host_id)
        .map(|h| h.name.clone())
        .unwrap_or_else(|| host_id.to_string())
}

fn open(db_path: &Path) -> Result<rusqlite::Connection, rusqlite::Error> {
    let conn = rusqlite::Connection::open(db_path)?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    Ok(conn)
}

fn ensure_table(db_path: &Path) -> Result<(), rusqlite::Error> {
    open(db_path)?.execute_batch(
        "CREATE TABLE IF NOT EXISTS alert_events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            rule_id     TEXT NOT NULL,
            rule_name   TEXT NOT NULL,
            host_id     TEXT NOT NULL,
            metric      TEXT NOT NULL,
            threshold   REAL NOT NULL,
            peak_value  REAL NOT NULL,
            started_ts  INTEGER NOT NULL,
            resolved_ts INTEGER
        );",
    )
}

fn rules_file(data_dir: &Path) -> PathBuf {
    data_dir.join("alerts.json")
}

#[derive(Serialize, Deserialize, Default)]
struct RulesFile {
    rules: Vec<AlertRule>,
}

fn load_rules(data_dir: &Path) -> Vec<AlertRule> {
    std::fs::read_to_string(rules_file(data_dir))
        .ok()
        .and_then(|s| serde_json::from_str::<RulesFile>(&s).ok())
        .map(|f| f.rules)
        .unwrap_or_default()
}

fn save_rules(data_dir: &Path, rules: &[AlertRule]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&RulesFile {
        rules: rules.to_vec(),
    })
    .map_err(|e| e.to_string())?;
    let tmp = data_dir.join("alerts.json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, rules_file(data_dir)).map_err(|e| e.to_string())
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(cpu: f64, mem_used: u64, temp: Option<f64>) -> Sample {
        Sample {
            host_id: "local".into(),
            ts: 1000,
            cpu_pct: cpu,
            mem_used_kb: mem_used,
            mem_total_kb: 8_000_000,
            net_rx_bps: 2e6,
            net_tx_bps: 5e5,
            temp_c: temp,
        }
    }

    fn rule(metric: Metric, op: Op, threshold: f64) -> AlertRule {
        AlertRule {
            id: "r1".into(),
            name: "test".into(),
            metric,
            op,
            threshold,
            duration_secs: 0,
            host_id: None,
            enabled: true,
        }
    }

    #[test]
    fn metric_extraction() {
        let s = sample(42.0, 6_000_000, Some(70.0));
        assert_eq!(Metric::CpuPct.value(&s), Some(42.0));
        assert_eq!(Metric::MemPct.value(&s), Some(75.0));
        assert_eq!(Metric::TempC.value(&s), Some(70.0));
        assert_eq!(Metric::NetRxBps.value(&s), Some(2e6));
        // Missing temp → not measurable, never fires.
        assert_eq!(Metric::TempC.value(&sample(1.0, 0, None)), None);
        // Zero total memory must not divide by zero.
        let mut z = sample(1.0, 0, None);
        z.mem_total_kb = 0;
        assert_eq!(Metric::MemPct.value(&z), None);
    }

    #[test]
    fn conditions_and_host_filter() {
        let r = rule(Metric::CpuPct, Op::Gt, 90.0);
        assert!(r.condition(95.0));
        assert!(!r.condition(90.0)); // strict comparison
        assert!(rule(Metric::TempC, Op::Lt, 10.0).condition(5.0));
        assert!(r.matches_host("local"));
        assert!(r.matches_host("remote-1"));
        let mut pinned = r.clone();
        pinned.host_id = Some("remote-1".into());
        assert!(pinned.matches_host("remote-1"));
        assert!(!pinned.matches_host("local"));
    }

    #[test]
    fn rules_file_round_trip() {
        let dir = std::env::temp_dir().join(format!("flux-alerts-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        // Missing file → empty, not an error.
        assert!(load_rules(&dir).is_empty());
        let rules = vec![
            rule(Metric::CpuPct, Op::Gt, 90.0),
            rule(Metric::NetTxBps, Op::Gt, 1e7),
        ];
        save_rules(&dir, &rules).unwrap();
        let loaded = load_rules(&dir);
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].metric, Metric::CpuPct);
        assert_eq!(loaded[1].threshold, 1e7);
        // Corrupt file → empty, not a crash.
        std::fs::write(rules_file(&dir), "{nope").unwrap();
        assert!(load_rules(&dir).is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn event_table_round_trip() {
        let dir = std::env::temp_dir().join(format!("flux-alerts-db-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("history.db");
        ensure_table(&db).unwrap();
        let conn = open(&db).unwrap();
        conn.execute(
            "INSERT INTO alert_events
             (rule_id, rule_name, host_id, metric, threshold, peak_value, started_ts)
             VALUES ('r1', 'CPU hot', 'local', 'cpu_pct', 90.0, 97.5, 1000)",
            [],
        )
        .unwrap();
        let id = conn.last_insert_rowid();
        conn.execute(
            "UPDATE alert_events SET resolved_ts = 1300, peak_value = 99.0 WHERE id = ?1",
            [id],
        )
        .unwrap();
        let (metric, peak, resolved): (String, f64, Option<i64>) = conn
            .query_row(
                "SELECT metric, peak_value, resolved_ts FROM alert_events WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(metric, "cpu_pct");
        assert_eq!(peak, 99.0);
        assert_eq!(resolved, Some(1300));
        std::fs::remove_dir_all(&dir).ok();
    }
}
