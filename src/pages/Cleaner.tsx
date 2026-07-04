import { useEffect, useState } from "react";
import { cleanCategory, scanCleanable } from "../lib/tauri";
import { formatBytes } from "../lib/format";
import type { CleanCategory } from "../types/monitor";

export function Cleaner() {
  const [categories, setCategories] = useState<CleanCategory[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scan = () => {
    setScanning(true);
    scanCleanable()
      .then(setCategories)
      .catch((e) => setError(String(e)))
      .finally(() => setScanning(false));
  };
  useEffect(scan, []);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedSize = categories
    .filter((c) => selected.has(c.id))
    .reduce((sum, c) => sum + c.size_bytes, 0);

  const clean = async () => {
    setCleaning(true);
    setError(null);
    setMessage(null);
    const cleaned: string[] = [];
    try {
      for (const id of selected) {
        await cleanCategory(id);
        cleaned.push(id);
      }
      setMessage(`Cleaned ${formatBytes(selectedSize)} across ${cleaned.length} categories.`);
      setSelected(new Set());
    } catch (e) {
      setError(String(e));
    } finally {
      setCleaning(false);
      scan();
    }
  };

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-ink-primary">System Cleaner</h1>
        <button
          onClick={scan}
          disabled={scanning}
          className="rounded-md px-3 py-1.5 text-sm text-ink-secondary hover:bg-white/10 disabled:opacity-40"
        >
          {scanning ? "Scanning…" : "Rescan"}
        </button>
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

      <div className="space-y-2">
        {categories.map((cat) => (
          <label
            key={cat.id}
            className="flex cursor-pointer items-center gap-4 rounded-lg border border-border bg-surface px-4 py-3 hover:bg-white/5"
          >
            <input
              type="checkbox"
              checked={selected.has(cat.id)}
              onChange={() => toggle(cat.id)}
              disabled={cat.size_bytes === 0}
              className="h-4 w-4 accent-[#3987e5]"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-ink-primary">{cat.label}</span>
                {cat.needs_root && (
                  <span className="rounded bg-status-warning/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-status-warning">
                    needs auth
                  </span>
                )}
              </div>
              <div className="text-xs text-ink-muted">{cat.description}</div>
            </div>
            <div className="text-right">
              <div className="font-medium tabular-nums text-ink-primary">
                {formatBytes(cat.size_bytes)}
              </div>
              {cat.item_count > 0 && (
                <div className="text-xs tabular-nums text-ink-muted">
                  {cat.item_count} files
                </div>
              )}
            </div>
          </label>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-sm text-ink-secondary">
          {selected.size > 0
            ? `${formatBytes(selectedSize)} selected`
            : "Select categories to clean"}
        </span>
        <button
          onClick={clean}
          disabled={selected.size === 0 || cleaning}
          className="rounded-md bg-series-1 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          {cleaning ? "Cleaning…" : "Clean selected"}
        </button>
      </div>
    </div>
  );
}
