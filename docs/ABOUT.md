# Flux — Technical Overview

## What it is

Flux is a Linux-native system monitor and fleet dashboard, built as a desktop app. One window watches the local machine like a modern Task Manager, and any number of remote Linux machines over plain SSH — no agent required, no cloud, no account. All data stays on your machine.

- **Distribution:** `.deb` + apt repository (hosted on GitHub Pages)
- **Requires:** Ubuntu 22.04+/equivalent (Tauri v2 needs webkitgtk 4.1)

## Stack

| Layer | Tech |
|---|---|
| Shell | Tauri v2 (Rust backend, system webview) |
| Frontend | React 19 + TypeScript, Tailwind v4, Zustand stores, uPlot charts, xterm.js |
| Workspace | `src-tauri` (app, pkg `flux`) + `crates/flux-core` (parsers/models, unit-tested) + `crates/flux-agent` (optional remote helper binary) |
| Remote | `ssh2` crate (libssh2 bindings) |
| Storage | SQLite (`rusqlite`) for history, JSON files for config |

The split matters: `flux-core` holds pure parsing/logic (CPU tick math, /proc parsers, SMART JSON, process models) so both the desktop app and `flux-agent` reuse it, and it's where most unit tests live.

## Feature map

**Local monitoring (Performance page):** CPU (global + per-core, frequency, load), memory, per-interface network, per-device disk I/O + mounts, GPU (NVIDIA via nvidia-smi with VRAM/encode/decode/clocks; amdgpu via sysfs; open drivers get temperature), sensors (hwmon), refresh rate user-settable 0.1s–5s (disk/sensors/GPU floored at 500ms).

**History:** every sample lands in SQLite (`history.db`) through a single writer thread — raw → 1-minute → 10-minute rollup tiers with retention caps. Charts offer Live / 3h / 24h / 7d / 30d. GPU history rides its own half-cadence path.

**Fleet:** host tiles with live sparklines, aggregate header (online count, avg CPU, total memory, aggregate traffic), cross-host top-processes table, Wake-on-LAN for offline hosts (MAC auto-captured on first connect), graceful reboot/poweroff, Proxmox guest sub-rows (VMs/LXCs with start/shutdown/stop).

**Tools:** process table (kill/renice, per-process detail), alerts engine (threshold + duration rules on cpu/mem/temp/net, desktop notifications, tray health dot), Docker (containers, logs, exec shell), services (systemd), startup apps, disk cleaner, uninstaller, SMART disk health, hardware info.

