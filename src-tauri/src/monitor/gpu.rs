use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::str::FromStr;
use std::sync::OnceLock;

#[derive(Serialize, Clone)]
pub struct GpuSnapshot {
    pub name: String,
    pub driver: String,
    pub driver_version: Option<String>,
    pub vbios_version: Option<String>,
    pub pci_address: Option<String>,
    pub utilization_pct: Option<f32>,
    pub mem_used_mb: Option<u64>,
    pub mem_total_mb: Option<u64>,
    pub mem_reserved_mb: Option<u64>,
    pub temp_c: Option<f32>,
    pub temp_crit_c: Option<f32>,
    pub power_w: Option<f32>,
    pub power_limit_w: Option<f32>,
    pub fan_pct: Option<f32>,
    pub clock_core_mhz: Option<u64>,
    pub clock_mem_mhz: Option<u64>,
    /// e.g. "Gen3 x16 (max Gen3)"
    pub pcie_link: Option<String>,
    /// Set when the driver only exposes partial data (e.g. nouveau).
    pub note: Option<String>,
}

enum GpuBackend {
    /// Proprietary NVIDIA driver: full stats via nvidia-smi.
    NvidiaSmi,
    /// amdgpu sysfs: busy percent + VRAM + hwmon temp.
    Amd { device: PathBuf, hwmon: Option<PathBuf> },
    /// Open drivers (nouveau, i915, xe): hwmon temperature only.
    HwmonTemp { hwmon: PathBuf, driver: String },
    None,
}

fn backend() -> &'static GpuBackend {
    static BACKEND: OnceLock<GpuBackend> = OnceLock::new();
    BACKEND.get_or_init(detect)
}

fn detect() -> GpuBackend {
    // Proprietary NVIDIA first: richest data.
    if Command::new("nvidia-smi")
        .arg("--list-gpus")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        return GpuBackend::NvidiaSmi;
    }
    // AMD: gpu_busy_percent is amdgpu-only.
    if let Ok(cards) = fs::read_dir("/sys/class/drm") {
        for card in cards.flatten() {
            let device = card.path().join("device");
            if device.join("gpu_busy_percent").exists() {
                return GpuBackend::Amd {
                    hwmon: first_hwmon(&device),
                    device,
                };
            }
        }
    }
    // Open drivers: temperature via their hwmon node.
    const GPU_DRIVERS: &[&str] = &["nouveau", "i915", "xe", "radeon"];
    if let Ok(entries) = fs::read_dir("/sys/class/hwmon") {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Ok(name) = fs::read_to_string(path.join("name")) {
                let name = name.trim().to_string();
                if GPU_DRIVERS.contains(&name.as_str()) {
                    return GpuBackend::HwmonTemp { hwmon: path, driver: name };
                }
            }
        }
    }
    GpuBackend::None
}

fn first_hwmon(device: &Path) -> Option<PathBuf> {
    fs::read_dir(device.join("hwmon"))
        .ok()?
        .flatten()
        .next()
        .map(|e| e.path())
}

/// GPU model name + PCI address from lspci, resolved once.
fn lspci_gpu() -> &'static (String, Option<String>) {
    static INFO: OnceLock<(String, Option<String>)> = OnceLock::new();
    INFO.get_or_init(|| {
        let output = Command::new("lspci").output().ok();
        let text = output
            .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
            .unwrap_or_default();
        let line = text
            .lines()
            .find(|l| l.contains("VGA compatible controller") || l.contains("3D controller"));
        match line {
            Some(l) => {
                let address = l.split_whitespace().next().map(String::from);
                let name = l
                    .splitn(3, ':')
                    .nth(2)
                    .map(|s| s.trim().to_string())
                    .unwrap_or_else(|| "GPU".into());
                (name, address)
            }
            None => ("GPU".into(), None),
        }
    })
}

fn read_num(path: PathBuf) -> Option<f64> {
    fs::read_to_string(path).ok()?.trim().parse().ok()
}

