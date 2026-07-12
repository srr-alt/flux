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
  const item = size === "sm" ? "px-3 py-0.5 text-xs" : "px-3.5 py-1 text-[13px]";
  return (
    <div className="glass inline-flex rounded-full border border-white/8 p-[3px]">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          aria-pressed={o.value === value}
          className={`rounded-full transition-colors duration-100 ${item} ${
            o.value === value
              ? "bg-series-1/22 font-semibold text-ink-primary shadow-[inset_0_1px_0_rgba(255,255,255,.08)]"
              : "text-ink-muted hover:text-ink-primary"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
