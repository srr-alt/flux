import { LOCAL_HOST_ID, useHostsStore } from "../state/hostsStore";
import { useMonitorStore } from "../state/monitorStore";

/** Display name of the host the page is scoped to (titlebar/screen headers). */
export function useSelectedHostName(): string {
  const hosts = useHostsStore((s) => s.hosts);
  const selected = useHostsStore((s) => s.selectedHostId);
  const local = useMonitorStore((s) => s.systemInfo?.hostname);
  return selected === LOCAL_HOST_ID
    ? local ?? "this machine"
    : hosts.find((h) => h.id === selected)?.name ?? "unknown host";
}