**Terminal:** ``Ctrl+` `` drops a shell on whichever host is selected — local PTY or remote SSH — in a slide-over panel with per-host command history.

**Privacy lock:** password-gated lock (ships locked, factory password documented in packaging) hides Fleet, remote data, and the terminal for remote hosts.

**Local HTTP API:** `127.0.0.1:7869` with a bearer token on disk — scripts can register hosts (`POST /api/hosts`).

---

## SSH handling in depth

This is the core of the remote story. Everything below lives in `src-tauri/src/remote/`.

### Library and session basics (`session.rs`)

Flux uses the `ssh2` crate (libssh2) — not the system `ssh` binary — so there are no subprocesses, no dependence on the user's `~/.ssh/config`, and full programmatic control over auth and host-key policy.

`SshSession::connect`:
- DNS resolve, TCP connect with a **5s connect timeout**, `TCP_NODELAY` on
- SSH handshake, then a **10s blocking-I/O timeout** on the session — a hung link fails into the poller's backoff path instead of freezing a thread for minutes

The wrapper exposes: `fingerprint()` (OpenSSH-style `SHA256:<base64>` of the host key), `check_host_key`/`remember_host_key`, `auth_key`/`auth_password`, `exec_capture` (run command, capture stdout; non-zero exit becomes `Err` carrying stderr), and `upload` (SFTP write + chmod, mkdir -p'd parents — used for agent deploy).

### Host-key trust: TOFU with a hard MITM stop

Flux owns its **own known_hosts file** (`~/.local/share/com.flux.app/known_hosts`) — it never touches or trusts `~/.ssh/known_hosts`. Three states:

- **Known** — key matches recorded entry, proceed.
- **Unknown** — never seen: the Add Host wizard displays the SHA256 fingerprint and the user explicitly accepts (trust-on-first-use). Only then is the key written (`[host]:port` format for non-22 ports).
- **Changed** — key differs from the recorded one: **hard refusal everywhere.** The poller reports "HOST KEY CHANGED — possible man-in-the-middle", add-host refuses, one-shot sessions refuse. Recovery is deliberate: a `forget_host_key` command removes exactly that host's entry (the file only contains entries Flux wrote), after which the wizard shows the new fingerprint for re-acceptance.

Background pollers never TOFU-accept anything — an unknown key outside the wizard is an error ("host key not yet trusted — re-add the host"). Trust decisions only happen with a human looking at a fingerprint.

### Credentials: one app keypair, password used once

- On first host add, Flux generates a dedicated **ed25519 keypair** (`keys/flux_ed25519`, shelling out to `ssh-keygen` since libssh2 can't generate keys), comment `flux-monitor`.
- The add flow (`add_host_blocking`): connect → TOFU check/accept → **password auth once** → idempotent `authorized_keys` append (`mkdir -p ~/.ssh; chmod 700; grep -qxF || append; chmod 600`) → open a **fresh verification session and prove key auth works** → only then persist the host.
- The password lives only on that call's stack — it is **never stored**, and everything afterwards (polling, terminal, SMART, power, Proxmox) is key auth with the app key.
- `hosts.json` stores id/name/address/port/username/key_path/MAC — no secrets.

### The per-host poller (`poller.rs`)

Each host gets **one OS thread owning one long-lived SSH session** plus an mpsc control channel:

- **Lifecycle:** connect → verify host key → key auth → fetch statics (hostname, OS, cores, memory) → publish "Connected". Errors publish a status the tile renders verbatim.
- **Reconnect backoff:** 1, 2, 5, 15, 30s steps; sleeps are sliced through `recv_timeout` so a Stop command still lands promptly. 3 consecutive poll failures → "Degraded" → reconnect loop.
- **Polling:** one **batched command per tick** — a single `sh -c` catting `/proc/stat`, `loadavg`, `meminfo`, `swaps`, `net/dev`, cpufreq, `diskstats`, `/sys/block`, and `df`, with `@@marker` section delimiters, every section best-effort. One SSH round-trip per sample; all parsing happens locally in `flux-core` using delta state (CPU ticks, net/disk counters) kept per connection. This is the "agentless" mode — nothing is installed on the target.
- **Control-channel piggybacking:** the inter-tick `recv_timeout` doubles as a command mailbox. Process listing (`ps -eo …`, CPU% from cputimes deltas), kill, and agent-switch requests execute **on the same session between ticks** — the fleet process table and Processes page reuse the already-authenticated connection instead of opening new ones.
- **First-connect extras:** primary MAC capture for Wake-on-LAN (walks `/sys/class/net` — `iproute2` isn't guaranteed on minimal systems), and a one-time `pveversion` probe; Proxmox nodes then get a 10s guest-list cadence.

### Dedicated one-shot sessions

Anything that could block or outlive a poll tick gets its **own SSH session** (same connect/host-key/auth path) so the metrics loop never stalls:

- **Terminal** (`terminal.rs`): new session per shell, `request_pty` + `shell`, session switched to non-blocking; a single I/O thread pumps read/write/resize via mpsc (libssh2 channels can't be split across threads), streaming output to xterm.js as Tauri events.
- **SMART**: `sudo -n smartctl -aj || smartctl -aj` with `PATH=$PATH:/usr/sbin:/sbin` (non-interactive SSH often lacks sbin on Debian).
- **Power**: `sudo -n systemctl reboot|poweroff || systemctl …` — read/channel errors *after* exec are treated as success, because the connection dying is what shutdown looks like.
- **Proxmox actions**: `qm|pct start|shutdown|stop <vmid>`, kind/action allowlisted, since a graceful VM shutdown can take tens of seconds.
- **Agent deploy**: SFTP-uploads the `flux-agent` binary, then hands the poller a switch command; if the agent dies, the poller falls back to agentless on the same session with fresh delta baselines.

### Command-injection posture

Anything interpolated into a remote command is allowlisted or sanitized at the boundary: device names must match `[a-zA-Z0-9_-]+` before reaching `sh -c`, power verbs and Proxmox kind/action come from fixed enum matches, vmid is a `u64`. Remote error strings are surfaced verbatim in the UI but never re-executed.

### What agentless mode costs and buys

Buys: zero footprint on targets (any Linux box with sshd works — containers, VMs, routers with `/proc`), no versioning/update problem, instant onboarding. Costs: no per-process disk I/O rates (kernel hides other users' `/proc/[pid]/io`; agent mode provides them), process CPU% needs two samples to become real, and everything is bounded by SSH round-trip latency. The optional `flux-agent` and the planned `fluxd` daemon address the gaps while keeping agentless as the default.

---

## Storage layout

`~/.local/share/com.flux.app/`: `history.db` (metrics + alert events), `hosts.json`, `alerts.json` (atomic tmp+rename writes), `known_hosts`, `keys/flux_ed25519(.pub)`, `docker_prefs.json` (incl. per-host shell history), `api-token`.