fn read_trimmed(path: PathBuf) -> Option<String> {
    fs::read_to_string(path).ok().map(|s| s.trim().to_string())
}

/// Kernel module version, e.g. /sys/module/nvidia/version. In-kernel
/// drivers (nouveau, i915) have no version file; report kernel release.
fn module_version(driver: &str) -> Option<String> {
    read_trimmed(PathBuf::from(format!("/sys/module/{driver}/version"))).or_else(|| {
        read_trimmed(PathBuf::from("/proc/sys/kernel/osrelease")).map(|k| format!("in-kernel ({k})"))
    })
}

/// "Gen3 x16" style link description from a PCI device sysfs dir.
fn pcie_link_from_sysfs(device: &Path) -> Option<String> {
    let speed = read_trimmed(device.join("current_link_speed"))?;
    let width = read_trimmed(device.join("current_link_width"))?;
    let max_speed = read_trimmed(device.join("max_link_speed"));
    let mut link = format!("{speed} x{width}");
    if let Some(max) = max_speed {
        if max != speed {
            link.push_str(&format!(" (max {max})"));
        }
    }
    Some(link)
}

fn empty_snapshot(name: String, driver: String) -> GpuSnapshot {
    GpuSnapshot {
        name,
        driver,
        driver_version: None,
        vbios_version: None,
        pci_address: None,
        utilization_pct: None,
        mem_used_mb: None,
        mem_total_mb: None,
        mem_reserved_mb: None,
        temp_c: None,
        temp_crit_c: None,
        power_w: None,
        power_limit_w: None,
        fan_pct: None,
        clock_core_mhz: None,
        clock_mem_mhz: None,
        pcie_link: None,
        note: None,
    }
}

pub fn snapshot() -> Vec<GpuSnapshot> {
    match backend() {
        GpuBackend::NvidiaSmi => nvidia_snapshot(),
        GpuBackend::Amd { device, hwmon } => {
            let (name, pci_address) = lspci_gpu().clone();
            let mut gpu = empty_snapshot(name, "amdgpu".into());
            gpu.pci_address = pci_address;
            gpu.driver_version = module_version("amdgpu");
            gpu.pcie_link = pcie_link_from_sysfs(device);
            gpu.utilization_pct =
                read_num(device.join("gpu_busy_percent")).map(|v| v as f32);
            gpu.mem_used_mb =
                read_num(device.join("mem_info_vram_used")).map(|v| (v / 1_048_576.0) as u64);
            gpu.mem_total_mb =
                read_num(device.join("mem_info_vram_total")).map(|v| (v / 1_048_576.0) as u64);
            if let Some(h) = hwmon {
                gpu.temp_c = read_num(h.join("temp1_input")).map(|t| (t / 1000.0) as f32);
                gpu.temp_crit_c = read_num(h.join("temp1_crit")).map(|t| (t / 1000.0) as f32);
                gpu.power_w =
                    read_num(h.join("power1_average")).map(|p| (p / 1_000_000.0) as f32);
                gpu.power_limit_w =
                    read_num(h.join("power1_cap")).map(|p| (p / 1_000_000.0) as f32);
                gpu.fan_pct = read_num(h.join("pwm1")).map(|v| (v / 255.0 * 100.0) as f32);
            }
            vec![gpu]
        }
        GpuBackend::HwmonTemp { hwmon, driver } => {
            let (name, pci_address) = lspci_gpu().clone();
            let mut gpu = empty_snapshot(name, driver.clone());
            gpu.pci_address = pci_address;
            gpu.driver_version = module_version(driver);
            gpu.pcie_link = pcie_link_from_sysfs(&hwmon.join("device"));
            gpu.temp_c = read_num(hwmon.join("temp1_input")).map(|t| (t / 1000.0) as f32);
            gpu.temp_crit_c = read_num(hwmon.join("temp1_crit")).map(|t| (t / 1000.0) as f32);
            gpu.note = Some(format!(
                "The open '{driver}' driver only exposes temperature. Install the proprietary driver for utilization, VRAM and power stats."
            ));
            vec![gpu]
        }
        GpuBackend::None => Vec::new(),
    }
}

