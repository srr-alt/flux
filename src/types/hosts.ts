export type CollectionMode = "agentless" | "agent";

export type HostStatus =
  | { state: "connecting" }
  | { state: "connected"; mode: CollectionMode }
  | { state: "degraded" }
  | { state: "disconnected" }
  | { state: "error"; message: string };

export interface HostView {
  id: string;
  name: string;
  address: string;
  port: number;
  username: string;
  running: boolean;
}

export interface NewHost {
  name: string;
  address: string;
  port: number;
  username: string;
}

export interface TestResult {
  fingerprint: string;
  host_key_known: boolean;
  host_key_changed: boolean;
  auth_ok: boolean;
  hostname: string;
  os_pretty_name: string;
  kernel: string;
}

export interface DeployProgress {
  host_id: string;
  step: string;
  pct: number;
  line?: string;
  done: boolean;
  error?: string;
}
