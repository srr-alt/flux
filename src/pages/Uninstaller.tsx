import { useEffect, useMemo, useState } from "react";
import { Search, SearchX } from "lucide-react";
import { listPackages, uninstallPackage } from "../lib/tauri";
import { Banner } from "../components/ui/Banner";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Input } from "../components/ui/Input";
import { LoadingState } from "../components/ui/LoadingState";
import { formatKb } from "../lib/format";
import { Modal } from "../components/ui/Modal";
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
        <Input
          icon={Search}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search packages…"
          className="w-64"
        />
      </div>

      {message && <Banner tone="good">{message}</Banner>}
      {error && <Banner>{error}</Banner>}

      <div className="min-h-0 flex-1 overflow-y-auto glass rounded-2xl border border-border">
        {loading ? (
          <LoadingState label="Loading packages…" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="No packages match"
            hint={search ? `Nothing matches “${search}”.` : undefined}
            className="m-4 border-0"
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="glass-overlay sticky top-0 z-10 shadow-[0_1px_0_var(--color-border)]">
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
                    <Button variant="dangerSoft" size="sm" onClick={() => setConfirm(pkg)}>
                      Uninstall
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {confirm && (
        <Modal
          title={`Uninstall ${confirm.name}?`}
          onClose={() => setConfirm(null)}
          dismissable={!busy}
        >
            <p className="text-sm text-ink-secondary">
              {confirm.summary} ({formatKb(confirm.installed_size_kb)})
            </p>
            <p className="mt-2 text-xs text-ink-muted">
              Runs `apt-get remove` — dependencies used by other packages are kept.
              You'll be asked to authenticate.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirm(null)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => doUninstall(confirm)} loading={busy}>
                {busy ? "Removing…" : "Uninstall"}
              </Button>
            </div>
        </Modal>
      )}
    </div>
  );
}
