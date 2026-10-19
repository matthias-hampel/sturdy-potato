/**
 * Beschreibende Sortenliste (BSL) of the Bundessortenamt: descriptive traits and 1–9 ratings per
 * variety. The reference app (AGVOLUTION/agmeo src/seedData/bslVarieties.ts) imports them from a
 * SQLite file; its contents ship as data/bsl/varieties.json.gz (scripts/export-bsl-data.py), and
 * `syncBsl` loads them into bsl_varieties and links each variety to the BSA register.
 *
 * Also ported: the reference's reductions of the raw properties to sowing traits
 * (lib/varieties/traits.ts) and disease susceptibilities (lib/varieties/resistance.ts), and its
 * name key for fuzzy matching (lib/varieties/normalize.ts).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { Logger } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import type { DB } from '../db/schema.js';

export type BslValue = number | string;

export interface BslSourceVariety {
  id: number;
  name: string;
  kenn?: string;
  since?: number;
  breeder?: string;
  breederNo?: string;
  status?: string;
  hybrid?: boolean;
  new?: boolean;
  note?: string;
  species: string;
  subspecies: string;
  usage?: string;
  properties?: Record<string, BslValue>;
  quality?: Record<string, BslValue>;
}

export interface BslData {
  source: string;
  varieties: BslSourceVariety[];
}

const DATA_FILE = fileURLToPath(new URL('../../data/bsl/varieties.json.gz', import.meta.url));

export function loadBslData(file = DATA_FILE): BslData {
  return JSON.parse(gunzipSync(readFileSync(file)).toString('utf-8')) as BslData;
}

/** Variety-name key for fuzzy matching: lowercase, NFKC, whitespace and - _ . removed (reference normalizeVarietyKey). */
export function normalizeVarietyKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s\-_.]+/g, '')
    .trim();
}

/** BSL lists repeated entries as "Name 1)", "Name 2)"; the footnote mark is not part of the name. */
export const bslVarietyName = (name: string) =>
  name
    .replace(/\s+\d+\)$/, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Maize maturity is listed as "S 250" (silage) or "K 220" (grain): the number is the value. */
export function coerceNumeric(value: BslValue): BslValue {
  if (typeof value === 'number') return value;
  const m = /^[SK]\s*(\d+(?:[.,]\d+)?)$/.exec(value.trim());
  return m ? Number(m[1].replace(',', '.')) : value;
}

/**
 * BSA species code ("Kennbuchstabe") of a BSL entry where its Kennnummer has none: the BSL lists
 * winter wheat, barley and lucerne with bare numbers.
 */
const SPECIES_WITHOUT_PREFIX: [RegExp, RegExp, string][] = [
  [/^weizen_winter$/, /./, 'WW'],
  [/^gerste$/, /^sommergerste/i, 'GS'],
  [/^gerste$/, /^wintergerste/i, 'GW'],
  [/^luzerne$/, /./, 'LUZ'],
  [/^koernererbse$/, /./, 'EF'],
];

/** The BSA species code and Kennnummer of a BSL entry, as far as the list gives them. */
export function bsaKey(v: Pick<BslSourceVariety, 'kenn' | 'species' | 'subspecies'>): { speciesCode: string | null; registrationNumber: number | null } {
  const kenn = v.kenn?.trim() ?? '';
  const prefixed = /^([A-Z]{1,4})\s+(\d+)$/.exec(kenn);
  if (prefixed) return { speciesCode: prefixed[1], registrationNumber: Number(prefixed[2]) };
  const code = SPECIES_WITHOUT_PREFIX.find(([sp, sub]) => sp.test(v.species) && sub.test(v.subspecies))?.[2] ?? null;
  return { speciesCode: code, registrationNumber: /^\d+$/.test(kenn) ? Number(kenn) : null };
}

// ---------------------------------------------------------------------------
// Traits for variety choice (reference lib/varieties/traits.ts)
// ---------------------------------------------------------------------------

/**
 * Trait → candidate BSL property names, most specific first. BSL 1–9 unless a physical unit: for
 * maturity, winter kill and lodging lower is earlier/better; for yield higher is better; TKM in g.
 */
const TRAIT_PROPERTIES = {
  maturity: ['reifezeit', 'reife', 'reifezeitpunkt', 'siloreifezahl', 'koernerreifezahl'],
  winterKill: ['auswinterung', 'neigung_zu_auswinterung', 'anfalligkeit_auswinterung'],
  lodging: ['lager', 'lagerneigung', 'neigung_zu_lager', 'neigung_lager'],
  yield: ['kornertrag', 'kornertrag_relativ', 'ertrag_gesamt', 'gruenmasseertrag', 'knollenertrag', 'kornertrag_stufe2', 'kornertrag_stufe1'],
  tkg: ['tausendkornmasse', 'tausendkornmasse_g'],
} as const;
export type VarietyTraitKey = keyof typeof TRAIT_PROPERTIES;

