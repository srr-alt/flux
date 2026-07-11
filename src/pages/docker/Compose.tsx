import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Check, Copy, FileClock, FilePlus, Layers } from "lucide-react";
import {
  composeAction,
  composeFileForget,
  composeFilesList,
  composeLogs,
  composeUpFile,
  listComposeProjects,
} from "../../lib/tauri";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Drawer } from "../../components/ui/Drawer";
import { EmptyState } from "../../components/ui/EmptyState";
import { LoadingState } from "../../components/ui/LoadingState";
import type { ComposeProject } from "../../types/monitor";
import { ErrorBanner, HeadRow, RowButton, TableShell } from "./shared";

const TAIL_OPTIONS = [100, 300, 1000, 5000] as const;

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
  // `up` runs with --build when set; applies to row Up and Add compose file.
  const [buildOnUp, setBuildOnUp] = useState(false);
  const [logsFor, setLogsFor] = useState<string | null>(null);
  const [logs, setLogs] = useState<string | null>(null);
  const [logTail, setLogTail] = useState<number>(300);
  const [follow, setFollow] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  const copyLogs = () => {
    if (!logs) return;
    writeText(logs)
      .then(() => {
        setCopied(true);
        clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => setCopied(false), 1500);
      })
      .catch((e) => setError(String(e)));
  };

  // Logs drawer: initial fetch + live tail while open.
  useEffect(() => {
    if (!logsFor) {
      setLogs(null);
      return;
    }
    let cancelled = false;
    const load = () =>
      composeLogs(logsFor, logTail)
        .then((text) => {
          if (!cancelled) setLogs(text);
        })
        .catch((e) => {
          if (!cancelled) setLogs(String(e));
        });
    load();
    const id = setInterval(load, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [logsFor, logTail]);

  useEffect(() => {
    if (follow && logs !== null) {
      logsEndRef.current?.scrollIntoView({ block: "end" });
    }
  }, [logs, follow]);

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
      await composeAction(p.name, p.config_files, verb, verb === "up" && buildOnUp);
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
      await composeUpFile(file, buildOnUp);
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
      await composeUpFile(file, buildOnUp);
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

  const toolbarRight = (
    <div className="flex items-center gap-3">
      <label
        className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-muted"
        title="Run docker compose up with --build (rebuilds images from their Dockerfiles)"
      >
        <input
          type="checkbox"
          checked={buildOnUp}
          onChange={(e) => setBuildOnUp(e.target.checked)}
          className="accent-series-1"
        />
        Build on up
      </label>
      <Button variant="primary" onClick={addProject} loading={adding}>
        {!adding && <FilePlus size={13} />}
        {adding ? (buildOnUp ? "Building…" : "Starting…") : "Add compose file"}
      </Button>
    </div>
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
        {toolbarRight}
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
                      <RowButton label="Logs" disabled={false} onClick={() => setLogsFor(p.name)} />
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

      {logsFor && (
        <Drawer wide title={`Logs · ${logsFor}`} onClose={() => setLogsFor(null)}>
          <div className="mb-3 flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5 text-ink-muted">
              Tail
              <select
                value={logTail}
                onChange={(e) => setLogTail(Number(e.target.value))}
                className="rounded-md border border-border bg-page px-1.5 py-0.5 text-ink-primary focus:border-series-1 focus:outline-none"
              >
                {TAIL_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-ink-muted">
              <input
                type="checkbox"
                checked={follow}
                onChange={(e) => setFollow(e.target.checked)}
                className="accent-series-1"
              />
              Follow
            </label>
            <Button
              size="sm"
              onClick={copyLogs}
              disabled={!logs || logs.trim() === ""}
              className="ml-auto"
            >
              {copied ? (
                <>
                  <Check size={11} className="text-status-good" /> Copied
                </>
              ) : (
                <>
                  <Copy size={11} /> Copy
                </>
              )}
            </Button>
          </div>
          {logs === null ? (
            <LoadingState label="Fetching logs…" />
          ) : logs.trim() === "" ? (
            <p className="text-sm text-ink-muted">No log output.</p>
          ) : (
            <>
              <pre className="whitespace-pre-wrap break-all rounded-md bg-black/25 p-3 font-mono text-[11px] leading-relaxed text-ink-secondary">
                {logs}
              </pre>
              <div ref={logsEndRef} />
            </>
          )}
        </Drawer>
      )}
    </div>
  );
}
