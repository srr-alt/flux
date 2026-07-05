import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { AXIS_FONT, themeColor } from "../../lib/theme";

export interface AreaSeries {
  values: number[];
  color: string;
  label: string;
}

interface AreaChartProps {
  timestamps: number[];
  series: AreaSeries[];
  yMax?: number;
  height?: number;
  formatValue?: (value: number) => string;
}

/** Detail chart: gridlines + labeled y axis, canvas-rendered via uPlot.
 * Hover shows a crosshair + tooltip with every series' value at that sample. */
export function AreaChart({
  timestamps,
  series,
  yMax,
  height = 260,
  formatValue,
}: AreaChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const formatRef = useRef(formatValue);
  formatRef.current = formatValue;
  // Labels/colors can change without a plot rebuild (rebuild only keys on
  // series.length) — the tooltip reads them through a ref, like formatValue.
  const seriesMetaRef = useRef(series);
  seriesMetaRef.current = series;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const tooltip = document.createElement("div");
    tooltip.className =
      "pointer-events-none absolute z-10 rounded-md border border-border bg-raised px-2.5 py-1.5 text-xs shadow-lg shadow-black/40";
    tooltip.style.display = "none";
    tooltip.style.top = "8px";
    container.appendChild(tooltip);

    const format = (v: number | null | undefined): string => {
      if (v == null) return "—";
      return formatRef.current
        ? formatRef.current(v)
        : String(Math.round(v * 10) / 10);
    };

    const updateTooltip = (u: uPlot) => {
      const idx = u.cursor.idx;
      if (idx == null || u.data[0].length === 0) {
        tooltip.style.display = "none";
        return;
      }
      const time = new Date((u.data[0][idx] as number) * 1000).toLocaleTimeString();
      const meta = seriesMetaRef.current;
      const rows = meta
        .map((s, i) => {
          const value = format(u.data[i + 1]?.[idx] as number | null | undefined);
          return (
            `<div style="display:flex;align-items:center;gap:6px;margin-top:2px">` +
            `<span style="width:8px;height:8px;border-radius:2px;background:${s.color};flex:none"></span>` +
            `<span style="color:${themeColor("inkMuted")}">${s.label}</span>` +
            `<span style="margin-left:auto;font-variant-numeric:tabular-nums;padding-left:12px">${value}</span>` +
            `</div>`
          );
        })
        .join("");
      tooltip.innerHTML =
        `<div style="color:${themeColor("inkMuted")};font-variant-numeric:tabular-nums">${time}</div>` +
        rows;

      const over = u.over;
      const left = u.cursor.left ?? 0;
      tooltip.style.display = "block";
      if (left > over.clientWidth / 2) {
        tooltip.style.left = `${over.offsetLeft + left - 10}px`;
        tooltip.style.transform = "translateX(-100%)";
      } else {
        tooltip.style.left = `${over.offsetLeft + left + 10}px`;
        tooltip.style.transform = "none";
      }
    };

    const opts: uPlot.Options = {
      width: container.clientWidth || 600,
      height,
      pxAlign: false,
      cursor: {
        show: true,
        x: true,
        y: false,
        points: { size: 6 },
        drag: { x: false, y: false },
      },
      legend: { show: false },
      hooks: { setCursor: [updateTooltip] },
      scales: {
        x: { time: true },
        y: { range: yMax !== undefined ? [0, yMax] : undefined },
      },
      axes: [
        {
          stroke: themeColor("inkMuted"),
          font: AXIS_FONT,
          grid: { show: false },
          ticks: { show: false },
        },
        {
          stroke: themeColor("inkMuted"),
          font: AXIS_FONT,
          size: 58,
          grid: { stroke: themeColor("gridline"), width: 1 },
          ticks: { show: false },
          values: (_u, splits) =>
            splits.map((v) =>
              formatRef.current ? formatRef.current(v) : String(v),
            ),
        },
      ],
      series: [
        {},
        ...series.map((s) => ({
          stroke: s.color,
          fill: s.color + "22",
          width: 1.8,
          points: { show: false },
        })),
      ],
    };

    const plot = new uPlot(opts, [[], ...series.map(() => [])], container);
    plotRef.current = plot;

    const resize = new ResizeObserver(() => {
      plot.setSize({ width: container.clientWidth, height });
    });
    resize.observe(container);

    return () => {
      resize.disconnect();
      plot.destroy();
      tooltip.remove();
      plotRef.current = null;
    };
  }, [series.length, yMax, height]);

  useEffect(() => {
    const length = Math.min(timestamps.length, ...series.map((s) => s.values.length));
    plotRef.current?.setData([
      timestamps.slice(-length),
      ...series.map((s) => s.values.slice(-length)),
    ] as uPlot.AlignedData);
  }, [timestamps, series]);

  return <div ref={containerRef} className="relative w-full" />;
}
