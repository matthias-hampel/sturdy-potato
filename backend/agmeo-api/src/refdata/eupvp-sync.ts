import { Logger } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.js';
import { aggregateVarieties, type EupvpClient, type EuVariety } from './eupvp.js';

export interface EuSyncResult {
  species: string;
  varieties: number;
}

const BATCH = 500;

/**
 * Refreshes the EU Common Catalogue for every EUPVP species a crop maps to, or for the crops whose
 * BSA or EU species code is in `only`. Upserts by (species, name). A variety the export no longer
 * lists keeps its row, since crop varieties may point at it, but loses its countries.
 */
export async function syncEu(
  db: Kysely<DB>,
  client: EupvpClient,
  opts: { only?: string[]; delayMs?: number; now?: Date } = {},
): Promise<EuSyncResult[]> {
  const logger = new Logger('EuSync');
  const now = opts.now ?? new Date();
  let q = db.selectFrom('crops').select('eu_species_code').distinct().where('eu_species_code', 'is not', null).orderBy('eu_species_code');
  if (opts.only?.length) q = q.where((eb) => eb.or([eb('bsa_species_code', 'in', opts.only!), eb('eu_species_code', 'in', opts.only!)]));
  const codes = (await q.execute()).map((r) => r.eu_species_code!);

  // A marketing extension ends on 30 June of the third year after the registration ended at the latest.
  const endedSince = `${now.getUTCFullYear() - 4}-01-01`;
  const catalogue = new Map((await client.species()).map((s) => [s.code, s]));
  const results: EuSyncResult[] = [];
  for (const [i, code] of codes.entries()) {
    const species = catalogue.get(code);
    if (!species) {
      logger.warn(`EUPVP has no agricultural species ${code}; skipped`);
      continue;
    }
    if (i > 0 && opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    const varieties = aggregateVarieties(await client.registrations(species, endedSince), code);
    const syncedAt = now.toISOString();
    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto('eu_species')
        .values({ code, botanical_name: species.botanicalName, synced_at: syncedAt })
        .onConflict((oc) => oc.column('code').doUpdateSet({ botanical_name: species.botanicalName, synced_at: syncedAt }))
        .execute();
      for (let b = 0; b < varieties.length; b += BATCH) {
        await trx
          .insertInto('eu_varieties')
          .values(varieties.slice(b, b + BATCH).map((v) => row(v, syncedAt)))
          .onConflict((oc) =>
            oc.columns(['species_code', 'name']).doUpdateSet((eb) => ({
              countries: eb.ref('excluded.countries'),
              registered_on: eb.ref('excluded.registered_on'),
              marketable_until: eb.ref('excluded.marketable_until'),
              season: eb.ref('excluded.season'),
              synced_at: eb.ref('excluded.synced_at'),
            })),
          )
          .execute();
      }
      await trx
        .updateTable('eu_varieties')
        .set({ countries: [], synced_at: syncedAt })
        .where('species_code', '=', code)
        .where('synced_at', '<', new Date(syncedAt))
        .execute();
    });
    logger.log(`${code} (${species.botanicalName}): ${varieties.length} varieties`);
    results.push({ species: code, varieties: varieties.length });
  }
  return results;
}

function row(v: EuVariety, syncedAt: string) {
  return {
    species_code: v.speciesCode,
    name: v.name,
    countries: v.countries,
    registered_on: v.registeredOn,
    marketable_until: v.marketableUntil,
    season: v.season,
    synced_at: syncedAt,
  };
}
