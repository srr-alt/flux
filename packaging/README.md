# Building .deb packages

`build.sh` builds a `.deb` for each targeted Ubuntu release inside a
Docker container matching that release, so the package links against
the release's actual glibc/webkit2gtk/libsoup instead of whatever the
host happens to have.

```
bash packaging/build.sh          # build all targets
bash packaging/build.sh jammy    # build one target only
```

Output lands in `packaging/dist/<codename>/Flux_<version>_amd64.deb`.

## Privacy lock factory default

Fresh installs start with the privacy lock **engaged** (Fleet and the
Assistant hidden). The factory password is:

```
Admin@123#
```

Unlock in Settings → Privacy lock, then set your own password there.
The lock is a UI privacy gate for shared screens, not a security
boundary — the hash lives in the app's localStorage.

## Targets

| Codename | Ubuntu  | Status |
|----------|---------|--------|
| jammy    | 22.04   | built  |
| noble    | 24.04   | built  |
| resolute | 26.04   | built  |
| focal    | 20.04   | **not supported** |

## Why Ubuntu 20.04 is not supported

Current Tauri v2 (wry 0.55 / webkit2gtk-rs 2.0.2) unconditionally links
against **libwebkit2gtk-4.1** and **libsoup-3.0** — there is no cargo
feature to fall back to the older webkit2gtk-4.0/libsoup2 stack that
earlier Tauri releases supported. This was verified against wry
0.55.1's `Cargo.toml`: `os-webview` (the default feature) hard-depends
on `webkit2gtk`/`webkit2gtk-sys` 2.0.2 and `soup3`, with no alternate
feature gate.

Ubuntu 20.04's repositories (main, universe, updates, security,
backports) never shipped `libwebkit2gtk-4.1-dev` or `libsoup-3.0-dev`
at any point in focal's lifecycle — confirmed via `apt-cache madison`
against the live archive. So there is no `apt install` path to the
required headers on stock 20.04.

Options if 20.04 support becomes a requirement:
- Downgrade to an older Tauri version (v1, or an early v2 release still
  supporting the webkit2gtk-4.0/libsoup2 backend) — a significant
  version downgrade across the whole app, not just packaging.
- Backport `libwebkit2gtk-4.1-dev`/`libsoup-3.0-dev` from a PPA (none
  vetted here; treat any third-party PPA as untrusted until reviewed).
- Ship an AppImage instead for 20.04, bundling the newer webkit2gtk/
  libsoup libraries alongside the binary rather than relying on the
  host's system packages.

## How it works

`Dockerfile` takes `BASE_IMAGE` and `WEBKIT_PKG` build args and
installs the Tauri Linux prerequisites, Node 20 (via nodesource, which
now serves a single `nodistro` repo so the same setup script works
across all these releases), and Rust (via rustup). `build.sh` then runs
the built image with:

- the repo bind-mounted read-only at `/src`
- a per-codename named volume at `/work` (holds the rsynced source
  copy, `node_modules`, and the Rust `target/` dir — kept separate per
  release since `target/` isn't safely shared across different
  glibc/webkit ABIs)
- a per-codename named volume caching the Cargo registry
- the corresponding `packaging/dist/<codename>/` directory bind-mounted
  writable at `/out`, where the resulting `.deb` is copied and
  chowned back to the host user
