interface MeterProps {
  /** 0..1 */
  ratio: number;
  color?: string;
  label?: string;
  detail?: string;
}

export function Meter({ ratio, color = "#3987e5", label, detail }: MeterProps) {
  const clamped = Math.max(0, Math.min(1, ratio));
  return (
    <div>
      {(label || detail) && (
        <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
          <span className="truncate text-ink-secondary">{label}</span>
          <span className="shrink-0 tabular-nums text-ink-muted">{detail}</span>
        </div>
      )}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gridline">
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{ width: `${clamped * 100}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
