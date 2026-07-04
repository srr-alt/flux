//! HWiNFO-style deep hardware inventory. Everything is collected from
//! sysfs/procfs and unprivileged CLI tools (lscpu, lspci, lsusb), so no
//! root is needed. Output is a generic section/entry tree so the frontend
//! can render and search it without knowing the schema.

use std::fmt::Write as _;
use std::fs;
use std::path::Path;
use std::process::Command;

use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct InfoEntry {
    pub label: String,
    pub value: String,
}

#[derive(Serialize, Clone)]
pub struct InfoSection {
    pub id: String,
    pub title: String,
    pub entries: Vec<InfoEntry>,
}

fn entry(label: impl Into<String>, value: impl Into<String>) -> InfoEntry {
    InfoEntry {
        label: label.into(),
        value: value.into(),
    }
}

/// Read a sysfs attribute, trimmed. Returns None for missing/unreadable
/// files (common: many DMI attributes need root or don't exist).
fn sysfs(path: impl AsRef<Path>) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn run(cmd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(cmd).args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn push_if(entries: &mut Vec<InfoEntry>, label: &str, value: Option<String>) {
    if let Some(v) = value {
        entries.push(entry(label, v));
    }
}

const DMI: &str = "/sys/class/dmi/id";

fn chassis_type_name(code: &str) -> &'static str {
    match code {
        "3" => "Desktop",
        "4" => "Low-profile desktop",
        "5" => "Pizza box",
        "6" => "Mini tower",
        "7" => "Tower",
        "8" => "Portable",
        "9" => "Laptop",
        "10" => "Notebook",
        "11" => "Handheld",
        "13" => "All-in-one",
        "14" => "Sub-notebook",
        "17" => "Main server chassis",
        "23" => "Rack-mount chassis",
        "30" => "Tablet",
        "31" => "Convertible",
        "32" => "Detachable",
        _ => "Unknown",
    }
}

fn section_system() -> InfoSection {
    let mut e = Vec::new();
    push_if(&mut e, "Manufacturer", sysfs(format!("{DMI}/sys_vendor")));
    push_if(&mut e, "Product", sysfs(format!("{DMI}/product_name")));
    push_if(&mut e, "Version", sysfs(format!("{DMI}/product_version")));
    push_if(&mut e, "Family", sysfs(format!("{DMI}/product_family")));
    push_if(&mut e, "SKU", sysfs(format!("{DMI}/product_sku")));
    if let Some(code) = sysfs(format!("{DMI}/chassis_type")) {
        e.push(entry(
            "Chassis",
            format!("{} (type {code})", chassis_type_name(&code)),
        ));
    }
    push_if(&mut e, "Hostname", sysfs("/proc/sys/kernel/hostname"));
    push_if(&mut e, "Kernel", sysfs("/proc/sys/kernel/osrelease"));
    if let Some(os) = fs::read_to_string("/etc/os-release").ok().and_then(|s| {
        s.lines()
            .find(|l| l.starts_with("PRETTY_NAME="))
            .map(|l| l.trim_start_matches("PRETTY_NAME=").trim_matches('"').to_string())
    }) {
        e.push(entry("Operating system", os));
    }
    e.push(entry(
        "Firmware mode",
        if Path::new("/sys/firmware/efi").exists() {
            "UEFI"
        } else {
            "Legacy BIOS"
        },
    ));
    InfoSection {
        id: "system".into(),
        title: "System".into(),
        entries: e,
    }
}

fn section_motherboard() -> InfoSection {
    let mut e = Vec::new();
    push_if(&mut e, "Board vendor", sysfs(format!("{DMI}/board_vendor")));
    push_if(&mut e, "Board name", sysfs(format!("{DMI}/board_name")));
    push_if(&mut e, "Board version", sysfs(format!("{DMI}/board_version")));
    push_if(&mut e, "BIOS vendor", sysfs(format!("{DMI}/bios_vendor")));
    push_if(&mut e, "BIOS version", sysfs(format!("{DMI}/bios_version")));
    push_if(&mut e, "BIOS date", sysfs(format!("{DMI}/bios_date")));
    push_if(&mut e, "BIOS release", sysfs(format!("{DMI}/bios_release")));
    push_if(&mut e, "EC firmware", sysfs(format!("{DMI}/ec_firmware_release")));
    InfoSection {
        id: "motherboard".into(),
        title: "Motherboard & BIOS".into(),
        entries: e,
    }
}

