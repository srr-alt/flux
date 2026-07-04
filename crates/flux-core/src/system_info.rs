use serde::{Deserialize, Serialize};
use sysinfo::System;

#[derive(Serialize, Deserialize, Clone)]
pub struct SystemInfo {
    pub hostname: String,
    pub kernel_version: String,
    pub os_pretty_name: String,
    pub cpu_model: String,
    pub physical_cores: usize,
    pub logical_cores: usize,
    pub total_memory_kb: u64,
    pub uptime_secs: u64,
}

pub fn collect(sys: &System) -> SystemInfo {
    SystemInfo {
        hostname: System::host_name().unwrap_or_else(|| "unknown".into()),
        kernel_version: System::kernel_version().unwrap_or_else(|| "unknown".into()),
        os_pretty_name: System::long_os_version()
            .or_else(System::name)
            .unwrap_or_else(|| "Linux".into()),
        cpu_model: sys
            .cpus()
            .first()
            .map(|c| c.brand().to_string())
            .unwrap_or_default(),
        physical_cores: System::physical_core_count().unwrap_or(0),
        logical_cores: sys.cpus().len(),
        total_memory_kb: sys.total_memory() / 1024,
        uptime_secs: System::uptime(),
    }
}
