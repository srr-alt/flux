import { useEffect, useState } from "react";
import { Thermometer } from "lucide-react";
import { AreaChart } from "../components/charts/AreaChart";
import { EmptyState } from "../components/ui/EmptyState";
import { LoadingState } from "../components/ui/LoadingState";
import { ScreenHeader } from "../components/layout/ScreenHeader";
import { themeColor, type ThemeColorName } from "../lib/theme";
import { useMonitorStore } from "../state/monitorStore";
import type { HwmonChip, TempReading } from "../types/monitor";

const SERIES_RAMP: ThemeColorName[] = [
  "series1",
  "series2",
  "series3",
  "series4",
  "series5",
  "series7",
  "series8",
];

function seriesColor(i: number): string {
  return themeColor(SERIES_RAMP[i % SERIES_RAMP.length]);
}

function tempClass(t: TempReading): string {
  if (t.crit_c !== null && t.c >= t.crit_c) return "text-status-critical";
  if (t.max_c !== null && t.c >= t.max_c) return "text-status-warning";
  return "text-ink-secondary";
}

/** Design chip-kind label (K10TEMP → CPU, nvme → SSD…) from the hwmon name. */
function chipKind(name: string): string {
  const n = name.toLowerCase();
  if (/k10temp|coretemp|zenpower|cpu/.test(n)) return "CPU";
  if (/nvidia|amdgpu|radeon|nouveau|gpu/.test(n)) return "GPU";
  if (/nvme|drivetemp|sata/.test(n)) return "SSD";
  if (/iwlwifi|mt79|ath1|wifi/.test(n)) return "WIFI";
  if (/bat|acpi/.test(n)) return "BATTERY";
  return "MOTHERBOARD";
}

/** Thin load bar for a reading: value scaled against its max when known. */
function ReadingBar({ frac, hot }: { frac: number | null; hot: boolean }) {
  if (frac === null) return <div className="h-[3px] flex-1" />;
  const pct = Math.min(100, Math.max(2, frac * 100));
  return (
    <div className="h-[3px] flex-1 overflow-hidden rounded-sm bg-gridline">
      <div
        className={`h-full rounded-sm ${hot ? "bg-status-critical" : "bg-[#3d4a8f]"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function Reading({
  label,
  value,
  frac,
  cls = "text-ink-secondary",
  hot = false,
}: {
  label: string;
  value: string;
  frac: number | null;
  cls?: string;
  hot?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 py-1 font-mono text-[11px]">
      <span className="w-20 truncate text-ink-muted">{label}</span>
      <ReadingBar frac={frac} hot={hot} />
      <span className={`w-[70px] shrink-0 text-right font-medium tabular-nums ${cls}`}>
        {value}
      </span>
    </div>
  );
}

/** Local machine only — hwmon isn't collected for remote hosts (yet). */
export function Sensors() {
  const sensors = useMonitorStore((s) => s.sensors);
  const sensorTimestamps = useMonitorStore((s) => s.sensorTimestamps);
  const sensorTemps = useMonitorStore((s) => s.sensorTemps);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Default to the first chip that has temperature channels; recover if the
  // selected chip disappears (USB sensor unplugged).
  useEffect(() => {
    if (sensors.length === 0) return;
    if (selectedId && sensors.some((c) => c.id === selectedId)) return;
    const first = sensors.find((c) => c.temps.length > 0) ?? sensors[0];
    setSelectedId(first.id);
  }, [sensors, selectedId]);

  if (sensorTimestamps.length === 0) {
    return <LoadingState label="Reading sensors…" className="h-full" />;
  }
  if (sensors.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Thermometer}
          title="No hardware sensors found"
          hint="Nothing under /sys/class/hwmon exposed readable channels."
        />
      </div>
    );
  }

  const selected: HwmonChip | undefined =
    sensors.find((c) => c.id === selectedId) ?? sensors[0];
  const hottest = selected
    ? selected.temps.reduce<number | null>(
        (max, t) => (max === null || t.c > max ? t.c : max),
        null,
      )
    : null;
  const crit = selected
    ? selected.temps.reduce<number | null>(
        (min, t) =>
          t.crit_c !== null && (min === null || t.crit_c < min) ? t.crit_c : min,
        null,
      )
    : null;

  return (
    <>
      <ScreenHeader title="Sensors" sub="hwmon · this machine · half refresh cadence" />
      <div className="flex flex-col gap-4 p-5">

      {/* chip cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {sensors.map((chip) => (
          <button
            key={chip.id}
            onClick={() => setSelectedId(chip.id)}
            className={`glass flex flex-col rounded-2xl border p-4 text-left transition-colors duration-150 ${
              chip.id === selected?.id
                ? "border-series-1/50"
                : "border-border hover:border-white/20"
            }`}
          >
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <span className="truncate font-mono text-xs font-semibold text-ink-secondary">
                {chip.name}
              </span>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-faint">
                {chipKind(chip.name)}
              </span>
            </div>
            <div>
              {chip.temps.map((t) => (
                <Reading
                  key={t.label}
                  label={t.label}
                  value={`${t.c.toFixed(0)}°C`}
                  frac={t.max_c ? t.c / t.max_c : t.crit_c ? t.c / t.crit_c : null}
                  cls={tempClass(t)}
                  hot={
                    (t.crit_c !== null && t.c >= t.crit_c) ||
                    (t.max_c !== null && t.c >= t.max_c)
                  }
                />
              ))}
              {chip.fans.map((f) => (
                <Reading key={f.label} label={f.label} value={`${f.rpm} rpm`} frac={null} />
              ))}
              {chip.voltages.map((v) => (
                <Reading
                  key={v.label}
                  label={v.label}
                  value={`${v.volts.toFixed(2)} V`}
                  frac={null}
                />
              ))}
            </div>
          </button>
        ))}
      </div>

      {/* temperature history */}
      {selected && selected.temps.length > 0 && (
        <div className="glass rounded-2xl border border-border p-4">
          <div className="mb-3 flex items-baseline gap-2">
            <span className="text-xs font-semibold text-ink-secondary">
              Temperature history
            </span>
            <span className="font-mono text-[11px] text-ink-faint">
              {selected.name} · {sensorTimestamps.length} samples
            </span>
            {hottest !== null && (
              <span
                className={`ml-auto text-[17px] font-bold tabular-nums ${
                  crit !== null && hottest >= crit * 0.85
                    ? "text-status-critical"
                    : "text-ink-primary"
                }`}
              >
                {hottest.toFixed(0)}°C
              </span>
            )}
          </div>
          <AreaChart
            timestamps={sensorTimestamps}
            series={selected.temps.map((t, i) => ({
              values: sensorTemps[`${selected.id}:${t.label}`] ?? [],
              color: seriesColor(i),
              label: t.label,
            }))}
            height={200}
            formatValue={(v) => `${Math.round(v)}°C`}
          />
          {crit !== null && (
            <div className="mt-1.5 font-mono text-[10px] text-ink-faint">
              critical {crit.toFixed(0)}°C ····
            </div>
          )}
        </div>
      )}
      </div>
    </>
  );
}
