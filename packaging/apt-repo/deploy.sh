#!/usr/bin/env bash
# Deploys the generated apt repo tree (publish/) to the GitHub Pages repo
# https://github.com/ydvsahil03/flux-apt — served at
# https://ydvsahil03.github.io/flux-apt/
#
# Prereq: run build.sh first so publish/ is fresh, and create the public
# repo once with:  gh repo create flux-apt --public --confirm
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PUBLISH_DIR="$DIR/publish"
PAGES_REPO="git@github.com:ydvsahil03/flux-apt.git"
# gh auth setup-git means https works too; prefer https for token auth
PAGES_REPO_HTTPS="https://github.com/ydvsahil03/flux-apt.git"

if [[ ! -f "$PUBLISH_DIR/pubkey.gpg" ]]; then
  echo "publish/ missing or incomplete — run build.sh first." >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cp -a "$PUBLISH_DIR"/. "$WORK/"
# Pages runs Jekyll by default; .nojekyll disables it so nothing is filtered
touch "$WORK/.nojekyll"
cp "$DIR/pages-README.md" "$WORK/README.md"

cd "$WORK"
git init -q -b main
git add -A
git -c user.name=ydvsahil03 -c user.email=ydvsahil0003@gmail.com \
  commit -q -m "apt repo snapshot $(date -u +%Y-%m-%dT%H:%M:%SZ)"
# Repo history is disposable — each deploy is a full snapshot
git push -f "$PAGES_REPO_HTTPS" main

echo "Deployed. If this is the first deploy, enable Pages:"
echo "  gh api repos/ydvsahil03/flux-apt/pages -f 'source[branch]=main' -f 'source[path]=/'"
echo "Repo URL: https://ydvsahil03.github.io/flux-apt/"
