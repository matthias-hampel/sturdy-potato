/**
 * Measurement systems. The database always stores metric (canonical) values; the UI converts
 * for display and converts typed input back. Ported from AGVOLUTION/agmeo `src/lib/units`.
 *
 * `canonical = display × factor + offset` (offset only for absolute temperature).
 */

export const MEASUREMENT_SYSTEMS = ['metric', 'imperial'] as const;
export type MeasurementSystem = (typeof MEASUREMENT_SYSTEMS)[number];
/** Organization setting: an explicit system, or derived from the organization's country. */
export const MEASUREMENT_SETTINGS = ['auto', ...MEASUREMENT_SYSTEMS] as const;
export type MeasurementSetting = (typeof MEASUREMENT_SETTINGS)[number];

// Exact US customary ↔ metric constants (international yard and pound, 1959).
export const HA_PER_ACRE = 0.40468564224;
export const M2_PER_ACRE = HA_PER_ACRE * 10_000;
export const KG_PER_LB = 0.45359237;
export const KG_PER_CWT = KG_PER_LB * 100;
export const KG_PER_SHORT_TON = KG_PER_LB * 2000;
export const KGPHA_PER_LBPAC = KG_PER_LB / HA_PER_ACRE;
export const L_PER_US_GAL = 3.785411784;
export const L_PER_US_QT = L_PER_US_GAL / 4;
export const L_PER_US_PT = L_PER_US_GAL / 8;
export const L_PER_US_FLOZ = L_PER_US_GAL / 128;
export const LPHA_PER_GPA = L_PER_US_GAL / HA_PER_ACRE;
export const MM_PER_INCH = 25.4;
export const CM_PER_INCH = 2.54;
export const M_PER_FT = 0.3048;
export const KM_PER_MILE = 1.609344;
export const MPS_PER_MPH = (KM_PER_MILE * 1000) / 3600;
export const KPA_PER_PSI = 6.894757293168361;
export const HPA_PER_INHG = 33.8638866667;
export const M3_PER_ACRE_INCH = M2_PER_ACRE * (MM_PER_INCH / 1000);
export const M3_PER_ACRE_FOOT = M3_PER_ACRE_INCH * 12;
/** Δ°F per Δ°C: for temperature differences and GDD, never for absolute temperatures. */
export const FAHRENHEIT_PER_CELSIUS = 1.8;

/** Countries whose farms work in US customary units when the setting is `auto`. */
const IMPERIAL_COUNTRIES = new Set(['US', 'LR', 'MM']);

export function resolveMeasurementSystem(setting: MeasurementSetting | null | undefined, country: string | null | undefined): MeasurementSystem {
  if (setting === 'metric' || setting === 'imperial') return setting;
  return country && IMPERIAL_COUNTRIES.has(country.toUpperCase()) ? 'imperial' : 'metric';
}

/**
 * Physical dimensions the app displays, each with a canonical metric unit. The three
 * liquid-rate dimensions exist because US labels quote fl oz, pt or qt per acre depending
 * on the product. `temperatureDelta` and `gdd` are linear (×1.8, no +32 offset).
 */
