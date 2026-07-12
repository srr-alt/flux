/** Single source of truth for chart/JS colors is the @theme block in
 * index.css. uPlot and inline styles need concrete strings, so we read the
 * CSS variables lazily (first call happens during render, after styles
 * load) and memoize. Fallbacks mirror index.css for tests/edge cases. */

const FALLBACKS = {
  series1: "#5e6ad2",
  series2: "#4fb477",
  series3: "#d0a24c",
  series4: "#3987e5",
  series5: "#8b93e8",
  series6: "#2da44e",
  series7: "#d55181",
  series8: "#d95926",
  inkMuted: "#8a8f98",
  inkSecondary: "#c8ccd4",
  gridline: "#191b22",
  terminal: "#08090b",
  statusGood: "#4fb477",
  statusWarning: "#d0a24c",
  statusSerious: "#e08a5f",
  statusCritical: "#e0685f",
} as const;

export type ThemeColorName = keyof typeof FALLBACKS;

const CSS_VAR: Record<ThemeColorName, string> = {
  series1: "--color-series-1",
  series2: "--color-series-2",
  series3: "--color-series-3",
  series4: "--color-series-4",
  series5: "--color-series-5",
  series6: "--color-series-6",
  series7: "--color-series-7",
  series8: "--color-series-8",
  inkMuted: "--color-ink-muted",
  inkSecondary: "--color-ink-secondary",
  gridline: "--color-gridline",
  terminal: "--color-terminal",
  statusGood: "--color-status-good",
  statusWarning: "--color-status-warning",
  statusSerious: "--color-status-serious",
  statusCritical: "--color-status-critical",
};

const cache = new Map<ThemeColorName, string>();

export function themeColor(name: ThemeColorName): string {
  const cached = cache.get(name);
  if (cached) return cached;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(CSS_VAR[name])
    .trim();
  const resolved = value || FALLBACKS[name];
  cache.set(name, resolved);
  return resolved;
}

/** "#3987e5", 0.25 -> "rgba(57, 135, 229, 0.25)". 6-digit hex only. */
export function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Metric-to-series mapping shared by Performance rail/details and HostTile.
 * Getters keep the CSS-var read lazy: modules can hold a reference at import
 * time, but colors resolve on first property access (during render). */
export const chartColors = {
  get cpu() { return themeColor("series1"); },
  get memory() { return themeColor("series5"); },
  get disk() { return themeColor("series3"); },
  get net() { return themeColor("series2"); },
  get netTx() { return themeColor("series5"); },
  get gpu() { return themeColor("series1"); },
};

export const AXIS_FONT = '11px "Inter Variable", system-ui';

/** xterm theme built from tokens so the terminal tracks the app palette. */
export function terminalTheme() {
  return {
    background: themeColor("terminal"),
    foreground: themeColor("inkSecondary"),
    cursor: themeColor("inkSecondary"),
    selectionBackground: withAlpha(themeColor("series1"), 0.33),
  };
}
