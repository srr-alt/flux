# Flux Roadmap

Strategy: exploit being a native desktop app (things Beszel structurally cannot do), patch Beszel's advantages (history, always-on alerting), then widen the moat (fleet features homelabbers love).

Positioning line: **"Nothing to expose, nothing to patch."** Flux never listens on the network (local HTTP API stays opt-in, localhost-only). No hub to reverse-proxy, no auth surface, no TLS chores.

---

## Phase 1 — Patch the structural gaps

### 1.1 Local history persistence (SQLite ring buffer) — HIGHEST VALUE
**Problem:** in-memory history (`src/state/history.ts`, `HISTORY_LENGTH` cap) holds minutes of data. Beszel shows 30 days.

**Design:**
- New `history` module in `src-tauri/src/monitor/` writing samples to SQLite (`rusqlite`, bundled).
- DB at app data dir: `flux/history.db`. One `samples` table: `(host_id, ts, cpu, mem, disk, net_rx, net_tx, temp)` + per-container Docker table. Downsample tiers like RRD: raw 10s kept 3h, 1min kept 48h, 10min kept 30d. Compaction job on a tokio interval.
- Record for **all polled hosts** (local + remote via existing `remote/poller.rs`), not just the viewed one.
- Frontend: time-range picker (3h / 24h / 7d / 30d) on Performance + Fleet charts; new Tauri command `history_query(host, metric, range)` returning downsampled points.
- Honest caveat in UI: "History records while Flux (or fluxd, Phase 2) is running."

**Touchpoints:** `src-tauri/src/monitor/`, `remote/poller.rs`, new `commands_history.rs`, `src/state/history.ts`, `src/components/charts/`, Performance/Fleet pages.
**Effort:** ~3–5 days. **Depends on:** nothing. **Unblocks:** 1.2 alert durations, 2.1 fluxd, 3.1 aggregates.

