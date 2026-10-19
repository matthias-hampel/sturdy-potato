import { Injectable } from '@nestjs/common';
import type { CropCategory, KtblAction, KtblActionQuery, KtblEstimate, KtblEstimateQuery } from '@agmeo/contracts';
import type { Ctx } from '../../auth/context.js';
import { badRequest, notFound } from '../../core/errors.js';
import type { Out } from '../../core/validation.js';
import { Database } from '../../db/database.js';
import { ktblAction, searchKtblActions } from './catalogue.js';
import { type KtblCropProfile, cropProfile } from './crops.js';
import { estimateKtbl } from './estimate.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

/** KTBL reference actions and their per-hectare estimates, for filling the organization's action catalogue. */
@Injectable()
export class KtblService {
  constructor(private readonly db: Database) {}

  async actions(ctx: Ctx, query: Out<typeof KtblActionQuery>): Promise<KtblAction[]> {
    const profile = query.crop ? await this.crop(ctx, query.crop) : null;
    return searchKtblActions({ operationType: query.operationType, appliesTo: profile?.appliesTo, q: query.q });
  }

  async estimate(ctx: Ctx, query: Out<typeof KtblEstimateQuery>): Promise<KtblEstimate> {
    if (!ktblAction(query.fqn)) throw notFound('KTBL action');
    const group = query.cropGroup ?? (query.crop ? (await this.crop(ctx, query.crop)).group : null) ?? undefined;
    const { costs, method } = estimateKtbl(query.fqn, {
      fieldSizeHa: query.fieldSizeHa,
      distanceKm: query.distanceKm,
      mechKw: query.mechKw,
      group,
    });
    return {
      fqn: query.fqn,
      cropGroup: group ?? null,
      method,
      fieldSizeHa: query.fieldSizeHa,
      distanceKm: query.distanceKm,
      mechKw: query.mechKw,
      // As precise as the action catalogue keeps them.
      hours: round(costs.hours, 3),
      diesel: round(costs.diesel, 2),
      depreciation: round(costs.depreciation, 2),
      interest: round(costs.interest, 2),
      miscellaneous: round(costs.miscellaneous, 2),
      repairs: round(costs.repairs, 2),
      materials: round(costs.materials, 2),
      services: round(costs.services, 2),
    };
  }

  /** A catalogue or organization crop by id or code (the organization's own first). */
  private async crop(ctx: Ctx, crop: string): Promise<KtblCropProfile> {
    const row = await this.db.run(ctx, (trx) =>
      trx
        .selectFrom('crops')
        .select(['code', 'category'])
        .where((eb) => (UUID.test(crop) ? eb('id', '=', crop) : eb('code', '=', crop)))
        .orderBy('organization_id', (ob) => ob.asc().nullsLast())
        .executeTakeFirst(),
    );
    if (!row) throw badRequest('unknown_crop', 'Unknown crop');
    return cropProfile(row.code, row.category as CropCategory);
  }
}
