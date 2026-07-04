export const HISTORY_LENGTH = 90;

export type SeriesMap = Record<string, number[]>;

export function push(history: number[] | undefined, value: number): number[] {
  const prev = history ?? [];
  const next = prev.length >= HISTORY_LENGTH ? prev.slice(1) : prev.slice();
  next.push(value);
  return next;
}
