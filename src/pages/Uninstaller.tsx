import { useEffect, useMemo, useState } from "react";
import { listPackages, uninstallPackage } from "../lib/tauri";
import { formatKb } from "../lib/format";
import type { PackageInfo } from "../types/monitor";

export function Uninstaller() {
  const [packages, setPackages] = useState<PackageInfo[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<PackageInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = () => {
    setLoading(true);
    listPackages()
      .then(setPackages)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };
  useEffect(refresh, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const matches = packages.filter(
      (p) => p.name.toLowerCase().includes(q) || p.summary.toLowerCase().includes(q),
    );
    return matches.slice(0, 300);
  }, [packages, search]);

  const doUninstall = async (pkg: PackageInfo) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await uninstallPackage(pkg.name);
      setMessage(`Removed ${pkg.name}.`);
      setConfirm(null);
      refresh();
    } catch (e) {
      setError(String(e));
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold text-ink-primary">
          Uninstaller{" "}
          <span className="text-sm font-normal text-ink-muted">
            {packages.length} packages
          </span>
        </h1>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search packages…"
          className="w-64 rounded-md border border-border bg-page px-3 py-1.5 text-sm text-ink-primary placeholder:text-ink-muted focus:border-series-1 focus:outline-none"
        />
      </div>

      {message && (
        <div className="mb-3 rounded-md border border-status-good/40 bg-status-good/10 px-3 py-2 text-sm text-status-good">
          {message}
        </div>
      )}
      {error && (
        <div className="mb-3 rounded-md border border-status-critical/40 bg-status-critical/10 px-3 py-2 text-sm text-status-critical">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-surface">
        {loading ? (
          <div className="p-6 text-sm text-ink-muted">Loading packages…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="text-left text-xs uppercase tracking-wide text-ink-muted">
                <th className="px-3 py-2 font-medium">Package</th>
                <th className="px-3 py-2 font-medium">Summary</th>
                <th className="w-24 px-3 py-2 text-right font-medium">Size</th>
                <th className="w-24 px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((pkg) => (
                <tr key={pkg.name} className="border-t border-border text-ink-secondary hover:bg-white/5">
                  <td className="px-3 py-1.5 font-medium text-ink-primary">
                    {pkg.name}
                    <span className="ml-2 text-xs font-normal text-ink-muted">
                      {pkg.version}
                    </span>
                  </td>
                  <td className="max-w-0 truncate px-3 py-1.5" title={pkg.summary}>
                    {pkg.summary}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {formatKb(pkg.installed_size_kb)}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <button
                      onClick={() => setConfirm(pkg)}
                      className="rounded px-2 py-0.5 text-xs text-status-critical hover:bg-status-critical/15"
                    >
                      Uninstall
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {confirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => !busy && setConfirm(null)}
        >
          <div
            className="w-96 rounded-lg border border-border bg-surface p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-ink-primary">
              Uninstall {confirm.name}?
            </h2>
            <p className="mt-2 text-sm text-ink-secondary">
              {confirm.summary} ({formatKb(confirm.installed_size_kb)})
            </p>
            <p className="mt-2 text-xs text-ink-muted">
              Runs `apt-get remove` — dependencies used by other packages are kept.
              You'll be asked to authenticate.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirm(null)}
                disabled={busy}
                className="rounded-md px-3 py-1.5 text-sm text-ink-secondary hover:bg-white/10 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={() => doUninstall(confirm)}
                disabled={busy}
                className="rounded-md bg-status-critical px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
              >
                {busy ? "Removing…" : "Uninstall"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
