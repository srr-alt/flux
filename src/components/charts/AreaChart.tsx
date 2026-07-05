import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

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

/** Detail chart: gridlines + labeled y axis, canvas-rendered via uPlot. */
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const opts: uPlot.Options = {
      width: container.clientWidth || 600,
      height,
      pxAlign: false,
      cursor: { show: false },
      legend: { show: false },
      scales: {
        x: { time: true },
        y: { range: yMax !== undefined ? [0, yMax] : undefined },
      },
      axes: [
        {
          stroke: "#8a8f98",
          font: "11px system-ui",
          grid: { show: false },
          ticks: { show: false },
        },
        {
          stroke: "#8a8f98",
          font: "11px system-ui",
          size: 58,
          grid: { stroke: "#26282c", width: 1 },
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

  return <div ref={containerRef} className="w-full" />;
}
