import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

export interface SparklineSeries {
  values: number[];
  color: string;
  label: string;
}

interface SparklineProps {
  timestamps: number[];
  series: SparklineSeries[];
  /** Fix the y-axis max (e.g. 100 for percentages); auto-scales when omitted. */
  yMax?: number;
  height?: number;
  formatValue?: (value: number) => string;
}

export function Sparkline({
  timestamps,
  series,
  yMax,
  height = 96,
  formatValue,
}: SparklineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const formatRef = useRef(formatValue);
  formatRef.current = formatValue;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const opts: uPlot.Options = {
      width: container.clientWidth || 300,
      height,
      pxAlign: false,
      cursor: { show: false },
      legend: { show: false },
      scales: {
        x: { time: false },
        y: { range: yMax !== undefined ? [0, yMax] : undefined },
      },
      axes: [{ show: false }, { show: false }],
      series: [
        {},
        ...series.map((s) => ({
          stroke: s.color,
          fill: s.color + "26",
          width: 1.5,
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
    // Chart structure only depends on series count / y-scale; data flows via setData.
  }, [series.length, yMax, height]);

  useEffect(() => {
    plotRef.current?.setData([
      timestamps,
      ...series.map((s) => s.values),
    ] as uPlot.AlignedData);
  }, [timestamps, series]);

  return <div ref={containerRef} className="w-full" />;
}
