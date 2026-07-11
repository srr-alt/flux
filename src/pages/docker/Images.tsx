import { useCallback, useEffect, useState } from "react";
import { HardDrive, Search } from "lucide-react";
import { imagePull, imageRemove, listImages } from "../../lib/tauri";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Input } from "../../components/ui/Input";
import { LoadingState } from "../../components/ui/LoadingState";
import { Modal } from "../../components/ui/Modal";
import type { ImageInfo } from "../../types/monitor";
import { RunDialog } from "./RunDialog";
import { DangerButton, ErrorBanner, HeadRow, RowButton, TableShell } from "./shared";

export function Images({
  refreshToken,
  onChanged,
}: {
  refreshToken: number;
  onChanged: () => void;
}) {
  const [images, setImages] = useState<ImageInfo[] | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pullRef, setPullRef] = useState("");
  const [pulling, setPulling] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<ImageInfo | null>(null);
  const [runImage, setRunImage] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const refresh = useCallback(() => {
    listImages()
      .then((list) => {
        setImages(list);
        setUnavailable(null);
      })
      .catch((e) => setUnavailable(String(e)));
  }, []);

  useEffect(refresh, [refresh, refreshToken]);

  const remove = async (img: ImageInfo) => {
    setBusy(img.id);
    setError(null);
    try {
      await imageRemove(img.id);
      refresh();
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const pull = async () => {
    const ref = pullRef.trim();
    if (!ref) return;
    setPulling(true);
    setError(null);
    try {
      await imagePull(ref);
      setPullRef("");
      refresh();
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setPulling(false);
    }
  };

  if (unavailable) {
    return <EmptyState icon={HardDrive} title="Docker unavailable" hint={unavailable} />;
  }
  if (images === null) {
    return <LoadingState label="Listing images…" className="h-full" />;
  }

  const label = (img: ImageInfo) =>
    img.repository === "<none>" ? img.id.slice(0, 12) : `${img.repository}:${img.tag}`;

  const q = filter.trim().toLowerCase();
  const visible = q
    ? images.filter((img) => `${img.repository}:${img.tag}`.toLowerCase().includes(q))
    : images;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center gap-2">
        {images.length > 0 && (
          <Input
            icon={Search}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter images…"
            className="w-56"
          />
        )}
        <Input
          value={pullRef}
          onChange={(e) => setPullRef(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !pulling && pull()}
          placeholder="Pull image… e.g. nginx:latest"
          className="w-72"
        />
        <Button onClick={pull} disabled={!pullRef.trim()} loading={pulling}>
          {pulling ? "Pulling…" : "Pull"}
        </Button>
      </div>

      {error && <ErrorBanner message={error} />}

      {images.length === 0 ? (
        <EmptyState icon={HardDrive} title="No images" hint="Pull one to get started." />
      ) : (
        <TableShell>
          <HeadRow>
            <th className="px-3 py-2 font-medium">Image</th>
            <th className="w-28 px-3 py-2 font-medium">ID</th>
            <th className="w-28 px-3 py-2 text-right font-medium">Size</th>
            <th className="w-32 px-3 py-2 font-medium">Created</th>
            <th className="w-36 px-3 py-2 font-medium"></th>
          </HeadRow>
          <tbody className="tabular-nums">
            {visible.map((img) => {
              const isBusy = busy === img.id;
              return (
                <tr
                  key={`${img.id}-${img.tag}`}
                  className="border-t border-border text-ink-secondary hover:bg-white/5"
                >
                  <td className="max-w-0 truncate px-3 py-1.5 font-medium text-ink-primary" title={label(img)}>
                    {img.repository === "<none>" ? (
                      <span className="text-ink-muted">&lt;dangling&gt;</span>
                    ) : (
                      <>
                        {img.repository}
                        <span className="font-normal text-ink-muted">:{img.tag}</span>
                      </>
                    )}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs">{img.id.slice(0, 12)}</td>
                  <td className="px-3 py-1.5 text-right">{img.size}</td>
                  <td className="px-3 py-1.5 text-xs">{img.created_since}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex justify-end gap-1 text-xs">
                      <RowButton
                        label="Run"
                        disabled={isBusy || img.repository === "<none>"}
                        onClick={() => setRunImage(label(img))}
                      />
                      <DangerButton
                        label="Remove"
                        disabled={isBusy}
                        onClick={() => setConfirmRemove(img)}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      )}

      {runImage !== null && (
        <RunDialog
          initialImage={runImage}
          onDone={onChanged}
          onClose={() => setRunImage(null)}
        />
      )}

      {confirmRemove && (
        <Modal
          title={`Remove ${label(confirmRemove)}?`}
          onClose={() => setConfirmRemove(null)}
        >
          <p className="text-sm text-ink-secondary">
            Deletes the image ({confirmRemove.size}). Fails if a container
            still uses it.
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
