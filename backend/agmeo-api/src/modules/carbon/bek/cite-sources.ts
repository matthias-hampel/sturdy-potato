/**
 * Citations and units of calculator parameters (agmeo src/lib/co2calculator/method/citeSources.ts).
 * The reference also cites catalogue articles by FQN; agmeo products carry their own contents, so
 * only the method parameters are cited here.
 */
import { parametersWithDetails } from './parameters-sources.js';
import type { Co2eCalculationExplanation } from './types.js';

/** Long citation of a parameter, the short one when there is none, or the stoichiometry note. */
export function citeSource(name: string): string | undefined {
  const p = parametersWithDetails[name];
  if (!p) return undefined;
  // Chemistry-derived parameters have no citation, only the note.
  if (
    !p.Langzitat &&
    !p.Kurzzitat &&
    p['Information zum Parameter:'] === 'stöchiometrische Umrechnung'
  )
    return p['Information zum Parameter:'];
  if (p.Langzitat) return p.Langzitat;
  return p.Kurzzitat;
}

export function explainParameter(name: string): string {
  const p = parametersWithDetails[name];
  if (p && name.includes('orgFertParams'))
    return `${p.Emissionsquelle}: ${p.Beschreibung}`;
  if (p) return p.Beschreibung;
  return name;
}

/** Replaces each parameter's unit with the cited one where the parameter is cited. */
export function addUnitToDetails(
  details: Co2eCalculationExplanation[],
): Co2eCalculationExplanation[] {
  if (details.length === 0) return [];
  return details.map((detail) => {
    if (!detail?.parameters) return detail;
    detail.parameters = detail.parameters.map((parameter) => {
      parameter.parameterUnit =
        parametersWithDetails[parameter.parameterName]?.Einheit ??
        parameter.parameterUnit ??
        '';
      return parameter;
    });
    return detail;
  });
}
