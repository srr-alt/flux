#!/usr/bin/env bash
# One-command release: bump version, commit, tag, build .debs for every
# supported Ubuntu release, publish a GitHub Release, refresh the signed
# apt repo, and (if the flux-apt Pages repo exists) deploy it.
#
# Usage: packaging/release.sh <new-version>   e.g. packaging/release.sh 0.1.2
#
# Docker note: if your shell session predates joining the docker group,
# run as  sg docker -c "packaging/release.sh 0.1.2"
set -euo pipefail

VERSION="${1:?usage: release.sh <new-version> (e.g. 0.1.2)}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Version must be semver (x.y.z), got: $VERSION" >&2
  exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree dirty — commit or stash first." >&2
  exit 1
fi
if git rev-parse "v$VERSION" >/dev/null 2>&1; then
  echo "Tag v$VERSION already exists." >&2
  exit 1
fi

OLD=$(grep -m1 '"version"' src-tauri/tauri.conf.json | sed -E 's/.*: *"([^"]+)".*/\1/')
echo "=== bump $OLD -> $VERSION ==="
sed -i "s/\"version\": \"$OLD\"/\"version\": \"$VERSION\"/" package.json src-tauri/tauri.conf.json
sed -i -s "0,/^version = \"$OLD\"/s//version = \"$VERSION\"/" src-tauri/Cargo.toml crates/flux-core/Cargo.toml crates/flux-agent/Cargo.toml
(cd src-tauri && cargo check -q)   # refresh Cargo.lock

git add package.json src-tauri/tauri.conf.json Cargo.lock \
  src-tauri/Cargo.toml crates/flux-core/Cargo.toml crates/flux-agent/Cargo.toml
git commit -m "release: v$VERSION"
git tag "v$VERSION"

echo "=== build .debs ==="
bash packaging/build.sh

echo "=== refresh apt repo ==="
bash packaging/apt-repo/build.sh

echo "=== push + GitHub Release ==="
git push origin main "v$VERSION"
DEBS=(packaging/dist/*/Flux_"$VERSION"+*_amd64.deb)
# Jammy-built agent has the oldest glibc floor of the supported set —
# that's the one shipped as the standalone release asset.
cp packaging/dist/jammy/flux-agent packaging/dist/flux-agent-linux-amd64
gh release create "v$VERSION" "${DEBS[@]}" packaging/dist/flux-agent-linux-amd64 \
  -t "Flux v$VERSION" \
  -n "Flux v$VERSION — .deb packages for Ubuntu 22.04 (jammy), 24.04 (noble), 26.04 (resolute).
Prefer the apt repo for automatic updates: https://ydvsahil03.github.io/flux-apt/"

if gh repo view ydvsahil03/flux-apt >/dev/null 2>&1; then
  echo "=== deploy apt repo to GitHub Pages ==="
  bash packaging/apt-repo/deploy.sh
else
  echo "flux-apt repo not found — skipped Pages deploy."
  echo "Create it once with: gh repo create flux-apt --public --confirm"
fi

echo "=== release v$VERSION done ==="
