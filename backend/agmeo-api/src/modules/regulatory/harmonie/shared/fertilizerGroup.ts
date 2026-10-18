/**
 * Fertilizer grouping shared by the ENNI and ENDO formats.
 *
 * Mineral products are grouped by the nutrients they carry (N / NP / NPK …);
 * organic ones by the animal / substrate the article name encodes. Each format
 * maps the neutral group to its own code list (Dube2.5 enums).
 */

import type { ExportFertilization } from '../types.js';

export type MineralGroup =
  'N' | 'NP' | 'NK' | 'NPK' | 'P' | 'PK' | 'K' | 'Mg' | 'S' | 'Kalk' | 'NMg';

export function mineralGroup(
  fert: Pick<ExportFertilization, 'n' | 'p2o5' | 'k2o' | 'mgo' | 'articleFqn'>,
): MineralGroup {
  const hasN = (fert.n ?? 0) > 0;
  const hasP = (fert.p2o5 ?? 0) > 0;
  const hasK = (fert.k2o ?? 0) > 0;
  const hasMg = (fert.mgo ?? 0) > 0;
  const isLime = /LIME|KALK|CARBONATE/i.test(fert.articleFqn);

  if (isLime && !hasN && !hasP && !hasK) return 'Kalk';
  if (hasN && hasP && hasK) return 'NPK';
  if (hasN && hasP) return 'NP';
  if (hasN && hasK) return 'NK';
  if (hasN && hasMg) return 'NMg';
  if (hasP && hasK) return 'PK';
  if (hasN) return 'N';
  if (hasP) return 'P';
  if (hasK) return 'K';
  if (hasMg) return 'Mg';
  if (/SULF|SULPH|SCHWEFEL/i.test(fert.articleFqn)) return 'S';
  return 'N';
}

/** Dube2.5 `mineralduengergruppe` */
export const MINERAL_GROUP_TO_DUBE: Record<MineralGroup, string> = {
  N: 'Stickstoffdünger',
  NP: 'NP-Dünger',
  NK: 'NK-Dünger',
  NPK: 'NPK-Dünger',
  P: 'Phosphatdünger',
  PK: 'PK-Dünger',
  K: 'Kalidünger',
  Mg: 'Mg-Dünger',
  S: 'Stickstoffdünger',
  Kalk: 'Kalkdünger',
  NMg: 'NMG-Dünger',
};

export type OrganicGroup =
  | 'Rindergülle'
  | 'Schweinegülle'
  | 'Rindermist'
  | 'Schweinemist'
  | 'Pferdemist'
  | 'Hähnchenmist'
  | 'Putenmist'
  | 'Legehennen - HTK'
  | 'Schafmist'
  | 'Gärrest'
  | 'Kompost'
  | 'Rinderjauche'
  | 'Schweinejauche'
  | 'Klärschlamm'
  | 'Sonstiger organischer Dünger';

/**
 * Organic group from the article fqn (`ORGANIC__<TYPE>`). The fqn type names in
 * the seed follow a `<FORM>_<ANIMAL>` convention (SLURRY_CATTLE,
 * BARN_FRESH_MANURE_PIG, CHICKEN_DUNG, DIGESTATE_…, COMPOST_…).
 */
export function organicGroup(articleFqn: string): OrganicGroup {
  const type = (articleFqn.split('__')[1] ?? '').toUpperCase();
  const animal = /CATTLE|COW|DAIRY|BULL|CALF|RIND/.test(type)
    ? 'cattle'
    : /PIG|SOW|SWINE|SCHWEIN/.test(type)
      ? 'pig'
      : /HORSE|PFERD/.test(type)
        ? 'horse'
        : /CHICKEN|BROILER|HEN|LAYING|POULTRY|HUHN/.test(type)
          ? 'chicken'
          : /TURKEY|PUTE/.test(type)
            ? 'turkey'
            : /SHEEP|GOAT|SCHAF|ZIEGE/.test(type)
              ? 'sheep'
              : null;

  if (/DIGESTATE|BIOGAS|FERMENT|GAERREST/.test(type)) return 'Gärrest';
  if (/COMPOST|KOMPOST/.test(type)) return 'Kompost';
  if (/SEWAGE|SLUDGE|KLAERSCHLAMM/.test(type)) return 'Klärschlamm';
  if (/URINE|JAUCHE/.test(type))
    return animal === 'pig' ? 'Schweinejauche' : 'Rinderjauche';
  if (/SLURRY|GUELLE|LIQUID/.test(type)) {
    if (animal === 'pig') return 'Schweinegülle';
    if (animal === 'cattle') return 'Rindergülle';
    return 'Sonstiger organischer Dünger';
  }
  if (/MANURE|DUNG|MIST|LITTER/.test(type)) {
    switch (animal) {
      case 'cattle':
        return 'Rindermist';
      case 'pig':
        return 'Schweinemist';
      case 'horse':
        return 'Pferdemist';
      case 'chicken':
        return /DRY|TROCKEN|HTK/.test(type)
          ? 'Legehennen - HTK'
          : 'Hähnchenmist';
      case 'turkey':
        return 'Putenmist';
      case 'sheep':
        return 'Schafmist';
    }
  }
  return 'Sonstiger organischer Dünger';
}
