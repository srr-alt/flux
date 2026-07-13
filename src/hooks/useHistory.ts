import { useEffect, useState } from "react";
import { gpuHistoryQuery, historyQuery } from "../lib/tauri";
import type { GpuHistoryPoint, HistoryPoint } from "../types/monitor";

/** Time-range options for history charts; null = live ring buffer. */
export const HISTORY_RANGES = [
  { label: "Live", secs: null },
  { label: "3h", secs: 3 * 3600 },
  { label: "24h", secs: 24 * 3600 },
  { label: "7d", secs: 7 * 24 * 3600 },
  { label: "30d", secs: 30 * 24 * 3600 },
] as const;

export type HistoryRange = (typeof HISTORY_RANGES)[number]["secs"];

const REFRESH_MS = 30_000;

/** Persisted history for a host, refreshed periodically. Empty while in
 * live mode (rangeSecs null) or when the range has no samples yet. */
export function useHistory(
  hostId: string,
  rangeSecs: HistoryRange,
): HistoryPoint[] {
  const [points, setPoints] = useState<HistoryPoint[]>([]);
  useEffect(() => {
    if (rangeSecs == null) {
      setPoints([]);
      return;
    }
    let alive = true;
    const load = () =>
      historyQuery(hostId, rangeSecs)
        .then((p) => {
          if (alive) setPoints(p);
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [hostId, rangeSecs]);
  return points;
}

/** Persisted history for one GPU (by index) on a host, refreshed
 * periodically. Empty in live mode or when the card has no samples yet. */
export function useGpuHistory(
  hostId: string,
  rangeSecs: HistoryRange,
  gpuIndex: number,
): GpuHistoryPoint[] {
  const [points, setPoints] = useState<GpuHistoryPoint[]>([]);
  useEffect(() => {
    if (rangeSecs == null) {
      setPoints([]);
      return;
    }
    let alive = true;
    const load = () =>
      gpuHistoryQuery(hostId, rangeSecs)
        .then((p) => {
          if (alive) setPoints(p.filter((row) => row.gpu_index === gpuIndex));
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [hostId, rangeSecs, gpuIndex]);
  return points;
}