### 1.2 Alert rules + native notifications + tray health
**Design:**
- Rule model: `{metric, op, threshold, duration, host_filter}` — e.g. CPU > 90% for 5 min on any host. Stored in settings JSON. Evaluated in Rust against the live sample stream (duration windows read from 1.1's buffer).
- `tauri-plugin-notification` for desktop notifications.
- Tray icon (`tauri` tray API): green all-healthy / amber warning / red firing. Tray menu = per-host one-line status, click opens app ("menu bar glance" v1).
- Alert history page (last N firings) reading from SQLite.

**Touchpoints:** new `src-tauri/src/alerts.rs`, `lib.rs` (tray setup), Settings page (rule editor UI), new plugin deps.
**Effort:** ~3–4 days. **Depends on:** 1.1 (duration windows).

### 1.3 Terminal drop-in (one keystroke to shell)
**Problem-free start:** SSH session pool already exists (`src-tauri/src/remote/session.rs`), xterm.js already used for Docker exec (`src/pages/docker/ShellPanel.tsx`).

**Design:**
- Reuse pooled `ssh2` session: open `channel_session()` + `request_pty()` + `shell()`, stream via Tauri events (same pattern as Docker exec channel).
- Local host: `portable-pty` (already a dep) spawning `$SHELL`.
- UI: generalize ShellPanel into a shared `TerminalPanel` component; hotkey (e.g. `` Ctrl+` ``) + terminal button on every host tile/dashboard. Tabbed if multiple hosts.
- Respect privacy lock: terminal hidden for remote hosts while locked (same rule as machine picker in `lockStore.ts`).

**Touchpoints:** `remote/session.rs`, new `commands_terminal.rs`, `ShellPanel.tsx` → shared component, Fleet/host UI.
**Effort:** ~2–3 days. **Depends on:** nothing. Ship any time.

---

## Phase 2 — Always-on story

### 2.1 Headless companion (`fluxd`)
**Problem:** "desktop apps can't alert at 3am."

**Design:**
- New binary crate `crates/fluxd` reusing `flux-core` + the poller/history/alerts code — extract those from `src-tauri` into `flux-core` (or a new `flux-daemon-core` crate) first. This refactor is the main cost.
- Runs as systemd **user** service: polls hosts, writes the same SQLite DB, fires webhook / ntfy / Telegram on alert rules (shared rule format with 1.2).
- GUI attach: on startup, if fluxd holds the DB, GUI becomes a reader (SQLite WAL handles concurrent read/write) and pauses its own polling for hosts fluxd covers. Simplest coordination: pidfile + version handshake over a localhost unix socket.
- Packaging: `flux --headless` alias or separate `fluxd` binary in the .deb; `systemctl --user enable fluxd` snippet in docs.

**Effort:** ~1–2 weeks (mostly the core-extraction refactor). **Depends on:** 1.1, 1.2. **Do after both.**

---

## Phase 3 — Widen the moat (cheap crowd-pleasers first)

### 3.1 S.M.A.R.T. disk health
`smartctl -j` over the existing SSH channel (and locally). Parse JSON in `flux-core/src/disk.rs` sibling module; surface health/temps/reallocated sectors on the host dashboard + a red badge feeding 1.2 alerts. Fallback note when smartmontools absent (offer install hint).
**Effort:** ~1 day.

### 3.2 Wake-on-LAN + power actions
- WoL: magic packet from the app (raw UDP broadcast, no deps). Store MAC per host (auto-capture from `ip link` when connected).
- Graceful reboot/shutdown buttons per host over SSH (`systemctl reboot/poweroff`), with confirm dialog.
- Offline host tile shows "Wake" button — the demo moment.
**Effort:** ~1 day. **Touchpoints:** `remote/hosts.rs` (MAC field), host tile UI.

### 3.3 SSH config import
Parse `~/.ssh/config` (Host/HostName/User/Port/IdentityFile/**ProxyJump**), one-click multi-select import into `remote/hosts.rs` store.
- ProxyJump: implement via `ssh2` channel-through-jump (direct-tcpip channel on the bastion session, then handshake over it). This is the real work; parser is trivial.
- Onboarding GIF: "15 machines in 10 seconds."
**Effort:** parser+import ~1 day; ProxyJump ~2–3 days. Ship parser first, ProxyJump can flag "jump hosts coming soon."

### 3.4 Fleet aggregate view
- Combined header on Fleet page: total fleet CPU/mem, aggregate net throughput.
- **Cross-host process table:** merge process lists from all hosts, sort by CPU/mem — "which box is eating the network/CPU." Needs per-host process polling fan-out in `remote/poller.rs` (currently per-viewed-host) — poll top-N processes only for cheapness.
**Effort:** ~3–4 days. **Depends on:** poller fan-out.

### 3.5 Proxmox awareness
Detect Proxmox node (`pveversion` probe over SSH). If present: list VMs/LXCs via `pvesh get /cluster/resources --output-format json` (or `qm list`/`pct list` fallback), show state + basic stats as sub-rows under the host, start/stop actions behind confirm.
**Effort:** ~1 week. Largest single audience on r/selfhosted.

### 3.6 Host list export/import + file-based config sync
Export hosts (+ alert rules) to a single JSON file; import merges by host id. Document "sync via Syncthing/Git yourself" — keeps the no-cloud story. Optional: watch the file for changes.
**Effort:** ~1 day.

---

## Sequence

| # | Item | Effort | Why this order |
|---|------|--------|----------------|
| 1 | 1.1 SQLite history | 3–5d | Unblocks alerts, fluxd, aggregates; biggest single gap vs Beszel |
| 2 | 1.2 Alerts + tray | 3–4d | Daily-driver stickiness; needs 1.1 |
| 3 | 1.3 Terminal drop-in | 2–3d | Category-defining, mostly wiring |
| 4 | 3.1 SMART | 1d | Cheap, expected to exist |
| 5 | 3.2 WoL + power | 1d | Cheap, disproportionately loved |
| 6 | 3.3 SSH import (parser) | 1d | Onboarding wow; ProxyJump later |
| 7 | 3.4 Fleet aggregate | 3–4d | Needs poller fan-out |
| 8 | 2.1 fluxd | 1–2w | Big refactor; reuses 1.1+1.2 |
| 9 | 3.3b ProxyJump | 2–3d | Bastion support |
| 10 | 3.5 Proxmox | 1w | New subsystem |
| 11 | 3.6 Export/sync | 1d | Anytime filler |

Rough total: ~6–8 weeks of focused work to v0.5-ish. Phases 1+early-3 (~items 1–6) make a strong v0.3 release story: *history, alerts, terminal, SMART, WoL, instant import.*

## Non-goals (keep the story clean)
- No hosted/cloud anything. No account. No listening sockets by default.
- No install-on-target requirement — agentless stays first-class; flux-agent stays optional accelerator.
- Windows/macOS targets deferred until Linux feature set stabilizes.
