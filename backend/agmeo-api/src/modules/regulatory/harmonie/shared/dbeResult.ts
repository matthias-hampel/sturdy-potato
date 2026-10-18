/**
 * §3(2) DüV breakdown as stored in DbeSnapshots.result (the return of
 * `calculateFertilizerNeed`). All values kg N/ha unless noted. Every field is
 * optional — older snapshots may predate individual fields.
 */
export type DuevDbeResult = {
  nRequirementValue?: number;
  referenceYield?: number;
  farmYield?: number;
  /** Farm yield in dt fresh mass (grassland results carry dt TM in `farmYield`). */
  farmYieldDtFM?: number;
  grasslandTmFactor?: number | null;
  yieldUnit?: string;
  yieldDifference?: number;
  yieldSurcharge?: number;
  nmin?: number;
  humusDeduction?: number;
  orgPreviousYearDeduction?: number;
  previousCropDeduction?: number;
  catchCropDeduction?: number;
  foilSurcharge?: number;
  nFertilizerNeed?: number;
  nitrateZoneReduction?: number;
  nFertilizerNeedFinal?: number;
  isGrassland?: boolean;
  /** ISO timestamp of the snapshot the result was read from. */
  snapshotAt?: string;
};
