/**
 * KTBL action costs, V2: values from the KTBL cost tables averaged per crop group, interpolated
 * bilinearly between the grid's field sizes and distances (values outside the grid take the
 * nearest edge).
 *
 * Ported from agmeo `src/lib/ktbl/actionCostEstimatorV2.ts` without changes.
 */
type CostName = 'hours' | 'diesel' | 'depreciation' | 'interest' | 'miscellaneous' | 'repairs' | 'materials' | 'services';

type ActionCostsV2 = Record<CostName, number>;

type Options = {
  fieldSizeHa?: number;
  distanceKm?: number;
  mechKw?: number;
  crop?: string; // crop group name (cereals, maize, roots, oilseeds, legumes, grasses, intercrops)
};

export type CostsData = {
  fieldSizes: number[]; // stored ×10 (e.g. 100 = 10 ha)
  distances: number[]; // km
  costColumns: string[];
  grids: number[][];
  groupedActions: Record<string, Record<string, number>>; // fqn → { "group__mech" → gridIdx }
  universalActions: Record<string, Record<string, number>>; // fqn → { mechStr → gridIdx }
};

const MECH_LEVELS = [45, 67, 83, 102, 120, 200, 230];
const DEFAULT_FS_HA = 10;
const DEFAULT_DIST_KM = 5;
const DEFAULT_MECH_KW = 120;

// "miscellanous" is a typo in the KTBL source data
const COST_COL_MAP: Record<string, CostName> = {
  hours: 'hours',
  diesel: 'diesel',
  depreciation: 'depreciation',
  interest: 'interest',
  miscellanous: 'miscellaneous',
  repairs: 'repairs',
  materials: 'materials',
  services: 'services',
};

type Interp = { lo: number; hi: number; t: number };

// Returns bracketing indices + linear interpolation weight (0 = at lo, 1 = at hi)
function interpIndex(arr: number[], value: number): Interp {
  if (value <= arr[0]) return { lo: 0, hi: 0, t: 0 };
  const last = arr.length - 1;
  if (value >= arr[last]) return { lo: last, hi: last, t: 0 };
  for (let i = 0; i < last; i++) {
    if (value <= arr[i + 1]) return { lo: i, hi: i + 1, t: (value - arr[i]) / (arr[i + 1] - arr[i]) };
  }
  return { lo: last, hi: last, t: 0 };
}

function nearestMech(kw: number): number {
  return MECH_LEVELS.reduce((best, m) => (Math.abs(m - kw) < Math.abs(best - kw) ? m : best));
}

export function createV2Estimator(data: CostsData) {
  const fieldSizesHa = data.fieldSizes.map((v) => v / 10);
  const nDist = data.distances.length;
  const nCols = data.costColumns.length;

  // Pre-compute column index → cost name to avoid repeated lookups per call
  const colNames = data.costColumns.map((c) => COST_COL_MAP[c] ?? null);

  function gridToActionCosts(grid: number[], fs: Interp, dist: Interp): ActionCostsV2 {
    if (grid[0] === 0) {
      // Constant grid: single value set, no interpolation needed
      const result = {} as ActionCostsV2;
      for (let i = 0; i < nCols; i++) {
        const name = colNames[i];
        if (name) result[name] = grid[1 + i] ?? 0;
      }
      return result;
    }
    // Bilinear interpolation across the (fieldSize × distance) grid
    const result = {} as ActionCostsV2;
    for (let i = 0; i < nCols; i++) {
      const name = colNames[i];
      if (!name) continue;
      const v00 = grid[1 + (fs.lo * nDist + dist.lo) * nCols + i] ?? 0;
      const v10 = grid[1 + (fs.hi * nDist + dist.lo) * nCols + i] ?? 0;
      const v01 = grid[1 + (fs.lo * nDist + dist.hi) * nCols + i] ?? 0;
      const v11 = grid[1 + (fs.hi * nDist + dist.hi) * nCols + i] ?? 0;
      result[name] = (1 - fs.t) * (1 - dist.t) * v00 + fs.t * (1 - dist.t) * v10 + (1 - fs.t) * dist.t * v01 + fs.t * dist.t * v11;
    }
    return result;
  }

  return function estimateActionCostsV2(fqn: string, options: Options = {}): ActionCostsV2 | null {
    const fs = interpIndex(fieldSizesHa, options.fieldSizeHa ?? DEFAULT_FS_HA);
    const dist = interpIndex(data.distances, options.distanceKm ?? DEFAULT_DIST_KM);
    const mech = nearestMech(options.mechKw ?? DEFAULT_MECH_KW);
    const sortedMechs = MECH_LEVELS.slice().sort((a, b) => Math.abs(a - mech) - Math.abs(b - mech));

    const fqnEntry = data.groupedActions[fqn];
    if (fqnEntry) {
      for (const m of sortedMechs) {
        const gIdx = options.crop ? (fqnEntry[`${options.crop}__${m}`] ?? fqnEntry[`__${m}`]) : fqnEntry[`__${m}`];
        if (gIdx !== undefined && data.grids[gIdx]) return gridToActionCosts(data.grids[gIdx], fs, dist);
      }
    }

    const uaMechs = data.universalActions[fqn];
    if (uaMechs) {
      for (const m of sortedMechs) {
        const gIdx = uaMechs[String(m)];
        if (gIdx !== undefined && data.grids[gIdx]) return gridToActionCosts(data.grids[gIdx], fs, dist);
      }
    }

    return null;
  };
}
