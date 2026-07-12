import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LOCAL_HOST_ID, useHostsStore } from "../../state/hostsStore";
import { useMonitorStore } from "../../state/monitorStore";

type DotTone = "on" | "warn" | "off";

/** Little planet: radial-gradient sphere, glows when the host is reachable. */
function Dot({ tone }: { tone: DotTone }) {
  const cls =
    tone === "on"
      ? "bg-[radial-gradient(circle_at_35%_30%,#9aa3f0,#5e6ad2_60%,#101018)] shadow-[0_0_7px_rgba(94,106,210,.55)]"
      : tone === "warn"
        ? "bg-[radial-gradient(circle_at_35%_30%,#e4c17a,#d0a24c_60%,#101018)] shadow-[0_0_7px_rgba(208,162,76,.45)]"
        : "bg-[radial-gradient(circle_at_35%_30%,#6b7180,#3a3d46_60%,#101018)]";
  return <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${cls}`} />;
}

/** Dropdown to scope a page to the local machine or a remote host. */
export function HostSwitcher() {
  const hosts = useHostsStore((s) => s.hosts);
  const statuses = useHostsStore((s) => s.statuses);
  const selected = useHostsStore((s) => s.selectedHostId);
  const setSelected = useHostsStore((s) => s.setSelected);
  const localHostname = useMonitorStore((s) => s.systemInfo?.hostname);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const tone = (id: string): DotTone => {
    if (id === LOCAL_HOST_ID) return "on";
    const s = statuses[id];
    return s?.state === "connected"
      ? "on"
      : s?.state === "connecting" || s?.state === "degraded"
        ? "warn"
        : "off";
  };
  const sub = (id: string) => {
    if (id === LOCAL_HOST_ID) return "local";
    const h = hosts.find((x) => x.id === id);
    if (!h) return "";
    return statuses[id]?.state === "connected" || statuses[id]?.state === "connecting"
      ? h.address
      : `${h.address} · out of orbit`;
  };

  const selectedName =
    selected === LOCAL_HOST_ID
      ? localHostname ?? "This machine"
      : hosts.find((h) => h.id === selected)?.name ?? "Unknown host";

  return (
    <div className="relative" ref={ref}>
      <button
        ref={triggerRef}
        className="glass flex w-full items-center gap-2.5 rounded-2xl border border-white/8 px-2.5 py-2 text-left transition-colors duration-150 hover:border-white/16"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Dot tone={tone(selected)} />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-xs font-semibold text-ink-primary">
            {selectedName}
          </span>
          <span className="block truncate font-mono text-[9.5px] text-ink-faint">
            {sub(selected)}
          </span>
        </span>
        <ChevronDown size={12} className="shrink-0 text-ink-faint" />
      </button>
      {open && (
        <div
          className="glass-overlay absolute left-0 top-full z-40 mt-1.5 w-full min-w-48 origin-top animate-pop-in rounded-[18px] border border-white/10 p-1 shadow-[0_12px_32px_rgba(0,0,0,.5)]"
          role="listbox"
          aria-label="Select host"
        >
          <Item
            label={localHostname ?? "This machine"}
            sub="local"
            active={selected === LOCAL_HOST_ID}
            tone={tone(LOCAL_HOST_ID)}
            onClick={() => {
              setSelected(LOCAL_HOST_ID);
              setOpen(false);
            }}
          />
          {hosts.map((h) => (
            <Item
              key={h.id}
              label={h.name}
              sub={h.address}
              active={selected === h.id}
              tone={tone(h.id)}
              onClick={() => {
                setSelected(h.id);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Item({
  label,
  sub,
  active,
  tone,
  onClick,
}: {
  label: string;
  sub: string;
  active: boolean;
  tone: DotTone;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-[7px] text-left text-xs font-medium transition-colors duration-100 hover:bg-white/6 ${
        active ? "bg-series-1/14 text-ink-primary" : "text-ink-muted"
      }`}
      onClick={onClick}
      role="option"
      aria-selected={active}
    >
      <Dot tone={tone} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 font-mono text-[9.5px] text-ink-faint">{sub}</span>
    </button>
  );
}
