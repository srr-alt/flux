import { useState } from "react";
import { installFluxDeb } from "../../lib/tauri";
import { Modal } from "../ui/Modal";

interface InstallDebModalProps {
  hostId: string;
  hostName: string;
  onClose: () => void;
}

export function InstallDebModal({ hostId, hostName, onClose }: InstallDebModalProps) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const install = async () => {
    setBusy(true);
    setError(null);
    try {
      await installFluxDeb(hostId, password);
      setDone(true);
      setTimeout(onClose, 1200);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      setPassword("");
    }
  };

  return (
    <Modal
      title={`Install Flux on ${hostName}`}
      onClose={onClose}
      width="w-[420px]"
      dismissable={!busy}
      showClose
    >
      {done ? (
        <p className="py-4 text-center text-sm text-status-good">
          Flux installed.
        </p>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            install();
          }}
        >
          <p className="text-xs leading-snug text-ink-muted">
            Adds the Flux apt repository and runs{" "}
            <span className="font-mono">apt install flux</span> on the remote
            machine. Needs the remote user's sudo password — used once, sent
            only over the SSH channel, never stored.
          </p>
          <input
            className="w-full rounded border border-border bg-page px-2.5 py-1.5 text-sm text-ink-primary outline-none focus:border-white/30"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="sudo password"
            autoFocus
            required
          />
          {error && <p className="text-xs text-status-critical">{error}</p>}
          <button
            type="submit"
            disabled={busy || !password}
            className="rounded bg-series-1/20 px-3 py-1.5 text-sm text-series-1 hover:bg-series-1/30 disabled:opacity-40"
          >
            {busy ? "Installing… (this can take a minute)" : "Install"}
          </button>
        </form>
      )}
    </Modal>
  );
}
