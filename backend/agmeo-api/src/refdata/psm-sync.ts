import { Logger } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { DB } from '../db/schema.js';
import { mapProducts, mapRestrictions, mapUses, type PsmClient } from './psm.js';

const BATCH = 1000;

export interface PsmSyncResult {
  products: number;
  uses: number;
  cropGroups: number;
  codes: number;
  restrictions: number;
}

/**
 * Replaces the plant-protection register with the BVL's current state: approved products, products
 * in their sale or use-up period, their approved uses, the crop hierarchy and German code texts.
 * Uses are replaced as a whole (they have no history); products are upserted, so registration
 * numbers stored on organizations' products keep resolving after an approval ended.
 */
export async function syncPsm(db: Kysely<DB>, client: PsmClient): Promise<PsmSyncResult> {
  const logger = new Logger('PsmSync');
  const [current, expired, contents, substances] = await Promise.all([
    client.all('mittel'),
    client.all('mittel_abgelaufen'),
    client.all('wirkstoff_gehalt'),
    client.all('wirkstoff'),
  ]);
  const products = mapProducts(current, expired, contents, substances);
  logger.log(`${products.length} products`);
  const awg = await client.all('awg');
  const [kultur, schadorg, aufwand, wartezeit, groups, codes] = await Promise.all([
    client.all('awg_kultur'),
    client.all('awg_schadorg'),
    client.all('awg_aufwand'),
    client.all('awg_wartezeit'),
    client.all('kultur_gruppe'),
    client.all('kode', { sprache: 'DE' }),
  ]);
  const uses = mapUses(awg, kultur, schadorg, aufwand, wartezeit, new Set(products.map((p) => p.kennr)));
  logger.log(`${uses.length} approved uses`);
  const [auflagen, auflageRedu] = await Promise.all([client.all('auflagen'), client.all('auflage_redu')]);
  const codeTexts = new Map<string, string>();
  for (const c of codes) if (c.kodetext && !codeTexts.has(String(c.kode))) codeTexts.set(String(c.kode), String(c.kodetext).replace(/\s+/g, ' ').trim());
  const { restrictions, reductions } = mapRestrictions(
    auflagen,
    auflageRedu,
    (code) => codeTexts.get(code) ?? null,
    new Set(uses.map((u) => u.awg_id)),
    new Set(products.map((p) => p.kennr)),
  );
  logger.log(`${restrictions.length} approval conditions`);

  await db.transaction().execute(async (trx) => {
    for (let i = 0; i < products.length; i += BATCH) {
      await trx
        .insertInto('psm_products')
        .values(products.slice(i, i + BATCH).map((p) => ({ ...p, active_ingredients: JSON.stringify(p.active_ingredients) })))
        .onConflict((oc) =>
          oc.column('kennr').doUpdateSet((eb) => ({
            name: eb.ref('excluded.name'),
            formulation: eb.ref('excluded.formulation'),
            first_approved_on: eb.ref('excluded.first_approved_on'),
            approval_ends_on: eb.ref('excluded.approval_ends_on'),
            use_up_until: eb.ref('excluded.use_up_until'),
            active_ingredients: eb.ref('excluded.active_ingredients'),
            synced_at: sql`now()`,
          })),
        )
        .execute();
    }
    await trx.deleteFrom('psm_uses').execute();
    for (let i = 0; i < uses.length; i += BATCH) {
      await trx
        .insertInto('psm_uses')
        .values(uses.slice(i, i + BATCH).map((u) => ({ ...u, waiting_days: JSON.stringify(u.waiting_days) })))
        .execute();
    }
    await trx.deleteFrom('psm_crop_groups').execute();
    const pairs = [...new Map(groups.map((g) => [`${g.kultur_gruppe}|${g.kultur}`, { group_code: String(g.kultur_gruppe), member_code: String(g.kultur) }])).values()];
    for (let i = 0; i < pairs.length; i += BATCH) await trx.insertInto('psm_crop_groups').values(pairs.slice(i, i + BATCH)).execute();
    await trx.deleteFrom('psm_codes').execute();
    const texts = [...new Map(codes.filter((c) => c.kodetext).map((c) => [`${c.kode}|${c.kodeliste}`, { code: String(c.kode), list: Number(c.kodeliste), text: String(c.kodetext).replace(/\s+/g, ' ').trim() }])).values()];
    for (let i = 0; i < texts.length; i += BATCH) await trx.insertInto('psm_codes').values(texts.slice(i, i + BATCH)).execute();
    // A sync that yields no Auflagen keeps the previous set rather than emptying the buffers.
    if (restrictions.length) {
      await trx.deleteFrom('psm_restrictions').execute();
      for (let i = 0; i < restrictions.length; i += BATCH) await trx.insertInto('psm_restrictions').values(restrictions.slice(i, i + BATCH)).execute();
      for (let i = 0; i < reductions.length; i += BATCH) await trx.insertInto('psm_restriction_reductions').values(reductions.slice(i, i + BATCH)).execute();
    } else logger.warn('BVL returned no Auflagen; keeping the stored ones');
  });
  return { products: products.length, uses: uses.length, cropGroups: groups.length, codes: codes.length, restrictions: restrictions.length };
}
