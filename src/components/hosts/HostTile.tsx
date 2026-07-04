import { Monitor, Server, Trash2 } from "lucide-react";
import { Sparkline } from "../charts/Sparkline";
import { Meter } from "../charts/Meter";
import {
  formatBytesPerSec,
  formatPercent,
  formatUptime,
} from "../../lib/format";
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
}

function statusColor(status: HostStatus | undefined, isLocal: boolean): string {
  if (isLocal) return "bg-status-good";
  switch (status?.state) {
    case "connected":
      return "bg-status-good";
    case "connecting":
      return "bg-status-warning";
    case "degraded":
      return "bg-status-serious";
    default:
      return "bg-status-critical";
  }
}

function statusLabel(status: HostStatus | undefined, isLocal: boolean): string {
  if (isLocal) return "this machine";
  switch (status?.state) {
    case "connected":
      return status.mode === "agent" ? "agent" : "ssh";
    case "connecting":
      return "connecting…";
    case "degraded":
      return "degraded";
    case "error":
      return "error";
    default:
      return "offline";
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
}: HostTileProps) {
  const latest = series.latest;
  const memPct =
    latest && latest.memory.total_kb > 0
      ? ((latest.memory.total_kb - latest.memory.available_kb) /
          latest.memory.total_kb) *
        100
      : 0;
  const netDown = latest
    ? latest.network.reduce((sum, i) => sum + i.rx_bytes_per_sec, 0)
    : 0;
  const netUp = latest
    ? latest.network.reduce((sum, i) => sum + i.tx_bytes_per_sec, 0)
    : 0;
  const offline = !isLocal && status?.state !== "connected";
  const Icon = isLocal ? Monitor : Server;

  return (
    <div
      className={`group relative flex cursor-pointer flex-col gap-3 rounded-lg border border-border bg-surface p-4 transition hover:border-white/25 ${
        offline ? "opacity-60" : ""
      }`}
      onClick={onOpen}
    >
      <div className="flex items-center gap-2">
        <Icon size={15} className="shrink-0 text-ink-muted" />
        <span className="truncate text-sm font-medium text-ink-primary">
          {name}
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-ink-muted">
          <span
            className={`h-2 w-2 rounded-full ${statusColor(status, isLocal)}`}
          />
          {statusLabel(status, isLocal)}
        </span>
      </div>

      <div className="truncate text-xs text-ink-muted">
        {systemInfo
          ? `${systemInfo.os_pretty_name} · up ${formatUptime(systemInfo.uptime_secs)}`
          : status?.state === "error"
            ? status.message
            : "—"}
      </div>

      <div className="h-9">
        <Sparkline
          timestamps={series.timestamps}
          series={[
            {
              values: series.cpuHistory,
              color: "#3987e5",
              label: "CPU",
            },
          ]}
          yMax={100}
          height={36}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-ink-secondary">
        <span>
          CPU{" "}
          {latest ? formatPercent(latest.cpu.global_usage_pct) : "—"}
        </span>
        <span>
          ↓ {formatBytesPerSec(netDown)} ↑ {formatBytesPerSec(netUp)}
        </span>
      </div>
      <Meter ratio={memPct / 100} color="#9085e9" label="Memory" detail={formatPercent(memPct)} />

      {onRemove && (
        <button
          className="absolute right-2 top-2 hidden rounded p-1 text-ink-muted hover:bg-status-critical/20 hover:text-status-critical group-hover:block"
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
