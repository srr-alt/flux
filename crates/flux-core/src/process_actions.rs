use nix::sys::signal::{kill, Signal};
use nix::unistd::Pid;

pub fn kill_process(pid: u32, force: bool) -> Result<(), String> {
    if pid <= 1 {
        return Err("Refusing to kill PID 1 (init/systemd).".into());
    }
    if pid == std::process::id() {
        return Err("Refusing to kill Flux itself.".into());
    }
    let signal = if force { Signal::SIGKILL } else { Signal::SIGTERM };
    kill(Pid::from_raw(pid as i32), signal).map_err(|err| match err {
        nix::errno::Errno::EPERM => {
            "Permission denied — this process is owned by another user (likely root).".to_string()
        }
        nix::errno::Errno::ESRCH => "Process no longer exists.".to_string(),
        other => format!("Failed to send signal: {other}"),
    })
}

pub fn renice_process(pid: u32, niceness: i32) -> Result<(), String> {
    if !(-20..=19).contains(&niceness) {
        return Err("Niceness must be between -20 and 19.".into());
    }
    let result = unsafe { libc::setpriority(libc::PRIO_PROCESS, pid, niceness) };
    if result == -1 {
        let errno = std::io::Error::last_os_error();
        return Err(match errno.raw_os_error() {
            Some(libc::EACCES) | Some(libc::EPERM) => {
                "Permission denied — lowering niceness (raising priority) requires root."
                    .to_string()
            }
            Some(libc::ESRCH) => "Process no longer exists.".to_string(),
            _ => format!("Failed to renice: {errno}"),
        });
    }
    Ok(())
}