fn section_cpu() -> InfoSection {
    let mut e = Vec::new();
    if let Some(out) = run("lscpu", &[]) {
        // Keep lscpu's own ordering; it already groups sensibly.
        for line in out.lines() {
            if let Some((key, value)) = line.split_once(':') {
                let key = key.trim();
                let value = value.trim();
                if value.is_empty() {
                    continue;
                }
                // Flags are searchable but huge; keep them last.
                if key == "Flags" {
                    continue;
                }
                e.push(entry(key, value));
            }
        }
        if let Some(flags) = out
            .lines()
            .find(|l| l.trim_start().starts_with("Flags:"))
            .and_then(|l| l.split_once(':'))
            .map(|(_, v)| v.trim().to_string())
        {
            e.push(entry("Flags", flags));
        }
    }
    push_if(
        &mut e,
        "Scaling governor",
        sysfs("/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor"),
    );
    push_if(
        &mut e,
        "Scaling driver",
        sysfs("/sys/devices/system/cpu/cpu0/cpufreq/scaling_driver"),
    );
    InfoSection {
        id: "cpu".into(),
        title: "CPU".into(),
        entries: e,
    }
}

fn section_vulnerabilities() -> InfoSection {
    let mut e = Vec::new();
    if let Ok(entries) = fs::read_dir("/sys/devices/system/cpu/vulnerabilities") {
        let mut names: Vec<_> = entries.flatten().map(|d| d.file_name()).collect();
        names.sort();
        for name in names {
            let name_str = name.to_string_lossy().to_string();
            if let Some(v) = sysfs(format!(
                "/sys/devices/system/cpu/vulnerabilities/{name_str}"
            )) {
                e.push(entry(name_str, v));
            }
        }
    }
    InfoSection {
        id: "vulnerabilities".into(),
        title: "CPU Vulnerabilities".into(),
        entries: e,
    }
}

fn format_kb(kb: u64) -> String {
    if kb >= 1024 * 1024 {
        format!("{:.1} GiB", kb as f64 / (1024.0 * 1024.0))
    } else if kb >= 1024 {
        format!("{:.1} MiB", kb as f64 / 1024.0)
    } else {
        format!("{kb} KiB")
    }
}

fn section_memory() -> InfoSection {
    let mut e = Vec::new();
    if let Ok(meminfo) = fs::read_to_string("/proc/meminfo") {
        let get = |key: &str| {
            meminfo
                .lines()
                .find(|l| l.starts_with(key))
                .and_then(|l| l.split_whitespace().nth(1))
                .and_then(|v| v.parse::<u64>().ok())
        };
        if let Some(total) = get("MemTotal:") {
            e.push(entry("Total RAM", format_kb(total)));
        }
        if let Some(swap) = get("SwapTotal:") {
            e.push(entry("Total swap", format_kb(swap)));
        }
        if let Some(hp) = get("Hugepagesize:") {
            e.push(entry("Huge page size", format_kb(hp)));
        }
    }
    // Corrected-error counts exist only when EDAC hardware is present.
    push_if(
        &mut e,
        "ECC (EDAC) controller",
        sysfs("/sys/devices/system/edac/mc/mc0/mc_name"),
    );
    e.push(entry(
        "Note",
        "Per-DIMM details (vendor, part number, slot) require root (dmidecode).",
    ));
    InfoSection {
        id: "memory".into(),
        title: "Memory".into(),
        entries: e,
    }
}

fn section_graphics() -> InfoSection {
    let mut e = Vec::new();
    for (i, gpu) in crate::monitor::gpu::snapshot().iter().enumerate() {
        let p = |label: &str| format!("GPU {i} {label}");
        e.push(entry(p("name"), gpu.name.clone()));
        e.push(entry(p("driver"), gpu.driver.clone()));
        push_if(&mut e, &p("driver version"), gpu.driver_version.clone());
        push_if(&mut e, &p("VBIOS"), gpu.vbios_version.clone());
        push_if(&mut e, &p("PCI address"), gpu.pci_address.clone());
        push_if(
            &mut e,
            &p("VRAM"),
            gpu.mem_total_mb.map(|m| format!("{m} MiB")),
        );
        push_if(&mut e, &p("PCIe link"), gpu.pcie_link.clone());
    }
    if let Some(out) = run("lspci", &[]) {
        for line in out.lines() {
            if line.contains(" VGA compatible controller: ")
                || line.contains(" 3D controller: ")
                || line.contains(" Display controller: ")
            {
                if let Some((addr, desc)) = line.split_once(' ') {
                    e.push(entry(format!("lspci {addr}"), desc.to_string()));
                }
            }
        }
    }
    InfoSection {
        id: "graphics".into(),
        title: "Graphics".into(),
        entries: e,
    }
}

