pub mod cpu;
pub mod disk;
pub mod memory;
pub mod network;
pub mod process;
pub mod process_actions;
pub mod protocol;
pub mod system_info;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct TickSnapshot {
    pub timestamp_ms: u64,
    pub cpu: cpu::CpuSnapshot,
    pub memory: memory::MemorySnapshot,
    pub network: Vec<network::NetworkInterfaceSnapshot>,
}
