/**
 * Ported from AGVOLUTION/agmeo src/lib/utils/index.ts — only `clip`.
 */

export function clip(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
