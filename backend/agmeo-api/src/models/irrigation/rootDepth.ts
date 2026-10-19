/**
 * Ported from AGVOLUTION/agmeo src/lib/irrigation/rootDepth.ts — only the
 * validation of a per-cultivation rooting-depth override. Persisting it (the
 * reference's `saveRootDepthOverridesForOrg`) is database work and stays with
 * the caller.
 *
 * The override REPLACES the crop's FAO-56 Table 22 default for one
 * cultivation (pass it as `rootDepthM` to buildFieldWaterBalance). It belongs
 * on the cultivation, not the field: a new crop-year starts from the default
 * for whatever crop is grown next.
 */

import { MAX_ROOT_DEPTH_M, MIN_ROOT_DEPTH_M } from './waterBalance.js';

export class RootDepthError extends Error {
  constructor(
    readonly code: 'not_found' | 'out_of_range',
    message: string,
  ) {
    super(message);
    this.name = 'RootDepthError';
  }
}

export type RootDepthUpdate = {
  cultivationId: string;
  /** Metres, or null to drop the override and fall back to the crop default. */
  rootDepthM: number | null;
};

/** Throws RootDepthError('out_of_range') for any non-null depth outside [0.1, 3] m. */
export function validateRootDepthOverrides(updates: RootDepthUpdate[]): void {
  for (const { rootDepthM } of updates) {
    if (rootDepthM === null) continue;
    if (
      !Number.isFinite(rootDepthM) ||
      rootDepthM < MIN_ROOT_DEPTH_M ||
      rootDepthM > MAX_ROOT_DEPTH_M
    ) {
      throw new RootDepthError(
        'out_of_range',
        `Rooting depth must be between ${MIN_ROOT_DEPTH_M} and ${MAX_ROOT_DEPTH_M} m`,
      );
    }
  }
}
