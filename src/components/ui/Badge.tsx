import type { ReactNode } from "react";

interface BadgeProps {
  tone?: "neutral" | "accent" | "good" | "warning" | "serious" | "critical";
  /** Dashed outline style (e.g. "saved" compose files). Overrides tone fill. */
  outline?: boolean;
  pulse?: boolean;
  /** Extra classes; lets callers pass a precomputed tone map (statePill). */
  className?: string;
  children: ReactNode;
}

const TONES: Record<NonNullable<BadgeProps["tone"]>, string> = {
  neutral: "bg-white/5 text-ink-muted",
  accent: "bg-series-1/15 text-series-1",
  good: "bg-status-good/15 text-status-good",
  warning: "bg-status-warning/15 text-status-warning",
  serious: "bg-status-serious/15 text-status-serious",
  critical: "bg-status-critical/15 text-status-critical",
};

export function Badge({
  tone = "neutral",
  outline = false,
  pulse = false,
  className = "",
  children,
}: BadgeProps) {
  const fill = outline ? "border border-dashed border-white/20 text-ink-muted" : TONES[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${fill} ${pulse ? "animate-pulse" : ""} ${className}`}
    >
      {children}
    </span>
  );
}
