import { useEffect } from "react";
import {
  getInitialSnapshot,
  getSystemInfo,
  onDisks,
  onGpu,
  onTick,
  setRefreshInterval,
} from "../lib/tauri";
import { DEFAULT_REFRESH_MS, loadRefreshMs } from "../lib/settings";
import { useMonitorStore } from "../state/monitorStore";

/** Mount once (in App). Owns the Tauri event subscriptions and feeds the store. */
export function useMonitorTick() {
  const pushTick = useMonitorStore((s) => s.pushTick);
  const pushDisks = useMonitorStore((s) => s.pushDisks);
  const pushGpus = useMonitorStore((s) => s.pushGpus);
  const setSystemInfo = useMonitorStore((s) => s.setSystemInfo);

  useEffect(() => {
    const unlisteners: (() => void)[] = [];
    let cancelled = false;
    const register = (promise: Promise<() => void>) => {
      promise.then((fn) => {
        if (cancelled) fn();
        else unlisteners.push(fn);
      });
    };

    // Re-apply the persisted refresh rate; the backend defaults to 1s.
    const savedMs = loadRefreshMs();
    if (savedMs !== DEFAULT_REFRESH_MS) {
      setRefreshInterval(savedMs).catch(() => {});
    }

    getSystemInfo().then((info) => {
      if (!cancelled) setSystemInfo(info);
    });
    getInitialSnapshot().then((snapshot) => {
      if (!cancelled && snapshot) pushTick(snapshot);
    });
    register(onTick(pushTick));
    register(onDisks(pushDisks));
    register(onGpu(pushGpus));

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }, [pushTick, pushDisks, pushGpus, setSystemInfo]);
}
