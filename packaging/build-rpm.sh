#!/usr/bin/env bash
# Builds the .rpm inside a Rocky 10 container (oldest glibc that still
# has webkit2gtk-4.1 — runs on EL10, Fedora 40+, openSUSE).
# Mirrors build.sh; Tauri's bundler produces the rpm itself, no rpmbuild.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$REPO_ROOT/packaging/dist/rpm"
HOST_UID="$(id -u)"
HOST_GID="$(id -g)"

echo "=== rpm (rockylinux 10) ==="
image_tag="vantage-builder:rpm"

docker build -t "$image_tag" -f "$REPO_ROOT/packaging/Dockerfile.rpm" "$REPO_ROOT/packaging"

mkdir -p "$DIST_DIR"

docker run --rm \
  -v "$REPO_ROOT":/src:ro \
  -v "$DIST_DIR":/out \
  -v "vantage-work-rpm":/work \
  -v "vantage-cargo-registry-rpm":/opt/cargo/registry \
  -e HOST_UID="$HOST_UID" \
  -e HOST_GID="$HOST_GID" \
  "$image_tag" \
  bash -c "
    set -euo pipefail
    rsync -a --delete \
      --exclude node_modules --exclude target --exclude dist \
      --exclude .git --exclude packaging \
      /src/ /work/src/
    cd /work/src
    npm ci
    rm -f target/release/bundle/rpm/*.rpm
    cargo build --release -p flux-agent
    mkdir -p src-tauri/resources
    cp target/release/flux-agent src-tauri/resources/flux-agent
    npm run tauri build -- --bundles rpm
    cp target/release/bundle/rpm/*.rpm /out/
    chown -R \"\$HOST_UID:\$HOST_GID\" /out
  "

echo "=== rpm done: $(ls "$DIST_DIR")"
