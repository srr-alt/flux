import { create } from "zustand";
import type { ContainerStats } from "../types/monitor";
import { HISTORY_LENGTH } from "./history";

/** History of container CPU/mem, fed by the Docker page's 5s stats poll.
 * Lives outside the page so subtab switches don't drop it. All histories are
 * index-aligned with statsTimestamps: every tick pushes to every known key,
 * null when a container produced no sample (paused/stopped) — uPlot renders
 * nulls as gaps. */

type NullableSeries = (number | null)[];

interface DockerStatsState {
  latest: Record<string, ContainerStats>;
  statsTimestamps: number[];
  cpuHistory: Record<string, NullableSeries>;
  memHistory: Record<string, NullableSeries>;
  pushStats: (all: ContainerStats[]) => void;
  removeContainer: (id: string) => void;
}

function pushAligned(
  history: NullableSeries | undefined,
  value: number | null,
): NullableSeries {
  const prev = history ?? [];
  const next = prev.length >= HISTORY_LENGTH ? prev.slice(1) : prev.slice();
  next.push(value);
  return next;
}

/** Poll gap over ~3 intervals: user left the Docker page; a chart bridging
 * the gap would be misleading, so restart history. */
const STALE_GAP_S = 15;

export const useDockerStore = create<DockerStatsState>((set) => ({
  latest: {},
  statsTimestamps: [],
  cpuHistory: {},
  memHistory: {},

  pushStats: (all) =>
    set((state) => {
      const now = Date.now() / 1000;
      const last = state.statsTimestamps[state.statsTimestamps.length - 1];
      const stale = last !== undefined && now - last > STALE_GAP_S;

      const latest: Record<string, ContainerStats> = {};
      for (const s of all) latest[s.id] = s;

      const prevCpu = stale ? {} : state.cpuHistory;
      const prevMem = stale ? {} : state.memHistory;
      const keys = new Set([...Object.keys(prevCpu), ...all.map((s) => s.id)]);

      // Containers appearing mid-history start with null backfill so every
      // series stays the same length as statsTimestamps.
      const baseLen = stale ? 0 : state.statsTimestamps.length;
      const backfill = (h: NullableSeries | undefined) =>
        h ?? (new Array(baseLen).fill(null) as NullableSeries);

      const cpuHistory: Record<string, NullableSeries> = {};
      const memHistory: Record<string, NullableSeries> = {};
      for (const id of keys) {
        const cpu = pushAligned(backfill(prevCpu[id]), latest[id]?.cpu_pct ?? null);
        // Drop keys that went a full buffer without a sample.
        if (cpu.every((v) => v === null)) continue;
        cpuHistory[id] = cpu;
        memHistory[id] = pushAligned(backfill(prevMem[id]), latest[id]?.mem_pct ?? null);
      }

      const timestamps = stale ? [] : state.statsTimestamps.slice();
      if (timestamps.length >= HISTORY_LENGTH) timestamps.shift();
      timestamps.push(now);

      return { latest, statsTimestamps: timestamps, cpuHistory, memHistory };
    }),

  removeContainer: (id) =>
    set((state) => {
      if (!(id in state.latest) && !(id in state.cpuHistory)) return state;
      const latest = { ...state.latest };
      const cpuHistory = { ...state.cpuHistory };
      const memHistory = { ...state.memHistory };
      delete latest[id];
      delete cpuHistory[id];
      delete memHistory[id];
      return { latest, cpuHistory, memHistory };
    }),
}));
