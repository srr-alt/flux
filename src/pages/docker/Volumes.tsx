import { useCallback, useEffect, useState } from "react";
import { Database } from "lucide-react";
import { listVolumes, volumeRemove } from "../../lib/tauri";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { LoadingState } from "../../components/ui/LoadingState";
import { Modal } from "../../components/ui/Modal";
import type { VolumeInfo } from "../../types/monitor";
import { DangerButton, ErrorBanner, HeadRow, TableShell } from "./shared";

export function Volumes({
  refreshToken,
  onChanged,
}: {
  refreshToken: number;
  onChanged: () => void;
}) {
  const [volumes, setVolumes] = useState<VolumeInfo[] | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<VolumeInfo | null>(null);

  const refresh = useCallback(() => {
    listVolumes()
      .then((list) => {
        setVolumes(list);
        setUnavailable(null);
      })
      .catch((e) => setUnavailable(String(e)));
  }, []);

  useEffect(refresh, [refresh, refreshToken]);

  const remove = async (v: VolumeInfo) => {
    setBusy(v.name);
    setError(null);
    try {
      await volumeRemove(v.name);
      refresh();
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  if (unavailable) {
    return <EmptyState icon={Database} title="Docker unavailable" hint={unavailable} />;
  }
  if (volumes === null) {
    return <LoadingState label="Listing volumes…" className="h-full" />;
  }
  if (volumes.length === 0) {
    return <EmptyState icon={Database} title="No volumes" hint="Named volumes show up here." />;
  }

  return (
    <div className="flex h-full flex-col">
      {error && <ErrorBanner message={error} />}
      <TableShell>
        <HeadRow>
          <th className="px-3 py-2 font-medium">Name</th>
          <th className="w-24 px-3 py-2 font-medium">Driver</th>
          <th className="px-3 py-2 font-medium">Mountpoint</th>
          <th className="w-24 px-3 py-2 font-medium"></th>
        </HeadRow>
        <tbody>
          {volumes.map((v) => (
            <tr key={v.name} className="border-t border-border text-ink-secondary hover:bg-white/5">
              <td className="max-w-0 truncate px-3 py-1.5 font-medium text-ink-primary" title={v.name}>
                {v.name}
              </td>
              <td className="px-3 py-1.5 text-xs">{v.driver}</td>
              <td className="max-w-0 truncate px-3 py-1.5 font-mono text-xs" title={v.mountpoint}>
                {v.mountpoint}
              </td>
              <td className="px-3 py-1.5">
                <div className="flex justify-end text-xs">
                  <DangerButton
                    label="Remove"
                    disabled={busy === v.name}
                    onClick={() => setConfirmRemove(v)}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </TableShell>

      {confirmRemove && (
        <Modal
          title={`Remove volume ${confirmRemove.name}?`}
          onClose={() => setConfirmRemove(null)}
        >
          <p className="text-sm text-ink-secondary">
            Permanently deletes the volume and all data in it. Fails if a
            container still uses it.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmRemove(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                remove(confirmRemove);
                setConfirmRemove(null);
              }}
            >
              Remove
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
