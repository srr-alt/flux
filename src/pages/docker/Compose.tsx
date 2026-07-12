import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Check, Copy, Layers } from "lucide-react";
import {
  composeAction,
  composeFileForget,
  composeFilesList,
  composeLogs,
  composeUpFile,
  listComposeProjects,
} from "../../lib/tauri";
import { Button } from "../../components/ui/Button";
import { Drawer } from "../../components/ui/Drawer";
import { EmptyState } from "../../components/ui/EmptyState";
import { LoadingState } from "../../components/ui/LoadingState";
import { Switch } from "../../components/ui/Switch";
import type { ComposeProject } from "../../types/monitor";
import { DangerButton, ErrorBanner, RowButton } from "./shared";

const TAIL_OPTIONS = [100, 300, 1000, 5000] as const;

/** compose ls status like "running(2)" or "running(1), exited(1)" — design
 * pill is bare colored text, no fill. */
function statusCls(status: string): string {
  const running = status.includes("running");
  const other = /exited|paused|dead|created/.test(status);
  if (running && !other) return "text-status-good";
  if (running && other) return "text-status-warning";
  return "text-ink-muted";
}

/** ~-shorten home paths the way the design writes compose files. */
function tildify(path: string): string {
  return path.replace(/^\/home\/[^/]+/, "~");
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
        <Button size="sm" onClick={addProject} loading={adding}>
          {adding ? (buildOnUp ? "Building…" : "Starting…") : "Add compose file"}
        </Button>
      </div>

      {error && <ErrorBanner message={error} />}

      {projects.length === 0 && savedOnly.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No compose projects"
          hint="Projects started with docker compose up show here — including stopped ones. Add a compose file to start one."
        />
      ) : (
        <div className="glass min-h-0 flex-1 overflow-y-auto rounded-2xl border border-border">
          {/* card header: title + build-on-up switch (design) */}
          <div className="glass-overlay sticky top-0 z-10 flex items-center border-b border-border px-3.5 py-[9px]">
            <span className="text-[11px] font-semibold text-ink-secondary">
              Compose projects
            </span>
            <label
              className="ml-auto flex cursor-pointer items-center gap-2 text-[11px] text-ink-muted"
              title="Run docker compose up with --build (rebuilds images from their Dockerfiles)"
            >
              <Switch
                checked={buildOnUp}
                onChange={() => setBuildOnUp((v) => !v)}
                aria-label="Build on up"
              />
              Build on up
            </label>
          </div>

          {projects.map((p) => {
            const isBusy = busy === p.name;
            const files = p.config_files.map(tildify).join(", ");
            return (
              <div
                key={p.name}
                className="grid grid-cols-[minmax(0,1fr)_90px_auto] items-center gap-2.5 border-b border-white/[.04] px-3.5 py-[11px]"
              >
                <div className="min-w-0">
                  <div className="text-xs font-medium text-ink-primary">{p.name}</div>
                  <div
                    className="truncate font-mono text-[10px] text-ink-faint"
                    title={p.config_files.join("\n")}
                  >
                    {files}
                  </div>
                </div>
                <span className={`text-[10px] font-medium ${statusCls(p.status)}`}>
                  {p.status}
                </span>
                <div className="flex justify-end gap-1.5">
                  <RowButton label="Up" disabled={isBusy} onClick={() => act(p, "up")} />
                  <RowButton label="Restart" disabled={isBusy} onClick={() => act(p, "restart")} />
                  <RowButton label="Logs" disabled={false} onClick={() => setLogsFor(p.name)} />
                  <DangerButton label="Down" disabled={isBusy} onClick={() => act(p, "down")} />
                </div>
              </div>
            );
          })}

          {savedOnly.map((file) => {
            const isBusy = busy === file;
            const dirName = file.split("/").slice(-2, -1)[0] ?? file;
            return (
              <div
                key={file}
                className="grid grid-cols-[minmax(0,1fr)_90px_auto] items-center gap-2.5 border-b border-white/[.04] px-3.5 py-[11px]"
              >
                <div className="min-w-0">
                  <div className="text-xs font-medium text-ink-primary">{dirName}</div>
                  <div className="truncate font-mono text-[10px] text-ink-faint" title={file}>
                    {tildify(file)} · saved
                  </div>
                </div>
                <span className="text-[10px] font-medium text-ink-muted">saved</span>
                <div className="flex justify-end gap-1.5">
                  <RowButton label="Up" disabled={isBusy} onClick={() => upFromFile(file)} />
                  <RowButton label="Forget" disabled={isBusy} onClick={() => forgetFile(file)} />
                </div>
              </div>
            );
          })}
        </div>
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
