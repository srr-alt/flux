#!/usr/bin/env bash
# Builds the signed apt repo tree (pool/ + dists/) from the .debs already
# produced by packaging/build.sh, using reprepro inside a throwaway
# container so the host doesn't need reprepro/gpg packages installed
# beyond the gpg binary already used to generate the signing key.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="$(cd "$DIR/../dist" && pwd)"
PUBLISH_DIR="$DIR/publish"
HOST_UID="$(id -u)"
HOST_GID="$(id -g)"

if [[ ! -f "$DIR/gnupg/pubring.kbx" ]]; then
  echo "No signing key found — run gen-key.sh first." >&2
  exit 1
fi

mkdir -p "$PUBLISH_DIR"

for codename in jammy noble resolute; do
  if ! ls "$DIST_DIR/$codename"/*.deb >/dev/null 2>&1; then
    echo "Skipping $codename: no .deb in $DIST_DIR/$codename (run packaging/build.sh first)"
    continue
  fi
  echo "=== including $codename ==="
  docker run --rm \
    -v "$DIR":/repo \
    -v "$DIST_DIR/$codename":/incoming:ro \
    -e HOST_UID="$HOST_UID" \
    -e HOST_GID="$HOST_GID" \
    -w /repo \
    debian:stable-slim \
    bash -c "
      set -euo pipefail
      apt-get update -qq >/dev/null
      apt-get install -y --no-install-recommends reprepro gnupg >/dev/null
      # gpgme refuses to sign against a GNUPGHOME owned by another uid
      # ('unsafe ownership'); the bind-mounted keyring is host-owned, so
      # copy it into a root-owned scratch dir for this container's use.
      cp -a /repo/gnupg /tmp/gnupg-run
      chown -R root:root /tmp/gnupg-run
      chmod 700 /tmp/gnupg-run
      echo allow-loopback-pinentry >> /tmp/gnupg-run/gpg-agent.conf
      echo pinentry-mode loopback >> /tmp/gnupg-run/gpg.conf
      export GNUPGHOME=/tmp/gnupg-run
      gpgconf --kill gpg-agent || true
      reprepro --basedir /repo --outdir /repo/publish \
        --section=utils --priority=optional \
        includedeb $codename /incoming/*.deb
      chown -R \"\$HOST_UID:\$HOST_GID\" /repo/publish /repo/db
    "
done

cp "$DIR/pubkey.gpg" "$PUBLISH_DIR/pubkey.gpg"
echo "=== apt repo tree ready at $PUBLISH_DIR ==="
