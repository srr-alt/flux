import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Layers, SearchX } from "lucide-react";
import {
  getProcessDetail,
  killProcess,
  killRemoteProcess,
  listProcesses,
  listRemoteProcesses,
  reniceProcess,
} from "../lib/tauri";
import { HostSwitcher } from "../components/hosts/HostSwitcher";
import { useSelectedHostMetrics, useSelectedSystemInfo } from "../hooks/useHostMetrics";
import { formatBytes, formatBytesPerSec, formatKb, formatPercent } from "../lib/format";
import { themeColor, withAlpha } from "../lib/theme";
import { Modal } from "../components/ui/Modal";
import { Drawer } from "../components/ui/Drawer";
import { EmptyState } from "../components/ui/EmptyState";
import { LoadingState } from "../components/ui/LoadingState";
import type { ProcessDetail, ProcessInfo } from "../types/monitor";

type SortKey = "name" | "user" | "cpu" | "mem" | "disk";

interface Group {
  name: string;
  procs: ProcessInfo[];
  cpu: number;
  mem: number;
  disk: number;
}

const diskRate = (p: ProcessInfo) =>
  p.disk_read_bytes_per_sec + p.disk_write_bytes_per_sec;

/** Task Manager-style heat shading: cell tint scales with load. */
function heat(frac: number): string | undefined {
  const clamped = Math.min(1, Math.max(0, frac));
  if (clamped < 0.02) return undefined;
  return withAlpha(themeColor("series4"), 0.06 + clamped * 0.34);
}

function sortValue(g: Group, key: SortKey): number | string {
  switch (key) {
    case "name":
      return g.name.toLowerCase();
    case "user":
      return g.procs[0]?.user ?? "";
    case "cpu":
      return g.cpu;
    case "mem":
      return g.mem;
    case "disk":
      return g.disk;
  }
}

function compare(a: number | string, b: number | string, desc: boolean): number {
  const cmp =
    typeof a === "string" && typeof b === "string"
      ? a.localeCompare(b)
      : (a as number) - (b as number);
  return desc ? -cmp : cmp;
}

