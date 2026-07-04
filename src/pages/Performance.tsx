import { useEffect, useState } from "react";
import { AreaChart } from "../components/charts/AreaChart";
import { Meter } from "../components/charts/Meter";
import { Sparkline } from "../components/charts/Sparkline";
import {
  formatBytes,
  formatBytesPerSec,
  formatKb,
  formatPercent,
  formatUptime,
} from "../lib/format";
import { getCpuDetails } from "../lib/tauri";
import { useMonitorStore } from "../state/monitorStore";
import type { CpuDetails as CpuDetailsType } from "../types/monitor";

const COLORS = {
  cpu: "#3987e5",
  memory: "#9085e9",
  disk: "#c98500",
  net: "#199e70",
  netTx: "#d55181",
  gpu: "#d95926",
};

function coreColor(pct: number): string {
  if (pct >= 90) return "#d03b3b";
  if (pct >= 70) return "#fab219";
  return COLORS.cpu;
}

type Selection = string; // "cpu" | "memory" | `disk:${device}` | `net:${iface}`

export function Performance() {
  const [selected, setSelected] = useState<Selection>("cpu");
  const latest = useMonitorStore((s) => s.latest);
  const timestamps = useMonitorStore((s) => s.timestamps);
  const cpuHistory = useMonitorStore((s) => s.cpuHistory);
  const memUsedPctHistory = useMonitorStore((s) => s.memUsedPctHistory);
  const netRx = useMonitorStore((s) => s.netRx);
  const netTx = useMonitorStore((s) => s.netTx);
  const diskTimestamps = useMonitorStore((s) => s.diskTimestamps);
  const diskRead = useMonitorStore((s) => s.diskRead);
  const diskWrite = useMonitorStore((s) => s.diskWrite);
  const gpus = useMonitorStore((s) => s.gpus);
  const gpuTimestamps = useMonitorStore((s) => s.gpuTimestamps);
  const gpuUtil = useMonitorStore((s) => s.gpuUtil);
  const gpuTemp = useMonitorStore((s) => s.gpuTemp);

  if (!latest) {
    return (
      <div className="flex h-full items-center justify-center text-ink-muted">
        Collecting first sample…
      </div>
    );
  }

  const mem = latest.memory;
  const memUsedPct = ((mem.total_kb - mem.available_kb) / mem.total_kb) * 100;
  const diskDevices = Object.keys(diskRead).sort();

  return (
    <div className="flex h-full">
      {/* Rail */}
      <div className="w-64 shrink-0 space-y-1.5 overflow-y-auto border-r border-border p-3">
        <RailItem
          active={selected === "cpu"}
          onClick={() => setSelected("cpu")}
          title="CPU"
          value={formatPercent(latest.cpu.global_usage_pct)}
          timestamps={timestamps}
          series={[{ values: cpuHistory, color: COLORS.cpu, label: "CPU" }]}
          yMax={100}
        />
        <RailItem
          active={selected === "memory"}
          onClick={() => setSelected("memory")}
          title="Memory"
          value={`${formatKb(mem.total_kb - mem.available_kb)} (${memUsedPct.toFixed(0)}%)`}
          timestamps={timestamps}
          series={[
            { values: memUsedPctHistory, color: COLORS.memory, label: "Used" },
          ]}
          yMax={100}
        />
        {diskDevices.map((device) => (
          <RailItem
            key={device}
            active={selected === `disk:${device}`}
            onClick={() => setSelected(`disk:${device}`)}
            title={`Disk (${device})`}
            value={`${formatBytesPerSec(last(diskRead[device]))} R`}
            timestamps={diskTimestamps}
            series={[
              { values: diskRead[device] ?? [], color: COLORS.disk, label: "R" },
              { values: diskWrite[device] ?? [], color: COLORS.netTx, label: "W" },
            ]}
          />
        ))}
        {gpus.map((gpu, i) => {
          const key = String(i);
          const hasUtil = gpu.utilization_pct !== null;
          return (
            <RailItem
              key={`gpu-${i}`}
              active={selected === `gpu:${i}`}
              onClick={() => setSelected(`gpu:${i}`)}
              title={gpus.length > 1 ? `GPU ${i}` : "GPU"}
              value={
                hasUtil
                  ? formatPercent(gpu.utilization_pct!)
                  : gpu.temp_c !== null
                    ? `${gpu.temp_c.toFixed(0)}°C`
                    : "—"
              }
              timestamps={gpuTimestamps}
              series={[
                hasUtil
                  ? { values: gpuUtil[key] ?? [], color: COLORS.gpu, label: "Util" }
                  : { values: gpuTemp[key] ?? [], color: COLORS.gpu, label: "Temp" },
              ]}
              yMax={hasUtil ? 100 : undefined}
            />
          );
        })}
        {latest.network.map((iface) => (
          <RailItem
            key={iface.name}
            active={selected === `net:${iface.name}`}
            onClick={() => setSelected(`net:${iface.name}`)}
            title={iface.name}
            value={`↓ ${formatBytesPerSec(iface.rx_bytes_per_sec)}`}
            timestamps={timestamps}
            series={[
              { values: netRx[iface.name] ?? [], color: COLORS.net, label: "↓" },
              { values: netTx[iface.name] ?? [], color: COLORS.netTx, label: "↑" },
            ]}
          />
        ))}
      </div>

      {/* Detail */}
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        {selected === "cpu" && <CpuDetail />}
        {selected === "memory" && <MemoryDetail />}
        {selected.startsWith("disk:") && (
          <DiskDetail device={selected.slice(5)} />
        )}
        {selected.startsWith("net:") && <NetDetail iface={selected.slice(4)} />}
        {selected.startsWith("gpu:") && (
          <GpuDetail index={Number(selected.slice(4))} />
        )}
      </div>
    </div>
  );
}

