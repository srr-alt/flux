import { useEffect, useState } from "react";
import { Circle, Square } from "lucide-react";
import { useMonitorStore } from "../state/monitorStore";
import { formatKb, formatUptime } from "../lib/format";
import {
  getUsageLogStatus,
  setRefreshInterval,
  startUsageLog,
  stopUsageLog,
} from "../lib/tauri";
import { loadRefreshMs, saveRefreshMs, REFRESH_OPTIONS } from "../lib/settings";
import type { UsageLogStatus } from "../types/monitor";

function RefreshRateCard() {
  const [refreshMs, setRefreshMs] = useState(loadRefreshMs);

  const apply = (ms: number) => {
    setRefreshMs(ms);
    saveRefreshMs(ms);
    setRefreshInterval(ms).catch(() => {});
  };

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h2 className="mb-1 text-sm font-medium text-ink-primary">Refresh rate</h2>
      <p className="mb-3 text-xs text-ink-muted">
        How often CPU, memory and network stats are sampled. Disk and GPU
        update at half this rate.
      </p>
      <div className="inline-flex rounded-lg border border-border bg-page p-1">
        {REFRESH_OPTIONS.map((opt) => (
          <button
            key={opt.ms}
            onClick={() => apply(opt.ms)}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              opt.ms === refreshMs
                ? "bg-series-1/15 font-medium text-series-1"
                : "text-ink-secondary hover:text-ink-primary"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function LoggingCard() {
  const [status, setStatus] = useState<UsageLogStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getUsageLogStatus().then(setStatus).catch(() => {});
  }, []);

  // While recording, refresh the row counter every 2s.
  useEffect(() => {
    if (!status?.active) return;
    const id = setInterval(() => {
      getUsageLogStatus().then(setStatus).catch(() => {});
    }, 2000);
    return () => clearInterval(id);
  }, [status?.active]);

  const toggle = async () => {
    setError(null);
    try {
      setStatus(status?.active ? await stopUsageLog() : await startUsageLog());
    } catch (e) {
      setError(String(e));
    }
  };

  const active = status?.active ?? false;

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h2 className="mb-1 text-sm font-medium text-ink-primary">Usage logging</h2>
      <p className="mb-3 text-xs text-ink-muted">
        Records CPU, memory, GPU and network usage to a CSV file every sample
        — keeps recording even while the window is minimized.
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={toggle}
          className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            active
              ? "bg-red-500/15 text-red-400 hover:bg-red-500/25"
              : "bg-series-1/15 text-series-1 hover:bg-series-1/25"
          }`}
        >
          {active ? (
            <>
              <Square size={13} /> Stop logging
            </>
          ) : (
            <>
              <Circle size={13} className="fill-current" /> Start logging
            </>
          )}
        </button>
        {active && (
          <span className="text-xs text-ink-muted">
            {status?.rows ?? 0} rows written
          </span>
        )}
      </div>
      {status?.path && (
        <p className="mt-3 break-all font-mono text-xs text-ink-secondary">
          {status.path}
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}

export function Settings() {
  const systemInfo = useMonitorStore((s) => s.systemInfo);

  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold text-ink-primary">Settings</h1>
      <RefreshRateCard />
      <LoggingCard />
      <div className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-medium text-ink-primary">About this system</h2>
        {systemInfo ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
            {[
              ["Hostname", systemInfo.hostname],
              ["OS", systemInfo.os_pretty_name],
              ["Kernel", systemInfo.kernel_version],
              ["CPU", systemInfo.cpu_model],
              [
                "Cores",
                `${systemInfo.physical_cores} physical / ${systemInfo.logical_cores} logical`,
              ],
              ["Memory", formatKb(systemInfo.total_memory_kb)],
              ["Uptime", formatUptime(systemInfo.uptime_secs)],
            ].map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-ink-muted">{label}</dt>
                <dd className="text-ink-secondary">{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <span className="text-sm text-ink-muted">Loading…</span>
        )}
      </div>
    </div>
  );
}
