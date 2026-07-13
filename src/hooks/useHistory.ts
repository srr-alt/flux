import { useEffect, useState } from "react";
import { historyQuery } from "../lib/tauri";
import type { HistoryPoint } from "../types/monitor";

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
