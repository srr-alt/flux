import { useEffect, useState } from "react";
import {
  addStartupApp,
  listStartupApps,
  removeStartupApp,
  setStartupEnabled,
} from "../lib/tauri";
import { Power } from "lucide-react";
import { Modal } from "../components/ui/Modal";
import { EmptyState } from "../components/ui/EmptyState";
import type { StartupApp } from "../types/monitor";

export function Startup() {
  const [apps, setApps] = useState<StartupApp[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newExec, setNewExec] = useState("");

  const refresh = () => {
    listStartupApps().then(setApps).catch((e) => setError(String(e)));
  };
  useEffect(refresh, []);

  const run = async (action: Promise<void>) => {
    setError(null);
    try {
      await action;
      refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-ink-primary">Startup Apps</h1>
        <button
          onClick={() => setShowAdd(true)}
          className="rounded-md bg-series-1 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          Add startup app
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-status-critical/40 bg-status-critical/10 px-3 py-2 text-sm text-status-critical">
          {error}
        </div>
      )}

      <div className="space-y-2">
        {apps.map((app) => (
          <div
            key={app.file_name}
            className="flex items-center gap-4 rounded-lg border border-border bg-surface px-4 py-3"
          >
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={app.enabled}
                onChange={(e) =>
                  run(setStartupEnabled(app.file_name, e.target.checked))
                }
                className="peer sr-only"
              />
              <div className="h-5 w-9 rounded-full bg-gridline transition-colors peer-checked:bg-series-1 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4" />
            </label>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-ink-primary">{app.name}</span>
                {app.is_system && (
                  <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-muted">
                    system
                  </span>
                )}
              </div>
              <div className="truncate text-xs text-ink-muted" title={app.exec}>
                {app.exec}
              </div>
            </div>
            {!app.is_system && (
              <button
                onClick={() => run(removeStartupApp(app.file_name))}
                className="rounded px-2 py-1 text-xs text-status-critical hover:bg-status-critical/15"
              >
                Delete
              </button>
            )}
          </div>
        ))}
        {apps.length === 0 && (
          <EmptyState
            icon={Power}
            title="No startup applications"
            hint="Apps added here launch automatically when you log in."
          />
        )}
      </div>

      {showAdd && (
        <Modal title="Add startup app" onClose={() => setShowAdd(false)}>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name"
              className="w-full rounded-md border border-border bg-page px-3 py-1.5 text-sm text-ink-primary placeholder:text-ink-muted focus:border-series-1 focus:outline-none"
            />
            <input
              value={newExec}
              onChange={(e) => setNewExec(e.target.value)}
              placeholder="Command (e.g. /usr/bin/foo --flag)"
              className="mt-2 w-full rounded-md border border-border bg-page px-3 py-1.5 text-sm text-ink-primary placeholder:text-ink-muted focus:border-series-1 focus:outline-none"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowAdd(false)}
                className="rounded-md px-3 py-1.5 text-sm text-ink-secondary hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  await run(addStartupApp(newName, newExec));
                  setShowAdd(false);
                  setNewName("");
                  setNewExec("");
                }}
                className="rounded-md bg-series-1 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
              >
                Add
              </button>
            </div>
        </Modal>
      )}
    </div>
  );
}
