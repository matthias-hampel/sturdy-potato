import { Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { RecalculateProductivityInput } from '@agmeo/contracts';
import type { Response } from 'express';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { config } from '../../config.js';
import { DomainError } from '../../core/errors.js';
import { type Out, ZBody } from '../../core/validation.js';
import { ProductivityService } from './productivity.service.js';

@Controller('orgs/:orgId/fields/:fieldId/productivity')
export class ProductivityController {
  constructor(private readonly productivity: ProductivityService) {}

  @Get()
  state(@OrgCtx() ctx: Ctx, @Param('fieldId', ParseUUIDPipe) fieldId: string) {
    return this.productivity.state(ctx, fieldId);
  }

  @Post()
  @Requires('field.write')
  request(
    @OrgCtx() ctx: Ctx,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @ZBody(RecalculateProductivityInput) input: Out<typeof RecalculateProductivityInput>,
  ) {
    return this.productivity.request(ctx, fieldId, input);
  }

  /** Relative productivity map tiles, proxied from the internal tile server. */
  @Get(':analysisId/tiles/:z/:x/:y.png')
  async tile(
    @OrgCtx() ctx: Ctx,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @Param('analysisId', ParseUUIDPipe) analysisId: string,
    @Param('z', ParseIntPipe) z: number,
    @Param('x', ParseIntPipe) x: number,
    @Param('y', ParseIntPipe) y: number,
    @Res() res: Response,
  ) {
    await this.productivity.assertAnalysis(ctx, fieldId, analysisId);
    let upstream: globalThis.Response;
    try {
      upstream = await fetch(`${config.geoTilesUrl}/productivity/${analysisId}/${z}/${x}/${y}.png?organization=${ctx.orgId}`, {
        signal: AbortSignal.timeout(15_000),
      });
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
