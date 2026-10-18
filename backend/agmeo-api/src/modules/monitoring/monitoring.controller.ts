import { Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { config } from '../../config.js';
import { IMAGERY_LAYERS, VEGETATION_INDICES, type VegetationIndex } from '@agmeo/contracts';
import { type Ctx, OrgCtx } from '../../auth/context.js';
import { DomainError, badRequest } from '../../core/errors.js';
import { MonitoringService } from './monitoring.service.js';

const parseIndex = (value?: string): VegetationIndex => {
  const index = (value ?? 'ndvi') as VegetationIndex;
  if (!VEGETATION_INDICES.includes(index)) throw badRequest('invalid_index', `Unknown vegetation index ${value}`);
  return index;
};

@Controller('orgs/:orgId/monitoring')
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get('fields')
  summary(@OrgCtx() ctx: Ctx, @Query('index') index?: string) {
    return this.monitoring.summary(ctx, parseIndex(index));
  }

  @Get('fields/:fieldId/observations')
  observations(
    @OrgCtx() ctx: Ctx,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @Query('index') index?: string,
    @Query('from') from?: string,
  ) {
    return this.monitoring.observations(ctx, fieldId, parseIndex(index), from);
  }

  @Get('imagery/dates')
  imageryDates(@OrgCtx() ctx: Ctx, @Query('fieldId', new ParseUUIDPipe({ optional: true })) fieldId?: string) {
    return this.monitoring.imageryDates(ctx, fieldId);
  }

  @Get('imagery/status')
  imageryStatus(@OrgCtx() ctx: Ctx, @Query('fieldId', new ParseUUIDPipe({ optional: true })) fieldId?: string) {
    return this.monitoring.imageryStatus(ctx, fieldId);
  }

  /**
   * Imagery tiles of one acquisition date, proxied from the internal tile server. The tile
   * server only renders this organization's field rasters (optionally one field).
   */
  @Get('imagery/:date/:layer/:z/:x/:y.png')
  async tile(
    @OrgCtx() ctx: Ctx,
    @Param('date') date: string,
    @Param('layer') layer: string,
    @Param('z', ParseIntPipe) z: number,
    @Param('x', ParseIntPipe) x: number,
    @Param('y', ParseIntPipe) y: number,
    @Query('fieldId', new ParseUUIDPipe({ optional: true })) fieldId: string | undefined,
    @Query('stretch') stretch: string | undefined,
    @Res() res: Response,
  ) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('invalid_date', 'Expected YYYY-MM-DD');
    if (!(IMAGERY_LAYERS as readonly string[]).includes(layer)) throw badRequest('invalid_layer', `Unknown layer ${layer}`);
    if (stretch && stretch !== 'absolute' && stretch !== 'relative') throw badRequest('invalid_stretch', 'Expected absolute or relative');
    const query = new URLSearchParams({ organization: ctx.orgId, stretch: stretch ?? 'absolute' });
    if (fieldId) query.set('field', fieldId);
    let upstream: globalThis.Response;
    try {
      upstream = await fetch(`${config.geoTilesUrl}/imagery/${date}/${layer}/${z}/${x}/${y}.png?${query}`, { signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new DomainError(503, 'tiles_unavailable', 'The satellite tile service is not reachable');
    }
    if (!upstream.ok) throw new DomainError(upstream.status === 404 ? 404 : 502, 'tile_error', 'Tile not available');
    res
      .status(200)
      .set({ 'content-type': 'image/png', 'cache-control': 'private, max-age=86400' })
      .send(Buffer.from(await upstream.arrayBuffer()));
  }
}
