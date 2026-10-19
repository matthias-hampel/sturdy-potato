import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { type Ctx, OrgCtx } from '../../auth/context.js';
import { badRequest, notFound } from '../../core/errors.js';
import { VarietiesService } from './varieties.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Variety browser over the Beschreibende Sortenliste (public reference data, read per organization). */
@Controller('orgs/:orgId/variety-catalogue')
export class VarietiesController {
  constructor(private readonly varieties: VarietiesService) {}

  @Get('species')
  species(@OrgCtx() ctx: Ctx) {
    return this.varieties.species(ctx);
  }

  @Get()
  list(@OrgCtx() ctx: Ctx, @Query('species') species?: string, @Query('cropId') cropId?: string, @Query('q') q?: string) {
    if (cropId && !UUID.test(cropId)) throw badRequest('invalid_crop', 'cropId must be a crop id');
    if (q && q.length > 100) throw badRequest('invalid_query', 'Search term too long');
    return this.varieties.list(ctx, { species: species || undefined, cropId: cropId || undefined, q: q?.trim() || undefined });
  }

  /** BSL 1–9 disease susceptibilities of a variety, by name or by a crop cycle's variety. */
  @Get('resistance')
  async resistance(@OrgCtx() ctx: Ctx, @Query('variety') variety?: string, @Query('cropCycleId') cropCycleId?: string) {
    if (cropCycleId && !UUID.test(cropCycleId)) throw badRequest('invalid_crop_cycle', 'cropCycleId must be a crop cycle id');
    const r = await this.varieties.resistance(ctx, { variety: variety?.trim() || undefined, cropCycleId: cropCycleId || undefined });
    if (!r) throw notFound('Variety');
    return r;
  }

  @Get(':id')
  detail(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.varieties.detail(ctx, id);
  }
}
