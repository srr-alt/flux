import { useShallow } from "zustand/react/shallow";
import { useFleetStore, emptySeries, type HostSeries } from "../state/fleetStore";
import { useMonitorStore } from "../state/monitorStore";
import { LOCAL_HOST_ID, useHostsStore } from "../state/hostsStore";

const EMPTY = emptySeries();

/**
 * Facade over the local monitorStore and the per-host fleetStore so pages
 * render any host through one shape. Local data keeps flowing through the
 * existing store untouched.
 */
/** Metrics of the host currently selected in the host switcher. */
export function useSelectedHostMetrics(): HostSeries & {
  hostId: string;
  isLocal: boolean;
} {
  const hostId = useHostsStore((s) => s.selectedHostId);
  const metrics = useHostMetrics(hostId);
  return { ...metrics, hostId, isLocal: hostId === LOCAL_HOST_ID };
}

/** Connection status of the selected host; null for the local machine
 * (always "connected"). Undefined status (not yet reported) counts as
 * connecting. */
export function useSelectedHostStatus() {
  const hostId = useHostsStore((s) => s.selectedHostId);
  const status = useHostsStore((s) => s.statuses[hostId]);
  const name = useHostsStore(
    (s) => s.hosts.find((h) => h.id === hostId)?.name ?? hostId,
  );
  if (hostId === LOCAL_HOST_ID) return null;
  return { status: status ?? { state: "connecting" as const }, name };
}

/** SystemInfo for the selected host (local store or hosts store). */
export function useSelectedSystemInfo() {
  const hostId = useHostsStore((s) => s.selectedHostId);
  const local = useMonitorStore((s) => s.systemInfo);
  const remote = useHostsStore((s) => s.systemInfos[hostId]);
  return hostId === LOCAL_HOST_ID ? local : (remote ?? null);
}

export function useHostMetrics(hostId: string): HostSeries {
  const local = useMonitorStore(
    useShallow((s) => ({
      latest: s.latest,
      disks: s.disks,
      timestamps: s.timestamps,
      cpuHistory: s.cpuHistory,
      memUsedPctHistory: s.memUsedPctHistory,
      netRx: s.netRx,
      netTx: s.netTx,
      diskTimestamps: s.diskTimestamps,
      diskRead: s.diskRead,
      diskWrite: s.diskWrite,
    })),
  );
  const remote = useFleetStore((s) => s.byHost[hostId]);
  if (hostId === LOCAL_HOST_ID) {
    return local;
  }
  return remote ?? EMPTY;
}
