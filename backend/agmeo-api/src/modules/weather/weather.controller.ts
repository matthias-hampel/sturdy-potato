import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { BbchObservationInput } from '@agmeo/contracts';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { type Out, ZBody } from '../../core/validation.js';
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

  /** A BBCH stage seen on the field; the crop's modelled stages follow it. */
  @Post('crop-cycles/:id/bbch-observations')
  @HttpCode(204)
  @Requires('crop.write')
  observeBbch(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(BbchObservationInput) input: Out<typeof BbchObservationInput>) {
    return this.conditions.observeBbch(ctx, id, input);
  }

  @Delete('crop-cycles/:id/bbch-observations/:date')
  @HttpCode(204)
  @Requires('crop.write')
  deleteBbchObservation(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Param('date') date: string) {
    return this.conditions.deleteBbchObservation(ctx, id, isoDay(date)!);
  }
}
