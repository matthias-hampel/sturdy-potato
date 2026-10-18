import { Logger } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.js';
import type { BsaClient, BsaVariety } from './bsa.js';

export interface BsaSyncResult {
  species: string;
  varieties: number;
}

const BATCH = 500;

/**
 * Refreshes the BSA catalogue for the given species codes, or for every species a crop maps to.
 * Upserts by (species, Kennnummer); varieties the BSA no longer lists are kept, since crop
 * varieties may still point at them.
 */
export async function syncBsa(
  db: Kysely<DB>,
  client: BsaClient,
  opts: { codes?: string[]; delayMs?: number } = {},
): Promise<BsaSyncResult[]> {
  const logger = new Logger('BsaSync');
  const codes =
    opts.codes ??
    (
      await db
        .selectFrom('crops')
        .select('bsa_species_code')
        .distinct()
        .where('bsa_species_code', 'is not', null)
        .orderBy('bsa_species_code')
        .execute()
    ).map((r) => r.bsa_species_code!);

  const catalogue = new Map((await client.species()).map((s) => [s.code, s]));
  const results: BsaSyncResult[] = [];
  for (const [i, code] of codes.entries()) {
    const species = catalogue.get(code);
    if (!species) {
      logger.warn(`BSA has no species ${code}; skipped`);
      continue;
    }
    if (i > 0 && opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    const varieties = await client.varieties(species);
    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto('bsa_species')
        .values({ code, name_de: species.nameDe, botanical_name: species.botanicalName })
        .onConflict((oc) =>
          oc.column('code').doUpdateSet({ name_de: species.nameDe, botanical_name: species.botanicalName, synced_at: new Date().toISOString() }),
        )
        .execute();
      for (let b = 0; b < varieties.length; b += BATCH) {
        await trx
          .insertInto('bsa_varieties')
          .values(varieties.slice(b, b + BATCH).map(row))
          .onConflict((oc) =>
            oc.columns(['species_code', 'registration_number']).doUpdateSet((eb) => ({
              name: eb.ref('excluded.name'),
              provisional_name: eb.ref('excluded.provisional_name'),
              protection_applied_on: eb.ref('excluded.protection_applied_on'),
              protection_granted_on: eb.ref('excluded.protection_granted_on'),
              protection_ended_on: eb.ref('excluded.protection_ended_on'),
              approval_applied_on: eb.ref('excluded.approval_applied_on'),
              approval_granted_on: eb.ref('excluded.approval_granted_on'),
              approval_ended_on: eb.ref('excluded.approval_ended_on'),
              marketable_until: eb.ref('excluded.marketable_until'),
              conservation_region: eb.ref('excluded.conservation_region'),
              synced_at: eb.ref('excluded.synced_at'),
            })),
          )
          .execute();
      }
    });
    logger.log(`${code} (${species.nameDe}): ${varieties.length} varieties`);
    results.push({ species: code, varieties: varieties.length });
  }
  return results;
}

function row(v: BsaVariety) {
  return {
    species_code: v.speciesCode,
    registration_number: v.registrationNumber,
    name: v.name,
    provisional_name: v.provisionalName,
    protection_applied_on: v.protectionAppliedOn,
    protection_granted_on: v.protectionGrantedOn,
    protection_ended_on: v.protectionEndedOn,
    approval_applied_on: v.approvalAppliedOn,
    approval_granted_on: v.approvalGrantedOn,
    approval_ended_on: v.approvalEndedOn,
    marketable_until: v.marketableUntil,
    conservation_region: v.conservationRegion,
    synced_at: new Date().toISOString(),
  };
}
