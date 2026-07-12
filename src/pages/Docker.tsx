import { useCallback, useEffect, useRef, useState } from "react";
import { containerStats, dockerDiskUsage, dockerPrune } from "../lib/tauri";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { ScreenHeader } from "../components/layout/ScreenHeader";
import { useSelectedHostName } from "../hooks/useSelectedHostName";
import { useDockerStore } from "../state/dockerStore";
import type { DiskUsageRow } from "../types/monitor";
import { Compose } from "./docker/Compose";
import { Containers } from "./docker/Containers";
import { Images } from "./docker/Images";
import { Networks } from "./docker/Networks";
import { RunDialog } from "./docker/RunDialog";
import { Volumes } from "./docker/Volumes";

const TABS = ["Containers", "Images", "Volumes", "Networks", "Compose"] as const;
type Tab = (typeof TABS)[number];

const PRUNE_TARGETS: { id: string; label: string; detail: string }[] = [
  { id: "system", label: "System", detail: "stopped containers, unused networks, dangling images, build cache" },
  { id: "images", label: "Images", detail: "all images not used by a container" },
  { id: "volumes", label: "Volumes", detail: "all volumes not used by a container — deletes their data" },
  { id: "builder", label: "Build cache", detail: "all build cache" },
];

const STATS_POLL_MS = 5000;

/** docker system df sizes: "22.05GB (76%)", "8.192kB", "0B" — decimal units. */
function parseDockerSize(s: string): number {
  const m = /^([\d.]+)\s*(B|kB|MB|GB|TB)/.exec(s.trim());
  if (!m) return 0;
  const mult = { B: 1, kB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 }[m[2] as "B"];
  return parseFloat(m[1]) * mult;
}

function formatDockerSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} kB`;
  return `${bytes.toFixed(0)} B`;
}

/** Design strip: Images / Containers / Volumes sizes + one amber
 * "Reclaimable … — prune" segment folding in every row's reclaimable. */
function usageSegments(usage: DiskUsageRow[]) {
  const LABELS: Record<string, string> = {
    Images: "Images",
    Containers: "Containers",
    "Local Volumes": "Volumes",
  };
  const segments = usage
    .filter((u) => LABELS[u.kind])
    .map((u) => ({ label: LABELS[u.kind], value: u.size, prune: false }));
  const reclaimable = usage.reduce((sum, u) => sum + parseDockerSize(u.reclaimable), 0);
  segments.push({
    label: "Reclaimable",
    value: reclaimable > 0 ? `${formatDockerSize(reclaimable)} — prune` : "0 B",
    prune: reclaimable > 0,
  });
  return segments;
}

export function Docker() {
  const [tab, setTab] = useState<Tab>("Containers");
  const hostName = useSelectedHostName();
  // Bumped after any mutation so sibling tabs and the usage strip refetch.
  const [refreshToken, setRefreshToken] = useState(0);
  const bump = useCallback(() => setRefreshToken((n) => n + 1), []);

  const [usage, setUsage] = useState<DiskUsageRow[]>([]);
  const [runOpen, setRunOpen] = useState(false);
  const [pruneOpen, setPruneOpen] = useState(false);
  const [pruning, setPruning] = useState<string | null>(null);
  const [pruneResult, setPruneResult] = useState<string | null>(null);
  const pushStats = useDockerStore((s) => s.pushStats);

  useEffect(() => {
    dockerDiskUsage()
      .then(setUsage)
      .catch(() => setUsage([]));
  }, [refreshToken]);

  // Stats history poll: lives in the shell so it keeps running while the
  // user is on other subtabs. Self-scheduling timeout — docker stats blocks
  // ~1s collecting deltas, so intervals could overlap.
  const pollTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      containerStats()
        .then((all) => {
          if (!cancelled) pushStats(all);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) pollTimer.current = setTimeout(tick, STATS_POLL_MS);
        });
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(pollTimer.current);
    };
  }, [pushStats]);

  const prune = async (target: string) => {
    setPruning(target);
    setPruneResult(null);
    try {
      setPruneResult(await dockerPrune(target));
      bump();
    } catch (e) {
      setPruneResult(String(e));
    } finally {
      setPruning(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Docker" sub={hostName} />
      <div className="flex min-h-0 flex-1 flex-col p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          size="sm"
          options={TABS.map((t) => ({ value: t, label: t }))}
          value={tab}
          onChange={setTab}
        />
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" onClick={() => setRunOpen(true)}>
            Run container
          </Button>
          <Button
            size="sm"
            onClick={() => setPruneOpen(true)}
            className="hover:border-status-critical/40 hover:bg-status-critical/10 hover:text-status-critical"
          >
            Prune
          </Button>
        </div>
      </div>

      {usage.length > 0 && (
        <div className="glass mb-4 flex items-center overflow-x-auto rounded-2xl border border-border px-4 py-3">
          {usageSegments(usage).map((seg) => (
            <button
              key={seg.label}
              onClick={() => seg.prune && setPruneOpen(true)}
              title={seg.prune ? "Prune unused resources…" : undefined}
              className={`flex flex-1 items-center gap-2 whitespace-nowrap px-1 text-left ${
                seg.prune ? "cursor-pointer" : "cursor-default"
              }`}
            >
              <span
                className={`h-[7px] w-[7px] shrink-0 rounded-sm ${
                  seg.prune ? "bg-status-warning" : "bg-ink-faint"
                }`}
              />
              <span className="text-[11px] text-ink-muted">{seg.label}</span>
              <span
                className={`font-mono text-xs font-semibold ${
                  seg.prune ? "text-status-warning" : "text-ink-secondary"
                }`}
              >
                {seg.value}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {tab === "Containers" && <Containers refreshToken={refreshToken} />}
        {tab === "Images" && <Images refreshToken={refreshToken} onChanged={bump} />}
        {tab === "Volumes" && <Volumes refreshToken={refreshToken} onChanged={bump} />}
        {tab === "Networks" && <Networks refreshToken={refreshToken} onChanged={bump} />}
        {tab === "Compose" && <Compose refreshToken={refreshToken} onChanged={bump} />}
      </div>

      {runOpen && (
        <RunDialog initialImage="" onDone={bump} onClose={() => setRunOpen(false)} />
      )}

      {pruneOpen && (
        <Modal
          title="Prune Docker resources"
          onClose={() => {
            if (!pruning) {
              setPruneOpen(false);
              setPruneResult(null);
            }
          }}
        >
          <p className="mb-3 text-sm text-ink-secondary">
            Frees disk space by removing unused resources. This cannot be
            undone.
          </p>
          <div className="space-y-2">
            {PRUNE_TARGETS.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <div>
                  <div className="text-sm font-medium text-ink-primary">{t.label}</div>
                  <div className="text-xs text-ink-muted">{t.detail}</div>
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => prune(t.id)}
                  disabled={pruning !== null}
                  loading={pruning === t.id}
                  className="shrink-0"
                >
                  Prune
                </Button>
              </div>
            ))}
          </div>
          {pruneResult && (
            <p className="mt-3 text-sm text-ink-secondary">{pruneResult}</p>
          )}
        </Modal>
      )}
      </div>
    </div>
  );
}
