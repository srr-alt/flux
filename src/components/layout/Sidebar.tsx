import { Zap } from "lucide-react";
import { NAVIGATION, type PageId } from "../../config/navigation";
import { useMonitorStore } from "../../state/monitorStore";

interface SidebarProps {
  active: PageId;
  onNavigate: (page: PageId) => void;
}

export function Sidebar({ active, onNavigate }: SidebarProps) {
  const systemInfo = useMonitorStore((s) => s.systemInfo);

  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-page">
      <div className="flex items-center gap-2.5 px-4 pb-4 pt-4">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-series-1/20">
          <Zap size={13} className="text-series-1" />
        </span>
        <div className="min-w-0 leading-tight">
          <div className="text-[13px] font-semibold tracking-tight text-ink-primary">
            Flux
          </div>
          {systemInfo && (
            <div className="truncate text-[11px] text-ink-muted">
              {systemInfo.hostname}
            </div>
          )}
        </div>
      </div>
      <div className="px-4 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-muted/70">
        Workspace
      </div>
      <nav className="flex-1 space-y-px px-2">
        {NAVIGATION.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors duration-100 ${
              active === id
                ? "bg-white/[0.07] font-medium text-ink-primary"
                : "text-ink-secondary hover:bg-white/[0.04] hover:text-ink-primary"
            }`}
          >
            <Icon
              size={15}
              strokeWidth={1.8}
              className={active === id ? "text-series-1" : "text-ink-muted"}
            />
            {label}
          </button>
        ))}
      </nav>
      {systemInfo && (
        <div className="truncate border-t border-border px-4 py-2.5 text-[11px] text-ink-muted">
          {systemInfo.os_pretty_name}
        </div>
      )}
    </aside>
  );
}
