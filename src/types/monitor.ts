export interface CpuSnapshot {
  global_usage_pct: number;
  per_core_usage_pct: number[];
  per_core_freq_mhz: number[];
  per_core_temp_c: number[] | null;
  load_avg_1: number;
  load_avg_5: number;
  load_avg_15: number;
  frequency_mhz: number | null;
  tasks_running: number;
  tasks_total: number;
}

export interface CpuDetails {
  architecture: string | null;
  vendor: string | null;
  virtualization: string | null;
  max_mhz: string | null;
  min_mhz: string | null;
  l1d_cache: string | null;
  l1i_cache: string | null;
  l2_cache: string | null;
  l3_cache: string | null;
  sockets: string | null;
  stepping: string | null;
}

export interface SwapDevice {
  name: string;
  kind: string;
  size_kb: number;
  used_kb: number;
}

export interface MemorySnapshot {
  total_kb: number;
  free_kb: number;
  available_kb: number;
  cached_kb: number;
  buffers_kb: number;
  shmem_kb: number;
  active_kb: number;
  inactive_kb: number;
  dirty_kb: number;
  writeback_kb: number;
  slab_kb: number;
  page_tables_kb: number;
  commit_limit_kb: number;
  committed_kb: number;
  swap_total_kb: number;
  swap_used_kb: number;
  swap_devices: SwapDevice[];
}

export interface NetworkInterfaceSnapshot {
  name: string;
  rx_bytes_per_sec: number;
  tx_bytes_per_sec: number;
  total_rx_bytes: number;
  total_tx_bytes: number;
  rx_packets_per_sec: number;
  tx_packets_per_sec: number;
  total_rx_errors: number;
  total_tx_errors: number;
  mac: string;
  ips: string[];
  mtu: number;
  speed_mbps: number | null;
  operstate: string;
  is_wireless: boolean;
}

export interface TickSnapshot {
  timestamp_ms: number;
  cpu: CpuSnapshot;
  memory: MemorySnapshot;
  network: NetworkInterfaceSnapshot[];
}

export interface DiskMountSnapshot {
  mount_point: string;
  device: string;
  fs_type: string;
  total_bytes: number;
  available_bytes: number;
  is_removable: boolean;
}

export interface DiskIoSnapshot {
  device: string;
  read_bytes_per_sec: number;
  write_bytes_per_sec: number;
  read_iops: number;
  write_iops: number;
  util_pct: number;
  model: string | null;
  size_bytes: number;
  rotational: boolean;
}

export interface DiskSnapshot {
  mounts: DiskMountSnapshot[];
  io: DiskIoSnapshot[];
}

export interface GpuSnapshot {
  name: string;
  driver: string;
  driver_version: string | null;
  vbios_version: string | null;
  pci_address: string | null;
  utilization_pct: number | null;
  mem_used_mb: number | null;
  mem_total_mb: number | null;
  mem_reserved_mb: number | null;
  temp_c: number | null;
  temp_crit_c: number | null;
  power_w: number | null;
  power_limit_w: number | null;
  fan_pct: number | null;
  clock_core_mhz: number | null;
  clock_mem_mhz: number | null;
  pcie_link: string | null;
  note: string | null;
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
  created_at: string;
}

export interface ContainerStats {
  id: string;
  cpu_pct: number;
  mem_pct: number;
  mem_usage: string;
  net_io: string;
  block_io: string;
  pids: number;
}

export interface ImageInfo {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created_since: string;
  containers: string;
}

export interface VolumeInfo {
  name: string;
  driver: string;
  mountpoint: string;
}

export interface NetworkInfo {
  id: string;
  name: string;
  driver: string;
  scope: string;
  builtin: boolean;
}

export interface ComposeProject {
  name: string;
  status: string;
  config_files: string[];
}

export interface DiskUsageRow {
  kind: string;
  total: string;
  active: string;
  size: string;
  reclaimable: string;
}

export interface MountInfo {
  kind: string;
  source: string;
  destination: string;
  rw: boolean;
}

export interface PortBinding {
  container_port: string;
  host: string;
}

export interface ContainerDetail {
  id: string;
  name: string;
  image: string;
  created: string;
  restart_policy: string;
  cmd: string[];
  entrypoint: string[];
  env: string[];
  mounts: MountInfo[];
  ports: PortBinding[];
  networks: [string, string][];
}

export interface RunSpec {
  image: string;
  name: string | null;
  ports: string[];
  env: string[];
  volumes: string[];
}

export interface SocketInfo {
  proto: string;
  local: string;
  remote: string;
  state: string;
}

export interface ProcessDetail {
  pid: number;
  cmdline: string[];
  exe: string | null;
  cwd: string | null;
  cgroup: string | null;
  threads: number | null;
  vm_rss_kb: number | null;
  vm_swap_kb: number | null;
  open_fds: number | null;
  fd_sample: string[];
  sockets: SocketInfo[];
}

export interface GpuProcess {
  gpu_bus_id: string;
  pid: number;
  name: string;
  mem_mb: number | null;
}

export interface TempReading {
  label: string;
  c: number;
  max_c: number | null;
  crit_c: number | null;
}

export interface FanReading {
  label: string;
  rpm: number;
}

export interface VoltageReading {
  label: string;
  volts: number;
}

export interface HwmonChip {
  id: string;
  name: string;
  temps: TempReading[];
  fans: FanReading[];
  voltages: VoltageReading[];
}

export interface ProcessInfo {
  pid: number;
  ppid: number;
  name: string;
  cmd: string;
  user: string;
  cpu_pct: number;
  mem_bytes: number;
  status: string;
  run_time_secs: number;
  nice: number;
  disk_read_bytes_per_sec: number;
  disk_write_bytes_per_sec: number;
}

export interface ProcessQuery {
  sort_by: "cpu" | "mem" | "pid" | "name" | "user" | "disk";
  sort_desc: boolean;
  search: string | null;
  limit: number | null;
}

export interface ServiceInfo {
  name: string;
  description: string;
  active_state: string;
  sub_state: string;
  unit_file_state: string;
}

export interface StartupApp {
  file_name: string;
  name: string;
  exec: string;
  comment: string;
  enabled: boolean;
  is_system: boolean;
}

export interface CleanCategory {
  id: string;
  label: string;
  description: string;
  size_bytes: number;
  item_count: number;
  needs_root: boolean;
}

export interface PackageInfo {
  name: string;
  version: string;
  installed_size_kb: number;
  summary: string;
}

export interface UsageLogStatus {
  active: boolean;
  path: string | null;
  rows: number;
  started_ms: number | null;
}

export interface InfoEntry {
  label: string;
  value: string;
}

export interface InfoSection {
  id: string;
  title: string;
  entries: InfoEntry[];
}

export interface SystemInfo {
  hostname: string;
  kernel_version: string;
  os_pretty_name: string;
  cpu_model: string;
  physical_cores: number;
  logical_cores: number;
  total_memory_kb: number;
  uptime_secs: number;
}

/** One persisted history sample (backend history.rs HistoryPoint). */
export interface HistoryPoint {
  ts: number;
  cpu_pct: number;
  cpu_max_pct: number;
  mem_used_kb: number;
  mem_total_kb: number;
  net_rx_bps: number;
  net_tx_bps: number;
  temp_c: number | null;
}

/** One persisted GPU history sample (backend history.rs GpuHistoryPoint). */
export interface GpuHistoryPoint {
  gpu_index: number;
  ts: number;
  util_pct: number | null;
  util_max_pct: number | null;
  temp_c: number | null;
  mem_used_mb: number | null;
  mem_total_mb: number | null;
}
