import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  CleanCategory,
  ComposeProject,
  ContainerDetail,
  ContainerInfo,
  ContainerStats,
  CpuDetails,
  DiskSnapshot,
  DiskUsageRow,
  GpuHistoryPoint,
  GpuProcess,
  GpuSnapshot,
  HistoryPoint,
  HwmonChip,
  ImageInfo,
  InfoSection,
  NetworkInfo,
  PackageInfo,
  ProcessDetail,
  ProcessInfo,
  ProcessQuery,
  RunSpec,
  ServiceInfo,
  StartupApp,
  SystemInfo,
  TickSnapshot,
  UsageLogStatus,
  VolumeInfo,
} from "../types/monitor";
import type { HostStatus, HostView, NewHost, TestResult } from "../types/hosts";

export const EVENTS = {
  TICK: "monitor://tick",
  DISKS: "monitor://disks",
  GPU: "monitor://gpu",
  SENSORS: "monitor://sensors",
} as const;

// --- Monitor ---

export function getSystemInfo(): Promise<SystemInfo> {
  return invoke("get_system_info");
}

export function getInitialSnapshot(): Promise<TickSnapshot | null> {
  return invoke("get_initial_snapshot");
}

export function getCpuDetails(): Promise<CpuDetails> {
  return invoke("get_cpu_details");
}

export function getGpuProcesses(): Promise<GpuProcess[]> {
  return invoke("get_gpu_processes");
}

/** Persisted history for a host; hostId "local" is this machine. */
export function historyQuery(
  hostId: string,
  rangeSecs: number,
): Promise<HistoryPoint[]> {
  return invoke("history_query", { hostId, rangeSecs });
}

/** Persisted per-GPU history for a host (local only for now). */
export function gpuHistoryQuery(
  hostId: string,
  rangeSecs: number,
): Promise<GpuHistoryPoint[]> {
  return invoke("gpu_history_query", { hostId, rangeSecs });
}

export function onTick(
  callback: (snapshot: TickSnapshot) => void,
): Promise<UnlistenFn> {
  return listen<TickSnapshot>(EVENTS.TICK, (event) => callback(event.payload));
}

export function onDisks(
  callback: (snapshot: DiskSnapshot) => void,
): Promise<UnlistenFn> {
  return listen<DiskSnapshot>(EVENTS.DISKS, (event) => callback(event.payload));
}

export function onGpu(
  callback: (gpus: GpuSnapshot[]) => void,
): Promise<UnlistenFn> {
  return listen<GpuSnapshot[]>(EVENTS.GPU, (event) => callback(event.payload));
}

export function onSensors(
  callback: (chips: HwmonChip[]) => void,
): Promise<UnlistenFn> {
  return listen<HwmonChip[]>(EVENTS.SENSORS, (event) => callback(event.payload));
}

// --- Processes ---

export function listProcesses(query: ProcessQuery): Promise<ProcessInfo[]> {
  return invoke("list_processes", { query });
}

export function killProcess(pid: number, force: boolean): Promise<void> {
  return invoke("kill_process", { pid, force });
}

export function reniceProcess(pid: number, niceness: number): Promise<void> {
  return invoke("renice_process", { pid, niceness });
}

export function getProcessDetail(pid: number): Promise<ProcessDetail> {
  return invoke("get_process_detail", { pid });
}

// --- Docker ---

export function listContainers(): Promise<ContainerInfo[]> {
  return invoke("list_containers");
}

export function containerStats(): Promise<ContainerStats[]> {
  return invoke("container_stats");
}

export function containerAction(id: string, verb: string): Promise<void> {
  return invoke("container_action", { id, verb });
}

export function containerLogs(id: string, tail: number): Promise<string> {
  return invoke("container_logs", { id, tail });
}

export function inspectContainer(id: string): Promise<ContainerDetail> {
  return invoke("inspect_container", { id });
}

export function runContainer(spec: RunSpec): Promise<void> {
  return invoke("run_container", { spec });
}

export function listImages(): Promise<ImageInfo[]> {
  return invoke("list_images");
}

