// Collectors shared with flux-agent live in the flux-core crate; only the
// GPU module (local-only scope) remains here. Re-export so existing
// `crate::monitor::*` paths keep working.
pub mod gpu;
pub mod process_detail;

pub use flux_core::{
    cpu, disk, memory, network, process, process_actions, sensors, system_info, TickSnapshot,
};
