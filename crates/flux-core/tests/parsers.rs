use std::time::Instant;

use flux_core::{cpu, disk, memory, network};

#[test]
fn meminfo_and_swaps() {
    let meminfo = "\
MemTotal:       16113852 kB
MemFree:          242868 kB
MemAvailable:    3199096 kB
Buffers:          181724 kB
Cached:          4855788 kB
SwapCached:            0 kB
Active:          9002624 kB
Inactive:        4577224 kB
Dirty:               400 kB
Writeback:             0 kB
Shmem:            395656 kB
Slab:             628184 kB
SReclaimable:     303336 kB
PageTables:        84028 kB
CommitLimit:     8056924 kB
Committed_AS:   24000000 kB
SwapTotal:       2097148 kB
SwapFree:        1048574 kB
";
    let swaps = "\
Filename                                Type            Size            Used            Priority
/swapfile                               file            2097148         1048574         -2
";
    let m = memory::parse(meminfo, swaps);
    assert_eq!(m.total_kb, 16113852);
    assert_eq!(m.cached_kb, 4855788 + 303336);
    assert_eq!(m.swap_used_kb, 2097148 - 1048574);
    assert_eq!(m.swap_devices.len(), 1);
    assert_eq!(m.swap_devices[0].name, "/swapfile");
    assert_eq!(m.swap_devices[0].used_kb, 1048574);
}

#[test]
fn stat_usage_between() {
    let before = "\
cpu  1000 0 500 8000 500 0 0 0 0 0
cpu0 500 0 250 4000 250 0 0 0 0 0
cpu1 500 0 250 4000 250 0 0 0 0 0
intr 12345
";
    let after = "\
cpu  1400 0 700 8300 600 0 0 0 0 0
cpu0 700 0 350 4150 300 0 0 0 0 0
cpu1 700 0 350 4150 300 0 0 0 0 0
intr 12399
";
    let prev = cpu::parse_stat(before);
    let cur = cpu::parse_stat(after);
    assert_eq!(prev.len(), 3); // aggregate + 2 cores
    let usage = cpu::usage_between(&prev, &cur);
    // delta total = 1000, delta idle = 300+100 -> busy 600/1000
    assert!((usage[0] - 60.0).abs() < 0.01, "got {}", usage[0]);
    assert!((usage[1] - 60.0).abs() < 0.01);
}

#[test]
fn loadavg() {
    let l = cpu::parse_loadavg("1.25 0.75 0.50 3/1234 56789\n");
    assert_eq!(l.one, 1.25);
    assert_eq!(l.fifteen, 0.50);
    assert_eq!(l.tasks_running, 3);
    assert_eq!(l.tasks_total, 1234);
}

#[test]
fn net_dev() {
    let raw = "\
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 1000000    5000    0    0    0     0          0         0  1000000    5000    0    0    0     0       0          0
enp3s0: 25000000   20000    2    0    0     0          0       100  5000000   10000    1    0    0     0       0          0
";
    let map = network::parse_net_dev(raw);
    assert!(!map.contains_key("lo"));
    let eth = &map["enp3s0"];
    assert_eq!(eth.rx_bytes, 25000000);
    assert_eq!(eth.rx_errors, 2);
    assert_eq!(eth.tx_bytes, 5000000);
    assert_eq!(eth.tx_packets, 10000);
}

#[test]
fn diskstats_rates() {
    // 15-field (older) and 20-field (5.5+) lines both parse by index
    let before = "\
   8       0 sda 1000 0 80000 500 2000 0 160000 800 0 1000 1300
 259       0 nvme0n1 5000 0 400000 100 1000 0 80000 50 0 200 150 0 0 0 0 0 0 0 0
   7       0 loop0 10 0 80 0 0 0 0 0 0 0 0
";
    let after = "\
   8       0 sda 1100 0 88000 550 2100 0 168000 850 0 1100 1400
 259       0 nvme0n1 5500 0 440000 110 1100 0 88000 55 0 220 170 0 0 0 0 0 0 0 0
   7       0 loop0 20 0 160 0 0 0 0 0 0 0 0
";
    let t0 = Instant::now();
    let prev = disk::parse_diskstats(before, t0, |n| n == "sda" || n == "nvme0n1");
    // simulate 1s later by lying about elapsed via same Instant — rates_from
    // uses at-delta, so build current with a later Instant
    std::thread::sleep(std::time::Duration::from_millis(20));
    let cur = disk::parse_diskstats(after, Instant::now(), |n| n == "sda" || n == "nvme0n1");
    assert_eq!(prev.len(), 2, "loop device must be filtered");
    let rates = disk::rates_from(&prev, &cur, |_| (None, 0, false));
    assert_eq!(rates.len(), 2);
    let sda = rates.iter().find(|r| r.device == "sda").unwrap();
    // 8000 sectors * 512 bytes over ~0.02s — just assert direction/positivity
    assert!(sda.read_bytes_per_sec > 0.0);
    assert!(sda.write_bytes_per_sec > 0.0);
}

#[test]
fn df_output() {
    let raw = "\
Filesystem     Type 1024-blocks      Used Available Capacity Mounted on
/dev/nvme0n1p2 ext4   479151816 380000000  74700000      84% /
/dev/nvme0n1p1 vfat      523248      6220    517028       2% /boot/efi
tmpfs          tmpfs    8056924    395656   7661268       5% /dev/shm with space
";
    let mounts = disk::parse_df(raw);
    assert_eq!(mounts.len(), 3);
    assert_eq!(mounts[0].mount_point, "/");
    assert_eq!(mounts[0].fs_type, "ext4");
    assert_eq!(mounts[0].total_bytes, 479151816 * 1024);
    assert_eq!(mounts[2].mount_point, "/dev/shm with space");
}