fn section_storage() -> InfoSection {
    let mut e = Vec::new();
    let Ok(entries) = fs::read_dir("/sys/block") else {
        return InfoSection {
            id: "storage".into(),
            title: "Storage".into(),
            entries: e,
        };
    };
    let mut names: Vec<_> = entries
        .flatten()
        .map(|d| d.file_name().to_string_lossy().to_string())
        .filter(|n| !n.starts_with("loop") && !n.starts_with("ram") && !n.starts_with("zram"))
        .collect();
    names.sort();
    for name in names {
        let base = format!("/sys/block/{name}");
        let p = |label: &str| format!("{name} {label}");
        let model = sysfs(format!("{base}/device/model"));
        let vendor = sysfs(format!("{base}/device/vendor"));
        let full_model = match (vendor, model) {
            (Some(v), Some(m)) => Some(format!("{v} {m}")),
            (None, Some(m)) => Some(m),
            (Some(v), None) => Some(v),
            (None, None) => None,
        };
        push_if(&mut e, &p("model"), full_model);
        if let Some(sectors) = sysfs(format!("{base}/size")).and_then(|s| s.parse::<u64>().ok()) {
            let bytes = sectors * 512;
            e.push(entry(
                p("capacity"),
                format!("{:.1} GB", bytes as f64 / 1e9),
            ));
        }
        push_if(
            &mut e,
            &p("type"),
            sysfs(format!("{base}/queue/rotational"))
                .map(|r| if r == "0" { "SSD / non-rotational" } else { "HDD (rotational)" }.to_string()),
        );
        push_if(&mut e, &p("firmware"), sysfs(format!("{base}/device/firmware_rev")).or_else(|| sysfs(format!("{base}/device/rev"))));
        push_if(&mut e, &p("serial"), sysfs(format!("{base}/device/serial")));
        push_if(&mut e, &p("I/O scheduler"), sysfs(format!("{base}/queue/scheduler")));
        if let (Some(logical), Some(physical)) = (
            sysfs(format!("{base}/queue/logical_block_size")),
            sysfs(format!("{base}/queue/physical_block_size")),
        ) {
            e.push(entry(
                p("block size"),
                format!("{logical} B logical / {physical} B physical"),
            ));
        }
    }
    InfoSection {
        id: "storage".into(),
        title: "Storage".into(),
        entries: e,
    }
}

fn section_network() -> InfoSection {
    let mut e = Vec::new();
    let Ok(entries) = fs::read_dir("/sys/class/net") else {
        return InfoSection {
            id: "network".into(),
            title: "Network Adapters".into(),
            entries: e,
        };
    };
    let mut names: Vec<_> = entries
        .flatten()
        .map(|d| d.file_name().to_string_lossy().to_string())
        .filter(|n| n != "lo")
        .collect();
    names.sort();
    for name in names {
        let base = format!("/sys/class/net/{name}");
        let p = |label: &str| format!("{name} {label}");
        // DRIVER= line in the device uevent names the kernel module.
        if let Some(driver) = fs::read_to_string(format!("{base}/device/uevent"))
            .ok()
            .and_then(|s| {
                s.lines()
                    .find(|l| l.starts_with("DRIVER="))
                    .map(|l| l.trim_start_matches("DRIVER=").to_string())
            })
        {
            e.push(entry(p("driver"), driver));
        }
        push_if(&mut e, &p("MAC"), sysfs(format!("{base}/address")));
        push_if(&mut e, &p("state"), sysfs(format!("{base}/operstate")));
        push_if(
            &mut e,
            &p("speed"),
            sysfs(format!("{base}/speed"))
                .filter(|s| s != "-1")
                .map(|s| format!("{s} Mb/s")),
        );
        push_if(&mut e, &p("MTU"), sysfs(format!("{base}/mtu")));
        if Path::new(&format!("{base}/wireless")).exists() {
            e.push(entry(p("kind"), "Wireless"));
        }
    }
    InfoSection {
        id: "network".into(),
        title: "Network Adapters".into(),
        entries: e,
    }
}

fn section_from_tool(id: &str, title: &str, cmd: &str) -> InfoSection {
    let mut e = Vec::new();
    if let Some(out) = run(cmd, &[]) {
        for line in out.lines().filter(|l| !l.trim().is_empty()) {
            match cmd {
                // "0000:01:00.0 VGA compatible controller: NVIDIA ..." — split
                // on first space so the address becomes the label.
                "lspci" => {
                    if let Some((addr, desc)) = line.split_once(' ') {
                        e.push(entry(addr, desc.to_string()));
                    }
                }
                // "Bus 001 Device 002: ID 8087:0026 Intel Corp. ..." — split
                // on the colon.
                "lsusb" => {
                    if let Some((bus, desc)) = line.split_once(": ") {
                        e.push(entry(bus, desc.to_string()));
                    }
                }
                _ => e.push(entry("", line.to_string())),
            }
        }
    } else {
        e.push(entry("Unavailable", format!("`{cmd}` not found or failed")));
    }
    InfoSection {
        id: id.into(),
        title: title.into(),
        entries: e,
    }
}