function last(values: number[] | undefined): number {
  return values && values.length > 0 ? values[values.length - 1] : 0;
}

interface RailItemProps {
  active: boolean;
  onClick: () => void;
  title: string;
  value: string;
  timestamps: number[];
  series: { values: number[]; color: string; label: string }[];
  yMax?: number;
}

function RailItem({ active, onClick, title, value, timestamps, series, yMax }: RailItemProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-xl border p-3 text-left transition-colors ${
        active
          ? "border-series-1/40 bg-series-1/10"
          : "border-transparent hover:bg-white/5"
      }`}
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium text-ink-primary">{title}</span>
        <span className="shrink-0 text-xs tabular-nums text-ink-secondary">{value}</span>
      </div>
      <Sparkline
        timestamps={timestamps.slice(-(series[0].values.length || 1))}
        series={series}
        yMax={yMax}
        height={36}
      />
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-ink-primary">
        {value}
      </div>
    </div>
  );
}

function DetailHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-4">
      <h1 className="text-xl font-semibold text-ink-primary">{title}</h1>
      {subtitle && <span className="truncate text-sm text-ink-muted">{subtitle}</span>}
    </div>
  );
}

function CpuDetail() {
  const latest = useMonitorStore((s) => s.latest);
  const systemInfo = useMonitorStore((s) => s.systemInfo);
  const timestamps = useMonitorStore((s) => s.timestamps);
  const cpuHistory = useMonitorStore((s) => s.cpuHistory);
  const [details, setDetails] = useState<CpuDetailsType | null>(null);
  useEffect(() => {
    getCpuDetails().then(setDetails).catch(() => {});
  }, []);
  if (!latest) return null;
  const cpu = latest.cpu;
  const maxTemp = cpu.per_core_temp_c ? Math.max(...cpu.per_core_temp_c) : null;

  return (
    <div>
      <DetailHeader title="CPU" subtitle={systemInfo?.cpu_model} />
      <div className="rounded-xl border border-border bg-surface p-4">
        <AreaChart
          timestamps={timestamps}
          series={[{ values: cpuHistory, color: COLORS.cpu, label: "Utilization" }]}
          yMax={100}
          formatValue={(v) => `${v}%`}
        />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Utilization" value={formatPercent(cpu.global_usage_pct)} />
        <Stat
          label="Frequency"
          value={cpu.frequency_mhz ? `${(cpu.frequency_mhz / 1000).toFixed(2)} GHz` : "—"}
        />
        <Stat
          label="Load average"
          value={`${cpu.load_avg_1.toFixed(2)} · ${cpu.load_avg_5.toFixed(2)} · ${cpu.load_avg_15.toFixed(2)}`}
        />
        <Stat label="Temperature" value={maxTemp !== null ? `${maxTemp.toFixed(0)}°C` : "—"} />
        <Stat
          label="Uptime"
          value={systemInfo ? formatUptime(systemInfo.uptime_secs) : "—"}
        />
        <Stat label="Tasks" value={`${cpu.tasks_running} running / ${cpu.tasks_total}`} />
        <Stat
          label="Cores"
          value={
            systemInfo
              ? `${systemInfo.physical_cores} physical / ${systemInfo.logical_cores} logical`
              : "—"
          }
        />
      </div>
      <div className="mt-4 rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-medium text-ink-primary">
          Cores ({cpu.per_core_usage_pct.length})
        </h2>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
          {cpu.per_core_usage_pct.map((pct, i) => (
            <Meter
              key={i}
              ratio={pct / 100}
              color={coreColor(pct)}
              label={`Core ${i}`}
              detail={`${formatPercent(pct)}${
                cpu.per_core_freq_mhz[i]
                  ? ` · ${(cpu.per_core_freq_mhz[i] / 1000).toFixed(1)}GHz`
                  : ""
              }${
                cpu.per_core_temp_c?.[i] !== undefined
                  ? ` · ${cpu.per_core_temp_c[i].toFixed(0)}°C`
                  : ""
              }`}
            />
          ))}
        </div>
      </div>
      {details && (
        <div className="mt-4 rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-3 text-sm font-medium text-ink-primary">Details</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
            {(
              [
                ["Architecture", details.architecture],
                ["Vendor", details.vendor],
                ["Sockets", details.sockets],
                ["Stepping", details.stepping],
                [
                  "Frequency range",
                  details.min_mhz && details.max_mhz
                    ? `${Number(details.min_mhz).toFixed(0)} – ${Number(details.max_mhz).toFixed(0)} MHz`
                    : null,
                ],
                ["L1d cache", details.l1d_cache],
                ["L1i cache", details.l1i_cache],
                ["L2 cache", details.l2_cache],
                ["L3 cache", details.l3_cache],
                ["Virtualization", details.virtualization],
              ] as const
            )
              .filter(([, v]) => v)
              .map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-ink-muted">{label}</dt>
                  <dd className="tabular-nums text-ink-secondary">{value}</dd>
                </div>
              ))}
          </dl>
        </div>
      )}
    </div>
  );
}

function MemoryDetail() {
  const latest = useMonitorStore((s) => s.latest);
  const timestamps = useMonitorStore((s) => s.timestamps);
  const memUsedPctHistory = useMonitorStore((s) => s.memUsedPctHistory);
  if (!latest) return null;
  const mem = latest.memory;
  const usedKb = mem.total_kb - mem.free_kb - mem.cached_kb - mem.buffers_kb;

  const segments = [
    { label: "Used", kb: usedKb, color: COLORS.memory },
    { label: "Cached", kb: mem.cached_kb, color: COLORS.net },
    { label: "Buffers", kb: mem.buffers_kb, color: COLORS.disk },
    { label: "Free", kb: mem.free_kb, color: "#2c2c2a" },
  ];

  return (
    <div>
      <DetailHeader title="Memory" subtitle={`${formatKb(mem.total_kb)} total`} />
      <div className="rounded-xl border border-border bg-surface p-4">
        <AreaChart
          timestamps={timestamps}
          series={[{ values: memUsedPctHistory, color: COLORS.memory, label: "Used" }]}
          yMax={100}
          formatValue={(v) => `${v}%`}
        />
      </div>
      <div className="mt-4 rounded-xl border border-border bg-surface p-4">
        <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full">
          {segments.map((seg) => (
            <div
              key={seg.label}
              style={{
                width: `${(seg.kb / mem.total_kb) * 100}%`,
                backgroundColor: seg.color,
              }}
            />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-secondary">
          {segments.map((seg) => (
            <span key={seg.label} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-sm"
                style={{ backgroundColor: seg.color }}
              />
              {seg.label} {formatKb(seg.kb)}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="In use" value={formatKb(mem.total_kb - mem.available_kb)} />
        <Stat label="Available" value={formatKb(mem.available_kb)} />
        <Stat label="Cached" value={formatKb(mem.cached_kb)} />
        <Stat
          label="Swap"
          value={
            mem.swap_total_kb > 0
              ? `${formatKb(mem.swap_used_kb)} / ${formatKb(mem.swap_total_kb)}`
              : "none"
          }
        />
        <Stat label="Active" value={formatKb(mem.active_kb)} />
        <Stat label="Inactive" value={formatKb(mem.inactive_kb)} />
        <Stat label="Shared" value={formatKb(mem.shmem_kb)} />
        <Stat label="Slab" value={formatKb(mem.slab_kb)} />
        <Stat
          label="Dirty / Writeback"
          value={`${formatKb(mem.dirty_kb)} / ${formatKb(mem.writeback_kb)}`}
        />
        <Stat label="Page tables" value={formatKb(mem.page_tables_kb)} />
        <Stat
          label="Committed"
          value={`${formatKb(mem.committed_kb)} / ${formatKb(mem.commit_limit_kb)}`}
        />
      </div>
      {mem.swap_devices.length > 0 && (
        <div className="mt-4 rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-3 text-sm font-medium text-ink-primary">Swap devices</h2>
          <div className="space-y-3">
            {mem.swap_devices.map((sw) => (
              <Meter
                key={sw.name}
                ratio={sw.size_kb > 0 ? sw.used_kb / sw.size_kb : 0}
                color={COLORS.memory}
                label={`${sw.name} (${sw.kind})`}
                detail={`${formatKb(sw.used_kb)} / ${formatKb(sw.size_kb)}`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DiskDetail({ device }: { device: string }) {
  const disks = useMonitorStore((s) => s.disks);
  const diskTimestamps = useMonitorStore((s) => s.diskTimestamps);
  const diskRead = useMonitorStore((s) => s.diskRead);
  const diskWrite = useMonitorStore((s) => s.diskWrite);
  const mounts =
    disks?.mounts.filter((m) => m.device.includes(device) && m.total_bytes > 0) ?? [];
  const io = disks?.io.find((d) => d.device === device);

  return (
    <div>
      <DetailHeader title={`Disk — ${device}`} />
      <div className="rounded-xl border border-border bg-surface p-4">
        <AreaChart
          timestamps={diskTimestamps}
          series={[
            { values: diskRead[device] ?? [], color: COLORS.disk, label: "Read" },
            { values: diskWrite[device] ?? [], color: COLORS.netTx, label: "Write" },
          ]}
          formatValue={(v) => formatBytesPerSec(v)}
        />
        <Legend
          entries={[
            { label: "Read", color: COLORS.disk },
            { label: "Write", color: COLORS.netTx },
          ]}
        />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Read" value={formatBytesPerSec(last(diskRead[device]))} />
        <Stat label="Write" value={formatBytesPerSec(last(diskWrite[device]))} />
        <Stat
          label="IOPS (R / W)"
          value={io ? `${io.read_iops.toFixed(0)} / ${io.write_iops.toFixed(0)}` : "—"}
        />
        <Stat label="Busy" value={io ? formatPercent(io.util_pct) : "—"} />
      </div>
      {io && (
        <div className="mt-4 rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-3 text-sm font-medium text-ink-primary">Details</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
            {(
              [
                ["Model", io.model ?? "—"],
                ["Device", `/dev/${io.device}`],
                ["Capacity", formatBytes(io.size_bytes)],
                ["Type", io.rotational ? "HDD (rotational)" : "SSD / NVMe"],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-ink-muted">{label}</dt>
                <dd className="tabular-nums text-ink-secondary">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {mounts.length > 0 && (
        <div className="mt-4 rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-3 text-sm font-medium text-ink-primary">Filesystems</h2>
          <div className="space-y-3">
            {mounts.map((m) => (
              <Meter
                key={m.mount_point}
                ratio={1 - m.available_bytes / m.total_bytes}
                color={COLORS.disk}
                label={`${m.mount_point} (${m.fs_type})`}
                detail={`${formatBytes(m.total_bytes - m.available_bytes)} / ${formatBytes(m.total_bytes)}`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NetDetail({ iface }: { iface: string }) {
  const latest = useMonitorStore((s) => s.latest);
  const timestamps = useMonitorStore((s) => s.timestamps);
  const netRx = useMonitorStore((s) => s.netRx);
  const netTx = useMonitorStore((s) => s.netTx);
  const current = latest?.network.find((n) => n.name === iface);

  return (
    <div>
      <DetailHeader title={`Network — ${iface}`} />
      <div className="rounded-xl border border-border bg-surface p-4">
        <AreaChart
          timestamps={timestamps}
          series={[
            { values: netRx[iface] ?? [], color: COLORS.net, label: "Download" },
            { values: netTx[iface] ?? [], color: COLORS.netTx, label: "Upload" },
          ]}
          formatValue={(v) => formatBytesPerSec(v)}
        />
        <Legend
          entries={[
            { label: "Download", color: COLORS.net },
            { label: "Upload", color: COLORS.netTx },
          ]}
        />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
          label="Download"
          value={current ? formatBytesPerSec(current.rx_bytes_per_sec) : "—"}
        />
        <Stat
          label="Upload"
          value={current ? formatBytesPerSec(current.tx_bytes_per_sec) : "—"}
        />
        <Stat
          label="Total received"
          value={current ? formatBytes(current.total_rx_bytes) : "—"}
        />
        <Stat
          label="Total sent"
          value={current ? formatBytes(current.total_tx_bytes) : "—"}
        />
        <Stat
          label="Packets/s (↓ / ↑)"
          value={
            current
              ? `${current.rx_packets_per_sec.toFixed(0)} / ${current.tx_packets_per_sec.toFixed(0)}`
              : "—"
          }
        />
        <Stat
          label="Errors (rx / tx)"
          value={
            current ? `${current.total_rx_errors} / ${current.total_tx_errors}` : "—"
          }
        />
        <Stat
          label="Link speed"
          value={current?.speed_mbps ? `${current.speed_mbps} Mb/s` : "—"}
        />
        <Stat label="State" value={current?.operstate ?? "—"} />
      </div>
      {current && (
        <div className="mt-4 rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-3 text-sm font-medium text-ink-primary">Details</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
            {(
              [
                ["Type", current.is_wireless ? "Wireless" : "Wired"],
                ["MAC address", current.mac],
                ["IP addresses", current.ips.join(", ") || "—"],
                ["MTU", String(current.mtu)],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-ink-muted">{label}</dt>
                <dd className="break-all tabular-nums text-ink-secondary">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

function GpuDetail({ index }: { index: number }) {
  const gpus = useMonitorStore((s) => s.gpus);
  const gpuTimestamps = useMonitorStore((s) => s.gpuTimestamps);
  const gpuUtil = useMonitorStore((s) => s.gpuUtil);
  const gpuTemp = useMonitorStore((s) => s.gpuTemp);
  const gpu = gpus[index];
  if (!gpu) return null;

  const key = String(index);
  const hasUtil = gpu.utilization_pct !== null;

  return (
    <div>
      <DetailHeader title="GPU" subtitle={`${gpu.name} · ${gpu.driver}`} />
      <div className="rounded-xl border border-border bg-surface p-4">
        <AreaChart
          timestamps={gpuTimestamps}
          series={[
            hasUtil
              ? { values: gpuUtil[key] ?? [], color: COLORS.gpu, label: "Utilization" }
              : { values: gpuTemp[key] ?? [], color: COLORS.gpu, label: "Temperature" },
          ]}
          yMax={hasUtil ? 100 : undefined}
          formatValue={(v) => (hasUtil ? `${v}%` : `${v}°C`)}
        />
        <Legend
          entries={[
            hasUtil
              ? { label: "Utilization", color: COLORS.gpu }
              : { label: "Temperature", color: COLORS.gpu },
          ]}
        />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
          label="Utilization"
          value={gpu.utilization_pct !== null ? formatPercent(gpu.utilization_pct) : "—"}
        />
        <Stat
          label="VRAM"
          value={
            gpu.mem_used_mb !== null && gpu.mem_total_mb !== null
              ? `${formatBytes(gpu.mem_used_mb * 1048576)} / ${formatBytes(gpu.mem_total_mb * 1048576)}`
              : "—"
          }
        />
        <Stat
          label="Temperature"
          value={
            gpu.temp_c !== null
              ? `${gpu.temp_c.toFixed(0)}°C${gpu.temp_crit_c !== null ? ` / ${gpu.temp_crit_c.toFixed(0)}°C crit` : ""}`
              : "—"
          }
        />
        <Stat
          label="Power"
          value={
            gpu.power_w !== null
              ? `${gpu.power_w.toFixed(1)} W${gpu.power_limit_w !== null ? ` / ${gpu.power_limit_w.toFixed(0)} W` : ""}`
              : "—"
          }
        />
        <Stat
          label="Core clock"
          value={gpu.clock_core_mhz !== null ? `${gpu.clock_core_mhz} MHz` : "—"}
        />
        <Stat
          label="Memory clock"
          value={gpu.clock_mem_mhz !== null ? `${gpu.clock_mem_mhz} MHz` : "—"}
        />
        <Stat
          label="Fan"
          value={gpu.fan_pct !== null ? formatPercent(gpu.fan_pct) : "—"}
        />
        <Stat
          label="VRAM reserved"
          value={
            gpu.mem_reserved_mb !== null
              ? formatBytes(gpu.mem_reserved_mb * 1048576)
              : "—"
          }
        />
      </div>
      <div className="mt-4 rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-medium text-ink-primary">Details</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          {(
            [
              ["Model", gpu.name],
              ["Driver", gpu.driver],
              ["Driver version", gpu.driver_version ?? "—"],
              ["VBIOS", gpu.vbios_version ?? "—"],
              ["PCI address", gpu.pci_address ?? "—"],
              ["PCIe link", gpu.pcie_link ?? "—"],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-ink-muted">{label}</dt>
              <dd className="tabular-nums text-ink-secondary">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      {gpu.note && (
        <div className="mt-4 rounded-xl border border-status-warning/30 bg-status-warning/10 px-4 py-3 text-sm text-status-warning">
          {gpu.note}
        </div>
      )}
    </div>
  );
}

function Legend({ entries }: { entries: { label: string; color: string }[] }) {
  return (
    <div className="mt-2 flex gap-5 text-xs text-ink-secondary">
      {entries.map((e) => (
        <span key={e.label} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-sm"
            style={{ backgroundColor: e.color }}
          />
          {e.label}
        </span>
      ))}
    </div>
  );
}
