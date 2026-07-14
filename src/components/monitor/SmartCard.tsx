import { useEffect, useState } from "react";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { smartReport } from "../../lib/tauri";
import { LOCAL_HOST_ID } from "../../state/hostsStore";
import type { SmartOutcome } from "../../types/monitor";

function Fact({
  label,
  value,
  bad = false,
}: {
  label: string;
  value: string;
  bad?: boolean;
}) {
  return (
    <div className="contents">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd
        className={`font-mono text-xs tabular-nums ${
          bad ? "font-semibold text-status-critical" : "text-ink-secondary"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

/** S.M.A.R.T. health for one block device — verdict badge + the numbers a
 * homelabber actually checks (wear, reallocated sectors, temps, hours).
 * Reads on mount; failures explain their fix (install hint, pkexec retry,
 * passwordless-sudo hint). */
export function SmartCard({ hostId, device }: { hostId: string; device: string }) {
  const [outcome, setOutcome] = useState<SmartOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authorizing, setAuthorizing] = useState(false);

  useEffect(() => {
    setOutcome(null);
    setError(null);
    smartReport(hostId, device).then(setOutcome).catch((e) => setError(String(e)));
  }, [hostId, device]);

  const authorize = () => {
    setAuthorizing(true);
    smartReport(hostId, device, true)
      .then(setOutcome)
      .catch((e) => setError(String(e)))
      .finally(() => setAuthorizing(false));
  };

  const disk = outcome?.disk ?? null;
  const failed = disk?.healthy === false;

  return (
    <div
      className={`mt-4 glass rounded-2xl border p-4 ${
        failed ? "border-status-critical/50" : "border-border"
      }`}
    >
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-medium text-ink-primary">S.M.A.R.T. health</h2>
        {disk?.healthy === true && (
          <Badge tone="good">
            <ShieldCheck size={11} /> PASSED
          </Badge>
        )}
        {failed && (
          <Badge tone="critical" pulse>
            <ShieldAlert size={11} /> FAILING
          </Badge>
        )}
        {disk && disk.healthy === null && <Badge tone="neutral">no verdict</Badge>}
      </div>

      {!outcome && !error && (
        <p className="text-xs text-ink-muted">Reading SMART data…</p>
      )}
      {error && <p className="text-xs text-status-critical">{error}</p>}

      {outcome?.failure === "not_installed" && (
        <p className="text-xs text-ink-muted">
          smartmontools is not installed{hostId !== LOCAL_HOST_ID && " on this host"} —{" "}
          <code className="rounded bg-white/5 px-1 py-0.5 font-mono text-[11px]">
            sudo apt install smartmontools
          </code>
        </p>
      )}
      {outcome?.failure === "permission_denied" &&
        (hostId === LOCAL_HOST_ID ? (
          <div className="flex items-center gap-3">
            <p className="text-xs text-ink-muted">
              Reading SMART data needs administrator access.
            </p>
            <Button variant="soft" size="sm" loading={authorizing} onClick={authorize}>
              Authorize scan
            </Button>
          </div>
        ) : (
          <p className="text-xs text-ink-muted">
            SMART needs root on the host — grant passwordless sudo for smartctl,
            or connect as root.
          </p>
        ))}
      {outcome?.failure === "error" && (
        <p className="text-xs text-ink-muted">{outcome.message ?? "SMART read failed."}</p>
      )}

      {disk && (
        <dl className="grid grid-cols-[auto_1fr_auto_1fr] gap-x-6 gap-y-1.5">
          {disk.temp_c !== null && (
            <Fact label="Temperature" value={`${disk.temp_c.toFixed(0)}°C`} />
          )}
          {disk.power_on_hours !== null && (
            <Fact
              label="Powered on"
              value={`${disk.power_on_hours.toLocaleString()} h`}
            />
          )}
          {disk.power_cycles !== null && (
            <Fact label="Power cycles" value={disk.power_cycles.toLocaleString()} />
          )}
          {disk.percentage_used !== null && (
            <Fact
              label="Wear used"
              value={`${disk.percentage_used}%`}
              bad={disk.percentage_used >= 80}
            />
          )}
          {disk.available_spare_pct !== null && (
            <Fact
              label="Spare blocks"
              value={`${disk.available_spare_pct}%`}
              bad={disk.available_spare_pct <= 10}
            />
          )}
          {disk.media_errors !== null && (
            <Fact
              label="Media errors"
              value={disk.media_errors.toLocaleString()}
              bad={disk.media_errors > 0}
            />
          )}
          {disk.reallocated_sectors !== null && (
            <Fact
              label="Reallocated sectors"
              value={disk.reallocated_sectors.toLocaleString()}
              bad={disk.reallocated_sectors > 0}
            />
          )}
          {disk.pending_sectors !== null && (
            <Fact
              label="Pending sectors"
              value={disk.pending_sectors.toLocaleString()}
              bad={disk.pending_sectors > 0}
            />
          )}
          {disk.offline_uncorrectable !== null && (
            <Fact
              label="Uncorrectable"
              value={disk.offline_uncorrectable.toLocaleString()}
              bad={disk.offline_uncorrectable > 0}
            />
          )}
          {disk.serial && <Fact label="Serial" value={disk.serial} />}
          {disk.firmware && <Fact label="Firmware" value={disk.firmware} />}
        </dl>
      )}
    </div>
  );
}
