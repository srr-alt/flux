import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FileClock, FilePlus, Layers } from "lucide-react";
import {
  composeAction,
  composeFileForget,
  composeFilesList,
  composeUpFile,
  listComposeProjects,
} from "../../lib/tauri";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { LoadingState } from "../../components/ui/LoadingState";
import type { ComposeProject } from "../../types/monitor";
import { ErrorBanner, HeadRow, RowButton, TableShell } from "./shared";

/** compose ls status like "running(2)" or "running(1), exited(1)". */
function statusCls(status: string): string {
  const running = status.includes("running");
  const other = /exited|paused|dead|created/.test(status);
  if (running && !other) return "bg-status-good/15 text-status-good";
  if (running && other) return "bg-status-warning/15 text-status-warning";
  return "bg-white/5 text-ink-muted";
}

export function Compose({
  refreshToken,
  onChanged,
}: {
  refreshToken: number;
  onChanged: () => void;
}) {
  const [projects, setProjects] = useState<ComposeProject[] | null>(null);
  const [savedFiles, setSavedFiles] = useState<string[]>([]);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(() => {
    listComposeProjects()
      .then((list) => {
        setProjects(list);
        setUnavailable(null);
      })
      .catch((e) => setUnavailable(String(e)));
    composeFilesList().then(setSavedFiles).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh, refreshToken]);

  const act = async (p: ComposeProject, verb: string) => {
    setBusy(p.name);
    setError(null);
    try {
      await composeAction(p.name, p.config_files, verb);
      refresh();
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const upFromFile = async (file: string) => {
    setBusy(file);
    setError(null);
    try {
      await composeUpFile(file);
      refresh();
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const forgetFile = async (file: string) => {
    try {
      await composeFileForget(file);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const addProject = async () => {
    const file = await open({
      title: "Pick a compose file",
      filters: [{ name: "Compose file", extensions: ["yml", "yaml"] }],
    });
    if (!file) return;
    setAdding(true);
    setError(null);
    try {
      await composeUpFile(file);
      refresh();
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setAdding(false);
    }
  };

  if (unavailable) {
    return <EmptyState icon={Layers} title="Compose unavailable" hint={unavailable} />;
  }
  if (projects === null) {
    return <LoadingState label="Listing compose projects…" className="h-full" />;
  }

  const addButton = (
    <Button variant="primary" onClick={addProject} loading={adding}>
      {!adding && <FilePlus size={13} />}
      {adding ? "Starting…" : "Add compose file"}
    </Button>
  );

  // Remembered files whose project isn't in `compose ls` anymore (downed or
  // never started this boot) get a synthetic row so they can be brought up.
  const liveConfigs = new Set(projects.flatMap((p) => p.config_files));
  const savedOnly = savedFiles.filter((f) => !liveConfigs.has(f));
  const runningCount = projects.filter((p) => p.status.includes("running")).length;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-xs text-ink-muted">
          {projects.length + savedOnly.length === 0
            ? ""
            : `${projects.length + savedOnly.length} project${
                projects.length + savedOnly.length === 1 ? "" : "s"
              } · ${runningCount} running`}
        </span>
        {addButton}
      </div>

      {error && <ErrorBanner message={error} />}

      {projects.length === 0 && savedOnly.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No compose projects"
          hint="Projects started with docker compose up show here — including stopped ones. Add a compose file to start one."
        />
      ) : (
        <TableShell>
          <HeadRow>
            <th className="px-3 py-2 font-medium">Project</th>
            <th className="w-32 px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Config</th>
            <th className="w-64 px-3 py-2 font-medium"></th>
          </HeadRow>
          <tbody>
            {projects.map((p) => {
              const isBusy = busy === p.name;
              return (
                <tr key={p.name} className="border-t border-border text-ink-secondary hover:bg-white/5">
                  <td className="px-3 py-1.5 font-medium text-ink-primary">{p.name}</td>
                  <td className="px-3 py-1.5">
                    <Badge className={statusCls(p.status)}>{p.status}</Badge>
                  </td>
                  <td
                    className="max-w-0 truncate px-3 py-1.5 font-mono text-xs"
                    title={p.config_files.join("\n")}
                  >
                    {p.config_files.join(", ")}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex justify-end gap-1 text-xs">
                      <RowButton label="Up" disabled={isBusy} onClick={() => act(p, "up")} />
                      <RowButton label="Restart" disabled={isBusy} onClick={() => act(p, "restart")} />
                      <RowButton label="Stop" disabled={isBusy} onClick={() => act(p, "stop")} />
                      <RowButton label="Down" disabled={isBusy} onClick={() => act(p, "down")} />
                    </div>
                  </td>
                </tr>
              );
            })}
            {savedOnly.map((file) => {
              const isBusy = busy === file;
              const dirName = file.split("/").slice(-2, -1)[0] ?? file;
              return (
                <tr key={file} className="border-t border-border text-ink-secondary hover:bg-white/5">
                  <td className="px-3 py-1.5">
                    <span className="inline-flex items-center gap-1.5 font-medium text-ink-secondary">
                      <FileClock size={12} className="text-ink-muted" />
                      {dirName}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">
                    <Badge outline>saved</Badge>
                  </td>
                  <td
                    className="max-w-0 truncate px-3 py-1.5 font-mono text-xs text-ink-muted"
                    title={file}
                  >
                    {file}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex justify-end gap-1 text-xs">
                      <RowButton label="Up" disabled={isBusy} onClick={() => upFromFile(file)} />
                      <RowButton label="Forget" disabled={isBusy} onClick={() => forgetFile(file)} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      )}
    </div>
  );
}
