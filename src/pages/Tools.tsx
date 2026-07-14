import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { ScreenHeader } from "../components/layout/ScreenHeader";
import type { PageId } from "../config/navigation";
import { formatKb } from "../lib/format";
import {
  alertsActive,
  alertsListRules,
  getUsageLogStatus,
  listPackages,
  listServices,
  listStartupApps,
} from "../lib/tauri";
import { useLockStore } from "../state/lockStore";
import { useMonitorStore } from "../state/monitorStore";
import { Alerts } from "./Alerts";
import { Cleaner } from "./Cleaner";
import { HardwareInfo } from "./HardwareInfo";
import { Services } from "./Services";
import { Startup } from "./Startup";
import { Uninstaller } from "./Uninstaller";

const TOOLS: { id: string; label: string; Component: ComponentType }[] = [
  { id: "alerts", label: "Alerts", Component: Alerts },
  { id: "services", label: "Services", Component: Services },
  { id: "startup", label: "Startup apps", Component: Startup },
  { id: "cleaner", label: "Cleaner", Component: Cleaner },
  { id: "uninstaller", label: "Uninstaller", Component: Uninstaller },
  { id: "hardware", label: "System Info", Component: HardwareInfo },
];

interface ToolStats {
  services?: { loaded: number; failed: number };
  startupEnabled?: number;
  packages?: number;
  logging?: { active: boolean; rows: number };
  alerts?: { rules: number; enabled: number; firing: number };
}

function ToolCard({
  icon,
  title,
  desc,
  stat,
  statClass = "text-ink-muted",
  onClick,
}: {
  icon: string;
  title: string;
  desc: string;
  stat: ReactNode;
  statClass?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="glass flex cursor-pointer flex-col gap-2.5 rounded-2xl border border-border p-4 text-left transition-[transform,border-color] duration-150 hover:-translate-y-0.5 hover:border-white/[.13]"
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-[30px] w-[30px] items-center justify-center rounded-2xl bg-white/[.06] text-sm">
          {icon}
        </span>
        <span className="text-[13px] font-semibold text-ink-primary">{title}</span>
      </div>
      <span className="text-[11px] leading-relaxed text-ink-muted">{desc}</span>
      <span className={`mt-auto font-mono text-[11px] font-medium ${statClass}`}>{stat}</span>
    </button>
  );
}

