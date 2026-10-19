import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { type Ctx, OrgCtx } from '../../auth/context.js';
import { badRequest } from '../../core/errors.js';
import { FieldConditionsService } from './field-conditions.service.js';
import { WeatherService } from './weather.service.js';

const isoDay = (v?: string) => {
  if (!v) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw badRequest('invalid_date', 'Dates must be YYYY-MM-DD');
  return v;
};

@Controller('orgs/:orgId')
export class WeatherController {
  constructor(
    private readonly weather: WeatherService,
    private readonly conditions: FieldConditionsService,
  ) {}

  @Get('farms/:farmId/weather')
  forecast(@OrgCtx() ctx: Ctx, @Param('farmId', ParseUUIDPipe) farmId: string) {
    return this.weather.forecast(ctx, farmId);
  }

  /** Stored daily and hourly weather of the field's grid cell. */
  @Get('fields/:fieldId/weather')
  fieldWeather(@OrgCtx() ctx: Ctx, @Param('fieldId', ParseUUIDPipe) fieldId: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.weather.fieldWeather(ctx, fieldId, { from: isoDay(from), to: isoDay(to) });
  }

  @Get('fields/:fieldId/conditions')
  fieldConditions(@OrgCtx() ctx: Ctx, @Param('fieldId', ParseUUIDPipe) fieldId: string) {
    return this.conditions.conditions(ctx, fieldId);
  }

  @Get('fields/:fieldId/trafficability')
  trafficability(
    @OrgCtx() ctx: Ctx,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @Query('equipmentId', ParseUUIDPipe) equipmentId: string,
    @Query('frontKpa') frontKpa?: string,
    @Query('rearKpa') rearKpa?: string,
  ) {
    const kpa = (v?: string) => {
      if (v == null || v === '') return undefined;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 40 || n > 400) throw badRequest('invalid_pressure', 'Tyre pressure must be 40–400 kPa');
      return n;
    };
    return this.conditions.trafficability(ctx, fieldId, { equipmentId, frontKpa: kpa(frontKpa), rearKpa: kpa(rearKpa) });
  }

  /** Live forecast at the field (spray windows on the field overview). */
  @Get('fields/:fieldId/forecast')
  fieldForecast(@OrgCtx() ctx: Ctx, @Param('fieldId', ParseUUIDPipe) fieldId: string) {
    return this.weather.fieldForecast(ctx, fieldId);
  }
}
