//! Placeholder for Phase B — full collect loop + stdin protocol land there.
//! Exists now so the workspace builds end to end.

fn main() {
    if std::env::args().any(|a| a == "--version") {
        println!("flux-agent {}", env!("CARGO_PKG_VERSION"));
        return;
    }
    eprintln!("flux-agent: protocol loop not implemented yet");
    std::process::exit(1);
}
