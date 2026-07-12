import { HardDrive, Trash2 } from "lucide-react";
import { Button } from "../ui/Button";
import { Sparkline } from "../charts/Sparkline";
import { Meter } from "../charts/Meter";
import { formatBytesPerSec, formatUptime } from "../../lib/format";
import { chartColors, themeColor } from "../../lib/theme";
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

/** Design tile chrome: faint MODE tag + colored STATUS word (no pill fill). */
function statusPill(
  status: HostStatus | undefined,
  isLocal: boolean,
): { mode: string; label: string; cls: string; pulse: boolean } {
  if (isLocal) return { mode: "LOCAL", label: "ONLINE", cls: "text-status-good", pulse: false };
  const mode = status?.state === "connected" && status.mode === "agent" ? "AGENT" : "AGENTLESS";
  switch (status?.state) {
    case "connected":
      return { mode, label: "ONLINE", cls: "text-status-good", pulse: false };
    case "connecting":
      return { mode, label: "CONNECTING", cls: "text-status-warning", pulse: true };
    case "degraded":
      return { mode, label: "DEGRADED", cls: "text-status-serious", pulse: true };
    case "error":
      return { mode, label: "ERROR", cls: "text-status-critical", pulse: false };
    default:
      return { mode, label: "OFFLINE", cls: "text-status-critical/80", pulse: false };
  }
}

/** Sphere avatar: glowing indigo planet when reachable, dim rock when not. */
function Sphere({ online }: { online: boolean }) {
  return (
    <span
      className={`h-5 w-5 shrink-0 rounded-full ${
        online
          ? "bg-[radial-gradient(circle_at_35%_30%,#9aa3f0,#5e6ad2_58%,#101018)] shadow-[0_0_9px_rgba(94,106,210,.45)]"
          : "bg-[radial-gradient(circle_at_35%_30%,#6b7180,#3a3d46_58%,#101018)]"
      }`}
    />
  );
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
  const cpuNow = latest?.cpu.global_usage_pct;

  return (
    <div
      className={`group relative flex cursor-pointer flex-col gap-3 glass rounded-2xl border border-border p-4 transition-all duration-150 hover:-translate-y-0.5 hover:border-white/20 hover:shadow-lg hover:shadow-black/30 ${
        offline ? "opacity-55 saturate-50" : ""
      }`}
      onClick={onOpen}
    >
      {/* header */}
      <div className="flex items-center gap-2.5">
        <Sphere online={isLocal || status?.state === "connected"} />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold leading-tight text-ink-primary">
            {name}
          </div>
          <div className="truncate font-mono text-[10px] leading-tight text-ink-faint">
            {systemInfo
              ? systemInfo.os_pretty_name
              : status?.state === "error"
                ? status.message
                : "waiting for connection…"}
          </div>
        </div>
        <span className="ml-auto shrink-0 text-[10px] font-medium tracking-wide text-ink-faint">
          {pill.mode}
        </span>
        <span
          className={`shrink-0 text-[10px] font-medium tracking-wide ${pill.cls} ${pill.pulse ? "animate-pulse" : ""}`}
        >
          {pill.label}
        </span>
      </div>

      {/* cpu sparkline with live value beside it (design: spark flex + right CPU block) */}
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <Sparkline
            timestamps={series.timestamps}
            series={[{ values: series.cpuHistory, color: chartColors.cpu, label: "CPU" }]}
            yMax={100}
            height={36}
          />
        </div>
        <div className="shrink-0 text-right">
          <div
            className={`text-lg font-bold tabular-nums leading-tight ${
              cpuNow === undefined
                ? "text-ink-primary"
                : cpuNow > 75
                  ? "text-status-critical"
                  : cpuNow > 50
                    ? "text-status-warning"
                    : "text-ink-primary"
            }`}
          >
            {cpuNow !== undefined ? cpuNow.toFixed(0) : "–"}
            <span className="text-xs font-medium text-ink-muted">%</span>
          </div>
          <div className="text-[9.5px] text-ink-faint">CPU</div>
        </div>
      </div>

      {/* meters */}
      <div className="grid grid-cols-2 gap-3">
        <Meter
          ratio={memPct / 100}
          color={memPct > 75 ? themeColor("statusCritical") : themeColor("statusGood")}
          label="Memory"
          detail={latest ? `${memPct.toFixed(0)}%` : "—"}
        />
        {diskPct !== null && rootMount && (
          <Meter
            ratio={diskPct / 100}
            color={diskPct > 75 ? themeColor("statusCritical") : themeColor("series1")}
            label="Disk"
            detail={`${diskPct.toFixed(0)}%`}
          />
        )}
      </div>

      {/* facts row */}
      <div className="flex gap-3.5 font-mono text-[10px] text-ink-faint">
        <span className="whitespace-nowrap tabular-nums">↑ {formatBytesPerSec(netUp)}</span>
        <span className="whitespace-nowrap tabular-nums">↓ {formatBytesPerSec(netDown)}</span>
        <span className="ml-auto truncate">
          {systemInfo
            ? `${systemInfo.os_pretty_name} · up ${formatUptime(systemInfo.uptime_secs)}`
            : "—"}
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
