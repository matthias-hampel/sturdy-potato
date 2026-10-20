/**
 * Nutrients the by-product (straw, leaves) left on the field supplies to the following crop, in kg/ha
 * (agmeo src/lib/co2calculator/src/extractor.ts). They are credited as pn2a–pn2c.
 */
import PARAMS from './parameters.js';
import type { SupportedCrops } from './types.js';

/** `byProductWet` in t fresh mass/ha; `byproductRemoved` the removed share (0–1). */
export function calculateNforNextCrop(
  byProductWet: number,
  crop: SupportedCrops,
  byproductRemoved: number,
): number {
  return (
    byProductWet *
    1000 *
    (PARAMS.crop[crop]?.nByproductFm || 0) *
    (1 - byproductRemoved)
  );
}

export function calculateP2O5forNextCrop(
  byProductWet: number,
  crop: SupportedCrops,
  byproductRemoved: number,
): number {
  return (
    byProductWet *
    1000 *
    (PARAMS.crop[crop]?.p2o5ByproductFm || 0) *
    (1 - byproductRemoved)
  );
}

export function calculateK2OforNextCrop(
  byProductWet: number,
  crop: SupportedCrops,
  byproductRemoved: number,
): number {
  return (
    byProductWet *
    1000 *
    (PARAMS.crop[crop]?.k2oByproductFm || 0) *
    (1 - byproductRemoved)
  );
}
