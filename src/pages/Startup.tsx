import { useEffect, useState } from "react";
import {
  addStartupApp,
  listStartupApps,
  removeStartupApp,
  setStartupEnabled,
} from "../lib/tauri";
import { Power } from "lucide-react";
import { Badge } from "../components/ui/Badge";
import { Banner } from "../components/ui/Banner";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Modal } from "../components/ui/Modal";
import { EmptyState } from "../components/ui/EmptyState";
import { LoadingState } from "../components/ui/LoadingState";
import type { StartupApp } from "../types/monitor";

export function Startup() {
  const [apps, setApps] = useState<StartupApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newExec, setNewExec] = useState("");

  const refresh = () => {
    listStartupApps()
      .then(setApps)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
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
        <Button variant="primary" onClick={() => setShowAdd(true)}>
          Add startup app
        </Button>
      </div>

      {error && <Banner>{error}</Banner>}

      <div className="space-y-2">
        {apps.map((app) => (
          <div
            key={app.file_name}
            className="flex items-center gap-4 glass rounded-2xl border border-border px-4 py-3"
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
                {app.is_system && <Badge>system</Badge>}
              </div>
              <div className="truncate text-xs text-ink-muted" title={app.exec}>
                {app.exec}
              </div>
            </div>
            {!app.is_system && (
              <Button
                variant="dangerSoft"
                size="sm"
                onClick={() => run(removeStartupApp(app.file_name))}
              >
                Delete
              </Button>
            )}
          </div>
        ))}
        {loading && apps.length === 0 && <LoadingState label="Loading startup apps…" />}
        {!loading && apps.length === 0 && (
          <EmptyState
            icon={Power}
            title="No startup applications"
            hint="Apps added here launch automatically when you log in."
          />
        )}
      </div>

      {showAdd && (
        <Modal title="Add startup app" onClose={() => setShowAdd(false)}>
          <Input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name"
            className="w-full"
          />
          <Input
            value={newExec}
            onChange={(e) => setNewExec(e.target.value)}
            placeholder="Command (e.g. /usr/bin/foo --flag)"
            className="mt-2 w-full"
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                await run(addStartupApp(newName, newExec));
                setShowAdd(false);
                setNewName("");
                setNewExec("");
              }}
            >
              Add
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
