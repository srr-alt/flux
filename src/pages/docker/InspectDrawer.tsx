import { useEffect, useState } from "react";
import { inspectContainer } from "../../lib/tauri";
import { AreaChart } from "../../components/charts/AreaChart";
import { Button } from "../../components/ui/Button";
import { Drawer } from "../../components/ui/Drawer";
import { LoadingState } from "../../components/ui/LoadingState";
import { chartColors } from "../../lib/theme";
import { useDockerStore } from "../../state/dockerStore";
import type { ContainerDetail, ContainerInfo } from "../../types/monitor";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted">
        {title}
      </h3>
      {children}
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 py-0.5 text-sm">
      <span className="w-28 shrink-0 text-ink-muted">{label}</span>
      <span className="break-all text-ink-secondary">{value || "—"}</span>
    </div>
  );
}

function Mono({ text }: { text: string }) {
  return (
    <pre className="whitespace-pre-wrap break-all rounded-md bg-black/25 p-2.5 font-mono text-[11px] leading-relaxed text-ink-secondary">
      {text}
    </pre>
  );
}

export function InspectDrawer({
  container,
  onClose,
  onShell,
}: {
  container: ContainerInfo;
  onClose: () => void;
  onShell?: () => void;
}) {
  const [detail, setDetail] = useState<ContainerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showEnv, setShowEnv] = useState(false);
  const stats = useDockerStore((s) => s.latest[container.id]);
  const cpuValues = useDockerStore((s) => s.cpuHistory[container.id]);
  const memValues = useDockerStore((s) => s.memHistory[container.id]);
  const statsTimestamps = useDockerStore((s) => s.statsTimestamps);
  const chartReady = (cpuValues?.filter((v) => v !== null).length ?? 0) >= 2;

  useEffect(() => {
    inspectContainer(container.id)
      .then(setDetail)
      .catch((e) => setError(String(e)));
  }, [container.id]);

  return (
    <Drawer title={`Inspect · ${container.name}`} onClose={onClose}>
      {error ? (
        <p className="text-sm text-status-critical">{error}</p>
      ) : detail === null ? (
        <LoadingState label="Inspecting…" />
      ) : (
        <>
          {container.state === "running" && onShell && (
            <Button size="sm" onClick={onShell} className="mb-4">
              Open shell
            </Button>
          )}
          <Section title="Overview">
            <KV label="Image" value={detail.image} />
            <KV label="Status" value={container.status} />
            <KV label="Created" value={detail.created.replace("T", " ").slice(0, 19)} />
            <KV label="Restart policy" value={detail.restart_policy || "no"} />
            <KV label="ID" value={detail.id.slice(0, 24)} />
          </Section>

          {stats && (
            <Section title="Live usage">
              <div className="mb-2 grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-ink-muted">CPU</div>
                  <div className="mt-0.5 text-lg font-semibold tabular-nums text-ink-primary">
                    {stats.cpu_pct.toFixed(1)}%
                  </div>
                </div>
                <div>
                  <div className="text-xs text-ink-muted">Memory</div>
                  <div className="mt-0.5 text-lg font-semibold tabular-nums text-ink-primary">
                    {stats.mem_usage.split(" / ")[0]}
                    <span className="ml-1.5 text-xs font-normal text-ink-muted">
                      {stats.mem_pct.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
              {chartReady && cpuValues && memValues ? (
                <div className="mb-2">
                  <AreaChart
                    timestamps={statsTimestamps}
                    series={[
                      { values: cpuValues, color: chartColors.cpu, label: "CPU" },
                      { values: memValues, color: chartColors.memory, label: "Memory" },
                    ]}
                    height={150}
                    formatValue={(v) => `${v.toFixed(1)}%`}
                  />
                </div>
              ) : (
                <p className="mb-2 text-xs text-ink-muted">
                  Collecting history… chart appears after a couple of samples.
                </p>
              )}
              <KV label="Network I/O" value={stats.net_io} />
              <KV label="Block I/O" value={stats.block_io} />
              <KV label="PIDs" value={String(stats.pids)} />
            </Section>
          )}

          {(detail.entrypoint.length > 0 || detail.cmd.length > 0) && (
            <Section title="Command">
              <Mono text={[...detail.entrypoint, ...detail.cmd].join(" ")} />
            </Section>
          )}

          {detail.ports.length > 0 && (
            <Section title="Ports">
              {detail.ports.map((p, i) => (
                <KV
                  key={i}
                  label={p.container_port}
                  value={p.host || "not published"}
                />
              ))}
            </Section>
          )}

          {detail.networks.length > 0 && (
            <Section title="Networks">
              {detail.networks.map(([name, ip]) => (
                <KV key={name} label={name} value={ip || "no IP"} />
              ))}
            </Section>
          )}

          {detail.mounts.length > 0 && (
            <Section title="Mounts">
              {detail.mounts.map((m, i) => (
                <div key={i} className="mb-1.5 rounded-md bg-white/5 px-2.5 py-1.5 text-xs">
                  <div className="break-all font-medium text-ink-primary">
                    {m.destination}
                    <span className="ml-2 font-normal text-ink-muted">
                      {m.kind}
                      {m.rw ? "" : " · read-only"}
                    </span>
                  </div>
                  <div className="break-all text-ink-muted">{m.source}</div>
                </div>
              ))}
            </Section>
          )}

          {detail.env.length > 0 && (
            <Section title={`Environment (${detail.env.length})`}>
              {showEnv ? (
                <Mono text={detail.env.join("\n")} />
              ) : (
                <button
                  onClick={() => setShowEnv(true)}
                  className="rounded px-2 py-1 text-xs text-ink-muted hover:bg-white/10 hover:text-ink-primary"
                >
                  Show {detail.env.length} variables
                </button>
              )}
            </Section>
          )}
        </>
      )}
    </Drawer>
  );
}
