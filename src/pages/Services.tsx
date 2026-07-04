import { useEffect, useMemo, useState } from "react";
import { listServices, serviceAction } from "../lib/tauri";
import type { ServiceInfo } from "../types/monitor";

type Verb = "start" | "stop" | "restart" | "enable" | "disable";

export function Services() {
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    listServices()
      .then(setServices)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };
  useEffect(refresh, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return services.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    );
  }, [services, search]);

  const act = async (service: string, verb: Verb) => {
    setBusy(service);
    setError(null);
    try {
      await serviceAction(service, verb);
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const stateColor = (s: ServiceInfo) =>
    s.active_state === "active"
      ? "text-status-good"
      : s.active_state === "failed"
        ? "text-status-critical"
        : "text-ink-muted";

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold text-ink-primary">
          Services{" "}
          <span className="text-sm font-normal text-ink-muted">
            {services.filter((s) => s.active_state === "active").length} active /{" "}
            {services.length}
          </span>
        </h1>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search services…"
          className="w-64 rounded-md border border-border bg-page px-3 py-1.5 text-sm text-ink-primary placeholder:text-ink-muted focus:border-series-1 focus:outline-none"
        />
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-status-critical/40 bg-status-critical/10 px-3 py-2 text-sm text-status-critical">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-surface">
        {loading ? (
          <div className="p-6 text-sm text-ink-muted">Loading services…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="text-left text-xs uppercase tracking-wide text-ink-muted">
                <th className="px-3 py-2 font-medium">Service</th>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="w-20 px-3 py-2 font-medium">State</th>
                <th className="w-20 px-3 py-2 font-medium">Boot</th>
                <th className="w-52 px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.name} className="border-t border-border text-ink-secondary hover:bg-white/5">
                  <td className="px-3 py-1.5 font-medium text-ink-primary">{s.name}</td>
                  <td className="max-w-0 truncate px-3 py-1.5" title={s.description}>
                    {s.description}
                  </td>
                  <td className={`px-3 py-1.5 ${stateColor(s)}`}>{s.active_state}</td>
                  <td className="px-3 py-1.5">{s.unit_file_state || "—"}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex justify-end gap-1 text-xs">
                      {s.active_state === "active" ? (
                        <>
                          <ActionButton label="Restart" disabled={busy === s.name} onClick={() => act(s.name, "restart")} />
                          <ActionButton label="Stop" disabled={busy === s.name} onClick={() => act(s.name, "stop")} />
                        </>
                      ) : (
                        <ActionButton label="Start" disabled={busy === s.name} onClick={() => act(s.name, "start")} />
                      )}
                      {s.unit_file_state === "enabled" ? (
                        <ActionButton label="Disable" disabled={busy === s.name} onClick={() => act(s.name, "disable")} />
                      ) : s.unit_file_state === "disabled" ? (
                        <ActionButton label="Enable" disabled={busy === s.name} onClick={() => act(s.name, "enable")} />
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded px-2 py-0.5 text-ink-muted hover:bg-white/10 hover:text-ink-primary disabled:opacity-40"
    >
      {label}
    </button>
  );
}
