import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { type Ctx, OrgCtx } from '../../auth/context.js';
import { badRequest } from '../../core/errors.js';
import { WeatherService } from './weather.service.js';

const isoDay = (v?: string) => {
  if (!v) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw badRequest('invalid_date', 'Dates must be YYYY-MM-DD');
  return v;
};

@Controller('orgs/:orgId')
export class WeatherController {
  constructor(private readonly weather: WeatherService) {}

  @Get('farms/:farmId/weather')
  forecast(@OrgCtx() ctx: Ctx, @Param('farmId', ParseUUIDPipe) farmId: string) {
    return this.weather.forecast(ctx, farmId);
  }

  @Get('fields/:fieldId/weather')
  fieldWeather(@OrgCtx() ctx: Ctx, @Param('fieldId', ParseUUIDPipe) fieldId: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.weather.fieldWeather(ctx, fieldId, { from: isoDay(from), to: isoDay(to) });
  }

  @Get('fields/:fieldId/forecast')
  fieldForecast(@OrgCtx() ctx: Ctx, @Param('fieldId', ParseUUIDPipe) fieldId: string) {
    return this.weather.fieldForecast(ctx, fieldId);
  }
}