export const DIMENSIONS = [
  'area', // ha ↔ ac
  'yieldMass', // t/ha ↔ bu/ac | ton/ac | cwt/ac | lb/ac (crop-dependent)
  'massRate', // kg/ha ↔ lb/ac
  'liquidRateOz', // l/ha ↔ fl oz/ac
  'liquidRatePt', // l/ha ↔ pt/ac
  'liquidRateQt', // l/ha ↔ qt/ac
  'sprayVolume', // l/ha ↔ gal/ac
  'volumeRate', // m³/ha ↔ gal/ac
  'massRateLarge', // t/ha ↔ ton/ac
  'seedCountRate', // seeds/m² ↔ seeds/ac
  'plantCountRate', // plants/m² ↔ plants/ac
  'countRate', // units/ha ↔ units/ac
  'precipDepth', // mm ↔ in
  'waterVolume', // m³ ↔ ac-in
  'waterVolumeLarge', // m³ ↔ ac-ft
  'temperature', // °C ↔ °F
  'temperatureDelta', // Δ°C ↔ Δ°F
  'gdd', // °C-days ↔ °F-days
  'length', // m ↔ ft
  'smallLength', // cm ↔ in
  'soilDepth', // cm ↔ in
  'distance', // km ↔ mi
  'speed', // km/h ↔ mph
  'windSpeed', // m/s ↔ mph
  'pressure', // kPa ↔ psi
  'airPressure', // hPa ↔ inHg
  'weight', // kg ↔ lb
  'weightLarge', // t ↔ short ton
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

/** Unit ids double as i18n keys (`unit.<id>`) for their labels. */
export type UnitId =
  | 'ha' | 'acre' | 'tPerHa' | 'buPerAc' | 'shortTonPerAc' | 'cwtPerAc' | 'lbPerAc' | 'kgPerHa' | 'lPerHa'
  | 'flOzPerAc' | 'ptPerAc' | 'qtPerAc' | 'galPerAc' | 'm3PerHa' | 'piecesPerHa' | 'piecesPerAc' | 'plantsPerM2'
  | 'plantsPerAc' | 'seedsPerM2' | 'seedsPerAc' | 'mm' | 'inch' | 'm3' | 'acreInch' | 'acreFoot' | 'degC' | 'degF'
  | 'gddC' | 'gddF' | 'm' | 'ft' | 'cm' | 'km' | 'mile' | 'kmh' | 'mph' | 'mPerS' | 'kPa' | 'psi' | 'hPa' | 'inHg'
  | 'kg' | 'lb' | 't' | 'shortTon';

export interface UnitSpec {
  id: UnitId;
  factor: number;
  offset?: number;
  /** Default fraction digits for display. */
  precision: number;
}

const u = (id: UnitId, factor: number, precision: number, offset?: number): UnitSpec => ({ id, factor, precision, offset });

const CONFIG: Record<Dimension, { metric: UnitSpec; imperial: UnitSpec | 'cropDependent' }> = {
  area: { metric: u('ha', 1, 2), imperial: u('acre', HA_PER_ACRE, 1) },
  yieldMass: { metric: u('tPerHa', 1, 1), imperial: 'cropDependent' },
  massRate: { metric: u('kgPerHa', 1, 0), imperial: u('lbPerAc', KGPHA_PER_LBPAC, 0) },
  liquidRateOz: { metric: u('lPerHa', 1, 1), imperial: u('flOzPerAc', L_PER_US_FLOZ / HA_PER_ACRE, 0) },
  liquidRatePt: { metric: u('lPerHa', 1, 1), imperial: u('ptPerAc', L_PER_US_PT / HA_PER_ACRE, 1) },
  liquidRateQt: { metric: u('lPerHa', 1, 1), imperial: u('qtPerAc', L_PER_US_QT / HA_PER_ACRE, 1) },
  sprayVolume: { metric: u('lPerHa', 1, 0), imperial: u('galPerAc', LPHA_PER_GPA, 0) },
  volumeRate: { metric: u('m3PerHa', 1, 1), imperial: u('galPerAc', LPHA_PER_GPA / 1000, 0) },
  massRateLarge: { metric: u('tPerHa', 1, 1), imperial: u('shortTonPerAc', KG_PER_SHORT_TON / HA_PER_ACRE / 1000, 1) },
  seedCountRate: { metric: u('seedsPerM2', 1, 0), imperial: u('seedsPerAc', 1 / M2_PER_ACRE, 0) },
  plantCountRate: { metric: u('plantsPerM2', 1, 0), imperial: u('plantsPerAc', 1 / M2_PER_ACRE, 0) },
  countRate: { metric: u('piecesPerHa', 1, 0), imperial: u('piecesPerAc', 1 / HA_PER_ACRE, 0) },
  precipDepth: { metric: u('mm', 1, 1), imperial: u('inch', MM_PER_INCH, 2) },
  waterVolume: { metric: u('m3', 1, 0), imperial: u('acreInch', M3_PER_ACRE_INCH, 1) },
  waterVolumeLarge: { metric: u('m3', 1, 0), imperial: u('acreFoot', M3_PER_ACRE_FOOT, 1) },
  temperature: { metric: u('degC', 1, 1), imperial: u('degF', 1 / FAHRENHEIT_PER_CELSIUS, 0, -32 / FAHRENHEIT_PER_CELSIUS) },
  temperatureDelta: { metric: u('degC', 1, 1), imperial: u('degF', 1 / FAHRENHEIT_PER_CELSIUS, 0) },
  gdd: { metric: u('gddC', 1, 0), imperial: u('gddF', 1 / FAHRENHEIT_PER_CELSIUS, 0) },
  length: { metric: u('m', 1, 1), imperial: u('ft', M_PER_FT, 1) },
  smallLength: { metric: u('cm', 1, 0), imperial: u('inch', CM_PER_INCH, 1) },
  soilDepth: { metric: u('cm', 1, 0), imperial: u('inch', CM_PER_INCH, 1) },
  distance: { metric: u('km', 1, 1), imperial: u('mile', KM_PER_MILE, 1) },
  speed: { metric: u('kmh', 1, 1), imperial: u('mph', KM_PER_MILE, 1) },
  windSpeed: { metric: u('mPerS', 1, 1), imperial: u('mph', MPS_PER_MPH, 1) },
  pressure: { metric: u('kPa', 1, 0), imperial: u('psi', KPA_PER_PSI, 1) },
  airPressure: { metric: u('hPa', 1, 1), imperial: u('inHg', HPA_PER_INHG, 2) },
  weight: { metric: u('kg', 1, 0), imperial: u('lb', KG_PER_LB, 0) },
  weightLarge: { metric: u('t', 1, 2), imperial: u('shortTon', KG_PER_SHORT_TON / 1000, 1) },
};

/**
 * How a crop's yield is quoted in the US. Bushels are standardized by weight per crop (USDA
 * test weights); forage crops are quoted in short tons/ac, potatoes in cwt/ac, small seeds in lb/ac.
 */
export type CropYieldImperial = { kind: 'bushel'; lbPerBu: number } | { kind: 'shortTonPerAc' } | { kind: 'cwtPerAc' } | { kind: 'lbPerAc' };

/** By crop code (`crops.code`). Crops not listed use short tons/ac. */
export const CROP_YIELD_IMPERIAL: Record<string, CropYieldImperial> = {
  grain_maize: { kind: 'bushel', lbPerBu: 56 },
  winter_rye: { kind: 'bushel', lbPerBu: 56 },
  winter_wheat: { kind: 'bushel', lbPerBu: 60 },
  spring_wheat: { kind: 'bushel', lbPerBu: 60 },
  soybeans: { kind: 'bushel', lbPerBu: 60 },
  peas: { kind: 'bushel', lbPerBu: 60 },
  field_beans: { kind: 'bushel', lbPerBu: 60 },
  lupins: { kind: 'bushel', lbPerBu: 60 },
  winter_barley: { kind: 'bushel', lbPerBu: 48 },
  spring_barley: { kind: 'bushel', lbPerBu: 48 },
  oats: { kind: 'bushel', lbPerBu: 32 },
  winter_oats: { kind: 'bushel', lbPerBu: 32 },
  triticale: { kind: 'bushel', lbPerBu: 50 },
  winter_rapeseed: { kind: 'bushel', lbPerBu: 50 },
  spring_rapeseed: { kind: 'bushel', lbPerBu: 50 },
  winter_spelt: { kind: 'bushel', lbPerBu: 40 },
  silage_maize: { kind: 'shortTonPerAc' },
  sugar_beet: { kind: 'shortTonPerAc' },
  potatoes: { kind: 'cwtPerAc' },
  sunflower: { kind: 'lbPerAc' },
};
const CROP_YIELD_FALLBACK: CropYieldImperial = { kind: 'shortTonPerAc' };

function yieldUnit(c: CropYieldImperial): UnitSpec {
  switch (c.kind) {
    case 'bushel':
      return u('buPerAc', (c.lbPerBu * KGPHA_PER_LBPAC) / 1000, 0);
    case 'shortTonPerAc':
      return u('shortTonPerAc', KG_PER_SHORT_TON / HA_PER_ACRE / 1000, 1);
    case 'cwtPerAc':
      return u('cwtPerAc', KG_PER_CWT / HA_PER_ACRE / 1000, 0);
    case 'lbPerAc':
      return u('lbPerAc', KGPHA_PER_LBPAC / 1000, 0);
  }
}

export interface MeasureContext {
  /** Crop code, for imperial yields. Leave out for aggregates across crops. */
  crop?: string | null;
}

export function displayUnit(dimension: Dimension, system: MeasurementSystem, ctx?: MeasureContext): UnitSpec {
  const config = CONFIG[dimension];
  if (system === 'metric') return config.metric;
  if (config.imperial !== 'cropDependent') return config.imperial;
  return yieldUnit((ctx?.crop && CROP_YIELD_IMPERIAL[ctx.crop]) || CROP_YIELD_FALLBACK);
}

/** Canonical metric value → value in the system's display unit (unrounded). */
export function toDisplay(canonical: number, dimension: Dimension, system: MeasurementSystem, ctx?: MeasureContext): number {
  if (system === 'metric') return canonical;
  const unit = displayUnit(dimension, system, ctx);
  return (canonical - (unit.offset ?? 0)) / unit.factor;
}

/** Typed value in the system's display unit → canonical metric value (unrounded). */
export function toCanonical(display: number, dimension: Dimension, system: MeasurementSystem, ctx?: MeasureContext): number {
  if (system === 'metric') return display;
  const unit = displayUnit(dimension, system, ctx);
  return display * unit.factor + (unit.offset ?? 0);
}
