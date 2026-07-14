import {
  dockerShellClose,
  dockerShellHistory,
  dockerShellOpen,
  dockerShellResize,
  dockerShellWrite,
  SHELL_EVENT,
} from "../../lib/tauri";
import {
  TerminalPanel,
  type TerminalBackend,
} from "../../components/terminal/TerminalPanel";
import type { ContainerInfo } from "../../types/monitor";

/** Shell into a container (docker exec -it) in the shared terminal panel. */
export function ShellPanel({
  container,
  onClose,
}: {
  container: ContainerInfo;
  onClose: () => void;
}) {
  const backend: TerminalBackend = {
    event: SHELL_EVENT,
    open: (cols, rows) =>
      dockerShellOpen(container.id, container.name, cols, rows),
    write: dockerShellWrite,
    resize: dockerShellResize,
    close: dockerShellClose,
    fetchHistory: () => dockerShellHistory(container.name),
  };
  return (
    <TerminalPanel
      backend={backend}
      onClose={onClose}
      header={
        <>
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
        </>
      }
    />
  );
}
