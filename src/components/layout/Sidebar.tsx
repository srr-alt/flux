import { NAVIGATION, type PageId } from "../../config/navigation";
import { HostSwitcher } from "../hosts/HostSwitcher";
import { useDockerStore } from "../../state/dockerStore";
import { useHostsStore } from "../../state/hostsStore";
import { useLockStore } from "../../state/lockStore";
import { useMonitorStore } from "../../state/monitorStore";
import { formatUptime } from "../../lib/format";

interface SidebarProps {
  active: PageId;
  onNavigate: (page: PageId) => void;
}

export function Sidebar({ active, onNavigate }: SidebarProps) {
  const systemInfo = useMonitorStore((s) => s.systemInfo);
  const hostCount = useHostsStore((s) => s.hosts.length) + 1;
  const containerCount = useDockerStore((s) => Object.keys(s.latest).length);
  const locked = useLockStore((s) => s.locked);
  // Alerts hides with Fleet: rules and firings name remote machines.
  const items = NAVIGATION.filter(
    (n) => !(locked && (n.id === "fleet" || n.id === "alerts")),
  );
  // Faint counts next to nav labels (design: Fleet 5, Docker 7).
  const badges: Partial<Record<PageId, number>> = {
    fleet: hostCount,
    docker: containerCount || undefined,
  };

  return (
    <aside className="glass flex w-56 shrink-0 flex-col border-r border-border">
      {/* Global machine picker: Performance and Processes follow it.
          Privacy lock hides it — remote machines are fleet data. */}
      {!locked && (
        <div className="px-2.5 pb-1 pt-3">
          <HostSwitcher />
        </div>
      )}
      <nav className="flex-1 space-y-px px-2.5 py-2.5">
        {items.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            className={`flex w-full items-center gap-2.5 rounded-[10px] px-2 py-[7px] text-left text-[12.5px] font-medium transition-colors duration-150 ${
              active === id
                ? "bg-series-1/14 text-ink-primary shadow-[inset_0_1px_0_rgba(255,255,255,.06)]"
                : "text-ink-muted hover:bg-white/4 hover:text-ink-primary"
            }`}
          >
            <Icon
              size={15}
              strokeWidth={1.8}
              className={active === id ? "text-ink-primary" : "text-ink-faint"}
            />
            {label}
            {badges[id] !== undefined && (
              <span className="ml-auto text-[11px] font-medium text-ink-faint">
                {badges[id]}
              </span>
            )}
          </button>
        ))}
      </nav>
      {systemInfo && (
        <div className="border-t border-border p-3">
          <div className="flex items-center gap-2.5 px-1 py-1">
            <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-raised text-[11px] font-semibold text-ink-muted">
              {systemInfo.hostname.slice(0, 2)}
            </div>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-xs font-medium text-ink-primary">
                {systemInfo.hostname}
              </div>
              <div className="truncate font-mono text-[10px] text-ink-faint">
                {systemInfo.os_pretty_name} · up {formatUptime(systemInfo.uptime_secs)}
              </div>
            </div>
            <span className="ml-auto shrink-0 rounded border border-border px-1 py-0.5 font-mono text-[9px] font-medium text-ink-faint">
              API :7869
            </span>
          </div>
        </div>
      )}
    </aside>
  );
}
