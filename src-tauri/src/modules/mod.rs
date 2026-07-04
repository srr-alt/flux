pub mod cleaner;
pub mod hardware;
pub mod services;
pub mod startup;
pub mod uninstaller;

use std::process::Command;

/// Run a command, mapping non-zero exit to Err(stderr).
pub fn run(program: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run {program}: {e}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(if stderr.trim().is_empty() {
            format!("{program} exited with {}", output.status)
        } else {
            stderr.trim().to_string()
        })
    }
}

/// Run a privileged command through pkexec (pops the system auth dialog).
pub fn run_privileged(program: &str, args: &[&str]) -> Result<String, String> {
    let mut all_args = vec![program];
    all_args.extend_from_slice(args);
    run("pkexec", &all_args).map_err(|e| {
        if e.contains("dismissed") || e.contains("Not authorized") {
            "Authorization was cancelled.".to_string()
        } else {
            e
        }
    })
}
