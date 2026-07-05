import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  hint?: ReactNode;
  /** Caller-styled action node (button/CTA). */
  action?: ReactNode;
  className?: string;
}

/** Shared empty state, styled after the Fleet page's dashed card. */
export function EmptyState({ icon: Icon, title, hint, action, className = "" }: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 p-8 text-center ${className}`}
    >
      {Icon && <Icon size={20} className="text-ink-muted" />}
      <span className="text-sm font-medium text-ink-secondary">{title}</span>
      {hint && <div className="max-w-md text-xs leading-relaxed text-ink-muted">{hint}</div>}
      {action}
    </div>
  );
}
