import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  CleanCategory,
  CpuDetails,
  DiskSnapshot,
  GpuSnapshot,
  InfoSection,
  PackageInfo,
  ProcessInfo,
  ProcessQuery,
  ServiceInfo,
  StartupApp,
  SystemInfo,
  TickSnapshot,
  UsageLogStatus,
} from "../types/monitor";
import type { HostStatus, HostView, NewHost, TestResult } from "../types/hosts";

export const EVENTS = {
  TICK: "monitor://tick",
  DISKS: "monitor://disks",
  GPU: "monitor://gpu",
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
