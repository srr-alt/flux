import { create } from "zustand";
import type {
  DiskSnapshot,
  GpuSnapshot,
  HwmonChip,
  SystemInfo,
  TickSnapshot,
} from "../types/monitor";

export const HISTORY_LENGTH = 90;

export type SeriesMap = Record<string, number[]>;

interface MonitorState {
  systemInfo: SystemInfo | null;
  latest: TickSnapshot | null;
  disks: DiskSnapshot | null;
  /** Ring-buffer histories, oldest first, capped at HISTORY_LENGTH. */
  timestamps: number[];
  cpuHistory: number[];
  memUsedPctHistory: number[];
  netRx: SeriesMap;
  netTx: SeriesMap;
  /** Disk events arrive at half cadence, so they keep their own time axis. */
  diskTimestamps: number[];
  diskRead: SeriesMap;
  diskWrite: SeriesMap;
  gpus: GpuSnapshot[];
  gpuTimestamps: number[];
  /** Keyed by GPU index; utilization when available, else temperature. */
  gpuUtil: SeriesMap;
  gpuTemp: SeriesMap;
  sensors: HwmonChip[];
  sensorTimestamps: number[];
  /** Temperature histories keyed `${chip.id}:${temp.label}`. */
  sensorTemps: SeriesMap;
  setSystemInfo: (info: SystemInfo) => void;
  pushTick: (snapshot: TickSnapshot) => void;
  pushDisks: (snapshot: DiskSnapshot) => void;
  pushGpus: (gpus: GpuSnapshot[]) => void;
  pushSensors: (chips: HwmonChip[]) => void;
}

function push(history: number[] | undefined, value: number): number[] {
  const prev = history ?? [];
  const next = prev.length >= HISTORY_LENGTH ? prev.slice(1) : prev.slice();
  next.push(value);
  return next;
}

export const useMonitorStore = create<MonitorState>((set) => ({
  systemInfo: null,
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
  gpus: [],
  gpuTimestamps: [],
  gpuUtil: {},
  gpuTemp: {},
  sensors: [],
  sensorTimestamps: [],
  sensorTemps: {},
  setSystemInfo: (info) => set({ systemInfo: info }),
  pushSensors: (chips) =>
    set((state) => {
      const sensorTemps: SeriesMap = { ...state.sensorTemps };
      for (const chip of chips) {
        for (const temp of chip.temps) {
          const key = `${chip.id}:${temp.label}`;
          sensorTemps[key] = push(sensorTemps[key], temp.c);
        }
      }
      return {
        sensors: chips,
        sensorTimestamps: push(state.sensorTimestamps, Date.now() / 1000),
        sensorTemps,
      };
    }),
  pushGpus: (gpus) =>
    set((state) => {
      const gpuUtil: SeriesMap = { ...state.gpuUtil };
      const gpuTemp: SeriesMap = { ...state.gpuTemp };
      gpus.forEach((gpu, i) => {
        const key = String(i);
        if (gpu.utilization_pct !== null) {
          gpuUtil[key] = push(gpuUtil[key], gpu.utilization_pct);
        }
        if (gpu.temp_c !== null) {
          gpuTemp[key] = push(gpuTemp[key], gpu.temp_c);
        }
      });
      return {
        gpus,
        gpuTimestamps: push(state.gpuTimestamps, Date.now() / 1000),
        gpuUtil,
        gpuTemp,
      };
    }),
  pushTick: (snapshot) =>
    set((state) => {
      const mem = snapshot.memory;
      const usedPct =
        mem.total_kb > 0
          ? ((mem.total_kb - mem.available_kb) / mem.total_kb) * 100
          : 0;
      const netRx: SeriesMap = { ...state.netRx };
      const netTx: SeriesMap = { ...state.netTx };
      for (const iface of snapshot.network) {
        netRx[iface.name] = push(netRx[iface.name], iface.rx_bytes_per_sec);
        netTx[iface.name] = push(netTx[iface.name], iface.tx_bytes_per_sec);
      }
      return {
        latest: snapshot,
        timestamps: push(state.timestamps, snapshot.timestamp_ms / 1000),
        cpuHistory: push(state.cpuHistory, snapshot.cpu.global_usage_pct),
        memUsedPctHistory: push(state.memUsedPctHistory, usedPct),
        netRx,
        netTx,
      };
    }),
  pushDisks: (snapshot) =>
    set((state) => {
      const diskRead: SeriesMap = { ...state.diskRead };
      const diskWrite: SeriesMap = { ...state.diskWrite };
      for (const dev of snapshot.io) {
        diskRead[dev.device] = push(diskRead[dev.device], dev.read_bytes_per_sec);
        diskWrite[dev.device] = push(diskWrite[dev.device], dev.write_bytes_per_sec);
      }
      return {
        disks: snapshot,
        diskTimestamps: push(state.diskTimestamps, Date.now() / 1000),
        diskRead,
        diskWrite,
      };
    }),
}));
