//! JSON-lines protocol between the Flux app (SSH client) and flux-agent
//! running on a remote host. One JSON object per line.
//!
//! stdout (agent -> app): `AgentEvent`
//! stdin  (app -> agent): `AgentRequest`; every request gets exactly one
//! `AgentEvent::Response` with the matching `id`.

use serde::{Deserialize, Serialize};

use crate::process::{ProcessInfo, ProcessQuery};
use crate::system_info::SystemInfo;
use crate::TickSnapshot;

#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    /// First line the agent prints after startup.
    Hello {
        version: String,
        system_info: SystemInfo,
    },
    Tick(TickSnapshot),
    Disks(crate::disk::DiskSnapshot),
    Response {
        id: u64,
        ok: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        data: Option<serde_json::Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
pub enum AgentRequest {
    Processes {
        id: u64,
        query: ProcessQuery,
    },
    Kill {
        id: u64,
        pid: u32,
        force: bool,
    },
    Renice {
        id: u64,
        pid: u32,
        niceness: i32,
    },
    /// Change the tick interval without restarting the agent.
    SetInterval {
        id: u64,
        ms: u64,
    },
}

/// Typed payload of a successful `Processes` response.
pub type ProcessesData = Vec<ProcessInfo>;
