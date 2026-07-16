#!/usr/bin/env bash
# Flux apt setup — one command install:
#   curl -fsSL https://srr-alt.github.io/flux-apt/setup.sh | sudo bash
#
# Installs the repo signing key to /etc/apt/keyrings, registers the apt
# source for your Ubuntu release, and installs Flux. Updates then arrive
# through normal `apt upgrade`.
set -euo pipefail

REPO_URL="https://srr-alt.github.io/flux-apt"
SUPPORTED="jammy noble resolute trixie"

if [[ $(id -u) -ne 0 ]]; then
  echo "This script needs root. Run:" >&2
  echo "  curl -fsSL $REPO_URL/setup.sh | sudo bash" >&2
  exit 1
fi

# Resolve the codename — UBUNTU_CODENAME covers Ubuntu derivatives
# (Mint, Pop!_OS, Zorin, elementary) whose own VERSION_CODENAME differs;
# Debian and its derivatives use VERSION_CODENAME / DEBIAN_CODENAME.
. /etc/os-release
CODENAME="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"

# Rolling Debian derivatives track trixie-era packages.
case "$CODENAME" in
  kali-rolling|lory|parrot) CODENAME=trixie ;;
esac

case " $SUPPORTED " in
  *" $CODENAME "*) ;;
  *)
    echo "Unsupported release '${CODENAME:-unknown}' — supported: $SUPPORTED" >&2
    echo "(Ubuntu 20.04/focal cannot be supported: Tauri v2 needs webkit2gtk-4.1.)" >&2
    echo "Fedora/openSUSE/RHEL: use the .rpm from https://github.com/srr-alt/flux/releases" >&2
    echo "Arch: PKGBUILD in packaging/aur/ (AUR: flux-monitor-bin)" >&2
    exit 1
    ;;
esac

# gnupg can be absent on minimal installs; curl exists (it fetched this script).
if ! command -v gpg >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y --no-install-recommends gnupg
fi

install -d -m 0755 /etc/apt/keyrings
curl -fsSL "$REPO_URL/pubkey.gpg" | gpg --dearmor --yes -o /etc/apt/keyrings/flux.gpg
echo "deb [signed-by=/etc/apt/keyrings/flux.gpg] $REPO_URL $CODENAME main" \
  > /etc/apt/sources.list.d/flux.list

apt-get update
apt-get install -y flux

echo
echo "Flux installed — launch it from your app menu or run: flux"
echo "Updates arrive via normal apt upgrade."
