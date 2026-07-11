import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Trash2 } from "lucide-react";
import { containerStats, dockerDiskUsage, dockerPrune } from "../lib/tauri";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { SegmentedControl } from "../components/ui/SegmentedControl";
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

export function Docker() {
  const [tab, setTab] = useState<Tab>("Containers");
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
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-4">
          <h1 className="text-lg font-semibold text-ink-primary">Docker</h1>
          <SegmentedControl
            size="sm"
            options={TABS.map((t) => ({ value: t, label: t }))}
            value={tab}
            onChange={setTab}
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="primary" size="sm" onClick={() => setRunOpen(true)}>
            <Play size={12} />
            Run container
          </Button>
          <Button
            size="sm"
            onClick={() => setPruneOpen(true)}
            className="hover:border-status-critical/40 hover:bg-status-critical/10 hover:text-status-critical"
          >
            <Trash2 size={12} />
            Prune
          </Button>
        </div>
      </div>

      {usage.length > 0 && (
        <div className="mb-4 inline-flex w-fit max-w-full overflow-x-auto rounded-xl border border-border bg-surface">
          {usage.map((u, i) => {
            const reclaimable =
              u.reclaimable && !u.reclaimable.startsWith("0B") ? u.reclaimable : null;
            const inner = (
              <>
                <div className="text-[10px] uppercase tracking-wide text-ink-muted">
                  {u.kind}
                  <span className="ml-1.5 normal-case tracking-normal">
                    {u.active}/{u.total} in use
                  </span>
                </div>
                <div className="mt-0.5 text-sm tabular-nums text-ink-primary">
                  {u.size}
                  {reclaimable && (
                    <span className="ml-1.5 text-xs text-status-warning">
                      {reclaimable} reclaimable
                    </span>
                  )}
                </div>
              </>
            );
            const border = i > 0 ? "border-l border-border" : "";
            return reclaimable ? (
              <button
                key={u.kind}
                onClick={() => setPruneOpen(true)}
                title={`Prune ${u.kind.toLowerCase()}…`}
                className={`px-4 py-2 text-left hover:bg-white/5 ${border}`}
              >
                {inner}
              </button>
            ) : (
              <div key={u.kind} className={`px-4 py-2 ${border}`}>
                {inner}
              </div>
            );
          })}
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
  );
}
