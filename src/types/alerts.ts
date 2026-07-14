export type AlertMetric =
  | "cpu_pct"
  | "mem_pct"
  | "temp_c"
  | "net_rx_bps"
  | "net_tx_bps";

export type AlertOp = "gt" | "lt";

export interface AlertRule {
  id: string;
  name: string;
  metric: AlertMetric;
  op: AlertOp;
  threshold: number;
  duration_secs: number;
  /** null = every host. */
  host_id: string | null;
  enabled: boolean;
}

export interface ActiveAlert {
  rule_id: string;
  rule_name: string;
  host_id: string;
  metric: AlertMetric;
  op: AlertOp;
  threshold: number;
  value: number;
  since_ts: number;
}

export interface AlertEventRow {
  id: number;
  rule_id: string;
  rule_name: string;
  host_id: string;
  metric: string;
  threshold: number;
  peak_value: number;
  started_ts: number;
  resolved_ts: number | null;
}
