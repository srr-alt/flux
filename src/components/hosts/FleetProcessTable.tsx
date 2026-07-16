import { useCallback, useEffect, useMemo, useState } from "react";
import { SegmentedControl } from "../ui/SegmentedControl";
import { formatBytes, formatPercent } from "../../lib/format";
import { listProcesses, listRemoteProcesses } from "../../lib/tauri";
import { LOCAL_HOST_ID } from "../../state/hostsStore";
import type { ProcessInfo } from "../../types/monitor";

interface FleetProcess extends ProcessInfo {
  hostId: string;
  hostName: string;
}

interface FleetProcessTableProps {
  /** Connected remotes to poll; local is always included. */
  remotes: { id: string; name: string }[];
  localName: string;
  onOpenHost: (hostId: string) => void;
}

type SortKey = "cpu" | "mem";

const TOP_PER_HOST = 15;
const TOP_TOTAL = 20;
const POLL_MS = 3000;

/** Cross-host top-processes table: merges per-host top-N lists so the
 * heaviest consumers surface regardless of which box they run on. Remote
 * fetches piggyback on each host's poller SSH session. */
export function FleetProcessTable({
  remotes,
  localName,
  onOpenHost,
}: FleetProcessTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("cpu");
  const [rows, setRows] = useState<FleetProcess[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Remotes as a stable key so the poll effect doesn't restart every render.
  const remoteKey = remotes.map((r) => r.id).join(",");

  const refresh = useCallback(async () => {
    const query = {
      sort_by: sortKey,
      sort_desc: true,
      search: null,
      limit: TOP_PER_HOST,
    };
    const tag = (list: ProcessInfo[], hostId: string, hostName: string) =>
      list.map((p) => ({ ...p, hostId, hostName }));
    const jobs: Promise<FleetProcess[]>[] = [
      listProcesses(query).then((l) => tag(l, LOCAL_HOST_ID, localName)),
      ...remotes.map((r) =>
        listRemoteProcesses(r.id, query).then((l) => tag(l, r.id, r.name)),
      ),
    ];
    const results = await Promise.allSettled(jobs);
    const merged = results
      .filter(
        (r): r is PromiseFulfilledResult<FleetProcess[]> =>
          r.status === "fulfilled",
      )
      .flatMap((r) => r.value);
    merged.sort((a, b) =>
      sortKey === "cpu" ? b.cpu_pct - a.cpu_pct : b.mem_bytes - a.mem_bytes,
    );
    setRows(merged.slice(0, TOP_TOTAL));
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortKey, remoteKey, localName]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const showHostColumn = useMemo(() => remotes.length > 0, [remotes.length]);

  return (
    <div className="glass rounded-2xl border border-border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink-primary">
          Top processes across fleet
        </h2>
        <SegmentedControl
          size="sm"
          options={[
            { value: "cpu", label: "CPU" },
            { value: "mem", label: "Memory" },
          ]}
          value={sortKey}
          onChange={(v) => setSortKey(v)}
        />
      </div>
      {rows.length === 0 ? (
        <p className="py-3 text-sm text-ink-muted">
          {loaded ? "No process data yet." : "Collecting…"}
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-ink-muted">
              <th className="pb-1.5 font-medium">Process</th>
              {showHostColumn && <th className="pb-1.5 font-medium">Host</th>}
              <th className="w-16 pb-1.5 text-right font-medium">PID</th>
              <th className="w-24 pb-1.5 font-medium">User</th>
              <th className="w-20 pb-1.5 text-right font-medium">CPU</th>
              <th className="w-24 pb-1.5 text-right font-medium">Memory</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((p) => (
              <tr
                key={`${p.hostId}:${p.pid}`}
                className="cursor-pointer border-t border-border text-ink-secondary hover:bg-white/[0.03]"
                onClick={() => onOpenHost(p.hostId)}
                title={p.cmd || p.name}
              >
                <td className="max-w-0 truncate py-1.5 text-ink-primary">
                  {p.name}
                </td>
                {showHostColumn && (
                  <td className="max-w-32 truncate py-1.5 pr-2 text-xs">
                    {p.hostName}
                  </td>
                )}
                <td className="py-1.5 text-right">{p.pid}</td>
                <td className="max-w-24 truncate py-1.5 text-xs">{p.user}</td>
                <td className="py-1.5 text-right">
                  {formatPercent(p.cpu_pct)}
                </td>
                <td className="py-1.5 text-right">
                  {formatBytes(p.mem_bytes)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