export function Processes() {
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [sortBy, setSortBy] = useState<SortKey>("cpu");
  const [sortDesc, setSortDesc] = useState(true);
  const [search, setSearch] = useState("");
  const [grouped, setGrouped] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [confirmKill, setConfirmKill] = useState<ProcessInfo | null>(null);
  const [detail, setDetail] = useState<ProcessInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const { latest, disks, isLocal, hostId } = useSelectedHostMetrics();
  const systemInfo = useSelectedSystemInfo();

  const refresh = useCallback(async () => {
    try {
      const query = {
        sort_by: "cpu" as const,
        sort_desc: true,
        search: null,
        limit: null,
      };
      const result = isLocal
        ? await listProcesses(query)
        : await listRemoteProcesses(hostId, query);
      setProcesses(result);
      setLoading(false);
    } catch {
      // transient failures (e.g. mid-navigation) — keep the last list
    }
  }, [isLocal, hostId]);

  // Poll only while this page is mounted; restart on host switch.
  useEffect(() => {
    setProcesses([]);
    setLoading(true);
    setDetail(null);
    refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [refresh]);

  const totalMemBytes = (systemInfo?.total_memory_kb ?? 0) * 1024;

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? processes.filter(
          (p) =>
            p.name.toLowerCase().includes(q) || p.cmd.toLowerCase().includes(q),
        )
      : processes;

    const byName = new Map<string, ProcessInfo[]>();
    for (const p of filtered) {
      const key = grouped ? p.name : `${p.name}#${p.pid}`;
      const list = byName.get(key);
      if (list) list.push(p);
      else byName.set(key, [p]);
    }
    const result: Group[] = [];
    for (const [, procs] of byName) {
      procs.sort((a, b) => b.cpu_pct - a.cpu_pct);
      result.push({
        name: procs[0].name,
        procs,
        cpu: procs.reduce((s, p) => s + p.cpu_pct, 0),
        mem: procs.reduce((s, p) => s + p.mem_bytes, 0),
        disk: procs.reduce((s, p) => s + diskRate(p), 0),
      });
    }
    result.sort((a, b) =>
      compare(sortValue(a, sortBy), sortValue(b, sortBy), sortDesc),
    );
    return result;
  }, [processes, search, grouped, sortBy, sortDesc]);

  // Header totals, Task Manager style.
  const totals = useMemo(() => {
    const mem = latest?.memory;
    const memPct =
      mem && mem.total_kb > 0
        ? ((mem.total_kb - mem.available_kb) / mem.total_kb) * 100
        : 0;
    const diskTotal = (disks?.io ?? []).reduce(
      (s, d) => s + d.read_bytes_per_sec + d.write_bytes_per_sec,
      0,
    );
    return {
      cpu: latest?.cpu.global_usage_pct ?? 0,
      memPct,
      disk: diskTotal,
    };
  }, [latest, disks]);

  const onHeaderClick = (key: SortKey) => {
    if (key === sortBy) setSortDesc((d) => !d);
    else {
      setSortBy(key);
      setSortDesc(key !== "name" && key !== "user");
    }
  };

  const toggleExpand = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const doKill = async (proc: ProcessInfo, force: boolean) => {
    setConfirmKill(null);
    setError(null);
    try {
      if (isLocal) await killProcess(proc.pid, force);
      else await killRemoteProcess(hostId, proc.pid, force);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const doRenice = async (proc: ProcessInfo, delta: number) => {
    setError(null);
    try {
      await reniceProcess(proc.pid, Math.min(19, Math.max(-20, proc.nice + delta)));
      refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const arrow = (key: SortKey) => (key === sortBy ? (sortDesc ? " ↓" : " ↑") : "");

  const heatCells = (cpu: number, mem: number, disk: number) => [
    {
      key: "cpu",
      text: formatPercent(cpu),
      bg: heat(cpu / 100),
    },
    {
      key: "mem",
      text: formatBytes(mem),
      bg: heat(totalMemBytes > 0 ? mem / totalMemBytes : 0),
    },
    {
      key: "disk",
      text: disk >= 10_240 ? formatBytesPerSec(disk) : "0 B/s",
      bg: heat(disk / 50_000_000),
    },
  ];

  const actionButtons = (proc: ProcessInfo) => (
    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100">
      {isLocal && (
      <button
        onClick={(e) => {
          e.stopPropagation();
          doRenice(proc, 1);
        }}
        title="Lower priority (nice +1)"
        className="rounded px-1.5 py-0.5 text-xs text-ink-muted hover:bg-white/10 hover:text-ink-primary"
      >
        −
      </button>
      )}
      {isLocal && (
      <button
        onClick={(e) => {
          e.stopPropagation();
          doRenice(proc, -1);
        }}
        title="Raise priority (nice −1, needs root)"
        className="rounded px-1.5 py-0.5 text-xs text-ink-muted hover:bg-white/10 hover:text-ink-primary"
      >
        +
      </button>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setConfirmKill(proc);
        }}
        className="rounded px-2 py-0.5 text-xs text-status-critical hover:bg-status-critical/15"
      >
        End
      </button>
    </div>
  );

  const leafRow = (proc: ProcessInfo, indented: boolean) => (
    <tr
      key={proc.pid}
      onClick={() => isLocal && setDetail(proc)}
      className={`group border-t border-border text-ink-secondary hover:bg-white/5 ${
        isLocal ? "cursor-pointer" : ""
      }`}
    >
      <td className="max-w-0 truncate px-3 py-1.5 text-ink-primary" title={proc.cmd}>
        <span className={indented ? "pl-9" : "pl-5"}>
          {proc.name}
          <span className="pl-2 text-xs text-ink-muted">{proc.pid}</span>
        </span>
      </td>
      <td className="px-3 py-1.5 text-xs">{proc.user}</td>
      {heatCells(proc.cpu_pct, proc.mem_bytes, diskRate(proc)).map((c) => (
        <td
          key={c.key}
          className="px-3 py-1.5 text-right"
          style={c.bg ? { backgroundColor: c.bg } : undefined}
        >
          {c.text}
        </td>
      ))}
      <td className="px-3 py-1.5">{actionButtons(proc)}</td>
    </tr>
  );

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-ink-primary">Processes</h1>
          <HostSwitcher />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setGrouped((g) => !g)}
            title="Group processes with the same name"
            className={`inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm transition-colors ${
              grouped
                ? "bg-series-1/15 text-series-1"
                : "text-ink-secondary hover:text-ink-primary"
            }`}
          >
            <Layers size={13} /> Group
          </button>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or command…"
            className="w-64 rounded-md border border-border bg-page px-3 py-1.5 text-sm text-ink-primary placeholder:text-ink-muted focus:border-series-1 focus:outline-none"
          />
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-status-critical/40 bg-status-critical/10 px-3 py-2 text-sm text-status-critical">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-surface">
        {loading ? (
          <LoadingState label="Loading processes…" />
        ) : groups.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="No processes match"
            hint={search ? `Nothing matches “${search}”.` : undefined}
            className="m-4 border-0"
          />
        ) : (
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="text-left text-[10px] uppercase tracking-wider text-ink-muted">
              <th
                onClick={() => onHeaderClick("name")}
                className="cursor-pointer select-none px-3 pb-2 pt-3 align-bottom font-medium hover:text-ink-primary"
              >
                Name{arrow("name")}
              </th>
              <th
                onClick={() => onHeaderClick("user")}
                className="w-24 cursor-pointer select-none px-3 pb-2 pt-3 align-bottom font-medium hover:text-ink-primary"
              >
                User{arrow("user")}
              </th>
              {(
                [
                  ["cpu", formatPercent(totals.cpu), "CPU", "w-24"],
                  ["mem", formatPercent(totals.memPct), "Memory", "w-28"],
                  ["disk", formatBytesPerSec(totals.disk), "Disk", "w-32"],
                ] as const
              ).map(([key, total, label, width]) => (
                <th
                  key={key}
                  onClick={() => onHeaderClick(key)}
                  className={`${width} cursor-pointer select-none border-l border-border px-3 pb-2 pt-2 text-right font-medium hover:text-ink-primary`}
                >
                  <div className="text-sm font-semibold text-ink-secondary">
                    {total}
                  </div>
                  {label}
                  {arrow(key)}
                </th>
              ))}
              <th className="w-24 px-3 pb-2 pt-3" />
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {groups.map((g) => {
              if (g.procs.length === 1) return leafRow(g.procs[0], false);
              const isOpen = expanded.has(g.name);
              return (
                <Fragment key={g.name}>
                  <tr
                    onClick={() => toggleExpand(g.name)}
                    className="cursor-pointer border-t border-border text-ink-secondary hover:bg-white/5"
                  >
                    <td className="max-w-0 truncate px-3 py-1.5 text-ink-primary">
                      <span className="inline-flex items-center gap-1.5">
                        {isOpen ? (
                          <ChevronDown size={13} className="shrink-0 text-ink-muted" />
                        ) : (
                          <ChevronRight size={13} className="shrink-0 text-ink-muted" />
                        )}
                        {g.name}
                        <span className="text-xs text-ink-muted">
                          ({g.procs.length})
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-xs">{g.procs[0].user}</td>
                    {heatCells(g.cpu, g.mem, g.disk).map((c) => (
                      <td
                        key={c.key}
                        className="px-3 py-1.5 text-right"
                        style={c.bg ? { backgroundColor: c.bg } : undefined}
                      >
                        {c.text}
                      </td>
                    ))}
                    <td className="px-3 py-1.5" />
                  </tr>
                  {isOpen && g.procs.map((p) => leafRow(p, true))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        )}
      </div>

      {detail && (
        <Drawer
          title={`${detail.name} · PID ${detail.pid}`}
          onClose={() => setDetail(null)}
        >
          <ProcessDetailPanel
            proc={detail}
            onKill={() => setConfirmKill(detail)}
          />
        </Drawer>
      )}

      {confirmKill && (
        <Modal
          title={`End ${confirmKill.name} (PID ${confirmKill.pid})?`}
          onClose={() => setConfirmKill(null)}
        >
            <p className="break-all text-xs text-ink-muted">
              {confirmKill.cmd || confirmKill.name}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmKill(null)}
                className="rounded-md px-3 py-1.5 text-sm text-ink-secondary hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={() => doKill(confirmKill, true)}
                className="rounded-md px-3 py-1.5 text-sm text-status-critical hover:bg-status-critical/15"
              >
                Force kill
              </button>
              <button
                onClick={() => doKill(confirmKill, false)}
                className="rounded-md bg-status-critical px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
              >
                Terminate
              </button>
            </div>
        </Modal>
      )}
    </div>
  );
}

function ProcessDetailPanel({
  proc,
  onKill,
}: {
  proc: ProcessInfo;
  onKill: () => void;
}) {
  const [detail, setDetail] = useState<ProcessDetail | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setGone(false);
    const load = () =>
      getProcessDetail(proc.pid)
        .then((d) => {
          if (!cancelled) setDetail(d);
        })
        .catch(() => {
          if (!cancelled) setGone(true);
        });
    load();
    const id = setInterval(load, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [proc.pid]);

  if (gone) {
    return <p className="text-sm text-ink-muted">Process exited.</p>;
  }
  if (!detail) {
    return <LoadingState label="Reading /proc…" />;
  }

  const facts: [string, string][] = [
    ["User", proc.user],
    ["Status", proc.status],
    ["Nice", String(proc.nice)],
    ["Threads", detail.threads !== null ? String(detail.threads) : "—"],
    [
      "Open fds",
      detail.open_fds !== null ? String(detail.open_fds) : "not readable (needs root)",
    ],
    ["Memory (RSS)", detail.vm_rss_kb !== null ? formatKb(detail.vm_rss_kb) : "—"],
    ["Swap", detail.vm_swap_kb !== null ? formatKb(detail.vm_swap_kb) : "—"],
  ];
  const paths: [string, string][] = [
    ["Executable", detail.exe ?? "not readable"],
    ["Working dir", detail.cwd ?? "not readable"],
    ["Cgroup", detail.cgroup ?? "—"],
  ];

  return (
    <div className="flex flex-col gap-4 text-sm">
      <section>
        <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-muted">
          Command
        </h3>
        <p className="break-all rounded-md bg-black/25 px-2.5 py-2 font-mono text-xs text-ink-secondary">
          {detail.cmdline.join(" ")}
        </p>
      </section>

      <section>
        <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-muted">
          Overview
        </h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-ink-muted">{label}</dt>
              <dd className="tabular-nums text-ink-secondary">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-muted">
          Paths
        </h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          {paths.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-ink-muted">{label}</dt>
              <dd className="break-all text-ink-secondary">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-muted">
          Sockets
        </h3>
        {detail.sockets.length === 0 ? (
          <p className="text-xs text-ink-muted">
            {detail.open_fds === null
              ? "Not readable (needs root)."
              : "No open sockets."}
          </p>
        ) : (
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-ink-muted">
                <th className="pb-1 font-medium">Proto</th>
                <th className="pb-1 font-medium">Local</th>
                <th className="pb-1 font-medium">Remote</th>
                <th className="pb-1 font-medium">State</th>
              </tr>
            </thead>
            <tbody>
              {detail.sockets.map((s, i) => (
                <tr key={i} className="border-t border-border text-ink-secondary">
                  <td className="py-1 pr-2">{s.proto}</td>
                  <td className="break-all py-1 pr-2">{s.local}</td>
                  <td className="break-all py-1 pr-2">{s.remote}</td>
                  <td className="py-1">{s.state}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-muted">
          Open files{detail.open_fds !== null ? ` (sample of ${detail.open_fds})` : ""}
        </h3>
        {detail.fd_sample.length === 0 ? (
          <p className="text-xs text-ink-muted">
            {detail.open_fds === null ? "Not readable (needs root)." : "None."}
          </p>
        ) : (
          <ul className="space-y-0.5 text-xs text-ink-secondary">
            {detail.fd_sample.map((f) => (
              <li key={f} className="break-all">
                {f}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="border-t border-border pt-3">
        <button
          onClick={onKill}
          className="rounded-md bg-status-critical/15 px-3 py-1.5 text-sm font-medium text-status-critical hover:bg-status-critical/25"
        >
          End process
        </button>
      </div>
    </div>
  );
}
