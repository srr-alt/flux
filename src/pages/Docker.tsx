import { useCallback, useEffect, useMemo, useState } from "react";
import { Container, RefreshCw } from "lucide-react";
import {
  containerAction,
  containerLogs,
  containerStats,
  listContainers,
} from "../lib/tauri";
import { Drawer } from "../components/ui/Drawer";
import { EmptyState } from "../components/ui/EmptyState";
import { LoadingState } from "../components/ui/LoadingState";
import { Modal } from "../components/ui/Modal";
import type { ContainerInfo, ContainerStats } from "../types/monitor";

function statePill(state: string): { cls: string; pulse: boolean } {
  switch (state) {
    case "running":
      return { cls: "bg-status-good/15 text-status-good", pulse: false };
    case "paused":
      return { cls: "bg-status-warning/15 text-status-warning", pulse: false };
    case "restarting":
      return { cls: "bg-status-warning/15 text-status-warning", pulse: true };
    case "dead":
      return { cls: "bg-status-critical/15 text-status-critical", pulse: false };
    default: // exited, created
      return { cls: "bg-white/5 text-ink-muted", pulse: false };
  }
}

export function Docker() {
  const [containers, setContainers] = useState<ContainerInfo[] | null>(null);
  const [stats, setStats] = useState<Record<string, ContainerStats>>({});
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<ContainerInfo | null>(null);
  const [logsFor, setLogsFor] = useState<ContainerInfo | null>(null);
  const [logs, setLogs] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listContainers()
      .then((list) => {
        setContainers(list);
        setUnavailable(null);
      })
      .catch((e) => setUnavailable(String(e)));
  }, []);

  // Container list every 3s; stats are a ~1s blocking docker call, poll
  // them at a slower cadence and only while something is running.
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  const anyRunning = containers?.some((c) => c.state === "running") ?? false;
  useEffect(() => {
    if (!anyRunning) {
      setStats({});
      return;
    }
    let cancelled = false;
    const load = () =>
      containerStats()
        .then((all) => {
          if (cancelled) return;
          const byId: Record<string, ContainerStats> = {};
          for (const s of all) byId[s.id] = s;
          setStats(byId);
        })
        .catch(() => {});
    load();
    const id = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [anyRunning]);

  // Logs drawer: initial fetch + follow while open.
  useEffect(() => {
    if (!logsFor) {
      setLogs(null);
      return;
    }
    let cancelled = false;
    const load = () =>
      containerLogs(logsFor.id, 300)
        .then((text) => {
          if (!cancelled) setLogs(text);
        })
        .catch((e) => {
          if (!cancelled) setLogs(String(e));
        });
    load();
    const id = setInterval(load, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [logsFor]);

  const act = async (c: ContainerInfo, verb: string) => {
    setBusy(c.id);
    setError(null);
    try {
      await containerAction(c.id, verb);
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const running = useMemo(
    () => containers?.filter((c) => c.state === "running").length ?? 0,
    [containers],
  );

  if (unavailable) {
    return (
      <div className="p-6">
        <h1 className="mb-4 text-lg font-semibold text-ink-primary">Docker</h1>
        <EmptyState
          icon={Container}
          title="Docker unavailable"
          hint={unavailable}
        />
      </div>
    );
  }
  if (containers === null) {
    return <LoadingState label="Listing containers…" className="h-full" />;
  }

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold text-ink-primary">
          Docker{" "}
          <span className="text-sm font-normal text-ink-muted">
            {running} running / {containers.length}
          </span>
        </h1>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-status-critical/40 bg-status-critical/10 px-3 py-2 text-sm text-status-critical">
          {error}
        </div>
      )}

      {containers.length === 0 ? (
        <EmptyState
          icon={Container}
          title="No containers"
          hint="Nothing here yet — docker run something and it shows up live."
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="text-left text-xs uppercase tracking-wide text-ink-muted">
                <th className="px-3 py-2 font-medium">Container</th>
                <th className="px-3 py-2 font-medium">Image</th>
                <th className="w-24 px-3 py-2 font-medium">State</th>
                <th className="w-20 px-3 py-2 text-right font-medium">CPU</th>
                <th className="w-36 px-3 py-2 text-right font-medium">Memory</th>
                <th className="px-3 py-2 font-medium">Ports</th>
                <th className="w-56 px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {containers.map((c) => {
                const pill = statePill(c.state);
                const s = stats[c.id];
                const isBusy = busy === c.id;
                return (
                  <tr
                    key={c.id}
                    className="border-t border-border text-ink-secondary hover:bg-white/5"
                  >
                    <td className="px-3 py-1.5 font-medium text-ink-primary">
                      {c.name}
                      <div className="text-[11px] font-normal text-ink-muted" title={c.status}>
                        {c.status}
                      </div>
                    </td>
                    <td className="max-w-0 truncate px-3 py-1.5" title={c.image}>
                      {c.image}
                    </td>
                    <td className="px-3 py-1.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${pill.cls} ${
                          pill.pulse ? "animate-pulse" : ""
                        }`}
                      >
                        {c.state}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {s ? `${s.cpu_pct.toFixed(1)}%` : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right" title={s?.mem_usage}>
                      {s ? s.mem_usage.split(" / ")[0] : "—"}
                    </td>
                    <td className="max-w-0 truncate px-3 py-1.5 text-xs" title={c.ports}>
                      {c.ports || "—"}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex justify-end gap-1 text-xs">
                        {c.state === "running" ? (
                          <>
                            <RowButton label="Stop" disabled={isBusy} onClick={() => act(c, "stop")} />
                            <RowButton label="Restart" disabled={isBusy} onClick={() => act(c, "restart")} />
                          </>
                        ) : (
                          <RowButton label="Start" disabled={isBusy} onClick={() => act(c, "start")} />
                        )}
                        <RowButton label="Logs" disabled={false} onClick={() => setLogsFor(c)} />
                        {c.state !== "running" && (
                          <button
                            onClick={() => setConfirmRemove(c)}
                            disabled={isBusy}
                            className="rounded px-2 py-0.5 text-status-critical hover:bg-status-critical/15 disabled:opacity-40"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {logsFor && (
        <Drawer
          title={`Logs · ${logsFor.name}`}
          onClose={() => setLogsFor(null)}
        >
          {logs === null ? (
            <LoadingState label="Fetching logs…" />
          ) : logs.trim() === "" ? (
            <p className="text-sm text-ink-muted">No log output.</p>
          ) : (
            <pre className="whitespace-pre-wrap break-all rounded-md bg-black/25 p-3 font-mono text-[11px] leading-relaxed text-ink-secondary">
              {logs}
            </pre>
          )}
        </Drawer>
      )}

      {confirmRemove && (
        <Modal
          title={`Remove ${confirmRemove.name}?`}
          onClose={() => setConfirmRemove(null)}
        >
          <p className="text-sm text-ink-secondary">
            Deletes the stopped container ({confirmRemove.image}). The image
            and any named volumes stay.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => setConfirmRemove(null)}
              className="rounded-md px-3 py-1.5 text-sm text-ink-secondary hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                act(confirmRemove, "remove");
                setConfirmRemove(null);
              }}
              className="rounded-md bg-status-critical px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              Remove
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function RowButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-ink-muted hover:bg-white/10 hover:text-ink-primary disabled:opacity-40"
    >
      {disabled && <RefreshCw size={10} className="animate-spin" />}
      {label}
    </button>
  );
}
