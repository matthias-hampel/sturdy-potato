import { Controller, Get } from '@nestjs/common';
import { KtblActionQuery, KtblEstimateQuery } from '@agmeo/contracts';
import { type Ctx, OrgCtx } from '../../auth/context.js';
import { type Out, ZQuery } from '../../core/validation.js';
import { KtblService } from './ktbl.service.js';

/** KTBL reference data (read-only, same for every organization; org-scoped for the crop lookup and access). */
@Controller('orgs/:orgId/ktbl')
export class KtblController {
  constructor(private readonly ktbl: KtblService) {}

  /** Actions with German and English labels, by operation type, crop and search words. */
  @Get('actions')
  actions(@OrgCtx() ctx: Ctx, @ZQuery(KtblActionQuery) query: Out<typeof KtblActionQuery>) {
    return this.ktbl.actions(ctx, query);
  }

  /** Hours, diesel and cost columns per hectare of an action for a crop (group), field size, distance and tractor power. */
  @Get('estimate')
  estimate(@OrgCtx() ctx: Ctx, @ZQuery(KtblEstimateQuery) query: Out<typeof KtblEstimateQuery>) {
    return this.ktbl.estimate(ctx, query);
  }
}
