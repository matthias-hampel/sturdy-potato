import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { CadastralLookupQuery, CreateFieldFromParcelsInput, LeaseAnalyticsQuery, ManualParcelInput, ParcelLeaseInput, SyncParcelsInput } from '@agmeo/contracts';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { type Out, ZBody, ZQuery } from '../../core/validation.js';
import { CadastralService } from './cadastral.service.js';

/** Cadastral parcels (Flurstücke) from the states' cadastre services, and their leases. */
@Controller('orgs/:orgId/cadastral')
export class CadastralController {
  constructor(private readonly cadastral: CadastralService) {}

  /** Parcels in a map extent, fetched (and cached) server-side from the state's WFS. */
  @Get('lookup')
  lookup(@ZQuery(CadastralLookupQuery) q: Out<typeof CadastralLookupQuery>) {
    return this.cadastral.lookup(q);
  }

  @Post('fields')
  @Requires('field.write')
  createField(@OrgCtx() ctx: Ctx, @ZBody(CreateFieldFromParcelsInput) input: Out<typeof CreateFieldFromParcelsInput>) {
    return this.cadastral.createField(ctx, input);
  }

  @Post('sync')
  @HttpCode(200)
  @Requires('field.write')
  sync(@OrgCtx() ctx: Ctx, @ZBody(SyncParcelsInput) input: Out<typeof SyncParcelsInput>) {
    return this.cadastral.sync(ctx, input);
  }

  @Get('parcels')
  list(@OrgCtx() ctx: Ctx, @Query('fieldId') fieldId?: string) {
    return this.cadastral.list(ctx, fieldId || undefined);
  }

  @Post('parcels')
  @Requires('field.write')
  addManual(@OrgCtx() ctx: Ctx, @ZBody(ManualParcelInput) input: Out<typeof ManualParcelInput>) {
    return this.cadastral.addManual(ctx, input);
  }

  @Delete('parcels/:id')
  @HttpCode(204)
  @Requires('field.write')
  delete(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.cadastral.delete(ctx, id);
  }

  @Put('parcels/:id/lease')
  @Requires('field.write')
  setLease(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(ParcelLeaseInput) input: Out<typeof ParcelLeaseInput>) {
    return this.cadastral.setLease(ctx, id, input);
  }

  @Delete('parcels/:id/lease')
  @HttpCode(204)
  @Requires('field.write')
  clearLease(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.cadastral.clearLease(ctx, id);
  }

  @Get('leases/analytics')
  analytics(@OrgCtx() ctx: Ctx, @ZQuery(LeaseAnalyticsQuery) q: Out<typeof LeaseAnalyticsQuery>) {
    return this.cadastral.analytics(ctx, q.months);
  }
}