export const TRAIT_PROPERTY_NAMES: string[] = [...new Set(Object.values(TRAIT_PROPERTIES).flat())];

export interface RawVarietyPropertyRow {
  propertyName: string;
  value: number | null;
}

export interface VarietyTraitValue {
  value: number;
  /** BSL property the value came from. */
  source: string;
}

export type VarietyTraits = Partial<Record<VarietyTraitKey, VarietyTraitValue>>;

/** The traits of one variety from its numeric properties; the first candidate present wins. */
export function toVarietyTraits(rows: RawVarietyPropertyRow[]): VarietyTraits {
  const props = new Map<string, number>();
  for (const r of rows) {
    if (r.value != null && Number.isFinite(r.value) && !props.has(r.propertyName)) props.set(r.propertyName, r.value);
  }
  const traits: VarietyTraits = {};
  for (const key of Object.keys(TRAIT_PROPERTIES) as VarietyTraitKey[]) {
    for (const name of TRAIT_PROPERTIES[key]) {
      const v = props.get(name);
      if (v != null) {
        traits[key] = { value: v, source: name };
        break;
      }
    }
  }
  return traits;
}

// ---------------------------------------------------------------------------
// Disease susceptibility (reference lib/varieties/resistance.ts)
// ---------------------------------------------------------------------------

/**
 * BSL property → disease, for the properties that are susceptibility ratings on the 1–9 scale
 * (lower = better). Resistance or tolerance classes (resistenz_*, toleranz_*, nematode
 * pathotypes) are on other scales and left out.
 */
const DISEASE_SUSCEPTIBILITY_PROPERTIES: Record<string, string> = {
  anfaelligkeit_braunrost: 'Braunrost',
  braunrost: 'Braunrost',
  anfaelligkeit_fuer_gelbrost: 'Gelbrost',
  gelbrost: 'Gelbrost',
  anfaelligkeit_fuer_mehltau: 'Mehltau',
  anfaelligkeit_mehltau: 'Mehltau',
  mehltau: 'Mehltau',
  anfaelligkeit_rost: 'Rost',
  rost: 'Rost',
  anfaelligkeit_rhynchosporium: 'Rhynchosporium',
  rhynchosporium: 'Rhynchosporium',
  anfaelligkeit_ramularia: 'Ramularia',
  ramularia: 'Ramularia',
  netzflecken: 'Netzflecken',
  dtr: 'DTR (Blattdürre)',
  blattseptoria: 'Septoria (Blattseptoria)',
  aehrenfusarium: 'Ährenfusarium',
  anfaelligkeit_mutterkorn: 'Mutterkorn',
  zwergrost: 'Zwergrost',
  kronenrost: 'Kronenrost',
  anfaelligkeit_staengelfaeule: 'Stängelfäule',
  anfaelligkeit_fuer_sclerotinia: 'Sclerotinia',
  anfaelligkeit_fuer_botrytis: 'Botrytis',
  botrytis: 'Botrytis',
  anfaelligkeit_bakterienwelke: 'Bakterienwelke',
  anfaelligkeit_cercospora: 'Cercospora',
  anfaelligkeit_fuer_ruebennematoden: 'Rübennematoden',
  krautfaeule: 'Krautfäule',
  schorf: 'Schorf',
  y_virus: 'Y-Virus',
};

export const DISEASE_PROPERTY_NAMES = Object.keys(DISEASE_SUSCEPTIBILITY_PROPERTIES);

export interface DiseaseRating {
  disease: string;
  susceptibility: number;
}

/** Disease ratings of a variety: known 1–9 susceptibilities, duplicates at their worst, most susceptible first. */
export function toDiseaseRatings(rows: RawVarietyPropertyRow[]): DiseaseRating[] {
  const worst = new Map<string, number>();
  for (const row of rows) {
    const label = DISEASE_SUSCEPTIBILITY_PROPERTIES[row.propertyName];
    if (!label) continue;
    const v = row.value;
    if (v == null || !Number.isFinite(v) || v < 1 || v > 9) continue;
    const prev = worst.get(label);
    if (prev == null || v > prev) worst.set(label, v);
  }
  return [...worst.entries()].map(([disease, susceptibility]) => ({ disease, susceptibility })).sort((a, b) => b.susceptibility - a.susceptibility);
}

/** Numeric property rows of a stored property map. */
export const numericRows = (properties: Record<string, BslValue>): RawVarietyPropertyRow[] =>
  Object.entries(properties).map(([propertyName, value]) => ({ propertyName, value: typeof value === 'number' ? value : null }));

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/**
 * The list repeats a variety in several of its tables (e.g. yield levels and quality, footnoted
 * "Name 1)"); within one use group these are one variety. Merged by group, name and Kennnummer;
 * the first entry's values win, later entries add what it lacks.
 */
