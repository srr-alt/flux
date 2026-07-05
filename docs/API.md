# Flux Local HTTP API

Flux exposes a small HTTP API for programmatic host management — register or
remove monitored machines from scripts, provisioning tools, or CI without
touching the UI. It is served by the desktop app itself, so the app must be
running.

- **Base URL**: `http://127.0.0.1:7869`
- **Binding**: loopback only — the API is never reachable from the network.
- **Content type**: JSON in and out.

## Authentication

Every request needs a bearer token:

```
Authorization: Bearer <token>
```

The token is generated on first app start and stored at
`~/.local/share/com.flux.app/api-token` (file mode `0600`), so only processes
running as the desktop user can read it. Requests without a valid token get
`401 {"error":"missing or bad token"}`.

```bash
TOKEN=$(cat ~/.local/share/com.flux.app/api-token)
```

## Endpoints

### GET /api/health

Liveness probe.

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:7869/api/health
```

`200` — `{"ok": true}`

### GET /api/hosts

List configured remote hosts.

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:7869/api/hosts
```

`200` — array of host objects:

```json
[
  {
    "id": "a1b2c3d4",
    "name": "build-server",
    "address": "10.0.0.5",
    "port": 22,
    "username": "ops",
    "running": true
  }
]
```

`running` is whether a poller is currently active for the host (connected or
retrying), not whether the machine is up.

### POST /api/hosts

Add and fully provision a host — the same flow as the UI wizard: record the
host key (trust-on-first-use), install Flux's SSH public key using the
one-time password, verify key auth works, then start monitoring. The password
is used once and never stored.

Body:

| field      | type   | required | default | notes                        |
|------------|--------|----------|---------|------------------------------|
| `name`     | string | no       | `""`    | display name; falls back to the address in the UI |
| `address`  | string | yes      |         | IP or hostname               |
| `port`     | number | no       | `22`    | SSH port                     |
| `username` | string | yes      |         | SSH user                     |
| `password` | string | yes      |         | used once to install the key |

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"node","address":"10.0.0.5","username":"ops","password":"secret"}' \
  http://127.0.0.1:7869/api/hosts
```

Responses:

- `201` — the created host object (same shape as `GET /api/hosts` entries).
- `400` — malformed JSON body: `{"error":"bad body: …"}`.
- `409` — the host's SSH key changed since it was last seen (possible
  man-in-the-middle; refused). If the machine was legitimately reinstalled,
  forget the old key in the UI wizard ("I reinstalled this machine") and retry.
- `502` — provisioning failed (unreachable, auth rejected, key install
  failed, …): `{"error":"…"}`.

The call blocks until provisioning finishes — allow ~10–15 s for slow hosts.

### DELETE /api/hosts/:id

Stop monitoring and remove a host. `id` from `GET /api/hosts`.

```bash
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:7869/api/hosts/a1b2c3d4
```

- `200` — `{"ok": true}`
- `500` — removal failed: `{"error":"…"}`

### Anything else

`404` — `{"error":"unknown route"}`

## Notes

- The UI reacts to API changes immediately (a `hosts://changed` event refreshes
  the frontend), so hosts added via the API appear in the Fleet page live.
- Port `7869` is fixed (`API_PORT` in `src-tauri/src/api_server.rs`).
- If the port is taken or token setup fails, the API thread logs to stderr and
  the rest of the app runs normally.
