pub mod agentless;
pub mod hosts;
pub mod poller;
pub mod session;

use serde::Serialize;

pub type HostId = String;

#[derive(Serialize, Clone, PartialEq)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum HostStatus {
    Connecting,
    Connected { mode: CollectionMode },
    /// Consecutive poll failures; reconnecting with backoff.
    Degraded,
    Disconnected,
    Error { message: String },
}

#[derive(Serialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CollectionMode {
    Agentless,
    Agent,
}

/// Payload of the `hosts://status` event.
#[derive(Serialize, Clone)]
pub struct HostStatusEvent {
    pub host_id: HostId,
    pub status: HostStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_info: Option<flux_core::system_info::SystemInfo>,
}

/// Payload of `monitor://remote-tick` / `monitor://remote-disks`.
#[derive(Serialize, Clone)]
pub struct RemoteEvent<T: Serialize + Clone> {
    pub host_id: HostId,
    pub snapshot: T,
}

pub const EVENT_HOST_STATUS: &str = "hosts://status";
pub const EVENT_REMOTE_TICK: &str = "monitor://remote-tick";
pub const EVENT_REMOTE_DISKS: &str = "monitor://remote-disks";
pub const EVENT_DEPLOY_PROGRESS: &str = "deploy://progress";
