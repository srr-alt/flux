import type { ReactNode } from "react";

interface BannerProps {
  tone?: "critical" | "warning" | "good";
  children: ReactNode;
}

const TONES: Record<NonNullable<BannerProps["tone"]>, string> = {
  critical: "border-status-critical/40 bg-status-critical/10 text-status-critical",
  warning: "border-status-warning/40 bg-status-warning/10 text-status-warning",
  good: "border-status-good/40 bg-status-good/10 text-status-good",
};

/** Inline feedback strip above tables/forms (errors, scan results). */
export function Banner({ tone = "critical", children }: BannerProps) {
  return (
    <div className={`mb-3 rounded-md border px-3 py-2 text-sm ${TONES[tone]}`}>{children}</div>
  );
}
