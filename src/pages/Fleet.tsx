import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { AddHostWizard } from "../components/hosts/AddHostWizard";
import { HostTile } from "../components/hosts/HostTile";
import { InstallDebModal } from "../components/hosts/InstallDebModal";
import type { PageId } from "../config/navigation";
import type { DeployProgress } from "../types/hosts";
import { deployAgent, listHosts, onDeployProgress, removeHost } from "../lib/tauri";
import { emptySeries, useFleetStore } from "../state/fleetStore";
import { LOCAL_HOST_ID, useHostsStore } from "../state/hostsStore";
import { useMonitorStore } from "../state/monitorStore";

interface FleetProps {
  onNavigate?: (page: PageId) => void;
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

  const localSeries = {
    ...emptySeries(),
    latest: localLatest,
    disks: localDisks,
    timestamps: localTimestamps,
    cpuHistory: localCpu,
    memUsedPctHistory: localMem,
  };

  return (
    <div className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-ink-primary">Fleet</h1>
          <p className="text-xs text-ink-muted">
            {hosts.length + 1} system{hosts.length === 0 ? "" : "s"} — click a
            tile to inspect
          </p>
        </div>
        <button
          className="flex items-center gap-1.5 rounded bg-series-1/20 px-3 py-1.5 text-sm text-series-1 hover:bg-series-1/30"
          onClick={() => setWizardOpen(true)}
        >
          <Plus size={14} /> Add host
        </button>
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
