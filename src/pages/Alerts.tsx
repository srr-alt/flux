import { useCallback, useEffect, useState } from "react";
import { Bell, BellRing, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Input } from "../components/ui/Input";
import { Modal } from "../components/ui/Modal";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { Switch } from "../components/ui/Switch";
import { formatBytesPerSec } from "../lib/format";
import {
  alertsActive,
  alertsDeleteRule,
  alertsEvents,
  alertsListRules,
  alertsSaveRule,
  alertsTestNotification,
  onAlertsChanged,
} from "../lib/tauri";
import { LOCAL_HOST_ID, useHostsStore } from "../state/hostsStore";
import type {
  ActiveAlert,
  AlertEventRow,
  AlertMetric,
  AlertOp,
  AlertRule,
} from "../types/alerts";

const METRICS: { value: AlertMetric; label: string; unit: string }[] = [
  { value: "cpu_pct", label: "CPU", unit: "%" },
  { value: "mem_pct", label: "Memory", unit: "%" },
  { value: "temp_c", label: "Temperature", unit: "°C" },
  { value: "net_rx_bps", label: "Net down", unit: "MB/s" },
  { value: "net_tx_bps", label: "Net up", unit: "MB/s" },
];

const DURATIONS: { value: number; label: string }[] = [
  { value: 0, label: "instant" },
  { value: 60, label: "1 min" },
  { value: 300, label: "5 min" },
  { value: 900, label: "15 min" },
];

/** Net thresholds are stored in bytes/sec but edited in MB/s. */
function toDisplay(metric: AlertMetric, v: number): number {
  return metric.startsWith("net_") ? v / 1e6 : v;
}
function fromDisplay(metric: AlertMetric, v: number): number {
  return metric.startsWith("net_") ? v * 1e6 : v;
}

function metricMeta(metric: AlertMetric | string) {
  return METRICS.find((m) => m.value === metric);
}

function formatValue(metric: AlertMetric | string, v: number): string {
  switch (metric) {
    case "cpu_pct":
    case "mem_pct":
      return `${v.toFixed(0)}%`;
    case "temp_c":
      return `${v.toFixed(0)}°C`;
    case "net_rx_bps":
    case "net_tx_bps":
      return formatBytesPerSec(v);
    default:
      return v.toFixed(0);
  }
}

function conditionText(rule: {
  metric: AlertMetric | string;
  op: AlertOp | string;
  threshold: number;
}): string {
  const meta = metricMeta(rule.metric);
  const op = rule.op === "gt" ? ">" : "<";
  return `${meta?.label ?? rule.metric} ${op} ${formatValue(rule.metric, rule.threshold)}`;
}