export function Tools({ onNavigate }: { onNavigate?: (page: PageId) => void }) {
  const [active, setActive] = useState<string | null>(null);
  const [stats, setStats] = useState<ToolStats>({});
  const systemInfo = useMonitorStore((s) => s.systemInfo);
  // Alerts hides under the privacy lock: rules and firings name remote
  // machines. Bounce out if the lock engages while it's open.
  const locked = useLockStore((s) => s.locked);
  useEffect(() => {
    if (locked && active === "alerts") setActive(null);
  }, [locked, active]);

  // Card stat lines — each source is cheap (no cleaner scan) and optional.
  useEffect(() => {
    if (active !== null) return;
    let gone = false;
    listServices()
      .then((all) => {
        if (gone) return;
        setStats((s) => ({
          ...s,
          services: {
            loaded: all.length,
            failed: all.filter((u) => u.active_state === "failed").length,
          },
        }));
      })
      .catch(() => {});
    listStartupApps()
      .then((all) => {
        if (!gone)
          setStats((s) => ({ ...s, startupEnabled: all.filter((a) => a.enabled).length }));
      })
      .catch(() => {});
    listPackages()
      .then((all) => {
        if (!gone) setStats((s) => ({ ...s, packages: all.length }));
      })
      .catch(() => {});
    getUsageLogStatus()
      .then((st) => {
        if (!gone) setStats((s) => ({ ...s, logging: { active: st.active, rows: st.rows } }));
      })
      .catch(() => {});
    Promise.all([alertsListRules(), alertsActive()])
      .then(([rules, firing]) => {
        if (!gone)
          setStats((s) => ({
            ...s,
            alerts: {
              rules: rules.length,
              enabled: rules.filter((r) => r.enabled).length,
              firing: firing.length,
            },
          }));
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [active]);

  const tool = TOOLS.find((t) => t.id === active);
  if (tool) {
    const Component = tool.Component;
    return (
      <div className="flex h-full flex-col">
        <ScreenHeader
          title="Tools"
          sub={tool.label.toLowerCase()}
          actions={
            <button
              onClick={() => setActive(null)}
              className="flex items-center gap-1 rounded-full border border-white/12 px-3 py-1 text-xs font-medium text-ink-secondary transition-colors duration-100 hover:bg-white/10 hover:text-ink-primary"
            >
              <ChevronLeft size={12} /> All tools
            </button>
          }
        />
        <div className="min-h-0 flex-1">
          <Component />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Tools" sub="this machine" />
      <div className="flex flex-col gap-4 p-5">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
          {!locked && (
            <ToolCard
              icon="🔔"
              title="Alerts"
              desc="Threshold rules, desktop notifications, tray health."
              stat={
                stats.alerts
                  ? stats.alerts.firing > 0
                    ? `${stats.alerts.firing} firing`
                    : stats.alerts.enabled > 0
                      ? `${stats.alerts.enabled} enabled · watching`
                      : stats.alerts.rules > 0
                        ? `${stats.alerts.rules} rules · all off`
                        : "no rules yet"
                  : "…"
              }
              statClass={
                stats.alerts && stats.alerts.firing > 0
                  ? "text-status-critical"
                  : stats.alerts && stats.alerts.enabled > 0
                    ? "text-status-good"
                    : "text-ink-muted"
              }
              onClick={() => setActive("alerts")}
            />
          )}
          <ToolCard
            icon="⚙"
            title="Services"
            desc="systemd units — start, stop, restart, enable, disable."
            stat={
              stats.services
                ? `${stats.services.loaded} loaded · ${stats.services.failed} failed`
                : "…"
            }
            statClass={
              stats.services && stats.services.failed > 0
                ? "text-status-critical"
                : "text-ink-muted"
            }
            onClick={() => setActive("services")}
          />
          <ToolCard
            icon="⏻"
            title="Startup apps"
            desc="Toggle, add or delete autostart entries."
            stat={stats.startupEnabled !== undefined ? `${stats.startupEnabled} enabled` : "…"}
            onClick={() => setActive("startup")}
          />
          <ToolCard
            icon="🧹"
            title="Cleaner"
            desc="Scan caches, logs, orphans. Root categories via pkexec."
            stat="open to scan"
            statClass="text-status-warning"
            onClick={() => setActive("cleaner")}
          />
          <ToolCard
            icon="📦"
            title="Uninstaller"
            desc="apt packages — search and remove by size."
            stat={
              stats.packages !== undefined
                ? `${stats.packages.toLocaleString()} packages`
                : "…"
            }
            onClick={() => setActive("uninstaller")}
          />
          <ToolCard
            icon="▤"
            title="System Info"
            desc="Hardware inventory, searchable, collapsible sections."
            stat={
              systemInfo
                ? `${systemInfo.physical_cores}C/${systemInfo.logical_cores}T · ${formatKb(systemInfo.total_memory_kb)}`
                : "…"
            }
            onClick={() => setActive("hardware")}
          />
          <ToolCard
            icon="▦"
            title="Usage logging"
            desc="Record samples to CSV for later analysis."
            stat={
              stats.logging
                ? stats.logging.active
                  ? `recording · ${stats.logging.rows.toLocaleString()} rows`
                  : "off"
                : "…"
            }
            statClass={stats.logging?.active ? "text-status-good" : "text-ink-muted"}
            onClick={() => onNavigate?.("settings")}
          />
        </div>
      </div>
    </div>
  );
}
