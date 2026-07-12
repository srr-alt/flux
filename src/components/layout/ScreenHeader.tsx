import type { ReactNode } from "react";

interface ScreenHeaderProps {
  title: string;
  /** Mono metadata next to the title (host, daemon, cadence…). */
  sub?: string;
  /** Right-aligned controls (tabs, primary actions). */
  actions?: ReactNode;
}

/** Design-system screen header: 48px strip under the titlebar with the
 * screen name and a mono context line. Pages render it as their first child
 * and put their content in a padded container below. */
export function ScreenHeader({ title, sub, actions }: ScreenHeaderProps) {
  return (
    <div className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-3.5 border-b border-border bg-page/85 px-5 backdrop-blur-md">
      <span className="text-sm font-semibold tracking-tight text-ink-primary">{title}</span>
      {sub && <span className="min-w-0 truncate font-mono text-[11px] text-ink-faint">{sub}</span>}
      {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