export function mergeDuplicates(varieties: BslSourceVariety[]): BslSourceVariety[] {
  const byKey = new Map<string, BslSourceVariety>();
  for (const v of varieties) {
    const key = [v.species, v.subspecies, normalizeVarietyKey(bslVarietyName(v.name)), v.kenn?.trim() ?? ''].join('|');
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, v);
      continue;
    }
    const merged: BslSourceVariety = { ...v, ...Object.fromEntries(Object.entries(prev).filter(([, x]) => x != null)) } as BslSourceVariety;
    merged.properties = { ...v.properties, ...prev.properties };
    merged.quality = { ...v.quality, ...prev.quality };
    byKey.set(key, merged);
  }
  return [...byKey.values()];
}

const BATCH = 300;

/** Loads the BSL into bsl_varieties (upsert by source id) and links the BSA register. */
export async function syncBsl(db: Kysely<DB>, data: BslData = loadBslData()): Promise<{ varieties: number; linked: number }> {
  const logger = new Logger('BslSync');
  const now = new Date();
  const rows = mergeDuplicates(data.varieties).map((v) => {
    const { speciesCode, registrationNumber } = bsaKey(v);
    const coerce = (m: Record<string, BslValue> = {}) => JSON.stringify(Object.fromEntries(Object.entries(m).map(([k, x]) => [k, coerceNumeric(x)])));
    return {
      bsl_id: v.id,
      species_code: speciesCode,
      registration_number: registrationNumber,
      name: bslVarietyName(v.name),
      kenn_nummer: v.kenn?.trim() || null,
      bsl_species: v.species,
      bsl_subspecies: v.subspecies,
      usage: v.usage ?? null,
      registered_since: v.since ?? null,
      breeder: v.breeder ?? null,
      breeder_number: v.breederNo ?? null,
      status: v.status ?? null,
      hybrid: v.hybrid ?? false,
      is_new: v.new ?? false,
      note: v.note ?? null,
      properties: coerce(v.properties),
      quality: coerce(v.quality),
      synced_at: now,
    };
  });
  let linked = 0;
  await db.transaction().execute(async (trx) => {
    for (let b = 0; b < rows.length; b += BATCH) {
      await trx
        .insertInto('bsl_varieties')
        .values(rows.slice(b, b + BATCH))
        .onConflict((oc) =>
          oc.column('bsl_id').doUpdateSet((eb) => ({
            species_code: eb.ref('excluded.species_code'),
            registration_number: eb.ref('excluded.registration_number'),
            name: eb.ref('excluded.name'),
            kenn_nummer: eb.ref('excluded.kenn_nummer'),
            bsl_species: eb.ref('excluded.bsl_species'),
            bsl_subspecies: eb.ref('excluded.bsl_subspecies'),
            usage: eb.ref('excluded.usage'),
            registered_since: eb.ref('excluded.registered_since'),
            breeder: eb.ref('excluded.breeder'),
            breeder_number: eb.ref('excluded.breeder_number'),
            status: eb.ref('excluded.status'),
            hybrid: eb.ref('excluded.hybrid'),
            is_new: eb.ref('excluded.is_new'),
            note: eb.ref('excluded.note'),
            properties: eb.ref('excluded.properties'),
            quality: eb.ref('excluded.quality'),
            synced_at: eb.ref('excluded.synced_at'),
          })),
        )
        .execute();
    }
    // Entries merged into another one since an earlier import.
    await trx.deleteFrom('bsl_varieties').where('bsl_id', 'not in', rows.map((r) => r.bsl_id)).execute();
    // The BSA register: by Kennnummer within the species, else by name within the species.
    const byNumber = await sql`
      UPDATE bsl_varieties l SET bsa_variety_id = b.id
      FROM bsa_varieties b
      WHERE b.species_code = l.species_code AND b.registration_number = l.registration_number`.execute(trx);
    const byName = await sql`
      UPDATE bsl_varieties l SET bsa_variety_id = b.id
      FROM bsa_varieties b
      WHERE l.bsa_variety_id IS NULL AND b.species_code = l.species_code
        AND lower(regexp_replace(b.name, '[[:space:]._-]', '', 'g')) = lower(regexp_replace(l.name, '[[:space:]._-]', '', 'g'))`.execute(trx);
    linked = Number(byNumber.numAffectedRows ?? 0) + Number(byName.numAffectedRows ?? 0);
  });
  logger.log(`${rows.length} BSL varieties, ${linked} linked to the BSA register`);
  return { varieties: rows.length, linked };
}
