//! Local HTTP API for programmatic host management.
//!
//! Binds 127.0.0.1 only. Every request needs `Authorization: Bearer <token>`
//! where the token lives in `<app-data>/api-token` (created on first start,
//! mode 0600) — so only processes running as the desktop user can call it.
//!
//!   TOKEN=$(cat ~/.local/share/com.flux.app/api-token)
//!   curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:7869/api/hosts
//!   curl -s -X POST -H "Authorization: Bearer $TOKEN" \
//!     -d '{"name":"node","address":"10.0.0.5","port":22,"username":"ops","password":"..."}' \
//!     http://127.0.0.1:7869/api/hosts
//!   curl -s -X DELETE -H "Authorization: Bearer $TOKEN" \
//!     http://127.0.0.1:7869/api/hosts/<id>
//!
//! POST provisions exactly like the UI wizard (TOFU key record, install the
//! app SSH key using the one-time password, verify, connect) and returns the
//! HostView JSON. A changed host key is refused with 409.

use std::os::unix::fs::PermissionsExt;

use serde::Deserialize;
use tauri::{AppHandle, Manager};

use crate::commands_hosts::{self, NewHost};
use crate::state::AppState;

pub const API_PORT: u16 = 7869;

#[derive(Deserialize)]
struct AddHostBody {
    #[serde(default)]
    name: String,
    address: String,
    #[serde(default = "default_port")]
    port: u16,
    username: String,
    password: String,
}

fn default_port() -> u16 {
    22
}

fn load_or_create_token(app: &AppHandle) -> std::io::Result<String> {
    let dir = app.path().app_data_dir().expect("app data dir");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join("api-token");
    if let Ok(token) = std::fs::read_to_string(&path) {
        let token = token.trim().to_string();
        if !token.is_empty() {
            return Ok(token);
        }
    }
    let token = uuid::Uuid::new_v4().simple().to_string();
    std::fs::write(&path, &token)?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    Ok(token)
}

fn json_response(status: u16, body: String) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    let mut response = tiny_http::Response::from_string(body).with_status_code(status);
    response.add_header(
        tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
    );
    response
}

fn err_body(message: &str) -> String {
    serde_json::json!({ "error": message }).to_string()
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let token = match load_or_create_token(&app) {
            Ok(t) => t,
            Err(e) => {
                eprintln!("flux api: token setup failed: {e}");
                return;
            }
        };
        let server = match tiny_http::Server::http(("127.0.0.1", API_PORT)) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("flux api: bind 127.0.0.1:{API_PORT} failed: {e}");
                return;
            }
        };
        println!("flux api listening on 127.0.0.1:{API_PORT}");

        for mut request in server.incoming_requests() {
            let authorized = request
                .headers()
                .iter()
                .find(|h| h.field.equiv("Authorization"))
                .map(|h| h.value.as_str() == format!("Bearer {token}"))
                .unwrap_or(false);
            if !authorized {
                let _ = request.respond(json_response(401, err_body("missing or bad token")));
                continue;
            }

            let method = request.method().clone();
            let url = request.url().to_string();
            let path: Vec<&str> = url
                .trim_start_matches('/')
                .trim_end_matches('/')
                .split('/')
                .collect();

            let response = match (method.as_str(), path.as_slice()) {
                ("GET", ["api", "health"]) => {
                    json_response(200, serde_json::json!({"ok": true}).to_string())
                }
                ("GET", ["api", "hosts"]) => {
                    let views = commands_hosts::views(&app.state::<AppState>());
                    json_response(200, serde_json::to_string(&views).unwrap_or_default())
                }
                ("POST", ["api", "hosts"]) => {
                    let mut body = String::new();
                    let _ = request.as_reader().read_to_string(&mut body);
                    match serde_json::from_str::<AddHostBody>(&body) {
                        Err(e) => json_response(400, err_body(&format!("bad body: {e}"))),
                        Ok(add) => {
                            let new = NewHost {
                                name: add.name,
                                address: add.address,
                                port: add.port,
                                username: add.username,
                            };
                            match commands_hosts::add_host_blocking(&app, new, &add.password) {
                                Ok(view) => json_response(
                                    201,
                                    serde_json::to_string(&view).unwrap_or_default(),
                                ),
                                Err(e) if e.contains("Host key changed") => {
                                    json_response(409, err_body(&e))
                                }
                                Err(e) => json_response(502, err_body(&e)),
                            }
                        }
                    }
                }
                ("DELETE", ["api", "hosts", id]) => {
                    match commands_hosts::remove_host_blocking(&app, id) {
                        Ok(()) => json_response(200, serde_json::json!({"ok": true}).to_string()),
                        Err(e) => json_response(500, err_body(&e)),
                    }
                }
                _ => json_response(404, err_body("unknown route")),
            };
            let _ = request.respond(response);
        }
    });
}
