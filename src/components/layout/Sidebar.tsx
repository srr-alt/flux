import { NAVIGATION, type PageId } from "../../config/navigation";
import { useMonitorStore } from "../../state/monitorStore";

interface SidebarProps {
  active: PageId;
  onNavigate: (page: PageId) => void;
}

export function Sidebar({ active, onNavigate }: SidebarProps) {
  const systemInfo = useMonitorStore((s) => s.systemInfo);

  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-surface">
      <div className="px-4 py-5">
        <div className="text-base font-bold tracking-tight text-ink-primary">
          Vantage
        </div>
        {systemInfo && (
          <div className="mt-0.5 truncate text-xs text-ink-muted">
            {systemInfo.hostname}
          </div>
        )}
      </div>
      <nav className="flex-1 space-y-0.5 px-2">
        {NAVIGATION.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors ${
              active === id
                ? "bg-series-1/15 font-medium text-series-1"
                : "text-ink-secondary hover:bg-white/5 hover:text-ink-primary"
            }`}
          >
            <Icon size={16} strokeWidth={1.8} />
            {label}
          </button>
        ))}
      </nav>
      {systemInfo && (
        <div className="border-t border-border px-4 py-3 text-xs text-ink-muted">
          {systemInfo.os_pretty_name}
        </div>
      )}
    </aside>
  );
}
