import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { Banner } from "../../components/ui/Banner";

export function RowButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded-md border border-transparent px-2 py-0.5 text-ink-muted transition-colors duration-100 hover:border-border hover:bg-white/10 hover:text-ink-primary disabled:opacity-40"
    >
      {disabled && <RefreshCw size={10} className="animate-spin" />}
      {label}
    </button>
  );
}

export function DangerButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-transparent px-2 py-0.5 text-status-critical transition-colors duration-100 hover:border-status-critical/30 hover:bg-status-critical/15 disabled:opacity-40"
    >
      {label}
    </button>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return <Banner>{message}</Banner>;
}

/** Scrollable bordered table container shared by every resource tab. */
export function TableShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-surface">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function HeadRow({ children }: { children: ReactNode }) {
  return (
    <thead className="sticky top-0 z-10 bg-surface shadow-[0_1px_0_var(--color-border)]">
      <tr className="text-left text-xs uppercase tracking-wide text-ink-muted">
        {children}
      </tr>
    </thead>
  );
}

export function statePill(state: string): { cls: string; pulse: boolean } {
  switch (state) {
    case "running":
      return { cls: "bg-status-good/15 text-status-good", pulse: false };
    case "paused":
      return { cls: "bg-status-warning/15 text-status-warning", pulse: false };
    case "restarting":
      return { cls: "bg-status-warning/15 text-status-warning", pulse: true };
    case "dead":
      return { cls: "bg-status-critical/15 text-status-critical", pulse: false };
    default: // exited, created
      return { cls: "bg-white/5 text-ink-muted", pulse: false };
  }
}