export function imageRemove(id: string): Promise<void> {
  return invoke("image_remove", { id });
}

export function imagePull(reference: string): Promise<void> {
  return invoke("image_pull", { reference });
}

export function listVolumes(): Promise<VolumeInfo[]> {
  return invoke("list_volumes");
}

export function volumeRemove(name: string): Promise<void> {
  return invoke("volume_remove", { name });
}

export function listNetworks(): Promise<NetworkInfo[]> {
  return invoke("list_networks");
}

export function networkRemove(id: string): Promise<void> {
  return invoke("network_remove", { id });
}

export function listComposeProjects(): Promise<ComposeProject[]> {
  return invoke("list_compose_projects");
}

export function composeAction(
  name: string,
  configFiles: string[],
  verb: string,
  build = false,
): Promise<void> {
  return invoke("compose_action", { name, configFiles, verb, build });
}

/** Interleaved logs of every container in the project. */
export function composeLogs(name: string, tail: number): Promise<string> {
  return invoke("compose_logs", { name, tail });
}

/** compose up -d from a picked file; project name derives from its directory.
 * On success the file is remembered (see composeFilesList). */
export function composeUpFile(file: string, build = false): Promise<void> {
  return invoke("compose_up_file", { file, build });
}

/** Compose files the user has added, remembered across down/restart. */
export function composeFilesList(): Promise<string[]> {
  return invoke("compose_files_list");
}

export function composeFileForget(file: string): Promise<void> {
  return invoke("compose_file_forget", { file });
}

export function dockerDiskUsage(): Promise<DiskUsageRow[]> {
  return invoke("docker_disk_usage");
}

export function dockerPrune(target: string): Promise<string> {
  return invoke("docker_prune", { target });
}

// Interactive container shell: PTY output streams on SHELL_EVENT with
// payload { session, data: number[], exited }.
export const SHELL_EVENT = "docker://shell";

export interface ShellOutput {
  session: number;
  data: number[];
  exited: boolean;
}

export function dockerShellOpen(
  id: string,
  name: string,
  cols: number,
  rows: number,
): Promise<number> {
  return invoke("docker_shell_open", { id, name, cols, rows });
}

/** Commands previously typed in this container's shell, oldest first. */
export function dockerShellHistory(container: string): Promise<string[]> {
  return invoke("docker_shell_history", { container });
}

export function dockerShellWrite(session: number, data: number[]): Promise<void> {
  return invoke("docker_shell_write", { session, data });
}

export function dockerShellResize(session: number, cols: number, rows: number): Promise<void> {
  return invoke("docker_shell_resize", { session, cols, rows });
}

export function dockerShellClose(session: number): Promise<void> {
  return invoke("docker_shell_close", { session });
}

// --- Services ---

export function listServices(): Promise<ServiceInfo[]> {
  return invoke("list_services");
}

export function serviceAction(
  service: string,
  verb: "start" | "stop" | "restart" | "enable" | "disable",
): Promise<void> {
  return invoke("service_action", { service, verb });
}

// --- Startup apps ---

export function listStartupApps(): Promise<StartupApp[]> {
  return invoke("list_startup_apps");
}

export function setStartupEnabled(
  fileName: string,
  enabled: boolean,
): Promise<void> {
  return invoke("set_startup_enabled", { fileName, enabled });
}

export function addStartupApp(name: string, exec: string): Promise<void> {
  return invoke("add_startup_app", { name, exec });
}

export function removeStartupApp(fileName: string): Promise<void> {
  return invoke("remove_startup_app", { fileName });
}

// --- Cleaner ---

export function scanCleanable(): Promise<CleanCategory[]> {
  return invoke("scan_cleanable");
}

export function cleanCategory(id: string): Promise<void> {
  return invoke("clean_category", { id });
}

// --- Uninstaller ---

export function listPackages(): Promise<PackageInfo[]> {
  return invoke("list_packages");
}

export function uninstallPackage(pkg: string): Promise<string> {
  return invoke("uninstall_package", { package: pkg });
}