fn section_power() -> InfoSection {
    let mut e = Vec::new();
    let Ok(entries) = fs::read_dir("/sys/class/power_supply") else {
        return InfoSection {
            id: "power".into(),
            title: "Power & Battery".into(),
            entries: e,
        };
    };
    let mut names: Vec<_> = entries
        .flatten()
        .map(|d| d.file_name().to_string_lossy().to_string())
        .collect();
    names.sort();
    for name in names {
        let base = format!("/sys/class/power_supply/{name}");
        let p = |label: &str| format!("{name} {label}");
        push_if(&mut e, &p("type"), sysfs(format!("{base}/type")));
        push_if(&mut e, &p("manufacturer"), sysfs(format!("{base}/manufacturer")));
        push_if(&mut e, &p("model"), sysfs(format!("{base}/model_name")));
        push_if(&mut e, &p("technology"), sysfs(format!("{base}/technology")));
        push_if(&mut e, &p("status"), sysfs(format!("{base}/status")));
        push_if(
            &mut e,
            &p("charge"),
            sysfs(format!("{base}/capacity")).map(|c| format!("{c}%")),
        );
        push_if(&mut e, &p("cycle count"), sysfs(format!("{base}/cycle_count")).filter(|c| c != "0"));
        // Battery wear: current full-charge capacity vs design capacity.
        let full = sysfs(format!("{base}/energy_full"))
            .or_else(|| sysfs(format!("{base}/charge_full")))
            .and_then(|v| v.parse::<u64>().ok());
        let design = sysfs(format!("{base}/energy_full_design"))
            .or_else(|| sysfs(format!("{base}/charge_full_design")))
            .and_then(|v| v.parse::<u64>().ok());
        if let (Some(full), Some(design)) = (full, design) {
            if design > 0 {
                e.push(entry(
                    p("health"),
                    format!("{:.0}% of design capacity", full as f64 / design as f64 * 100.0),
                ));
            }
        }
        push_if(
            &mut e,
            &p("voltage"),
            sysfs(format!("{base}/voltage_now"))
                .and_then(|v| v.parse::<u64>().ok())
                .map(|uv| format!("{:.2} V", uv as f64 / 1e6)),
        );
    }
    InfoSection {
        id: "power".into(),
        title: "Power & Battery".into(),
        entries: e,
    }
}

fn section_sensors() -> InfoSection {
    let mut e = Vec::new();
    let Ok(chips) = fs::read_dir("/sys/class/hwmon") else {
        return InfoSection {
            id: "sensors".into(),
            title: "Sensors".into(),
            entries: e,
        };
    };
    let mut chip_dirs: Vec<_> = chips.flatten().map(|d| d.path()).collect();
    chip_dirs.sort();
    for dir in chip_dirs {
        let Some(chip) = sysfs(dir.join("name")) else {
            continue;
        };
        let Ok(files) = fs::read_dir(&dir) else {
            continue;
        };
        let mut inputs: Vec<_> = files
            .flatten()
            .map(|f| f.file_name().to_string_lossy().to_string())
            .filter(|f| f.ends_with("_input"))
            .collect();
        inputs.sort();
        for input in inputs {
            let stem = input.trim_end_matches("_input");
            let Some(raw) = sysfs(dir.join(&input)).and_then(|v| v.parse::<i64>().ok()) else {
                continue;
            };
            let label = sysfs(dir.join(format!("{stem}_label"))).unwrap_or_else(|| stem.to_string());
            let mut value = String::new();
            if stem.starts_with("temp") {
                let _ = write!(value, "{:.1} °C", raw as f64 / 1000.0);
            } else if stem.starts_with("fan") {
                let _ = write!(value, "{raw} RPM");
            } else if stem.starts_with("in") {
                let _ = write!(value, "{:.3} V", raw as f64 / 1000.0);
            } else if stem.starts_with("power") {
                let _ = write!(value, "{:.1} W", raw as f64 / 1e6);
            } else if stem.starts_with("curr") {
                let _ = write!(value, "{:.3} A", raw as f64 / 1000.0);
            } else {
                let _ = write!(value, "{raw}");
            }
            e.push(entry(format!("{chip}: {label}"), value));
        }
    }
    InfoSection {
        id: "sensors".into(),
        title: "Sensors".into(),
        entries: e,
    }
}

pub fn collect() -> Vec<InfoSection> {
    let sections = vec![
        section_system(),
        section_motherboard(),
        section_cpu(),
        section_vulnerabilities(),
        section_memory(),
        section_graphics(),
        section_storage(),
        section_network(),
        section_power(),
        section_sensors(),
        section_from_tool("pci", "PCI Devices", "lspci"),
        section_from_tool("usb", "USB Devices", "lsusb"),
    ];
    sections.into_iter().filter(|s| !s.entries.is_empty()).collect()
}
