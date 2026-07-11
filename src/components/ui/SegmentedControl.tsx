interface SegmentedControlProps<T extends string | number> {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
}

/** Pill-in-track tab switcher (Tools/Docker subtabs, Settings pickers). */
export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  size = "md",
}: SegmentedControlProps<T>) {
  const item = size === "sm" ? "px-2.5 py-0.5 text-xs" : "px-3 py-1 text-[13px]";
  return (
    <div className="inline-flex rounded-lg border border-border bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          aria-pressed={o.value === value}
          className={`rounded-md transition-colors duration-100 ${item} ${
            o.value === value
              ? "bg-series-1/15 font-medium text-series-1"
              : "text-ink-secondary hover:text-ink-primary"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
