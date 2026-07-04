use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct SwapDevice {
    pub name: String,
    pub kind: String,
    pub size_kb: u64,
    pub used_kb: u64,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct MemorySnapshot {
    pub total_kb: u64,
    pub free_kb: u64,
    pub available_kb: u64,
    pub cached_kb: u64,
    pub buffers_kb: u64,
    pub shmem_kb: u64,
    pub active_kb: u64,
    pub inactive_kb: u64,
    pub dirty_kb: u64,
    pub writeback_kb: u64,
    pub slab_kb: u64,
    pub page_tables_kb: u64,
    pub commit_limit_kb: u64,
    pub committed_kb: u64,
    pub swap_total_kb: u64,
    pub swap_used_kb: u64,
    pub swap_devices: Vec<SwapDevice>,
}

/// Parse /proc/meminfo directly: we want the full Linux breakdown
/// (buffers/cached/reclaimable/shmem), not sysinfo's cross-platform subset.
pub fn snapshot() -> MemorySnapshot {
    let meminfo = fs::read_to_string("/proc/meminfo").unwrap_or_default();
    let swaps = fs::read_to_string("/proc/swaps").unwrap_or_default();
    parse(&meminfo, &swaps)
}

/// Pure parser over /proc/meminfo + /proc/swaps contents — shared by the
/// local snapshot above and the agentless SSH collector.
pub fn parse(meminfo_raw: &str, swaps_raw: &str) -> MemorySnapshot {
    let fields: HashMap<&str, u64> = meminfo_raw
        .lines()
        .filter_map(|line| {
            let (key, rest) = line.split_once(':')?;
            let value = rest.trim().split_whitespace().next()?.parse().ok()?;
            Some((key, value))
        })
        .collect();
    let get = |key: &str| fields.get(key).copied().unwrap_or(0);

    // "Cached" excludes SwapCached; SReclaimable is slab memory the kernel
    // can drop under pressure, so count it with the cache like `free` does.
    MemorySnapshot {
        total_kb: get("MemTotal"),
        free_kb: get("MemFree"),
        available_kb: get("MemAvailable"),
        cached_kb: get("Cached") + get("SReclaimable"),
        buffers_kb: get("Buffers"),
        shmem_kb: get("Shmem"),
        active_kb: get("Active"),
        inactive_kb: get("Inactive"),
        dirty_kb: get("Dirty"),
        writeback_kb: get("Writeback"),
        slab_kb: get("Slab"),
        page_tables_kb: get("PageTables"),
        commit_limit_kb: get("CommitLimit"),
        committed_kb: get("Committed_AS"),
        swap_total_kb: get("SwapTotal"),
        swap_used_kb: get("SwapTotal").saturating_sub(get("SwapFree")),
        swap_devices: parse_swaps(swaps_raw),
    }
}

pub fn parse_swaps(raw: &str) -> Vec<SwapDevice> {
    raw.lines()
        .skip(1)
        .filter_map(|line| {
            let fields: Vec<&str> = line.split_whitespace().collect();
            Some(SwapDevice {
                name: (*fields.first()?).to_string(),
                kind: (*fields.get(1)?).to_string(),
                size_kb: fields.get(2)?.parse().ok()?,
                used_kb: fields.get(3)?.parse().ok()?,
            })
        })
        .collect()
}
