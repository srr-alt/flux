#!/usr/bin/env bash
# Builds a .deb for each targeted Ubuntu release inside a matching Docker
# container, so the resulting package links against that release's actual
# glibc/webkit2gtk/libsoup instead of whatever happens to be on the host.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$REPO_ROOT/packaging/dist"
HOST_UID="$(id -u)"
HOST_GID="$(id -g)"

# codename|base_image|webkit_pkg|cargo_features
#
# All current Tauri v2 builds require libwebkit2gtk-4.1-dev + libsoup-3.0-dev
# unconditionally (wry's "os-webview" default feature hardcodes them, no
# feature flag reverts to -4.0/libsoup2). Ubuntu 20.04 (focal) never shipped
# either package in any repo component, so it cannot be targeted with the
# current toolchain — omitted here, see packaging/README.md.
TARGETS=(
  "jammy|ubuntu:22.04|libwebkit2gtk-4.1-dev|"
  "noble|ubuntu:24.04|libwebkit2gtk-4.1-dev|"
  "resolute|ubuntu:26.04|libwebkit2gtk-4.1-dev|"
  "trixie|debian:trixie|libwebkit2gtk-4.1-dev|"
)

ONLY="${1:-}"

for entry in "${TARGETS[@]}"; do
  IFS='|' read -r codename base_image webkit_pkg features <<< "$entry"

  if [[ -n "$ONLY" && "$ONLY" != "$codename" ]]; then
    continue
  fi

  echo "=== $codename ($base_image, $webkit_pkg) ==="
  image_tag="vantage-builder:$codename"

  docker build \
    --build-arg BASE_IMAGE="$base_image" \
    --build-arg WEBKIT_PKG="$webkit_pkg" \
    -t "$image_tag" \
    -f "$REPO_ROOT/packaging/Dockerfile" \
    "$REPO_ROOT/packaging"

  out_dir="$DIST_DIR/$codename"
  mkdir -p "$out_dir"

  feature_flag=""
  if [[ -n "$features" ]]; then
    feature_flag="--features $features"
  fi

  # Suffix the version per distro: the three builds share a package name
  # but are compiled against different webkit2gtk ABIs, and a shared apt
  # pool (reprepro) rejects same-name/same-version packages whose file
  # contents differ. Standard PPA convention (e.g. 0.1.0+jammy).
  base_version=$(grep -m1 '"version"' "$REPO_ROOT/src-tauri/tauri.conf.json" | sed -E 's/.*: *"([^"]+)".*/\1/')
  config_flag="--config '{\"version\":\"${base_version}+${codename}\"}'"

  docker run --rm \
    -v "$REPO_ROOT":/src:ro \
    -v "$out_dir":/out \
    -v "vantage-work-$codename":/work \
    -v "vantage-cargo-registry-$codename":/opt/cargo/registry \
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
      # The work volume persists between builds; clear old bundles so only
      # this build's .deb lands in /out.
      rm -f target/release/bundle/deb/*.deb
      # Build the headless agent first and bundle it as a resource so the
      # app can deploy it to remote hosts.
      cargo build --release -p flux-agent
      mkdir -p src-tauri/resources
      cp target/release/flux-agent src-tauri/resources/flux-agent
      cp target/release/flux-agent /out/flux-agent
      npm run tauri build -- --bundles deb $feature_flag $config_flag
      cp target/release/bundle/deb/*.deb /out/
      chown -R \"\$HOST_UID:\$HOST_GID\" /out
    "

  echo "=== $codename done: $(ls "$out_dir")"
done