// --- Settings / logging ---

/** Returns the applied (clamped) interval in ms. */
export function setRefreshInterval(ms: number): Promise<number> {
  return invoke("set_refresh_interval", { ms });
}

export function startUsageLog(): Promise<UsageLogStatus> {
  return invoke("start_usage_log");
}

export function stopUsageLog(): Promise<UsageLogStatus> {
  return invoke("stop_usage_log");
}

export function getUsageLogStatus(): Promise<UsageLogStatus> {
  return invoke("get_usage_log_status");
}

// --- Hardware info ---

export function getHardwareInfo(): Promise<InfoSection[]> {
  return invoke("get_hardware_info");
}

// --- Remote hosts ---

export const HOST_EVENTS = {
  STATUS: "hosts://status",
  REMOTE_TICK: "monitor://remote-tick",
  REMOTE_DISKS: "monitor://remote-disks",
  DEPLOY_PROGRESS: "deploy://progress",
} as const;

export interface HostStatusEvent {
  host_id: string;
  status: HostStatus;
  system_info?: SystemInfo;
}

export interface RemoteEvent<T> {
  host_id: string;
  snapshot: T;
}

export function listHosts(): Promise<HostView[]> {
  return invoke("list_hosts");
}

export function getHostStatuses(): Promise<Record<string, HostStatusEvent>> {
  return invoke("get_host_statuses");
}

export function testHostConnection(
  address: string,
  port: number,
  username: string,
  password?: string,
): Promise<TestResult> {
  return invoke("test_host_connection", { address, port, username, password });
}

export function addHost(newHost: NewHost, password: string): Promise<HostView> {
  return invoke("add_host", { new: newHost, password });
}

export function connectHost(hostId: string): Promise<void> {
  return invoke("connect_host", { hostId });
}

export function disconnectHost(hostId: string): Promise<void> {
  return invoke("disconnect_host", { hostId });
}

export function removeHost(hostId: string): Promise<void> {
  return invoke("remove_host", { hostId });
}

export function listRemoteProcesses(
  hostId: string,
  query: ProcessQuery,
): Promise<ProcessInfo[]> {
  return invoke("list_remote_processes", { hostId, query });
}

export function killRemoteProcess(
  hostId: string,
  pid: number,
  force: boolean,
): Promise<void> {
  return invoke("kill_remote_process", { hostId, pid, force });
}

/** Uploads the bundled flux-agent and switches collection to agent mode. */
export function deployAgent(hostId: string): Promise<string> {
  return invoke("deploy_agent", { hostId });
}

export function installFluxDeb(
  hostId: string,
  sudoPassword: string,
): Promise<void> {
  return invoke("install_flux_deb", { hostId, sudoPassword });
}

/** Drop a stored host key (machine legitimately reinstalled/recreated). */
export function forgetHostKey(address: string, port: number): Promise<void> {
  return invoke("forget_host_key", { address, port });
}

export function onDeployProgress(
  callback: (progress: import("../types/hosts").DeployProgress) => void,
): Promise<UnlistenFn> {
  return listen<import("../types/hosts").DeployProgress>(
    HOST_EVENTS.DEPLOY_PROGRESS,
    (e) => callback(e.payload),
  );
}

export function onHostStatus(
  callback: (event: HostStatusEvent) => void,
): Promise<UnlistenFn> {
  return listen<HostStatusEvent>(HOST_EVENTS.STATUS, (e) => callback(e.payload));
}

export function onRemoteTick(
  callback: (event: RemoteEvent<TickSnapshot>) => void,
): Promise<UnlistenFn> {
  return listen<RemoteEvent<TickSnapshot>>(HOST_EVENTS.REMOTE_TICK, (e) =>
    callback(e.payload),
  );
}

export function onRemoteDisks(
  callback: (event: RemoteEvent<DiskSnapshot>) => void,
): Promise<UnlistenFn> {
  return listen<RemoteEvent<DiskSnapshot>>(HOST_EVENTS.REMOTE_DISKS, (e) =>
    callback(e.payload),
  );
}
