/**
 * ISO 11783-11 data dictionary channels, shared by every telemetry source that
 * keys its measurements by DDI: ISOXML TLG time logs (TASKDATA zips from CLAAS,
 * Fendt/AGCO, Krone, CNH terminals) and the CLAAS Point Data API, whose
 * `implementMeasurementValues` use the same numbering.
 *
 * Harvest is not the only thing a time log carries: a fertilising or spraying
 * TASKDATA logs an applied rate on the same structure, which is what
 * as-applied mapping reads.
 *
 * Every number and unit here was read from the registry at isobus.net, not
 * recalled — see `WORKING_WIDTH_CHANNEL`.
 */

type IsoChannel = {
  kind: "yield" | "appliedRate" | "setpointRate" | "moisture" | "workingWidth";
  /** Decimal DDI. The ISO tables print hex — see `WORKING_WIDTH_CHANNEL`. */
  ddi: number;
  /** Registry name, verbatim, so a value can be traced back to its source. */
  name: string;
  /** Registry unit symbol, verbatim. */
  unit: string;
  /** The unit agmeo stores, after `toCanonical`. */
  canonicalUnit: string;
  /** raw × this = canonical. Never inline a factor at a call site. */
  toCanonical: number;
};

export type YieldChannel = IsoChannel & {
  /** Whether the mass is as-harvested or dried. */
  basis: "wet" | "dry";
};

/*
 * Conversions, derived rather than remembered:
 *
 *   mg/m²  → t/ha   1 mg/m² = 1e-6 kg/m² = 1e-2 kg/ha = 1e-5 t/ha
 *   mg/m²  → kg/ha  1e-2
 *   mm³/m² → l/ha   1 mm³ = 1e-6 l, so 1 mm³/m² = 1e-2 l/ha
 *   ml/m²  → l/ha   1 ml  = 1e-3 l, so 1 ml/m²  = 10 l/ha
 *   ppm    → %      1e-4
 *   mm     → m      1e-3
 */

export const MG_M2_TO_T_HA = 1e-5;
export const MG_M2_TO_KG_HA = 1e-2;
export const MM3_M2_TO_L_HA = 1e-2;
export const ML_M2_TO_L_HA = 10;
export const PPM_TO_PERCENT = 1e-4;
export const MM_TO_M = 1e-3;

/** Harvest mass per area. Pinned per file so a wet and a dry log never blend. */
export const YIELD_CHANNELS: YieldChannel[] = [
  {
    kind: "yield",
    ddi: 84,
    name: "Mass Per Area Yield",
    unit: "mg/m²",
    canonicalUnit: "t/ha",
    toCanonical: MG_M2_TO_T_HA,
    basis: "wet",
  },
  {
    kind: "yield",
    ddi: 181,
    name: "Dry Mass Per Area Yield",
    unit: "mg/m²",
    canonicalUnit: "t/ha",
    toCanonical: MG_M2_TO_T_HA,
    basis: "dry",
  },
];

/**
 * What the machine actually put out — the as-applied channels.
 *
 * The registry defines volume per area twice under the same names: DDI 1/2 in
 * mm³/m² and DDI 588/589 in ml/m², a factor of 1000 apart. They are separate
 * entries with their own factors so no call site has to know which spelling it
 * received. Searched in order, first present wins: mass leads because
 * fertiliser and seed are the common cases.
 */
export const APPLIED_RATE_CHANNELS: IsoChannel[] = [
  {
    kind: "appliedRate",
    ddi: 7,
    name: "Actual Mass Per Area Application Rate",
    unit: "mg/m²",
    canonicalUnit: "kg/ha",
    toCanonical: MG_M2_TO_KG_HA,
  },
  {
    kind: "appliedRate",
    ddi: 2,
    name: "Actual Volume Per Area Application Rate",
    unit: "mm³/m²",
    canonicalUnit: "l/ha",
    toCanonical: MM3_M2_TO_L_HA,
  },
  {
    kind: "appliedRate",
    ddi: 589,
    name: "Actual Volume Per Area Application Rate",
    unit: "ml/m²",
    canonicalUnit: "l/ha",
    toCanonical: ML_M2_TO_L_HA,
  },
  {
    kind: "appliedRate",
    ddi: 12,
    name: "Actual Count Per Area Application Rate",
    unit: "/m²",
    canonicalUnit: "1/m²",
    toCanonical: 1,
  },
];

/**
 * What the terminal was told to put out, so prescribed-versus-applied is
 * answerable from one file. For count per area, 11 is the setpoint and 12 the
 * actual — the reverse of the mass and volume pairs.
 */
export const SETPOINT_RATE_CHANNELS: IsoChannel[] = [
  {
    kind: "setpointRate",
    ddi: 6,
    name: "Setpoint Mass Per Area Application Rate",
    unit: "mg/m²",
    canonicalUnit: "kg/ha",
    toCanonical: MG_M2_TO_KG_HA,
  },
  {
    kind: "setpointRate",
    ddi: 1,
    name: "Setpoint Volume Per Area Application Rate",
    unit: "mm³/m²",
    canonicalUnit: "l/ha",
    toCanonical: MM3_M2_TO_L_HA,
  },
  {
    kind: "setpointRate",
    ddi: 588,
    name: "Setpoint Volume Per Area Application Rate",
    unit: "ml/m²",
    canonicalUnit: "l/ha",
    toCanonical: ML_M2_TO_L_HA,
  },
  {
    kind: "setpointRate",
    ddi: 11,
    name: "Setpoint Count Per Area Application Rate",
    unit: "/m²",
    canonicalUnit: "1/m²",
    toCanonical: 1,
  },
];

export const MOISTURE_CHANNEL: IsoChannel = {
  kind: "moisture",
  ddi: 99,
  name: "Crop Moisture",
  unit: "ppm",
  canonicalUnit: "%",
  toCanonical: PPM_TO_PERCENT,
};

/**
 * Actual Working Width is decimal 67, which the ISO tables print as hex
 * `0x0043`. It was once transcribed as the decimal literal 43 — Default Mass
 * Per Time Application Rate [mg/s] — so a flow rate was read as a width in
 * millimetres and widened every footprint in `removeOverlap`.
 */
export const WORKING_WIDTH_CHANNEL: IsoChannel = {
  kind: "workingWidth",
  ddi: 67,
  name: "Actual Working Width",
  unit: "mm",
  canonicalUnit: "m",
  toCanonical: MM_TO_M,
};

/** How a stored value should be labelled, so a number can be traced to its DDI. */
export const channelAttribution = (channel: IsoChannel): string => `ISOXML DDI ${channel.ddi} (${channel.name})`;

/** A moisture reading outside (0, 100) % is a sensor artefact, not a value. */
export const plausibleMoisturePercent = (value: number | undefined): number | undefined =>
  value !== undefined && value > 0 && value < 100 ? value : undefined;
