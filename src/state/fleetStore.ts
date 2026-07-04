import { create } from "zustand";
import type { DiskSnapshot, TickSnapshot } from "../types/monitor";
import { push, type SeriesMap } from "./history";

/** Mirrors the local monitorStore's ring-buffer shape, per remote host. */
export interface HostSeries {
  latest: TickSnapshot | null;
  disks: DiskSnapshot | null;
  timestamps: number[];
  cpuHistory: number[];
  memUsedPctHistory: number[];
  netRx: SeriesMap;
  netTx: SeriesMap;
  diskTimestamps: number[];
  diskRead: SeriesMap;
  diskWrite: SeriesMap;
}

export function emptySeries(): HostSeries {
  return {
    latest: null,
    disks: null,
    timestamps: [],
    cpuHistory: [],
    memUsedPctHistory: [],
    netRx: {},
    netTx: {},
    diskTimestamps: [],
    diskRead: {},
    diskWrite: {},
  };
}

interface FleetState {
  byHost: Record<string, HostSeries>;
  pushTick: (hostId: string, snapshot: TickSnapshot) => void;
  pushDisks: (hostId: string, snapshot: DiskSnapshot) => void;
  dropHost: (hostId: string) => void;
}

export const useFleetStore = create<FleetState>((set) => ({
  byHost: {},
  pushTick: (hostId, snapshot) =>
    set((state) => {
      const prev = state.byHost[hostId] ?? emptySeries();
      const mem = snapshot.memory;
      const usedPct =
        mem.total_kb > 0
          ? ((mem.total_kb - mem.available_kb) / mem.total_kb) * 100
          : 0;
      const netRx: SeriesMap = { ...prev.netRx };
      const netTx: SeriesMap = { ...prev.netTx };
      for (const iface of snapshot.network) {
        netRx[iface.name] = push(netRx[iface.name], iface.rx_bytes_per_sec);
        netTx[iface.name] = push(netTx[iface.name], iface.tx_bytes_per_sec);
      }
      return {
        byHost: {
          ...state.byHost,
          [hostId]: {
            ...prev,
            latest: snapshot,
            timestamps: push(prev.timestamps, snapshot.timestamp_ms / 1000),
            cpuHistory: push(prev.cpuHistory, snapshot.cpu.global_usage_pct),
            memUsedPctHistory: push(prev.memUsedPctHistory, usedPct),
            netRx,
            netTx,
          },
        },
      };
    }),
  pushDisks: (hostId, snapshot) =>
    set((state) => {
      const prev = state.byHost[hostId] ?? emptySeries();
      const diskRead: SeriesMap = { ...prev.diskRead };
      const diskWrite: SeriesMap = { ...prev.diskWrite };
      for (const dev of snapshot.io) {
        diskRead[dev.device] = push(diskRead[dev.device], dev.read_bytes_per_sec);
        diskWrite[dev.device] = push(
          diskWrite[dev.device],
          dev.write_bytes_per_sec,
        );
      }
      return {
        byHost: {
          ...state.byHost,
          [hostId]: {
            ...prev,
            disks: snapshot,
            diskTimestamps: push(prev.diskTimestamps, Date.now() / 1000),
            diskRead,
            diskWrite,
          },
        },
      };
    }),
  dropHost: (hostId) =>
    set((state) => {
      const byHost = { ...state.byHost };
      delete byHost[hostId];
      return { byHost };
    }),
}));
