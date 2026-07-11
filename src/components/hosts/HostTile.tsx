import { Cpu, HardDrive, Monitor, Server, Trash2 } from "lucide-react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Sparkline } from "../charts/Sparkline";
import { Meter } from "../charts/Meter";
import {
  formatBytes,
  formatBytesPerSec,
  formatKb,
  formatUptime,
} from "../../lib/format";
import { chartColors } from "../../lib/theme";
import type { HostSeries } from "../../state/fleetStore";
import type { HostStatus } from "../../types/hosts";
import type { SystemInfo } from "../../types/monitor";

interface HostTileProps {
  name: string;
  isLocal?: boolean;
  status: HostStatus | undefined;
  systemInfo: SystemInfo | null;
  series: HostSeries;
  onOpen: () => void;
  onRemove?: () => void;
  /** Shown while connected agentless: upgrade to full-detail agent. */
  onDeployAgent?: () => void;
  onInstallDeb?: () => void;
  busyText?: string;
}

function statusPill(
  status: HostStatus | undefined,
  isLocal: boolean,
): { label: string; cls: string; pulse: boolean } {
  if (isLocal)
    return {
      label: "local",
      cls: "bg-status-good/15 text-status-good",
      pulse: false,
    };
  switch (status?.state) {
    case "connected":
      return status.mode === "agent"
        ? { label: "agent", cls: "bg-series-1/15 text-series-1", pulse: false }
        : {
            label: "ssh",
            cls: "bg-status-good/15 text-status-good",
            pulse: false,
          };
    case "connecting":
      return {
        label: "connecting",
        cls: "bg-status-warning/15 text-status-warning",
        pulse: true,
      };
    case "degraded":
      return {
        label: "degraded",
        cls: "bg-status-serious/15 text-status-serious",
        pulse: true,
      };
    case "error":
      return {
        label: "error",
        cls: "bg-status-critical/15 text-status-critical",
        pulse: false,
      };
    default:
      return {
        label: "offline",
        cls: "bg-white/5 text-ink-muted",
        pulse: false,
      };
  }
}

export function HostTile({
  name,
  isLocal = false,
  status,
  systemInfo,
  series,
  onOpen,
  onRemove,
  onDeployAgent,
  onInstallDeb,
  busyText,
}: HostTileProps) {
  const latest = series.latest;
  const memUsedKb = latest
    ? latest.memory.total_kb - latest.memory.available_kb
    : 0;
  const memPct =
    latest && latest.memory.total_kb > 0
      ? (memUsedKb / latest.memory.total_kb) * 100
      : 0;
  const netDown = latest
    ? latest.network.reduce((sum, i) => sum + i.rx_bytes_per_sec, 0)
    : 0;
  const netUp = latest
    ? latest.network.reduce((sum, i) => sum + i.tx_bytes_per_sec, 0)
    : 0;
  const rootMount = series.disks?.mounts.find((m) => m.mount_point === "/");
  const diskPct = rootMount
    ? ((rootMount.total_bytes - rootMount.available_bytes) /
        rootMount.total_bytes) *
      100
    : null;
  const offline = !isLocal && status?.state !== "connected";
  const pill = statusPill(status, isLocal);
  const Icon = isLocal ? Monitor : Server;
  const cpuNow = latest?.cpu.global_usage_pct;

  return (
    <div
      className={`group relative flex cursor-pointer flex-col gap-3 rounded-xl border border-border bg-surface p-4 transition-all duration-150 hover:-translate-y-0.5 hover:border-white/20 hover:shadow-lg hover:shadow-black/30 ${
        offline ? "opacity-55 saturate-50" : ""
      }`}
      onClick={onOpen}
    >
      {/* header */}
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/5">
          <Icon size={14} className="text-ink-secondary" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold leading-tight text-ink-primary">
            {name}
          </div>
          <div className="truncate text-[11px] leading-tight text-ink-muted">
            {systemInfo
              ? systemInfo.os_pretty_name
              : status?.state === "error"
                ? status.message
                : "waiting for connection…"}
          </div>
        </div>
        <Badge className={`ml-auto shrink-0 ${pill.cls}`} pulse={pill.pulse}>
          {pill.label}
        </Badge>
      </div>

      {/* cpu sparkline with live value */}
      <div className="relative rounded-lg bg-black/20 px-2 pt-2">
        <div className="pointer-events-none absolute right-2 top-1.5 z-10 text-right">
          <span className="text-lg font-semibold tabular-nums leading-none text-ink-primary">
            {cpuNow !== undefined ? cpuNow.toFixed(0) : "–"}
            <span className="text-[10px] font-normal text-ink-muted">%</span>
          </span>
          <div className="text-[9px] uppercase tracking-wide text-ink-muted">
            cpu
          </div>
        </div>
        <Sparkline
          timestamps={series.timestamps}
          series={[{ values: series.cpuHistory, color: chartColors.cpu, label: "CPU" }]}
          yMax={100}
          height={44}
        />
      </div>

      {/* meters */}
      <div className="flex flex-col gap-2">
        <Meter
          ratio={memPct / 100}
          color={chartColors.memory}
          label="Memory"
          detail={
            latest ? `${formatKb(memUsedKb)} · ${memPct.toFixed(0)}%` : "—"
          }
        />
        {diskPct !== null && rootMount && (
          <Meter
            ratio={diskPct / 100}
            color={chartColors.disk}
            label="Disk /"
            detail={`${formatBytes(rootMount.total_bytes - rootMount.available_bytes)} · ${diskPct.toFixed(0)}%`}
          />
        )}
      </div>

      {/* facts row */}
      <div className="grid grid-cols-3 gap-2 text-[11px] text-ink-muted">
        <span className="flex items-center gap-1 truncate">
          <Cpu size={11} className="shrink-0" />
          {systemInfo ? `${systemInfo.logical_cores}× · load ${latest ? latest.cpu.load_avg_1.toFixed(2) : "—"}` : "—"}
        </span>
        <span className="truncate text-center">
          {systemInfo ? `up ${formatUptime(systemInfo.uptime_secs)}` : ""}
        </span>
        <span className="truncate text-right tabular-nums">
          ↓{formatBytesPerSec(netDown)} ↑{formatBytesPerSec(netUp)}
        </span>
      </div>

      {/* actions */}
      {busyText ? (
        <div className="flex items-center gap-1.5 truncate text-[11px] text-status-warning">
          <HardDrive size={11} className="shrink-0 animate-pulse" />
          {busyText}
        </div>
      ) : (
        !isLocal &&
        status?.state === "connected" && (
          <div className="flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
            {status.mode === "agentless" && onDeployAgent && (
              <Button
                variant="soft"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeployAgent();
                }}
                title="Upload the flux-agent binary for full process detail"
              >
                Enable full detail
              </Button>
            )}
            {onInstallDeb && (
              <Button
                variant="ghost"
                size="sm"
                className="bg-white/5"
                onClick={(e) => {
                  e.stopPropagation();
                  onInstallDeb();
                }}
                title="Install the Flux desktop app on this machine via apt"
              >
                Install Flux
              </Button>
            )}
          </div>
        )
      )}

      {onRemove && (
        <button
          className="absolute bottom-2.5 right-2.5 hidden rounded-md p-1 text-ink-muted hover:bg-status-critical/20 hover:text-status-critical group-hover:block"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label="Remove host"
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}
