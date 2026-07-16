import { Plus, TerminalSquare } from "lucide-react";
import { ScreenHeader } from "../components/layout/ScreenHeader";
import { useEffect, useMemo, useState } from "react";
import { AddHostWizard } from "../components/hosts/AddHostWizard";
import { FleetProcessTable } from "../components/hosts/FleetProcessTable";
import { HostTile } from "../components/hosts/HostTile";
import { InstallDebModal } from "../components/hosts/InstallDebModal";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Modal } from "../components/ui/Modal";
import type { PageId } from "../config/navigation";
import type {
  DeployProgress,
  ProxmoxAction,
  ProxmoxGuest,
} from "../types/hosts";
import { formatBytesPerSec, formatKb } from "../lib/format";
import {
  deployAgent,
  hostPower,
  listHosts,
  onDeployProgress,
  proxmoxGuestAction,
  removeHost,
  wakeHost,
} from "../lib/tauri";
import { emptySeries, useFleetStore, type HostSeries } from "../state/fleetStore";
import { LOCAL_HOST_ID, useHostsStore } from "../state/hostsStore";
import { useMonitorStore } from "../state/monitorStore";
import { useTerminalStore } from "../state/terminalStore";

interface FleetProps {
  onNavigate?: (page: PageId) => void;
}

