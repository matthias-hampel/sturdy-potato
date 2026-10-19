/**
 * Ported from AGVOLUTION/agmeo src/lib/trafficability/index.ts — logic, numbers and
 * thresholds unchanged; only imports adapted to the rewrite.
 */

/**
 * Trafficability — does the soil at this field, this depth, on this day,
 * tolerate the contact pressure of THIS machine without permanent
 * compaction?
 *
 * Full pipeline:
 *
 *   1. θ (FAO-56 water balance) ──► pF        (mualem.ts)
 *   2. clay + BD + pF             ──► Pc      (precompression.ts)
 *   3. Machine + tyre pressure    ──► σ_max   (contactPressure.ts)
 *   4. σ_max + depth + pF         ──► σ_z     (sci.ts: stressAtDepth)
 *   5. σ_z / Pc                   ──► SCI     (sci.ts: sci)
 *   6. SCI                        ──► band    (sci.ts: trafficabilityBand)
 *
 * Steps 1-2 depend only on the field (θ, soil class, BD, clay) — they do
 * NOT change when the user moves the tyre-pressure slider. Steps 3-6 are
 * the hot loop the slider re-runs across all fields.
 *
 * `prepareFieldTrafficability` runs steps 1-2 once per field (typically
 * server-side). `applyMachineLoad` runs steps 3-6 on every slider tick.
 * `evaluateTrafficability` keeps a one-call convenience wrapper.
 */

import {
  axleContactStress,
  type AxleStressMachineInput,
  type AxleStressOutput,
} from './contactPressure.js';
import { thetaToPF } from './mualem.js';
import { DEFAULT_BULK_DENSITY, precompression } from './precompression.js';
import {
  sci,
  stressAtDepth,
  type TrafficabilityBand,
  trafficabilityBand,
} from './sci.js';
import { getKa5SoilParams, type Ka5SoilParams } from './soilClasses.js';

export type FieldTrafficabilityPrep = {
  /** Matric potential on log scale from the field's current θ. */
  pf: number;
  /** Precompression Pc [kPa] at the evaluation depth. */
  precompressionKpa: number;
  /** Resolved soil-class parameters (or default fallback). */
  soil: Ka5SoilParams;
};

type PrepareFieldInput = {
  /** Current volumetric water content θ in vol fraction (0..1). */
  thetaCurrent: number;
  /** KA5 soil class code (fine or coarse; e.g. "Sl3" or "Ls"). */
  ka5: string | null | undefined;
  /** Override clay-% if you have a field-specific soil sample. */
  clayPctOverride?: number;
  /** Override bulk density if known. Defaults to 1.5 g/cm³. */
  bulkDensityGCm3?: number;
};

/**
 * Compute the soil-side numbers that stay constant across slider ticks for
 * one field on one day. Cheap to call but typically done once per field at
 * server load / page mount, not in the hot path.
 */
export function prepareFieldTrafficability(
  input: PrepareFieldInput,
): FieldTrafficabilityPrep {
  const soil = getKa5SoilParams(input.ka5);
  const bd = input.bulkDensityGCm3 ?? DEFAULT_BULK_DENSITY;
  const clay = input.clayPctOverride ?? soil.clayPct;
  const pf = thetaToPF(input.thetaCurrent, soil.mvg);
  const precompressionKpa = precompression({
    bulkDensityGCm3: bd,
    clayPct: clay,
    pf,
  });
  return { pf, precompressionKpa, soil };
}

/** Depth σ is evaluated at, in metres (topsoil yield horizon). */
export const DEFAULT_EVAL_DEPTH_M = 0.25;

type ApplyMachineLoadInput = {
  prep: FieldTrafficabilityPrep;
  machine: AxleStressMachineInput;
  /** Tyre footprint radius approximation per axle (≈ widthM/2). */
  frontFootprintRadiusM: number;
  rearFootprintRadiusM: number;
  /** Evaluation depth in metres. Default DEFAULT_EVAL_DEPTH_M. */
  evalDepthM?: number;
};

type TrafficabilityResult = {
  pf: number;
  precompressionKpa: number;
  axleStress: AxleStressOutput;
  stressAtDepthKpa: number;
  sci: number;
  band: TrafficabilityBand;
};

/**
 * Hot-path step. Given a pre-computed field prep + a machine config,
 * compute σ at depth, SCI, and the colour band. Slider drags re-run this
 * for every field — it must be cheap.
 */