#[derive(Serialize, Clone)]
pub struct GpuProcess {
    /// Same format as GpuSnapshot.pci_address, for multi-GPU filtering.
    pub gpu_bus_id: String,
    pub pid: u32,
    /// Full executable path as reported by nvidia-smi.
    pub name: String,
    pub mem_mb: Option<u64>,
}

/// Compute processes per GPU. NVIDIA-only: nvidia-smi's query-compute-apps
/// covers CUDA/NVENC clients (not graphics — Xorg won't appear). Other
/// backends have no per-process story, so they return empty.
pub fn processes() -> Vec<GpuProcess> {
    if !matches!(backend(), GpuBackend::NvidiaSmi) {
        return Vec::new();
    }
    let Ok(output) = Command::new("nvidia-smi")
        .args([
            "--query-compute-apps=gpu_bus_id,pid,process_name,used_gpu_memory",
            "--format=csv,noheader,nounits",
        ])
        .output()
    else {
        return Vec::new();
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            // process_name is a path and can't contain commas on Linux /proc,
            // but split conservatively anyway: bus id, pid, then name, mem.
            let fields: Vec<&str> = line.split(',').map(str::trim).collect();
            if fields.len() < 4 {
                return None;
            }
            Some(GpuProcess {
                gpu_bus_id: fields[0].to_string(),
                pid: fields[1].parse().ok()?,
                name: fields[2..fields.len() - 1].join(", "),
                mem_mb: fields[fields.len() - 1].parse().ok(),
            })
        })
        .collect()
}

const NVIDIA_QUERY: &str = "name,driver_version,vbios_version,pci.bus_id,utilization.gpu,memory.used,memory.total,memory.reserved,temperature.gpu,power.draw,power.limit,fan.speed,clocks.sm,clocks.mem,pcie.link.gen.current,pcie.link.gen.max,pcie.link.width.current";

fn nvidia_snapshot() -> Vec<GpuSnapshot> {
    let Ok(output) = Command::new("nvidia-smi")
        .args([
            &format!("--query-gpu={NVIDIA_QUERY}"),
            "--format=csv,noheader,nounits",
        ])
        .output()
    else {
        return Vec::new();
    };

    // "[N/A]" fields simply fail to parse and stay None.
    fn field<T: FromStr>(fields: &[&str], i: usize) -> Option<T> {
        fields.get(i)?.parse().ok()
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let fields: Vec<&str> = line.split(',').map(str::trim).collect();
            if fields.len() < 17 {
                return None;
            }
            let pcie_link = match (
                field::<u32>(&fields, 14),
                field::<u32>(&fields, 15),
                field::<u32>(&fields, 16),
            ) {
                (Some(gen), Some(max), Some(width)) => Some(if gen == max {
                    format!("Gen{gen} x{width}")
                } else {
                    format!("Gen{gen} x{width} (max Gen{max})")
                }),
                _ => None,
            };
            Some(GpuSnapshot {
                name: fields[0].to_string(),
                driver: "nvidia".into(),
                driver_version: Some(fields[1].to_string()),
                vbios_version: Some(fields[2].to_string()),
                pci_address: Some(fields[3].to_string()),
                utilization_pct: field(&fields, 4),
                mem_used_mb: field(&fields, 5),
                mem_total_mb: field(&fields, 6),
                mem_reserved_mb: field(&fields, 7),
                temp_c: field(&fields, 8),
                temp_crit_c: None,
                power_w: field(&fields, 9),
                power_limit_w: field(&fields, 10),
                fan_pct: field(&fields, 11),
                clock_core_mhz: field(&fields, 12),
                clock_mem_mhz: field(&fields, 13),
                pcie_link,
                note: None,
            })
        })
        .collect()
}
