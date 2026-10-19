/**
 * Scope 2 (purchased electricity and heat) factors per kWh (agmeo src/lib/co2calculator/src/scope2.ts).
 * The entries themselves belong to the farm overview, which is not ported yet; the factors are
 * listed with the calculation parameters.
 */
import { parametersWithDetails as paramsCited } from './parameters-sources.js';

export const SCOPE2_KINDS = [
  'electricityGrid',
  'electricityRenewable',
  'heatingHeizoelDiesel',
  'heatingErdgas',
  'heatingFluessiggas',
  'heatingBiogas',
  'heatingPellets',
  'heatingBiomasseHolz',
  'heatingNahFernwaerme',
] as const;
export type Scope2Kind = (typeof SCOPE2_KINDS)[number];

export type Scope2ParameterDetails = {
  id: string;
  name: string;
  value: number;
  unit: string;
  source: string;
};

export const SCOPE2_PARAMETER_ID_BY_KIND = {
  electricityGrid: 'ef.electricityGridDe2018',
  electricityRenewable: 'ef.electricityRenewablesMixDe2018',
  heatingHeizoelDiesel: 'ef.heizoelDieselBafa2025',
  heatingErdgas: 'ef.erdgasBafa2025',
  heatingFluessiggas: 'ef.fluessiggasBafa2025',
  heatingBiogas: 'ef.biogasBafa2025',
  heatingPellets: 'ef.pelletsBafa2025',
  heatingBiomasseHolz: 'ef.biomasseHolzBafa2025',
  heatingNahFernwaerme: 'ef.nahFernwaermeBafa2025',
} as const satisfies Record<Scope2Kind, string>;

export const SCOPE2_KIND_I18N_KEY: Record<Scope2Kind, string> = {
  electricityGrid: 'scope2.electricity.grid',
  electricityRenewable: 'scope2.electricity.renewable',
  heatingHeizoelDiesel: 'scope2.heating.heizoelDiesel',
  heatingErdgas: 'scope2.heating.erdgas',
  heatingFluessiggas: 'scope2.heating.fluessiggas',
  heatingBiogas: 'scope2.heating.biogas',
  heatingPellets: 'scope2.heating.pellets',
  heatingBiomasseHolz: 'scope2.heating.biomasseHolz',
  heatingNahFernwaerme: 'scope2.heating.nahFernwaerme',
};

export const SCOPE2_ELECTRICITY_KINDS = [
  'electricityGrid',
  'electricityRenewable',
] as const satisfies readonly Scope2Kind[];

export const SCOPE2_HEATING_KINDS = [
  'heatingHeizoelDiesel',
  'heatingErdgas',
  'heatingFluessiggas',
  'heatingBiogas',
  'heatingPellets',
  'heatingBiomasseHolz',
  'heatingNahFernwaerme',
] as const satisfies readonly Scope2Kind[];

export function scope2ParameterDetails(
  kind: Scope2Kind,
): Scope2ParameterDetails {
  const id = SCOPE2_PARAMETER_ID_BY_KIND[kind];
  const p = paramsCited[id];
  return {
    id,
    name: p.Bezeichnung,
    value: p.Wert,
    unit: p.Einheit,
    source: p.Kurzzitat,
  };
}

export type Scope2RowComputed = {
  kind: Scope2Kind;
  kwh: number;
  kgCo2e: number;
  parameter: Scope2ParameterDetails;
};

export function computeScope2Row(
  kind: Scope2Kind,
  kwh: number,
): Scope2RowComputed {
  const parameter = scope2ParameterDetails(kind);
  return { kind, kwh, kgCo2e: kwh * parameter.value, parameter };
}
