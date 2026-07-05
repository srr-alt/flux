import { Activity, MemoryStick, Network, Plus, Server, TerminalSquare } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AddHostWizard } from "../components/hosts/AddHostWizard";
import { HostTile } from "../components/hosts/HostTile";
import { InstallDebModal } from "../components/hosts/InstallDebModal";
import type { PageId } from "../config/navigation";
import type { DeployProgress } from "../types/hosts";
import { formatBytesPerSec, formatKb } from "../lib/format";
import { deployAgent, listHosts, onDeployProgress, removeHost } from "../lib/tauri";
import { emptySeries, useFleetStore, type HostSeries } from "../state/fleetStore";
import { LOCAL_HOST_ID, useHostsStore } from "../state/hostsStore";
import { useMonitorStore } from "../state/monitorStore";

interface FleetProps {
  onNavigate?: (page: PageId) => void;
}

function StatChip({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2">
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-white/5">
        <Icon size={13} className="text-ink-secondary" />
      </span>
      <div className="leading-tight">
        <div className="text-sm font-semibold tabular-nums text-ink-primary">
          {value}
        </div>
        <div className="text-[10px] uppercase tracking-wide text-ink-muted">
          {label}
        </div>
      </div>
    </div>
  );
}

export function Fleet({ onNavigate }: FleetProps) {
  const hosts = useHostsStore((s) => s.hosts);
  const statuses = useHostsStore((s) => s.statuses);
  const systemInfos = useHostsStore((s) => s.systemInfos);
  const setSelected = useHostsStore((s) => s.setSelected);
  const byHost = useFleetStore((s) => s.byHost);
  const localInfo = useMonitorStore((s) => s.systemInfo);
  const localLatest = useMonitorStore((s) => s.latest);
  const localDisks = useMonitorStore((s) => s.disks);
  const localTimestamps = useMonitorStore((s) => s.timestamps);
  const localCpu = useMonitorStore((s) => s.cpuHistory);
  const localMem = useMonitorStore((s) => s.memUsedPctHistory);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [installTarget, setInstallTarget] = useState<{ id: string; name: string } | null>(null);
  const [deploying, setDeploying] = useState<Record<string, string>>({});

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onDeployProgress((p: DeployProgress) => {
      setDeploying((prev) => {
        const next = { ...prev };
        if (p.done) {
          if (p.error) next[p.host_id] = `failed: ${p.error}`;
          else delete next[p.host_id];
        } else {
          next[p.host_id] = p.line ? `${p.step}: ${p.line}` : `${p.step}…`;
        }
        return next;
      });
    }).then((fn) => (unlisten = fn));
    return () => unlisten?.();
  }, []);

  const open = (hostId: string) => {
    setSelected(hostId);
    onNavigate?.("performance");
  };

  const localSeries: HostSeries = {
    ...emptySeries(),
    latest: localLatest,
    disks: localDisks,
    timestamps: localTimestamps,
    cpuHistory: localCpu,
    memUsedPctHistory: localMem,
  };

  // Fleet-wide aggregates over the local machine + every connected remote.
  const totals = useMemo(() => {
    const online: HostSeries[] = [localSeries];
    for (const host of hosts) {
      if (statuses[host.id]?.state === "connected" && byHost[host.id]) {
        online.push(byHost[host.id]);
      }
    }
    let cpuSum = 0;
    let cpuCount = 0;
    let memUsedKb = 0;
    let netDown = 0;
    let netUp = 0;
    for (const series of online) {
      const tick = series.latest;
      if (!tick) continue;
      cpuSum += tick.cpu.global_usage_pct;
      cpuCount += 1;
      memUsedKb += tick.memory.total_kb - tick.memory.available_kb;
      for (const iface of tick.network) {
        netDown += iface.rx_bytes_per_sec;
        netUp += iface.tx_bytes_per_sec;
      }
    }
    return {
      online: online.length,
      total: hosts.length + 1,
      cpuAvg: cpuCount > 0 ? cpuSum / cpuCount : 0,
      memUsedKb,
      netDown,
      netUp,
    };
  }, [hosts, statuses, byHost, localSeries.latest]);

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink-primary">Fleet</h1>
          <p className="text-xs text-ink-muted">
            One dashboard for every machine — click a tile to inspect
          </p>
        </div>
        <button
          className="flex items-center gap-1.5 rounded-md bg-series-1/20 px-3 py-1.5 text-sm font-medium text-series-1 hover:bg-series-1/30"
          onClick={() => setWizardOpen(true)}
        >
          <Plus size={14} /> Add host
        </button>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatChip
          icon={Server}
          label="systems online"
          value={`${totals.online} / ${totals.total}`}
        />
        <StatChip
          icon={Activity}
          label="avg cpu"
          value={`${totals.cpuAvg.toFixed(0)}%`}
        />
        <StatChip
          icon={MemoryStick}
          label="memory in use"
          value={formatKb(totals.memUsedKb)}
        />
        <StatChip
          icon={Network}
          label="fleet traffic"
          value={`↓${formatBytesPerSec(totals.netDown)} ↑${formatBytesPerSec(totals.netUp)}`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <HostTile
          name={localInfo?.hostname ?? "This machine"}
          isLocal
          status={undefined}
          systemInfo={localInfo}
          series={localSeries}
          onOpen={() => open(LOCAL_HOST_ID)}
        />
        {hosts.map((host) => (
          <HostTile
            key={host.id}
            name={host.name}
            status={statuses[host.id]}
            systemInfo={systemInfos[host.id] ?? null}
            series={byHost[host.id] ?? emptySeries()}
            onOpen={() => open(host.id)}
            busyText={deploying[host.id]}
            onDeployAgent={() => {
              setDeploying((prev) => ({ ...prev, [host.id]: "deploying agent…" }));
              deployAgent(host.id).catch(() => {});
            }}
            onInstallDeb={() => setInstallTarget({ id: host.id, name: host.name })}
            onRemove={async () => {
              await removeHost(host.id);
              useFleetStore.getState().dropHost(host.id);
              useHostsStore.getState().removeHost(host.id);
              useHostsStore.getState().setHosts(await listHosts());
            }}
          />
        ))}

        {hosts.length === 0 && (
          <div className="flex flex-col justify-center gap-2 rounded-xl border border-dashed border-border p-5 text-sm text-ink-muted">
            <span className="font-medium text-ink-secondary">
              No remote systems yet
            </span>
            <span className="text-xs leading-relaxed">
              Add any Linux machine with SSH — monitoring starts instantly, no
              install needed. Scripts can register hosts too:
            </span>
            <span className="flex items-center gap-1.5 rounded-md bg-black/25 px-2 py-1.5 font-mono text-[10px] text-ink-secondary">
              <TerminalSquare size={11} className="shrink-0" />
              POST 127.0.0.1:7869/api/hosts
            </span>
            <button
              className="mt-1 w-max rounded-md bg-series-1/20 px-3 py-1.5 text-xs font-medium text-series-1 hover:bg-series-1/30"
              onClick={() => setWizardOpen(true)}
            >
              Add your first host
            </button>
          </div>
        )}
      </div>

      {wizardOpen && <AddHostWizard onClose={() => setWizardOpen(false)} />}
      {installTarget && (
        <InstallDebModal
          hostId={installTarget.id}
          hostName={installTarget.name}
          onClose={() => setInstallTarget(null)}
        />
      )}
    </div>
  );
}
