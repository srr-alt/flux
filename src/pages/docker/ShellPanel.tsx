import { useEffect, useRef, useState } from "react";
import { History, X } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { listen } from "@tauri-apps/api/event";
import {
  dockerShellClose,
  dockerShellHistory,
  dockerShellOpen,
  dockerShellResize,
  dockerShellWrite,
  SHELL_EVENT,
  type ShellOutput,
} from "../../lib/tauri";
import { terminalTheme } from "../../lib/theme";
import type { ContainerInfo } from "../../types/monitor";

const HISTORY_CHIPS = 8;

/** Right slide-over with a real PTY into the container (docker exec -it).
 * Deliberately NOT the shared Drawer: Esc must reach the shell (vim, less),
 * so closing is X button / backdrop only. */
export function ShellPanel({
  container,
  onClose,
}: {
  container: ContainerInfo;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<number | null>(null);
  const termRef = useRef<Terminal | null>(null);
  // Commands typed in previous sessions of this container, newest first.
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    dockerShellHistory(container.name)
      .then((h) => setHistory(h.slice(-HISTORY_CHIPS).reverse()))
      .catch(() => {});
  }, [container.name]);

  // Types the command into the shell without running it — user reviews,
  // then presses Enter.
  const pasteCommand = (cmd: string) => {
    if (sessionRef.current === null) return;
    const data = Array.from(new TextEncoder().encode(cmd));
    dockerShellWrite(sessionRef.current, data).catch(() => {});
    termRef.current?.focus();
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily: "ui-monospace, 'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 13,
      cursorBlink: true,
      theme: terminalTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    term.focus();

    let session: number | null = null;
    let disposed = false;
    const encoder = new TextEncoder();

    const unlistenP = listen<ShellOutput>(SHELL_EVENT, (e) => {
      if (e.payload.session !== session) return;
      if (e.payload.exited) {
        term.write("\r\n\x1b[2m[session ended]\x1b[0m\r\n");
        return;
      }
      term.write(new Uint8Array(e.payload.data));
    });

    termRef.current = term;
    dockerShellOpen(container.id, container.name, term.cols, term.rows)
      .then((id) => {
        if (disposed) {
          dockerShellClose(id);
          return;
        }
        session = id;
        sessionRef.current = id;
      })
      .catch((err) => term.write(`\x1b[31m${String(err)}\x1b[0m\r\n`));

    const dataSub = term.onData((s) => {
      if (session !== null) {
        dockerShellWrite(session, Array.from(encoder.encode(s))).catch(() => {});
      }
    });

    const ro = new ResizeObserver(() => {
      fit.fit();
      if (session !== null) {
        dockerShellResize(session, term.cols, term.rows).catch(() => {});
      }
    });
    ro.observe(host);

    return () => {
      disposed = true;
      ro.disconnect();
      dataSub.dispose();
      unlistenP.then((un) => un());
      if (session !== null) dockerShellClose(session);
      sessionRef.current = null;
      termRef.current = null;
      term.dispose();
    };
  }, [container.id, container.name]);

  return (
    <div
      className="fixed inset-0 z-50 animate-fade-in bg-black/30"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-y-0 right-0 flex w-[720px] max-w-full animate-drawer-in glass-overlay flex-col border-l border-white/10 shadow-[-16px_0_48px_rgba(0,0,0,.5)]">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div className="min-w-0">
            <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink-primary">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  container.state === "running"
                    ? "bg-status-good"
                    : container.state === "paused" || container.state === "restarting"
                      ? "bg-status-warning"
                      : "bg-ink-muted"
                }`}
              />
              <span className="truncate font-mono">{container.name}</span>
            </h2>
            <p className="mt-0.5 truncate text-xs text-ink-muted">{container.image}</p>
          </div>
          <button
            className="shrink-0 rounded-md p-1 text-ink-muted transition-colors duration-100 hover:bg-white/10 hover:text-ink-primary"
            onClick={onClose}
            aria-label="Close shell"
          >
            <X size={14} />
          </button>
        </div>
        {history.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto border-b border-border px-4 py-2">
            <span
              className="inline-flex shrink-0 items-center gap-1 text-[10px] uppercase tracking-wide text-ink-muted"
              title="Commands from previous shells in this container — click to type one into the prompt"
            >
              <History size={11} />
              History
            </span>
            {history.map((cmd, i) => (
              <button
                key={i}
                onClick={() => pasteCommand(cmd)}
                title={`${cmd} — click to type into the shell`}
                className="max-w-56 shrink-0 truncate rounded-md border border-border bg-white/5 px-2 py-0.5 font-mono text-[11px] text-ink-secondary transition-colors duration-100 hover:border-series-1/50 hover:bg-series-1/10 hover:text-ink-primary"
              >
                {cmd}
              </button>
            ))}
          </div>
        )}
        <div ref={hostRef} className="min-h-0 flex-1 bg-terminal p-2" />
      </div>
    </div>
  );
}
