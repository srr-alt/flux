import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, Copy, X } from "lucide-react";
import { NAVIGATION, type PageId } from "../../config/navigation";
import { LOCAL_HOST_ID, useHostsStore } from "../../state/hostsStore";
import { useLockStore } from "../../state/lockStore";
import { useMonitorStore } from "../../state/monitorStore";

const win = getCurrentWindow();

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now.toLocaleTimeString("en-GB");
}

export function TitleBar({
  page,
  assistantOpen,
  onToggleAssistant,
}: {
  page: PageId;
  assistantOpen: boolean;
  onToggleAssistant: () => void;
}) {
  const [maximized, setMaximized] = useState(false);
  const clock = useClock();
  const locked = useLockStore((s) => s.locked);
  const hosts = useHostsStore((s) => s.hosts);
  const selected = useHostsStore((s) => s.selectedHostId);
  const localHostname = useMonitorStore((s) => s.systemInfo?.hostname);

  useEffect(() => {
    win.isMaximized().then(setMaximized);
    const unlisten = win.onResized(() => {
      win.isMaximized().then(setMaximized);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // The `data-tauri-drag-region` attribute alone doesn't reliably move an
  // undecorated window on Linux/GTK — wiring startDragging() explicitly does.
  const onMouseDown = (e: React.MouseEvent) => {
    // Mousedown on the window buttons bubbles up here; startDragging()
    // would grab the pointer and the button's click event never fires.
    if ((e.target as HTMLElement).closest("button")) return;
    if (e.buttons === 1) {
      if (e.detail === 2) {
        win.toggleMaximize();
      } else {
        win.startDragging();
      }
    }
  };

  const hostName =
    selected === LOCAL_HOST_ID
      ? localHostname ?? "local"
      : hosts.find((h) => h.id === selected)?.name ?? "unknown";
  const pageLabel = NAVIGATION.find((n) => n.id === page)?.label.toLowerCase() ?? page;

  return (
    <div
      onMouseDown={onMouseDown}
      className="glass flex h-[38px] shrink-0 select-none items-center gap-2.5 border-b border-border px-3"
    >
      {/* logo orb with orbit ring */}
      <span className="pointer-events-none relative flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#8b93e8,#5e6ad2_60%,#2a3070)] text-[10px] font-bold text-white">
        F
        <span className="absolute h-[11px] w-[28px] -rotate-[18deg] rounded-full border border-[#8b93e8]/50" />
      </span>
      <span className="pointer-events-none text-[12.5px] font-semibold tracking-tight text-ink-primary">
        Flux
      </span>
      <span className="pointer-events-none truncate font-mono text-[10.5px] text-ink-faint">
        {hostName} · {pageLabel}
      </span>
      <div className="flex-1" />
      <div className="glass pointer-events-none flex items-center gap-[7px] rounded-full border border-border px-2.5 py-[3px]">
        <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-status-good text-status-good" />
        <span className="font-mono text-[10.5px] font-medium tabular-nums text-ink-muted">
          {clock}
        </span>
      </div>
      {!locked && (
        <button
          onClick={onToggleAssistant}
          className={`ml-2.5 flex items-center gap-[5px] rounded-full px-3 py-[5px] text-[11px] font-medium transition-colors duration-150 ${
            assistantOpen
              ? "bg-series-1/15 text-ink-primary"
              : "text-ink-muted hover:bg-white/10 hover:text-ink-secondary"
          }`}
        >
          ✦ Assistant
        </button>
      )}
      <div className="ml-1 flex items-center gap-0.5">
        <button
          onClick={() => win.minimize()}
          className="flex h-[26px] w-[30px] items-center justify-center rounded-md text-ink-muted transition-colors duration-100 hover:bg-white/10 hover:text-ink-primary"
          aria-label="Minimize"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => win.toggleMaximize()}
          className="flex h-[26px] w-[30px] items-center justify-center rounded-md text-ink-muted transition-colors duration-100 hover:bg-white/10 hover:text-ink-primary"
          aria-label="Maximize"
        >
          {maximized ? <Copy size={12} /> : <Square size={12} />}
        </button>
        <button
          onClick={() => win.close()}
          className="flex h-[26px] w-[30px] items-center justify-center rounded-md text-ink-muted transition-colors duration-100 hover:bg-status-critical/20 hover:text-status-critical"
          aria-label="Close"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
