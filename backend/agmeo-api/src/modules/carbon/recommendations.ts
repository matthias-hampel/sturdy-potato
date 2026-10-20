/**
 * Emission recommendations: what a completed operation or a crop cycle would emit with one
 * practice changed, priced with the BEK calculator (AGVOLUTION/agmeo src/lib/sanityChecker.ts,
 * `recommendations` and `compareCo2e`).
 *
 * The reference recomputes an operation's transactions with one article swapped. Here the same
 * operation input runs through `operationEmissionsPerHa` twice:
 * - incorporation: organic fertilizer worked in after more than an hour → within the hour
 *   (reference: INCORPORATION_4H → INCORPORATION_1H);
 * - mineralBlueFertilizer: urea with inhibitor → the same product from a green-technology plant
 *   (reference: ALZON liquid / neo-N → their "grüne Technologie" counterparts, category
 *   UREA_W_INHIBITOR_BLUE with the lower production factor);
 * - restStraw: straw taken off → left on the field (reference: BYPRODUCT_LEFT below 100 %).
 */
import { type CarbonMeasureType, isOrganicFertilizer } from '@agmeo/contracts';
import PARAMS from './bek/parameters.js';
import { carbonCrop, hasModelData } from './crops.js';
import {
  type CarbonInputLine,
  type CycleCarbonInput,
  cycleEmissionsPerHa,
  incorporationTime,
  operationEmissionsPerHa,
  type OperationCarbonInput,
  sumEmissions,
} from './emissions.js';

export interface PricedMeasure {
  type: CarbonMeasureType;
  productName: string | null;
  /** kg CO2e saved per hectare (positive = the measure lowers emissions). */
  savedKgPerHa: number;
}

/** Below this a measure is not worth showing (rounding noise of the calculator). */
const MIN_SAVING_KG_HA = 0.5;

const round = (v: number) => Math.round(v * 100) / 100;

function saving(
  op: OperationCarbonInput,
  changed: OperationCarbonInput,
  cropCode: string | null,
  year?: number,
): number {
  const crop = carbonCrop(cropCode);
  const before = sumEmissions(operationEmissionsPerHa(op, crop, year).byId);
  const after = sumEmissions(operationEmissionsPerHa(changed, crop, year).byId);
  return before - after;
}

const isOrganic = (l: CarbonInputLine) =>
  l.product.category === 'fertilizer' &&
  isOrganicFertilizer(l.product.fertilizerType);

const isInhibitorUrea = (l: CarbonInputLine) =>
  l.product.category === 'fertilizer' &&
  l.product.fertilizerType === 'urea_inhibitor' &&
  !l.product.bekCategory;

/** The green-technology category for a urea with inhibitor: liquid products by volume. */
const blueCategory = (l: CarbonInputLine) =>
  l.product.baseUnit === 'l' || l.product.baseUnit === 'm3'
    ? 'UREA_W_INHIBITOR_BLUE_LIQUID'
    : 'UREA_W_INHIBITOR_BLUE';

/**
 * Measures for one completed operation on a field line with the given crop. Each measure changes
 * only its own input, so the savings of two measures on one operation add up.
 */
export function operationMeasures(
  op: OperationCarbonInput,
  cropCode: string | null,
  year?: number,
): PricedMeasure[] {
  const out: PricedMeasure[] = [];
  const organic = op.inputs.filter(isOrganic);
  // Worked in, but later than within the hour (4 h or 8 h class). Without incorporation the
  // reference recommends nothing (top dressing in a standing crop cannot be worked in).
  const time = incorporationTime(op.incorporationHours);
  if (organic.length && (time === '4h' || time === '8h')) {
    const saved = saving(op, { ...op, incorporationHours: 1 }, cropCode, year);
    if (saved >= MIN_SAVING_KG_HA)
      out.push({
        type: 'incorporation',
        productName: organic.map((l) => l.product.name).join(', '),
        savedKgPerHa: round(saved),
      });
  }
  for (const line of op.inputs) {
    if (!isInhibitorUrea(line)) continue;
    const changed: OperationCarbonInput = {
      ...op,
      inputs: op.inputs.map((l) =>
        l === line
          ? { ...l, product: { ...l.product, bekCategory: blueCategory(l) } }
          : l,
      ),
    };
    const saved = saving(op, changed, cropCode, year);
    if (saved >= MIN_SAVING_KG_HA)
      out.push({
        type: 'mineralBlueFertilizer',
        productName: line.product.name,
        savedKgPerHa: round(saved),
      });
  }
  return out;
}

/** Whether the crop leaves a by-product (straw) the calculator can credit. */
export function hasStraw(cropCode: string | null): boolean {
  const crop = carbonCrop(cropCode);
  return (
    hasModelData(crop) &&
    crop !== 'silageMaize' &&
    (PARAMS.crop[crop].MPBR ?? 0) > 0
  );
}

/** Leaving the straw on the field instead of taking it off (a harvested crop cycle). */
export function strawMeasure(
  cycle: CycleCarbonInput & { cropCode: string | null },
  year?: number,
): PricedMeasure | null {
  if (!cycle.strawRemoved || !cycle.yieldTHa || !hasStraw(cycle.cropCode))
    return null;
  const before = sumEmissions(cycleEmissionsPerHa(cycle, year).byId);
  const after = sumEmissions(
    cycleEmissionsPerHa({ ...cycle, strawRemoved: false }, year).byId,
  );
  const saved = before - after;
  return saved >= MIN_SAVING_KG_HA
    ? { type: 'restStraw', productName: null, savedKgPerHa: round(saved) }
    : null;
}
