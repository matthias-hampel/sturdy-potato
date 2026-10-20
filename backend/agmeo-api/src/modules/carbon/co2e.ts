/**
 * Greenhouse-gas emissions after the BEK method (Berechnungsstandard für einzelbetriebliche
 * Klimabilanzen) as implemented in AGVOLUTION/agmeo src/lib/co2calculator — ported in ./bek with
 * its tests. This module is the entry point for the rest of the API: the factor-set name stored
 * with every ledger entry, the source → category grouping and the calculation parameters page.
 */
import {
  BEK_SOURCE_CATEGORY,
  BEK_SOURCES,
  type BekSource,
  type CalculationParameter,
  type CalculationParameterGroup,
  type EmissionCategory,
} from '@agmeo/contracts';
import PARAMS from './bek/parameters.js';
import { parametersWithDetails } from './bek/parameters-sources.js';
import { cropsWithoutModelData, type SupportedCrops } from './bek/types.js';

export { operationEmissionsPerHa, cycleEmissionsPerHa } from './emissions.js';

/** Stored with each emission entry; changes when the method or its factors change. */
export const CO2E_FACTOR_SET = 'DE-BEK-agmeo-2026.10';

/** Sources of the simplified calculator (factor set DE-BEK-simplified-2026.1), still in old ledger rows. */
const LEGACY_SOURCE: Record<string, BekSource> = {
  diesel: 'pb6a',
  machinery: 'pb7',
  n2o_direct: 'pf4',
  n2o_indirect: 'pf2',
  fertilizer_supply: 'pb1a',
  lime_urea_co2: 'pf8a',
  plant_protection: 'pb5',
  seed: 'pb4',
};

/** The BEK source of a ledger row's `source`, mapping rows written by the simplified calculator. */
export function bekSource(source: string): BekSource | null {
  if ((BEK_SOURCES as readonly string[]).includes(source))
    return source as BekSource;
  return LEGACY_SOURCE[source] ?? null;
}

export function emissionCategory(source: string): EmissionCategory | null {
  const s = bekSource(source);
  return s ? BEK_SOURCE_CATEGORY[s] : null;
}

const CROP_FIELDS = [
  'dryMatterContent',
  'dryMatterContentByproduct',
  'MPBR',
  'rootProportion',
  'nContentRoot',
  'nByproductFm',
  'p2o5ByproductFm',
  'k2oByproductFm',
  'restsHumusBuildingPotential',
  'humusMain',
  'supplySeed',
  'thousandGrainWeight',
  'piecesToKg',
] as const;

function groupOf(id: string): CalculationParameterGroup | null {
  if (id.startsWith('cf.') || id.startsWith('gwp.') || id === 'nPerCHumus')
    return 'general';
  if (
    [
      'ef.diesel',
      'ef.biodiesel',
      'ef.hvo100',
      'ef.machineManufacture',
    ].includes(id)
  )
    return 'fuel';
  if (/Bafa2025$|^ef\.electricity/.test(id)) return 'scope2';
  if (id === 'ef.supplyPesticides' || id.startsWith('pesticides.'))
    return 'plant_protection';
  if (
    id.startsWith('ef.supply') ||
    id === 'ef.otherMineralN' ||
    id === 'ef.nPrevious'
  )
    return 'fertilizer_supply';
  if (id.startsWith('ef.')) return 'field';
  if (id.startsWith('orgFertParams.')) return 'organic_fertilizer';
  return null;
}

/** Every factor of the calculator with its value as used, unit and citation; crop values per crop. */
export function calculationParameters(): CalculationParameter[] {
  const out: CalculationParameter[] = [];
  for (const [id, p] of Object.entries(parametersWithDetails)) {
    const group = groupOf(id);
    if (!group) continue;
    const parts = id.split('.');
    const variant =
      group === 'organic_fertilizer'
        ? `${parts[1]}.${parts[2]}`
        : parts.length > 2
          ? parts.slice(1, -1).join('.')
          : null;
    out.push({
      id,
      group,
      key: parts[parts.length - 1],
      variant,
      value: p.Wert,
      unit: p.Einheit,
      name: p.Bezeichnung || null,
      description: p.Beschreibung || null,
      source: p.Kurzzitat || null,
      citation: p.Langzitat || null,
    });
  }
  // Constants the reference sets in the calculator itself.
  out.push(
    {
      id: 'n2oNefAmmoniaDeposit',
      group: 'field',
      key: 'n2oNefAmmoniaDeposit',
      variant: null,
      value: 0.01,
      unit: 'kg N2O-N · (kg NH3-N)-1',
      name: 'EF N2O-N, NH3-Deposition',
      description: null,
      source: null,
      citation: null,
    },
    {
      id: 'nLastYearShare',
      group: 'field',
      key: 'nLastYearShare',
      variant: null,
      value: 0.1,
      unit: '–',
      name: 'N-Nachwirkung organische Düngung Vorjahr',
      description: null,
      source: null,
      citation: null,
    },
  );
  // Crop parameters as the calculator uses them (several crops borrow another crop's values).
  for (const crop of Object.keys(PARAMS.crop) as SupportedCrops[]) {
    if (cropsWithoutModelData.includes(crop)) continue;
    const params = PARAMS.crop[crop] as unknown as Record<
      string,
      number | undefined
    >;
    for (const field of CROP_FIELDS) {
      const value = params[field];
      if (value == null) continue;
      const cited = parametersWithDetails[`crop.${crop}.${field}`];
      const same = cited && cited.Wert === value;
      out.push({
        id: `crop.${crop}.${field}`,
        group: 'crop',
        key: field,
        variant: crop,
        value,
        unit: cited?.Einheit ?? '',
        name: cited?.Bezeichnung || null,
        description: cited?.Beschreibung || null,
        source: same ? cited.Kurzzitat || null : null,
        citation: same ? cited.Langzitat || null : null,
      });
    }
  }
  return out;
}
