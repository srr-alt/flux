const REFRESH_KEY = "flux.refreshMs";

export const REFRESH_OPTIONS = [
  { ms: 500, label: "0.5s" },
  { ms: 1000, label: "1s" },
  { ms: 2000, label: "2s" },
  { ms: 3000, label: "3s" },
  { ms: 5000, label: "5s" },
] as const;

export const DEFAULT_REFRESH_MS = 1000;

export function loadRefreshMs(): number {
  const raw = Number(localStorage.getItem(REFRESH_KEY));
  return REFRESH_OPTIONS.some((o) => o.ms === raw) ? raw : DEFAULT_REFRESH_MS;
}

export function saveRefreshMs(ms: number): void {
  localStorage.setItem(REFRESH_KEY, String(ms));
}
