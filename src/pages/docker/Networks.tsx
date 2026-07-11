import { useCallback, useEffect, useState } from "react";
import { Network } from "lucide-react";
import { listNetworks, networkRemove } from "../../lib/tauri";
import { Badge } from "../../components/ui/Badge";
import { EmptyState } from "../../components/ui/EmptyState";
import { LoadingState } from "../../components/ui/LoadingState";
import type { NetworkInfo } from "../../types/monitor";
import { DangerButton, ErrorBanner, HeadRow, TableShell } from "./shared";

export function Networks({
  refreshToken,
  onChanged,
}: {
  refreshToken: number;
  onChanged: () => void;
}) {
  const [networks, setNetworks] = useState<NetworkInfo[] | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listNetworks()
      .then((list) => {
        setNetworks(list);
        setUnavailable(null);
      })
      .catch((e) => setUnavailable(String(e)));
  }, []);

  useEffect(refresh, [refresh, refreshToken]);

  const remove = async (n: NetworkInfo) => {
    setBusy(n.id);
    setError(null);
    try {
      await networkRemove(n.id);
      refresh();
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  if (unavailable) {
    return <EmptyState icon={Network} title="Docker unavailable" hint={unavailable} />;
  }
  if (networks === null) {
    return <LoadingState label="Listing networks…" className="h-full" />;
  }

  return (
    <div className="flex h-full flex-col">
      {error && <ErrorBanner message={error} />}
      <TableShell>
        <HeadRow>
          <th className="px-3 py-2 font-medium">Name</th>
          <th className="w-28 px-3 py-2 font-medium">ID</th>
          <th className="w-24 px-3 py-2 font-medium">Driver</th>
          <th className="w-24 px-3 py-2 font-medium">Scope</th>
          <th className="w-24 px-3 py-2 font-medium"></th>
        </HeadRow>
        <tbody>
          {networks.map((n) => (
            <tr key={n.id} className="border-t border-border text-ink-secondary hover:bg-white/5">
              <td className="px-3 py-1.5 font-medium text-ink-primary">
                {n.name}
                {n.builtin && <Badge className="ml-2">built-in</Badge>}
              </td>
              <td className="px-3 py-1.5 font-mono text-xs">{n.id.slice(0, 12)}</td>
              <td className="px-3 py-1.5 text-xs">{n.driver}</td>
              <td className="px-3 py-1.5 text-xs">{n.scope}</td>
              <td className="px-3 py-1.5">
                <div className="flex justify-end text-xs">
                  {!n.builtin && (
                    <DangerButton
                      label="Remove"
                      disabled={busy === n.id}
                      onClick={() => remove(n)}
                    />
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </TableShell>
    </div>
  );
}
