import { Controller, Get, ParseUUIDPipe, Query } from '@nestjs/common';
import { isSoilParameter } from '@agmeo/contracts';
import { type Ctx, OrgCtx } from '../../auth/context.js';
import { badRequest } from '../../core/errors.js';
import { MapLayersService } from './map-layers.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Thematic layers of the organization map. */
@Controller('orgs/:orgId/map')
export class MapLayersController {
  constructor(private readonly layers: MapLayersService) {}

  /** Margin (with finance permission), yield, CO2e and N per field of a season. */
  @Get('kpis')
  kpis(@OrgCtx() ctx: Ctx, @Query('seasonId') seasonId?: string) {
    if (seasonId && !UUID.test(seasonId)) throw badRequest('invalid_season', 'seasonId must be a season id');
    return this.layers.kpis(ctx, seasonId || undefined);
  }

  @Get('soil')
  soil(@OrgCtx() ctx: Ctx, @Query('parameter') parameter = 'ph') {
    if (!isSoilParameter(parameter)) throw badRequest('invalid_parameter', 'Unknown soil parameter');
    return this.layers.soil(ctx, parameter);
  }

  @Get('trafficability')
  trafficability(@OrgCtx() ctx: Ctx, @Query('equipmentId', ParseUUIDPipe) equipmentId: string, @Query('day') day = '0') {
    const d = Number(day);
    if (!Number.isInteger(d) || d < 0 || d > 7) throw badRequest('invalid_day', 'day must be 0–7');
    return this.layers.trafficability(ctx, equipmentId, d);
  }
}