function timeAgo(ts: number): string {
  const secs = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function formatWhen(ts: number): string {
  const d = new Date(ts * 1000);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return sameDay
    ? time
    : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

const EMPTY_RULE: AlertRule = {
  id: "",
  name: "",
  metric: "cpu_pct",
  op: "gt",
  threshold: 90,
  duration_secs: 300,
  host_id: null,
  enabled: true,
};

function RuleModal({
  initial,
  onSaved,
  onClose,
}: {
  initial: AlertRule;
  onSaved: (rules: AlertRule[]) => void;
  onClose: () => void;
}) {
  const hosts = useHostsStore((s) => s.hosts);
  const [rule, setRule] = useState<AlertRule>(initial);
  const [threshold, setThreshold] = useState(
    String(toDisplay(initial.metric, initial.threshold)),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const meta = metricMeta(rule.metric);

  const save = async () => {
    const parsed = Number(threshold);
    if (!Number.isFinite(parsed)) {
      setError("Threshold must be a number.");
      return;
    }
    const name =
      rule.name.trim() ||
      `${meta?.label ?? rule.metric} ${rule.op === "gt" ? ">" : "<"} ${threshold}${meta?.unit ?? ""}`;
    setSaving(true);
    setError(null);
    try {
      onSaved(
        await alertsSaveRule({
          ...rule,
          name,
          threshold: fromDisplay(rule.metric, parsed),
        }),
      );
      onClose();
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title={rule.id ? "Edit alert rule" : "New alert rule"}
    >
      <div className="flex w-[440px] max-w-full flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-xs text-ink-muted">
          Name
          <Input
            value={rule.name}
            onChange={(e) => setRule({ ...rule, name: e.target.value })}
            placeholder="e.g. CPU pegged"
          />
        </label>

        <div className="flex flex-col gap-1.5 text-xs text-ink-muted">
          Metric
          <SegmentedControl
            size="sm"
            options={METRICS.map((m) => ({ value: m.value, label: m.label }))}
            value={rule.metric}
            onChange={(metric) => setRule({ ...rule, metric })}
          />
        </div>

        <div className="flex items-end gap-3">
          <div className="flex flex-col gap-1.5 text-xs text-ink-muted">
            Condition
            <SegmentedControl
              size="sm"
              options={[
                { value: "gt", label: "above" },
                { value: "lt", label: "below" },
              ]}
              value={rule.op}
              onChange={(op) => setRule({ ...rule, op: op as AlertOp })}
            />
          </div>
          <label className="flex flex-1 flex-col gap-1.5 text-xs text-ink-muted">
            Threshold ({meta?.unit})
            <Input
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              inputMode="decimal"
            />
          </label>
        </div>

        <div className="flex flex-col gap-1.5 text-xs text-ink-muted">
          Must hold for
          <SegmentedControl
            size="sm"
            options={DURATIONS}
            value={rule.duration_secs}
            onChange={(duration_secs) => setRule({ ...rule, duration_secs })}
          />
        </div>

        <label className="flex flex-col gap-1.5 text-xs text-ink-muted">
          Host
          <select
            value={rule.host_id ?? ""}
            onChange={(e) =>
              setRule({ ...rule, host_id: e.target.value || null })
            }
            className="rounded-md border border-border bg-page px-2.5 py-1.5 text-[13px] text-ink-primary outline-none focus:border-series-1"
          >
            <option value="">All hosts</option>
            <option value={LOCAL_HOST_ID}>This machine</option>
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>

        {error && <p className="text-xs text-status-critical">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            {rule.id ? "Save rule" : "Create rule"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function Alerts() {
  const hosts = useHostsStore((s) => s.hosts);
  const [rules, setRules] = useState<AlertRule[] | null>(null);
  const [active, setActive] = useState<ActiveAlert[]>([]);
  const [events, setEvents] = useState<AlertEventRow[]>([]);
  const [editing, setEditing] = useState<AlertRule | null>(null);
  const [testState, setTestState] = useState<"idle" | "sent" | "failed">("idle");

  const hostName = useCallback(
    (id: string) =>
      id === LOCAL_HOST_ID
        ? "This machine"
        : (hosts.find((h) => h.id === id)?.name ?? id),
    [hosts],
  );

  const reload = useCallback(() => {
    alertsListRules().then(setRules).catch(() => setRules([]));
    alertsActive().then(setActive).catch(() => {});
    alertsEvents(100).then(setEvents).catch(() => {});
  }, []);

  useEffect(() => {
    reload();
    let unlisten: (() => void) | undefined;
    onAlertsChanged((list) => {
      setActive(list);
      // A fire/resolve also appends/updates history rows.
      alertsEvents(100).then(setEvents).catch(() => {});
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [reload]);

  const toggleRule = async (rule: AlertRule) => {
    setRules(await alertsSaveRule({ ...rule, enabled: !rule.enabled }));
  };

  const deleteRule = async (rule: AlertRule) => {
    setRules(await alertsDeleteRule(rule.id));
  };

  const testNotification = () => {
    alertsTestNotification()
      .then(() => setTestState("sent"))
      .catch(() => setTestState("failed"));
    setTimeout(() => setTestState("idle"), 2500);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Rendered inside the Tools shell (its ScreenHeader is above), so
          the page carries its own toolbar row instead of a ScreenHeader. */}
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-ink-faint">
            {active.length > 0
              ? `${active.length} firing`
              : rules?.some((r) => r.enabled)
                ? "watching"
                : "no rules enabled"}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={testNotification}>
              {testState === "idle" && "Test notification"}
              {testState === "sent" && "Sent ✓"}
              {testState === "failed" && "Failed — check OS settings"}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setEditing(EMPTY_RULE)}
            >
              <Plus size={14} /> Add rule
            </Button>
          </div>
        </div>
        {/* Firing now */}
        {active.length > 0 && (
          <div className="glass rounded-2xl border border-status-critical/40 p-4">
            <div className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold text-status-critical">
              <BellRing size={15} /> Firing now
            </div>
            <div className="flex flex-col gap-1.5">
              {active.map((a) => (
                <div
                  key={`${a.rule_id}:${a.host_id}`}
                  className="flex items-baseline gap-3 font-mono text-xs"
                >
                  <span className="font-medium text-ink-primary">
                    {a.rule_name}
                  </span>
                  <span className="text-ink-muted">{hostName(a.host_id)}</span>
                  <span className="text-status-critical">
                    now {formatValue(a.metric, a.value)}
                  </span>
                  <span className="ml-auto text-ink-faint">
                    since {timeAgo(a.since_ts)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Rules */}
        <div className="glass rounded-2xl border border-border p-4">
          <div className="mb-3 text-[13px] font-semibold text-ink-primary">
            Rules
          </div>
          {rules === null ? null : rules.length === 0 ? (
            <EmptyState
              icon={Bell}
              title="No alert rules yet"
              hint='Create one — e.g. "CPU above 90% for 5 min on any host" — and Flux will notify your desktop when it trips.'
              action={
                <Button variant="soft" onClick={() => setEditing(EMPTY_RULE)}>
                  <Plus size={14} /> Add your first rule
                </Button>
              }
            />
          ) : (
            <div className="flex flex-col divide-y divide-border/60">
              {rules.map((rule) => (
                <div key={rule.id} className="flex items-center gap-3 py-2">
                  <Switch
                    checked={rule.enabled}
                    onChange={() => toggleRule(rule)}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-ink-primary">
                      {rule.name}
                    </div>
                    <div className="font-mono text-[11px] text-ink-muted">
                      {conditionText(rule)}
                      {rule.duration_secs > 0 &&
                        ` for ${DURATIONS.find((d) => d.value === rule.duration_secs)?.label ?? `${rule.duration_secs}s`}`}
                      {" · "}
                      {rule.host_id ? hostName(rule.host_id) : "all hosts"}
                    </div>
                  </div>
                  <div className="ml-auto flex items-center gap-1">
                    {active.some((a) => a.rule_id === rule.id) && (
                      <Badge tone="critical" pulse>
                        firing
                      </Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Edit rule"
                      onClick={() => setEditing(rule)}
                    >
                      <Pencil size={13} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Delete rule"
                      onClick={() => deleteRule(rule)}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* History */}
        <div className="glass rounded-2xl border border-border p-4">
          <div className="mb-3 text-[13px] font-semibold text-ink-primary">
            History
          </div>
          {events.length === 0 ? (
            <p className="py-2 text-xs text-ink-faint">
              No alerts have fired yet.
            </p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-[10.5px] uppercase tracking-wide text-ink-faint">
                  <th className="py-1.5 pr-4 font-medium">When</th>
                  <th className="py-1.5 pr-4 font-medium">Rule</th>
                  <th className="py-1.5 pr-4 font-medium">Host</th>
                  <th className="py-1.5 pr-4 font-medium">Peak</th>
                  <th className="py-1.5 pr-4 font-medium">Duration</th>
                  <th className="py-1.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {events.map((e) => (
                  <tr key={e.id} className="border-t border-border/60">
                    <td className="py-1.5 pr-4 text-ink-muted">
                      {formatWhen(e.started_ts)}
                    </td>
                    <td className="py-1.5 pr-4 text-ink-primary">
                      {e.rule_name}
                    </td>
                    <td className="py-1.5 pr-4 text-ink-muted">
                      {hostName(e.host_id)}
                    </td>
                    <td className="py-1.5 pr-4 text-ink-secondary">
                      {formatValue(e.metric, e.peak_value)}
                    </td>
                    <td className="py-1.5 pr-4 text-ink-muted">
                      {e.resolved_ts
                        ? formatDurationShort(e.resolved_ts - e.started_ts)
                        : "—"}
                    </td>
                    <td className="py-1.5">
                      {e.resolved_ts ? (
                        <Badge tone="neutral">resolved</Badge>
                      ) : (
                        <Badge tone="critical" pulse>
                          firing
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {editing && (
        <RuleModal
          initial={editing}
          onSaved={setRules}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function formatDurationShort(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  return `${(secs / 3600).toFixed(1)}h`;
}
