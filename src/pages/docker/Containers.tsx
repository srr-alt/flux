import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Container,
  Copy,
  FileText,
  Pause,
  Play,
  RotateCw,
  Search,
  Square,
  SquareTerminal,
  X,
} from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { containerAction, containerLogs, listContainers } from "../../lib/tauri";
import { Sparkline } from "../../components/charts/Sparkline";
import { chartColors } from "../../lib/theme";
import { useDockerStore } from "../../state/dockerStore";
import { Button } from "../../components/ui/Button";
import { Drawer } from "../../components/ui/Drawer";
import { EmptyState } from "../../components/ui/EmptyState";
import { Input } from "../../components/ui/Input";
import { LoadingState } from "../../components/ui/LoadingState";
import { Modal } from "../../components/ui/Modal";
import type { ContainerInfo, ContainerStats } from "../../types/monitor";
import { InspectDrawer } from "./InspectDrawer";
import { ShellPanel } from "./ShellPanel";
import { ErrorBanner, HeadRow, TableShell } from "./shared";

const TAIL_OPTIONS = [100, 300, 1000, 5000] as const;

const STATE_COLOR: Record<string, string> = {
  running: "text-status-good",
  paused: "text-status-warning",
  restarting: "text-status-warning",
};

/** 24px icon action (design: containers row actions are compact glyphs). */
function IconBtn({
  icon: Icon,
  title,
  onClick,
  disabled,
  danger,
}: {
  icon: typeof Play;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors duration-100 disabled:opacity-40 ${
        danger
          ? "text-status-critical hover:bg-status-critical/15"
          : "text-ink-muted hover:bg-white/10 hover:text-ink-primary"
      }`}
    >
      <Icon size={12} />
    </button>
  );
}

export function Containers({ refreshToken }: { refreshToken: number }) {
  const [containers, setContainers] = useState<ContainerInfo[] | null>(null);
  const stats = useDockerStore((s) => s.latest);
  const cpuHistory = useDockerStore((s) => s.cpuHistory);
  const statsTimestamps = useDockerStore((s) => s.statsTimestamps);
  const removeFromStore = useDockerStore((s) => s.removeContainer);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<ContainerInfo | null>(null);
  const [logsFor, setLogsFor] = useState<ContainerInfo | null>(null);
  const [logs, setLogs] = useState<string | null>(null);
  const [logTail, setLogTail] = useState<number>(300);
  const [follow, setFollow] = useState(true);
  const [inspecting, setInspecting] = useState<ContainerInfo | null>(null);
  const [shellFor, setShellFor] = useState<ContainerInfo | null>(null);
  const [filter, setFilter] = useState("");
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  const copyLogs = () => {
    if (!logs) return;
    writeText(logs)
      .then(() => {
        setCopied(true);
        clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => setCopied(false), 1500);
      })
      .catch((e) => setError(String(e)));
  };

  const refresh = useCallback(() => {
    listContainers()
      .then((list) => {
        setContainers(list);
        setUnavailable(null);
        // Drop store history for containers removed outside the app.
        const ids = new Set(list.map((c) => c.id));
        for (const id of Object.keys(useDockerStore.getState().cpuHistory)) {
          if (!ids.has(id)) removeFromStore(id);
        }
      })
      .catch((e) => setUnavailable(String(e)));
  }, [removeFromStore]);

  // Container list every 3s. Stats come from the shell's 5s poll via
  // useDockerStore — they keep flowing while other subtabs are open.
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [refresh, refreshToken]);

  // Logs drawer: initial fetch + live tail while open.
  useEffect(() => {
    if (!logsFor) {
      setLogs(null);
      return;
    }
    let cancelled = false;
    const load = () =>
      containerLogs(logsFor.id, logTail)
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
  }, [logsFor, logTail]);

  useEffect(() => {
    if (follow && logs !== null) {
      logsEndRef.current?.scrollIntoView({ block: "end" });
    }
  }, [logs, follow]);

  const act = async (c: ContainerInfo, verb: string) => {
    setBusy(c.id);
    setError(null);
    try {
      await containerAction(c.id, verb);
      if (verb === "remove") removeFromStore(c.id);
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q || !containers) return containers;
    return containers.filter(
      (c) => c.name.toLowerCase().includes(q) || c.image.toLowerCase().includes(q),
    );
  }, [containers, filter]);

  if (unavailable) {
    return (
      <EmptyState icon={Container} title="Docker unavailable" hint={unavailable} />
    );
  }
  if (containers === null || visible === null) {
    return <LoadingState label="Listing containers…" className="h-full" />;
  }

  return (
    <div className="flex h-full flex-col">
      {containers.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <Input
            icon={Search}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name or image…"
            className="w-64"
          />
          <Summary containers={containers} stats={stats} />
        </div>
      )}

      {error && <ErrorBanner message={error} />}

      {containers.length === 0 ? (
        <EmptyState
          icon={Container}
          title="No containers"
          hint="Nothing here yet — run an image and it shows up live."
        />
      ) : (
        <TableShell>
          <HeadRow>
            <th className="px-3 py-2 font-medium">Container</th>
            <th className="w-28 px-3 py-2 font-medium">CPU</th>
            <th className="w-16 px-3 py-2 text-right font-medium">%</th>
            <th className="w-24 px-3 py-2 text-right font-medium">Memory</th>
            <th className="px-3 py-2 font-medium">Ports</th>
            <th className="w-36 px-3 py-2 text-right font-medium">Actions</th>
          </HeadRow>
          <tbody className="tabular-nums">
            {visible.map((c) => {
              const s = stats[c.id];
              const isBusy = busy === c.id;
              const stateCls = STATE_COLOR[c.state] ?? "text-ink-muted";
              return (
                <tr
                  key={c.id}
                  onClick={() => setInspecting(c)}
                  className="cursor-pointer border-t border-border text-ink-secondary hover:bg-white/5"
                >
                  <td className="max-w-0 px-3 py-2" title={c.status}>
                    <div className="flex items-center gap-2.5">
                      <span className={`shrink-0 font-mono text-[10px] font-medium ${stateCls}`}>
                        {c.state}
                      </span>
                      <span className="shrink-0 text-xs font-medium text-ink-primary">
                        {c.name}
                      </span>
                      <span className="truncate font-mono text-[10px] text-ink-faint">
                        {c.image}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <CpuSparkCell values={cpuHistory[c.id]} timestamps={statsTimestamps} />
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs font-semibold text-ink-secondary">
                    {s ? `${s.cpu_pct.toFixed(0)}%` : "—"}
                  </td>
                  <td
                    className="px-3 py-2 text-right font-mono text-xs text-ink-muted"
                    title={s?.mem_usage}
                  >
                    {s ? s.mem_usage.split(" / ")[0] : "—"}
                  </td>
                  <td
                    className="max-w-0 truncate px-3 py-2 font-mono text-[10px] text-ink-faint"
                    title={c.ports}
                  >
                    {c.ports || "—"}
                  </td>
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      {c.state === "running" && (
                        <>
                          <IconBtn icon={Pause} title="Pause" disabled={isBusy} onClick={() => act(c, "pause")} />
                          <IconBtn icon={RotateCw} title="Restart" disabled={isBusy} onClick={() => act(c, "restart")} />
                          <IconBtn icon={FileText} title="Logs" onClick={() => setLogsFor(c)} />
                          <IconBtn icon={SquareTerminal} title="Shell" disabled={isBusy} onClick={() => setShellFor(c)} />
                          <IconBtn icon={Square} title="Stop" danger disabled={isBusy} onClick={() => act(c, "stop")} />
                        </>
                      )}
                      {c.state === "paused" && (
                        <>
                          <IconBtn icon={Play} title="Unpause" disabled={isBusy} onClick={() => act(c, "unpause")} />
                          <IconBtn icon={FileText} title="Logs" onClick={() => setLogsFor(c)} />
                          <IconBtn icon={Square} title="Stop" danger disabled={isBusy} onClick={() => act(c, "stop")} />
                        </>
                      )}
                      {c.state !== "running" && c.state !== "paused" && (
                        <>
                          <IconBtn icon={Play} title="Start" disabled={isBusy} onClick={() => act(c, "start")} />
                          <IconBtn icon={FileText} title="Logs" onClick={() => setLogsFor(c)} />
                          <IconBtn icon={X} title="Remove" danger disabled={isBusy} onClick={() => setConfirmRemove(c)} />
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      )}
      {containers.length > 0 && (
        <div className="mt-3 font-mono text-[11px] text-ink-faint/80">
          stats poll 5s · logs / inspect / shell (docker exec -it, xterm.js) open as slide-overs
        </div>
      )}

      {inspecting && (
        <InspectDrawer
          container={inspecting}
          onClose={() => setInspecting(null)}
          onShell={() => {
            setShellFor(inspecting);
            setInspecting(null);
          }}
        />
      )}

      {shellFor && (
        <ShellPanel container={shellFor} onClose={() => setShellFor(null)} />
      )}

      {logsFor && (
        <Drawer wide title={`Logs · ${logsFor.name}`} onClose={() => setLogsFor(null)}>
          <div className="mb-3 flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5 text-ink-muted">
              Tail
              <select
                value={logTail}
                onChange={(e) => setLogTail(Number(e.target.value))}
                className="rounded-md border border-border bg-page px-1.5 py-0.5 text-ink-primary focus:border-series-1 focus:outline-none"
              >
                {TAIL_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-ink-muted">
              <input
                type="checkbox"
                checked={follow}
                onChange={(e) => setFollow(e.target.checked)}
                className="accent-series-1"
              />
              Follow
            </label>
            <Button
              size="sm"
              onClick={copyLogs}
              disabled={!logs || logs.trim() === ""}
              className="ml-auto"
            >
              {copied ? (
                <>
                  <Check size={11} className="text-status-good" /> Copied
                </>
              ) : (
                <>
                  <Copy size={11} /> Copy
                </>
              )}
            </Button>
          </div>
          {logs === null ? (
            <LoadingState label="Fetching logs…" />
          ) : logs.trim() === "" ? (
            <p className="text-sm text-ink-muted">No log output.</p>
          ) : (
            <>
              <pre className="whitespace-pre-wrap break-all rounded-md bg-black/25 p-3 font-mono text-[11px] leading-relaxed text-ink-secondary">
                {logs}
              </pre>
              <div ref={logsEndRef} />
            </>
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
            <Button variant="ghost" onClick={() => setConfirmRemove(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                act(confirmRemove, "remove");
                setConfirmRemove(null);
              }}
            >
              Remove
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Row sparkline. Memoized so the 3s list poll doesn't push data into uPlot;
 * only the 5s stats ticks (new array identities from the store) re-render. */
const CpuSparkCell = memo(function CpuSparkCell({
  values,
  timestamps,
}: {
  values: (number | null)[] | undefined;
  timestamps: number[];
}) {
  const points = values?.filter((v) => v !== null).length ?? 0;
  if (!values || points < 2) {
    return <span className="inline-block w-[72px]" />;
  }
  return (
    <div className="w-[72px]">
      <Sparkline
        timestamps={timestamps}
        series={[{ values, color: chartColors.cpu, label: "CPU" }]}
        height={20}
      />
    </div>
  );
});

function Summary({
  containers,
  stats,
}: {
  containers: ContainerInfo[];
  stats: Record<string, ContainerStats>;
}) {
  const running = containers.filter((c) => c.state === "running").length;
  let cpu = 0;
  let mem = 0;
  let sampled = false;
  for (const c of containers) {
    const s = stats[c.id];
    if (s) {
      cpu += s.cpu_pct;
      mem += s.mem_pct;
      sampled = true;
    }
  }
  return (
    <div className="text-xs tabular-nums text-ink-muted">
      {running} running · {containers.length} total
      {sampled && (
        <>
          {" "}
          · CPU <span className="text-ink-secondary">{cpu.toFixed(1)}%</span> · Mem{" "}
          <span className="text-ink-secondary">{mem.toFixed(1)}%</span>
        </>
      )}
    </div>
  );
}
