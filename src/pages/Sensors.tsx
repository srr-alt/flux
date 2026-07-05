import { useEffect, useState } from "react";
import { Thermometer } from "lucide-react";
import { AreaChart } from "../components/charts/AreaChart";
import { EmptyState } from "../components/ui/EmptyState";
import { LoadingState } from "../components/ui/LoadingState";
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
  return "text-ink-primary";
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

  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-ink-primary">Sensors</h1>
        <p className="text-xs text-ink-muted">
          This machine · /sys/class/hwmon · updates at half refresh cadence
        </p>
      </div>

      {selected && selected.temps.length > 0 && (
        <div className="mb-5 rounded-xl border border-border bg-surface p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm font-medium text-ink-secondary">
              {selected.name} temperatures
            </span>
            <span className="text-xs text-ink-muted">{selected.id}</span>
          </div>
          <AreaChart
            timestamps={sensorTimestamps}
            series={selected.temps.map((t, i) => ({
              values: sensorTemps[`${selected.id}:${t.label}`] ?? [],
              color: seriesColor(i),
              label: t.label,
            }))}
            height={220}
            formatValue={(v) => `${Math.round(v)}°C`}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {sensors.map((chip) => (
          <button
            key={chip.id}
            onClick={() => setSelectedId(chip.id)}
            className={`rounded-xl border bg-surface p-4 text-left transition-colors ${
              chip.id === selected?.id
                ? "border-series-1/60"
                : "border-border hover:border-white/20"
            }`}
          >
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-semibold text-ink-primary">
                {chip.name}
              </span>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-muted">
                {chip.id}
              </span>
            </div>
            <div className="space-y-1 text-xs">
              {chip.temps.map((t) => (
                <div key={t.label} className="flex justify-between gap-2">
                  <span className="truncate text-ink-muted">{t.label}</span>
                  <span className={`shrink-0 tabular-nums ${tempClass(t)}`}>
                    {t.c.toFixed(1)}°C
                    {t.max_c !== null && (
                      <span className="text-ink-muted"> / {Math.round(t.max_c)}°C</span>
                    )}
                  </span>
                </div>
              ))}
              {chip.fans.map((f) => (
                <div key={f.label} className="flex justify-between gap-2">
                  <span className="truncate text-ink-muted">{f.label}</span>
                  <span className="shrink-0 tabular-nums text-ink-primary">
                    {f.rpm} rpm
                  </span>
                </div>
              ))}
              {chip.voltages.map((v) => (
                <div key={v.label} className="flex justify-between gap-2">
                  <span className="truncate text-ink-muted">{v.label}</span>
                  <span className="shrink-0 tabular-nums text-ink-primary">
                    {v.volts.toFixed(2)} V
                  </span>
                </div>
              ))}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
