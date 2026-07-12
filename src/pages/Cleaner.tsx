import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { cleanCategory, scanCleanable } from "../lib/tauri";
import { Badge } from "../components/ui/Badge";
import { Banner } from "../components/ui/Banner";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { LoadingState } from "../components/ui/LoadingState";
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
        <Button variant="ghost" onClick={scan} loading={scanning}>
          {scanning ? "Scanning…" : "Rescan"}
        </Button>
      </div>

      {message && <Banner tone="good">{message}</Banner>}
      {error && <Banner>{error}</Banner>}

      {scanning && categories.length === 0 && (
        <LoadingState label="Scanning for cleanable files…" />
      )}
      {!scanning && categories.length === 0 && !error && (
        <EmptyState
          icon={Trash2}
          title="Nothing to clean"
          hint="Caches and logs will show up here as they accumulate."
        />
      )}

      <div className="space-y-2">
        {categories.map((cat) => (
          <label
            key={cat.id}
            className="flex cursor-pointer items-center gap-4 glass rounded-2xl border border-border px-4 py-3 hover:bg-white/5"
          >
            <input
              type="checkbox"
              checked={selected.has(cat.id)}
              onChange={() => toggle(cat.id)}
              disabled={cat.size_bytes === 0}
              className="h-4 w-4 accent-series-1"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-ink-primary">{cat.label}</span>
                {cat.needs_root && <Badge tone="warning">needs auth</Badge>}
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
        <Button
          variant="primary"
          onClick={clean}
          disabled={selected.size === 0}
          loading={cleaning}
          className="px-4 py-2"
        >
          {cleaning ? "Cleaning…" : "Clean selected"}
        </Button>
      </div>
    </div>
  );
}