function applyMachineLoad(input: ApplyMachineLoadInput): TrafficabilityResult {
  const { prep, machine, frontFootprintRadiusM, rearFootprintRadiusM } = input;
  const evalDepthM = input.evalDepthM ?? DEFAULT_EVAL_DEPTH_M;

  const axleStress = axleContactStress(machine);
  const useRear = axleStress.rearStressKpa >= axleStress.frontStressKpa;
  const surfaceWorstKpa = useRear
    ? axleStress.rearStressKpa
    : axleStress.frontStressKpa;
  const footprintWorstM = useRear
    ? rearFootprintRadiusM
    : frontFootprintRadiusM;

  const stressAtDepthKpa = stressAtDepth({
    surfaceStressKpa: surfaceWorstKpa,
    footprintRadiusM: footprintWorstM,
    depthM: evalDepthM,
    pf: prep.pf,
  });

  const sciValue = sci({
    stressAtDepthKpa,
    precompressionKpa: prep.precompressionKpa,
  });
  return {
    pf: prep.pf,
    precompressionKpa: prep.precompressionKpa,
    axleStress,
    stressAtDepthKpa,
    sci: sciValue,
    band: trafficabilityBand(sciValue),
  };
}

const DEFAULT_OPERATING_MASS_KG = 8000;
const DEFAULT_AXLE_FRACTION = 0.4;
const DEFAULT_FOOTPRINT_RADIUS_M = 0.25;
/** Slider fallback when the chosen machine has no mounted-tyre recommendation. */
export const DEFAULT_FALLBACK_PRESSURE_KPA = 150;

/** Tyre footprint radius ≈ widthM/2 (Keller 2005 single-tyre footprint half-width). */
function footprintRadius(widthM: number | null | undefined): number {
  return widthM ? widthM / 2 : DEFAULT_FOOTPRINT_RADIUS_M;
}

type MachineLoadInput = {
  operatingMassKg: number | null;
  frontAxleFraction: number | null;
  frontTyre: {
    widthM: number | null;
    recommendedPressureKpa: number | null;
  } | null;
  rearTyre: {
    widthM: number | null;
    recommendedPressureKpa: number | null;
  } | null;
};

function buildMachineLoad(
  machine: MachineLoadInput,
  pressures: { frontInflationKpa: number; rearInflationKpa: number },
): {
  machine: AxleStressMachineInput;
  frontFootprintRadiusM: number;
  rearFootprintRadiusM: number;
} {
  const { frontInflationKpa, rearInflationKpa } = pressures;
  return {
    machine: {
      operatingMassKg: machine.operatingMassKg ?? DEFAULT_OPERATING_MASS_KG,
      frontAxleFraction: machine.frontAxleFraction ?? DEFAULT_AXLE_FRACTION,
      frontInflationKpa,
      frontRecommendedKpa:
        machine.frontTyre?.recommendedPressureKpa ?? frontInflationKpa,
      rearInflationKpa,
      rearRecommendedKpa:
        machine.rearTyre?.recommendedPressureKpa ?? rearInflationKpa,
    },
    frontFootprintRadiusM: footprintRadius(machine.frontTyre?.widthM),
    rearFootprintRadiusM: footprintRadius(machine.rearTyre?.widthM),
  };
}

type EvaluateFieldsInput<F> = {
  fields: F[];
  machine: MachineLoadInput;
  frontInflationKpa: number;
  rearInflationKpa: number;
  dayOffset: number;
  evalDepthM?: number;
};

/**
 * Apply the machine + pressure + day combination to every field in one pass.
 * Returns `[field, result]` pairs in input order — the map layer projects to
 * GeoJSON features, the sidebar reduces to per-band counts. Single hot loop
 * shared between both consumers.
 */
export function evaluateFieldsForMachine<
  F extends {
    today: FieldTrafficabilityPrep;
    forecast: { prep: FieldTrafficabilityPrep }[];
  },
>(input: EvaluateFieldsInput<F>): { field: F; result: TrafficabilityResult }[] {
  const {
    fields,
    machine,
    frontInflationKpa,
    rearInflationKpa,
    dayOffset,
    evalDepthM,
  } = input;
  const {
    machine: machineLoad,
    frontFootprintRadiusM,
    rearFootprintRadiusM,
  } = buildMachineLoad(machine, { frontInflationKpa, rearInflationKpa });
  return fields.map((field) => {
    const prep =
      dayOffset === 0
        ? field.today
        : (field.forecast[dayOffset - 1]?.prep ?? field.today);
    return {
      field,
      result: applyMachineLoad({
        prep,
        machine: machineLoad,
        frontFootprintRadiusM,
        rearFootprintRadiusM,
        evalDepthM,
      }),
    };
  });
}

/** Inputs for the one-call convenience wrapper (server-side default-pressure path). */
export type TrafficabilityEvalInput = PrepareFieldInput &
  Omit<ApplyMachineLoadInput, 'prep'>;

export function evaluateTrafficability(
  input: TrafficabilityEvalInput,
): TrafficabilityResult {
  const prep = prepareFieldTrafficability(input);
  return applyMachineLoad({
    prep,
    machine: input.machine,
    frontFootprintRadiusM: input.frontFootprintRadiusM,
    rearFootprintRadiusM: input.rearFootprintRadiusM,
    evalDepthM: input.evalDepthM,
  });
}
