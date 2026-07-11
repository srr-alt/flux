import { useState } from "react";
import { addHost, forgetHostKey, listHosts, testHostConnection } from "../../lib/tauri";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Modal } from "../ui/Modal";
import { useHostsStore } from "../../state/hostsStore";
import type { TestResult } from "../../types/hosts";

interface AddHostWizardProps {
  onClose: () => void;
}

type Step = "form" | "confirm" | "provisioning" | "done";

export function AddHostWizard({ onClose }: AddHostWizardProps) {
  const [step, setStep] = useState<Step>("form");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);
  const [keyChanged, setKeyChanged] = useState(false);

  const runTest = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await testHostConnection(
        address.trim(),
        port,
        username.trim(),
        password,
      );
      setTest(result);
      if (result.host_key_changed) {
        setKeyChanged(true);
        setError(
          "HOST KEY CHANGED since last seen — possible man-in-the-middle. Only continue if you reinstalled or recreated this machine yourself.",
        );
      } else if (!result.auth_ok) {
        setError("Authentication failed — check username/password.");
      } else {
        setStep("confirm");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const provision = async () => {
    setStep("provisioning");
    setError(null);
    try {
      await addHost(
        { name: name.trim(), address: address.trim(), port, username: username.trim() },
        password,
      );
      useHostsStore.getState().setHosts(await listHosts());
      setStep("done");
      setTimeout(onClose, 900);
    } catch (e) {
      setError(String(e));
      setStep("confirm");
    }
  };

  return (
    <Modal
      title="Add remote host"
      onClose={onClose}
      width="w-[440px]"
      dismissable={step !== "provisioning"}
      showClose
    >
        {step === "form" && (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              runTest();
            }}
          >
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              Display name (optional)
              <Input
                className="w-full"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="build-server"
              />
            </label>
            <div className="flex gap-2">
              <label className="flex flex-1 flex-col gap-1 text-xs text-ink-muted">
                Address
                <Input
                  className="w-full"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="192.168.1.50 or host.example.com"
                  required
                />
              </label>
              <label className="flex w-20 flex-col gap-1 text-xs text-ink-muted">
                Port
                <Input
                  className="w-full"
                  type="number"
                  min={1}
                  max={65535}
                  value={port}
                  onChange={(e) => setPort(Number(e.target.value) || 22)}
                />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              Username
              <Input
                className="w-full"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              Password
              <Input
                className="w-full"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <span className="text-[11px] leading-snug text-ink-muted">
                Used once to install Flux's SSH key on the host. It is never
                stored.
              </span>
            </label>
            {error && (
              <p className="text-xs text-status-critical">{error}</p>
            )}
            {keyChanged && (
              <button
                type="button"
                className="rounded-md border border-status-warning/40 bg-status-warning/10 px-3 py-1.5 text-xs text-status-warning transition-colors duration-100 hover:bg-status-warning/20"
                onClick={async () => {
                  await forgetHostKey(address.trim(), port);
                  setKeyChanged(false);
                  setError(null);
                  runTest();
                }}
              >
                I reinstalled this machine — forget old key & re-verify
              </button>
            )}
            <Button
              type="submit"
              variant="primary"
              disabled={!address.trim() || !username.trim() || !password}
              loading={busy}
              className="mt-1"
            >
              {busy ? "Connecting…" : "Test connection"}
            </Button>
          </form>
        )}

        {step === "confirm" && test && (
          <div className="flex flex-col gap-3">
            <div className="rounded border border-border bg-page p-3 text-xs">
              <p className="text-ink-secondary">
                {test.hostname} — {test.os_pretty_name} ({test.kernel})
              </p>
              <p className="mt-2 text-ink-muted">Host key fingerprint:</p>
              <p className="break-all font-mono text-[11px] text-ink-primary">
                {test.fingerprint}
              </p>
              {!test.host_key_known && (
                <p className="mt-2 leading-snug text-status-warning">
                  First connection to this host. Verify the fingerprint matches
                  (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the
                  host) before trusting it.
                </p>
              )}
            </div>
            {error && <p className="text-xs text-status-critical">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setStep("form")}>
                Back
              </Button>
              <Button variant="primary" onClick={provision}>
                Trust & add host
              </Button>
            </div>
          </div>
        )}

        {step === "provisioning" && (
          <p className="py-6 text-center text-sm text-ink-muted">
            Installing key and connecting…
          </p>
        )}
        {step === "done" && (
          <p className="py-6 text-center text-sm text-status-good">
            Host added.
          </p>
        )}
    </Modal>
  );
}
