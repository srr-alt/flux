import {
  TERMINAL_EVENT,
  terminalClose,
  terminalHistory,
  terminalOpen,
  terminalResize,
  terminalWrite,
} from "../../lib/tauri";
import { LOCAL_HOST_ID, useHostsStore } from "../../state/hostsStore";
import { useTerminalStore } from "../../state/terminalStore";
import { TerminalPanel, type TerminalBackend } from "./TerminalPanel";

/** The host-shell slide-over, driven by terminalStore. Rendered once in
 * App; keyed remount switches hosts. */
export function HostTerminal() {
  const hostId = useTerminalStore((s) => s.hostId);
  const close = useTerminalStore((s) => s.close);
  const hosts = useHostsStore((s) => s.hosts);
  const statuses = useHostsStore((s) => s.statuses);

  if (hostId === null) return null;

  const isLocal = hostId === LOCAL_HOST_ID;
  const host = hosts.find((h) => h.id === hostId);
  const name = isLocal ? "This machine" : (host?.name ?? hostId);
  const detail = isLocal
    ? "local shell"
    : host
      ? `${host.username}@${host.address}:${host.port}`
      : "";
  const online = isLocal || statuses[hostId]?.state === "connected";

  const backend: TerminalBackend = {
    event: TERMINAL_EVENT,
    open: (cols, rows) => terminalOpen(hostId, cols, rows),
    write: terminalWrite,
    resize: terminalResize,
    close: terminalClose,
    fetchHistory: () => terminalHistory(hostId),
  };

  return (
    <TerminalPanel
      key={hostId}
      backend={backend}
      onClose={close}
      header={
        <>
          <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink-primary">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                online ? "bg-status-good" : "bg-status-warning"
              }`}
            />
            <span className="truncate font-mono">{name}</span>
          </h2>
          <p className="mt-0.5 truncate text-xs text-ink-muted">{detail}</p>
        </>
      }
    />
  );
}
