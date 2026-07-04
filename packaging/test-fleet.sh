#!/usr/bin/env bash
# Spins up a small SSH-able container fleet for testing Flux's multi-system
# monitoring/deployment. All users: test / test123 (sudo works with the same
# password where noted).
#
#   packaging/test-fleet.sh up      # create/start the fleet
#   packaging/test-fleet.sh down    # remove it
#   packaging/test-fleet.sh status
#
# Fleet:
#   flux-node1  ubuntu:22.04  port 2299  monitoring + agent deploy
#   flux-node2  ubuntu:24.04  port 2300  + sudo -> .deb install flow works
#   flux-node3  debian:12     port 2301  unsupported-distro gate (install must refuse)
set -euo pipefail

cmd="${1:-up}"

NODES=(
  "flux-node1|ubuntu:22.04|2299|"
  "flux-node2|ubuntu:24.04|2300|sudo"
  "flux-node3|debian:12|2301|sudo"
)

up() {
  for entry in "${NODES[@]}"; do
    IFS='|' read -r name image port extras <<<"$entry"
    if docker ps --format '{{.Names}}' | grep -qx "$name"; then
      echo "$name already running"
      continue
    fi
    docker rm -f "$name" >/dev/null 2>&1 || true
    echo "=== starting $name ($image, ssh port $port) ==="
    sudo_setup=""
    if [[ "$extras" == *sudo* ]]; then
      # test can sudo with password test123 — exercises the sudo -S path
      sudo_setup="apt-get install -y -qq sudo >/dev/null && usermod -aG sudo test &&"
    fi
    docker run -d --name "$name" -p "$port:22" "$image" bash -c "
      export DEBIAN_FRONTEND=noninteractive
      apt-get update -qq &&
      apt-get install -y -qq openssh-server procps curl gnupg ca-certificates >/dev/null &&
      useradd -m -s /bin/bash test && echo test:test123 | chpasswd &&
      $sudo_setup
      mkdir -p /run/sshd &&
      # light periodic load so charts show movement
      su - test -c 'nohup sh -c \"while true; do head -c 40M /dev/urandom | sha256sum >/dev/null; sleep 4; done\" >/dev/null 2>&1 &' &&
      exec /usr/sbin/sshd -D
    " >/dev/null
  done
  echo "waiting for sshd..."
  for entry in "${NODES[@]}"; do
    IFS='|' read -r name image port extras <<<"$entry"
    for _ in $(seq 1 60); do
      if (echo >"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
        echo "$name ready on 127.0.0.1:$port (test/test123)"
        continue 2
      fi
      sleep 2
    done
    echo "$name did NOT come up — docker logs $name" >&2
  done
}

down() {
  for entry in "${NODES[@]}"; do
    IFS='|' read -r name _ _ _ <<<"$entry"
    docker rm -f "$name" >/dev/null 2>&1 && echo "removed $name" || true
  done
}

status() {
  docker ps -a --filter name=flux-node --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
}

case "$cmd" in
  up) up ;;
  down) down ;;
  status) status ;;
  *) echo "usage: $0 up|down|status" >&2; exit 1 ;;
esac
