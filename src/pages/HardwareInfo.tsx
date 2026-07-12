import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search, SearchX } from "lucide-react";
import { getHardwareInfo } from "../lib/tauri";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Input } from "../components/ui/Input";
import { LoadingState } from "../components/ui/LoadingState";
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
    <div className="glass rounded-2xl border border-border">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-t-xl px-4 py-2.5 text-left transition-colors duration-100 hover:bg-white/5"
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
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold text-ink-primary">System Info</h1>
        <div className="flex items-center gap-2">
          <Input
            icon={Search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search hardware info…"
            className="w-64"
          />
          <Button onClick={load} loading={loading}>
            Refresh
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered === null ? (
          <LoadingState label="Reading hardware…" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="No matches"
            hint={search ? `Nothing matches “${search}”.` : undefined}
          />
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
