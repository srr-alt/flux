# Flux apt repository

Signed apt repository for [Flux](https://github.com/ydvsahil03/vantage) — a modern Linux system monitor and optimizer (Stacer replacement) built with Tauri.

Supported Ubuntu releases: **22.04 (jammy)**, **24.04 (noble)**, **26.04 (resolute)**.

## Install

```bash
# 1. Import the signing key
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://ydvsahil03.github.io/flux-apt/pubkey.gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/flux.gpg

# 2. Add the repository (uses your Ubuntu codename automatically)
echo "deb [signed-by=/etc/apt/keyrings/flux.gpg] https://ydvsahil03.github.io/flux-apt $(lsb_release -cs) main" \
  | sudo tee /etc/apt/sources.list.d/flux.list

# 3. Install
sudo apt update
sudo apt install flux
```

## Key fingerprint

```
703C D0EB 7F08 8E1C B4E6  1178 A3BF BD72 454C 3F61
```

Verify after import:

```bash
gpg --show-keys /etc/apt/keyrings/flux.gpg
```

## Notes

- Ubuntu 20.04 (focal) is not supported: Flux requires webkit2gtk-4.1/libsoup3, which focal never shipped.
- Packages are versioned per release (e.g. `0.1.0+jammy`) so each codename gets a build linked against its own system libraries.