function StatChip({
  label,
  value,
  unit,
  tone = "text-ink-primary",
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: string;
}) {
  return (
    <div className="glass rounded-2xl border border-border px-4 py-3">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
        {label}
      </div>
      <div className={`truncate text-[19px] font-bold tabular-nums tracking-tight ${tone}`}>
        {value}
        {unit && <span className="text-xs font-medium text-ink-muted"> {unit}</span>}
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
  const proxmoxByHost = useFleetStore((s) => s.proxmoxByHost);
  const localInfo = useMonitorStore((s) => s.systemInfo);
  const localLatest = useMonitorStore((s) => s.latest);
  const localDisks = useMonitorStore((s) => s.disks);
  const localTimestamps = useMonitorStore((s) => s.timestamps);
  const localCpu = useMonitorStore((s) => s.cpuHistory);
  const localMem = useMonitorStore((s) => s.memUsedPctHistory);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [installTarget, setInstallTarget] = useState<{ id: string; name: string } | null>(null);
  const [deploying, setDeploying] = useState<Record<string, string>>({});
  const [powerTarget, setPowerTarget] = useState<{
    id: string;
    name: string;
    verb: "reboot" | "poweroff";
  } | null>(null);
  const [powerBusy, setPowerBusy] = useState(false);
  const [powerError, setPowerError] = useState<string | null>(null);
  // Proxmox guest shutdown/stop confirm (start fires without asking).
  const [guestTarget, setGuestTarget] = useState<{
    hostId: string;
    guest: ProxmoxGuest;
    action: "shutdown" | "stop";
  } | null>(null);
  const [guestBusy, setGuestBusy] = useState(false);
  const [guestError, setGuestError] = useState<string | null>(null);
  // Wake feedback: keep "Waking…" up long enough for the machine to boot
  // and the poller to reconnect.
  const [waking, setWaking] = useState<Record<string, boolean>>({});

  const wake = (hostId: string) => {
    setWaking((w) => ({ ...w, [hostId]: true }));
    wakeHost(hostId).catch(() => {});
    setTimeout(
      () => setWaking((w) => ({ ...w, [hostId]: false })),
      45_000,
    );
  };

  const guestAction = (hostId: string, guest: ProxmoxGuest, action: ProxmoxAction) => {
    if (action === "start") {
      proxmoxGuestAction(hostId, guest.vmid, guest.kind, "start").catch(() => {});
      return;
    }
    setGuestError(null);
    setGuestTarget({ hostId, guest, action });
  };

  const confirmGuestAction = () => {
    if (!guestTarget) return;
    setGuestBusy(true);
    setGuestError(null);
    proxmoxGuestAction(
      guestTarget.hostId,
      guestTarget.guest.vmid,
      guestTarget.guest.kind,
      guestTarget.action,
    )
      .then(() => setGuestTarget(null))
      .catch((e) => setGuestError(String(e)))
      .finally(() => setGuestBusy(false));
  };

  const confirmPower = () => {
    if (!powerTarget) return;
    setPowerBusy(true);
    setPowerError(null);
    hostPower(powerTarget.id, powerTarget.verb)
      .then(() => setPowerTarget(null))
      .catch((e) => setPowerError(String(e)))
      .finally(() => setPowerBusy(false));
  };

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

  const openProcesses = (hostId: string) => {
    setSelected(hostId);
    onNavigate?.("processes");
  };

  const connectedRemotes = hosts
    .filter((h) => statuses[h.id]?.state === "connected")
    .map((h) => ({ id: h.id, name: h.name }));

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
    <>
      <ScreenHeader
        title="Fleet"
        sub={hosts.length > 0 ? `local + ${hosts.length} remote · ssh` : "local · ssh"}
      />
      <div className="p-5">
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatChip
          label="online"
          value={String(totals.online)}
          unit={`/ ${totals.total}`}
          tone="text-status-good"
        />
        <StatChip
          label="avg cpu"
          value={totals.cpuAvg.toFixed(0)}
          unit="%"
          tone={totals.cpuAvg > 60 ? "text-status-warning" : "text-ink-primary"}
        />
        <StatChip label="memory in use" value={formatKb(totals.memUsedKb)} />
        <StatChip
          label="aggregate traffic"
          value={formatBytesPerSec(totals.netDown + totals.netUp)}
        />
      </div>

      <div className="mb-4 flex items-center">
        <span className="text-xs text-ink-muted">
          {totals.total} machine{totals.total === 1 ? "" : "s"}
        </span>
        <Button variant="primary" className="ml-auto" onClick={() => setWizardOpen(true)}>
          <Plus size={14} /> Add host
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <HostTile
          name={localInfo?.hostname ?? "This machine"}
          isLocal
          status={undefined}
          systemInfo={localInfo}
          series={localSeries}
          onOpen={() => open(LOCAL_HOST_ID)}
          onShell={() => useTerminalStore.getState().open(LOCAL_HOST_ID)}
        />
        {hosts.map((host) => (
          <HostTile
            key={host.id}
            name={host.name}
            status={statuses[host.id]}
            systemInfo={systemInfos[host.id] ?? null}
            series={byHost[host.id] ?? emptySeries()}
            onOpen={() => open(host.id)}
            onShell={() => useTerminalStore.getState().open(host.id)}
            onWake={host.mac ? () => wake(host.id) : undefined}
            wakePending={!!waking[host.id]}
            guests={
              statuses[host.id]?.state === "connected"
                ? proxmoxByHost[host.id]
                : undefined
            }
            onGuestAction={(guest, action) => guestAction(host.id, guest, action)}
            onPower={(verb) =>
              setPowerTarget({ id: host.id, name: host.name, verb })
            }
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
          <EmptyState
            title="No remote systems yet"
            hint={
              <span className="flex flex-col items-center gap-2">
                <span>
                  Add any Linux machine with SSH — monitoring starts instantly,
                  no install needed. Scripts can register hosts too:
                </span>
                <span className="flex items-center gap-1.5 rounded-md bg-black/25 px-2 py-1.5 font-mono text-[10px] text-ink-secondary">
                  <TerminalSquare size={11} className="shrink-0" />
                  POST 127.0.0.1:7869/api/hosts
                </span>
              </span>
            }
            action={
              <Button variant="primary" size="sm" onClick={() => setWizardOpen(true)}>
                Add your first host
              </Button>
            }
          />
        )}
      </div>

      <div className="mt-4">
        <FleetProcessTable
          remotes={connectedRemotes}
          localName={localInfo?.hostname ?? "This machine"}
          onOpenHost={openProcesses}
        />
      </div>

      {hosts.length > 0 && (
        <div className="mt-4 font-mono text-[11px] text-ink-faint/80">
          hosts can also be registered by scripts · POST 127.0.0.1:7869/api/hosts
        </div>
      )}

      {wizardOpen && <AddHostWizard onClose={() => setWizardOpen(false)} />}
      {installTarget && (
        <InstallDebModal
          hostId={installTarget.id}
          hostName={installTarget.name}
          onClose={() => setInstallTarget(null)}
        />
      )}
      {powerTarget && (
        <Modal
          onClose={() => setPowerTarget(null)}
          title={
            powerTarget.verb === "reboot"
              ? `Reboot ${powerTarget.name}?`
              : `Shut down ${powerTarget.name}?`
          }
        >
          <div className="flex w-96 max-w-full flex-col gap-4">
            <p className="text-sm text-ink-secondary">
              {powerTarget.verb === "reboot"
                ? "The machine restarts gracefully via systemctl; monitoring reconnects when it comes back."
                : "The machine powers off gracefully via systemctl. Waking it again needs Wake-on-LAN or the power button."}
            </p>
            {powerError && (
              <p className="text-xs text-status-critical">{powerError}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPowerTarget(null)}>
                Cancel
              </Button>
              <Button variant="danger" loading={powerBusy} onClick={confirmPower}>
                {powerTarget.verb === "reboot" ? "Reboot" : "Shut down"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {guestTarget && (
        <Modal
          onClose={() => setGuestTarget(null)}
          title={
            guestTarget.action === "shutdown"
              ? `Shut down ${guestTarget.guest.name || guestTarget.guest.vmid}?`
              : `Stop ${guestTarget.guest.name || guestTarget.guest.vmid}?`
          }
        >
          <div className="flex w-96 max-w-full flex-col gap-4">
            <p className="text-sm text-ink-secondary">
              {guestTarget.action === "shutdown"
                ? `The ${guestTarget.guest.kind === "qemu" ? "VM" : "container"} shuts down gracefully via its guest OS — this can take a while.`
                : `Hard stop: the ${guestTarget.guest.kind === "qemu" ? "VM is killed like a pulled power cord" : "container is killed immediately"} — unsaved data inside is lost.`}
            </p>
            {guestError && (
              <p className="text-xs text-status-critical">{guestError}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setGuestTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={guestBusy}
                onClick={confirmGuestAction}
              >
                {guestTarget.action === "shutdown" ? "Shut down" : "Stop"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
      </div>
    </>
  );
}
