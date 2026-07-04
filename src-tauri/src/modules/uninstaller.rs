use serde::Serialize;

use super::{run, run_privileged};

#[derive(Serialize, Clone)]
pub struct PackageInfo {
    pub name: String,
    pub version: String,
    pub installed_size_kb: u64,
    pub summary: String,
}

pub fn list() -> Result<Vec<PackageInfo>, String> {
    let output = run(
        "dpkg-query",
        &[
            "-W",
            "-f",
            "${Package}\\t${Version}\\t${Installed-Size}\\t${binary:Summary}\\n",
        ],
    )?;
    let mut packages: Vec<PackageInfo> = output
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(4, '\t');
            Some(PackageInfo {
                name: parts.next()?.to_string(),
                version: parts.next()?.to_string(),
                installed_size_kb: parts.next()?.parse().unwrap_or(0),
                summary: parts.next().unwrap_or("").to_string(),
            })
        })
        .collect();
    packages.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(packages)
}

pub fn uninstall(package: &str) -> Result<String, String> {
    if !package
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '+' | ':'))
    {
        return Err("Invalid package name.".into());
    }
    run_privileged("apt-get", &["remove", "-y", package])
}
