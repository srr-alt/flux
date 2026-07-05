import { ChevronDown, Monitor, Server } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LOCAL_HOST_ID, useHostsStore } from "../../state/hostsStore";

/** Dropdown to scope a page to the local machine or a remote host. */
export function HostSwitcher() {
  const hosts = useHostsStore((s) => s.hosts);
  const statuses = useHostsStore((s) => s.statuses);
  const selected = useHostsStore((s) => s.selectedHostId);
  const setSelected = useHostsStore((s) => s.setSelected);
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

  if (hosts.length === 0) return null;

  const selectedName =
    selected === LOCAL_HOST_ID
      ? "This machine"
      : hosts.find((h) => h.id === selected)?.name ?? "Unknown host";

  const dot = (id: string) => {
    if (id === LOCAL_HOST_ID) return "bg-status-good";
    const s = statuses[id];
    return s?.state === "connected"
      ? "bg-status-good"
      : s?.state === "connecting" || s?.state === "degraded"
        ? "bg-status-warning"
        : "bg-status-critical";
  };

  return (
    <div className="relative" ref={ref}>
      <button
        ref={triggerRef}
        className="flex items-center gap-2 rounded border border-border bg-surface px-2.5 py-1 text-xs text-ink-secondary hover:border-white/25"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dot(selected)}`} />
        {selectedName}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-40 mt-1 min-w-48 rounded border border-border bg-surface py-1 shadow-lg"
          role="listbox"
          aria-label="Select host"
        >
          <Item
            icon={Monitor}
            label="This machine"
            active={selected === LOCAL_HOST_ID}
            dotCls={dot(LOCAL_HOST_ID)}
            onClick={() => {
              setSelected(LOCAL_HOST_ID);
              setOpen(false);
            }}
          />
          {hosts.map((h) => (
            <Item
              key={h.id}
              icon={Server}
              label={h.name}
              active={selected === h.id}
              dotCls={dot(h.id)}
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
  icon: Icon,
  label,
  active,
  dotCls,
  onClick,
}: {
  icon: typeof Monitor;
  label: string;
  active: boolean;
  dotCls: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-white/10 ${
        active ? "text-series-1" : "text-ink-secondary"
      }`}
      onClick={onClick}
      role="option"
      aria-selected={active}
    >
      <Icon size={13} className="shrink-0" />
      <span className="truncate">{label}</span>
      <span className={`ml-auto h-1.5 w-1.5 rounded-full ${dotCls}`} />
    </button>
  );
}
