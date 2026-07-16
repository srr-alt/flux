import { useEffect, useState } from "react";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { LoadingState } from "../components/ui/LoadingState";
import { ScreenHeader } from "../components/layout/ScreenHeader";
import { Switch } from "../components/ui/Switch";
import { useLockStore } from "../state/lockStore";
import { version as APP_VERSION } from "../../package.json";
import { SegmentedControl } from "../components/ui/SegmentedControl";
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
    <div className="glass rounded-2xl border border-border p-4">
      <h2 className="mb-1 text-sm font-medium text-ink-primary">Refresh rate</h2>
      <p className="mb-3 text-xs text-ink-muted">
        How often CPU, memory and network stats are sampled. Disk, sensors
        and GPU update at half this rate, but never faster than every 0.5s.
      </p>
      <SegmentedControl
        options={REFRESH_OPTIONS.map((opt) => ({ value: opt.ms, label: opt.label }))}
        value={refreshMs}
        onChange={apply}
      />
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
    <div className="glass rounded-2xl border border-border p-4">
      <div className="flex items-center gap-4">
        <div>
          <h2 className="mb-1 text-sm font-medium text-ink-primary">Usage logging</h2>
          <p className="text-xs text-ink-muted">
            Records CPU, memory, GPU and network usage to a CSV file every
            sample — keeps recording even while the window is minimized.
          </p>
        </div>
        <div className="ml-auto">
          <Switch checked={active} onChange={toggle} aria-label="Toggle usage logging" />
        </div>
      </div>
      {active && status?.path && (
        <div className="mt-3 break-all rounded-xl border border-border bg-page px-3 py-2 font-mono text-[11px] text-status-good">
          ● recording → {status.path} · {status.rows ?? 0} rows
        </div>
      )}
      {error && <p className="mt-2 text-xs text-status-critical">{error}</p>}
    </div>
  );
}

function PrivacyLockCard() {
  const { hash, locked, setPassword, lock, unlock, changePassword } = useLockStore();
  const [input, setInput] = useState("");
  const [nextPw, setNextPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = async (action: () => Promise<boolean | void>, doneMsg?: string) => {
    setError(null);
    setNotice(null);
    const ok = (await action()) !== false;
    if (!ok) setError("Wrong password.");
    else {
      setInput("");
      setNextPw("");
      if (doneMsg) setNotice(doneMsg);
    }
  };

  return (
    <div className="glass rounded-2xl border border-border p-4">
      <h2 className="mb-1 text-sm font-medium text-ink-primary">Privacy lock</h2>
      <p className="mb-3 text-xs text-ink-muted">
        Hides Fleet, the Assistant and the machine picker until unlocked with a
        password. Deters a shared screen, not an attacker — the check lives in
        this app only.
      </p>

      {!hash ? (
        <div className="flex items-center gap-2">
          <Input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="New password"
            className="w-56"
            onKeyDown={(e) => {
              if (e.key === "Enter" && input !== "") run(() => setPassword(input));
            }}
          />
          <Button size="sm" disabled={input === ""} onClick={() => run(() => setPassword(input))}>
            Set password & lock
          </Button>
        </div>
      ) : locked ? (
        <div className="flex items-center gap-2">
          <Input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Password"
            className="w-56"
            onKeyDown={(e) => {
              if (e.key === "Enter" && input !== "") run(() => unlock(input));
            }}
          />
          <Button size="sm" disabled={input === ""} onClick={() => run(() => unlock(input))}>
            Unlock
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div>
            <Button size="sm" onClick={() => lock()}>
              Lock now
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="password"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Current password"
              className="w-48"
            />
            <Input
              type="password"
              value={nextPw}
              onChange={(e) => setNextPw(e.target.value)}
              placeholder="New password"
              className="w-48"
            />
            <Button
              size="sm"
              disabled={input === "" || nextPw === ""}
              onClick={() =>
                run(() => changePassword(input, nextPw), "Password updated.")
              }
            >
              Reset password
            </Button>
          </div>
        </div>
      )}

      {locked && (
        <div className="mt-3 rounded-xl border border-border bg-page px-3 py-2 font-mono text-[11px] text-status-warning">
          ● locked — Fleet, Assistant and machine picker hidden
        </div>
      )}
      {notice && <p className="mt-2 text-xs text-status-good">{notice}</p>}
      {error && <p className="mt-2 text-xs text-status-critical">{error}</p>}
    </div>
  );
}

export function Settings() {
  const systemInfo = useMonitorStore((s) => s.systemInfo);

  return (
    <>
      <ScreenHeader title="Settings" sub={`flux ${APP_VERSION} · tauri 2`} />
      <div className="flex max-w-2xl flex-col gap-3.5 p-5">
      <RefreshRateCard />
      <LoggingCard />
      <PrivacyLockCard />
      <div className="glass rounded-2xl border border-border p-4">
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
                <dt className="text-xs text-ink-muted">{label}</dt>
                <dd className="font-mono text-xs text-ink-secondary">{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <LoadingState label="Reading system info…" className="justify-start p-0" />
        )}
      </div>
      </div>
    </>
  );
}
