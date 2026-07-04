import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw, Search } from "lucide-react";
import { getHardwareInfo } from "../lib/tauri";
import type { InfoSection } from "../types/monitor";

function SectionCard({
  section,
  forceOpen,
}: {
  section: InfoSection;
  forceOpen: boolean;
}) {
  const [open, setOpen] = useState(true);
  const isOpen = forceOpen || open;

  return (
    <div className="rounded-lg border border-border bg-surface">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
      >
        {isOpen ? (
          <ChevronDown size={14} className="shrink-0 text-ink-muted" />
        ) : (
          <ChevronRight size={14} className="shrink-0 text-ink-muted" />
        )}
        <span className="text-sm font-medium text-ink-primary">
          {section.title}
        </span>
        <span className="ml-auto text-xs text-ink-muted">
          {section.entries.length}
        </span>
      </button>
      {isOpen && (
        <dl className="grid grid-cols-[minmax(180px,auto)_1fr] gap-x-6 gap-y-1 border-t border-border px-4 py-3 text-sm">
          {section.entries.map((e, i) => (
            <div key={`${e.label}-${i}`} className="contents">
              <dt className="text-ink-muted">{e.label}</dt>
              <dd className="break-words text-ink-secondary">{e.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export function HardwareInfo() {
  const [sections, setSections] = useState<InfoSection[] | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    getHardwareInfo()
      .then(setSections)
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const filtered = useMemo(() => {
    if (!sections) return null;
    const q = search.trim().toLowerCase();
    if (!q) return sections;
    return sections
      .map((s) => ({
        ...s,
        entries: s.entries.filter(
          (e) =>
            e.label.toLowerCase().includes(q) ||
            e.value.toLowerCase().includes(q),
        ),
      }))
      .filter((s) => s.entries.length > 0);
  }, [sections, search]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-6 py-4">
        <div className="relative flex-1 max-w-sm">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search hardware info…"
            className="w-full rounded-md border border-border bg-surface py-1.5 pl-9 pr-3 text-sm text-ink-primary placeholder:text-ink-muted focus:outline-none focus:ring-1 focus:ring-series-1/50"
          />
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-ink-secondary transition-colors hover:text-ink-primary disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        {filtered === null ? (
          <span className="text-sm text-ink-muted">Reading hardware…</span>
        ) : filtered.length === 0 ? (
          <span className="text-sm text-ink-muted">No matches.</span>
        ) : (
          <div className="flex flex-col gap-3">
            {filtered.map((s) => (
              <SectionCard
                key={s.id}
                section={s}
                forceOpen={search.trim().length > 0}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
