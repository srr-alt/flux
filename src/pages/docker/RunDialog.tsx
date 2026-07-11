import { useState } from "react";
import { runContainer } from "../../lib/tauri";
import { Button } from "../../components/ui/Button";
import { Input, Textarea } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs font-medium text-ink-secondary">
        {label}
        {hint && <span className="ml-2 font-normal text-ink-muted">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

/** Create + start a container: docker run -d. Pulls the image if missing. */
export function RunDialog({
  initialImage,
  onDone,
  onClose,
}: {
  initialImage: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const [image, setImage] = useState(initialImage);
  const [name, setName] = useState("");
  const [ports, setPorts] = useState("");
  const [env, setEnv] = useState("");
  const [volumes, setVolumes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lines = (s: string) =>
    s
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

  const submit = async () => {
    if (!image.trim()) {
      setError("Image is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await runContainer({
        image: image.trim(),
        name: name.trim() || null,
        ports: lines(ports),
        env: lines(env),
        volumes: lines(volumes),
      });
      onDone();
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <Modal title="Run container" onClose={busy ? () => {} : onClose}>
      <Field label="Image" hint="pulled automatically if missing">
        <Input
          className="w-full"
          value={image}
          onChange={(e) => setImage(e.target.value)}
          placeholder="nginx:latest"
          autoFocus
        />
      </Field>
      <Field label="Name" hint="optional">
        <Input
          className="w-full"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-nginx"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Ports" hint="host:container, one per line">
          <Textarea
            className="h-16 w-full resize-none font-mono text-xs"
            value={ports}
            onChange={(e) => setPorts(e.target.value)}
            placeholder={"8080:80"}
          />
        </Field>
        <Field label="Volumes" hint="host:container">
          <Textarea
            className="h-16 w-full resize-none font-mono text-xs"
            value={volumes}
            onChange={(e) => setVolumes(e.target.value)}
            placeholder={"/data:/var/lib/data"}
          />
        </Field>
      </div>
      <Field label="Environment" hint="KEY=value, one per line">
        <Textarea
          className="h-16 w-full resize-none font-mono text-xs"
          value={env}
          onChange={(e) => setEnv(e.target.value)}
          placeholder={"POSTGRES_PASSWORD=secret"}
        />
      </Field>

      {error && (
        <p className="mb-2 break-all text-sm text-status-critical">{error}</p>
      )}

      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit} loading={busy}>
          {busy ? "Starting…" : "Run"}
        </Button>
      </div>
    </Modal>
  );
}
