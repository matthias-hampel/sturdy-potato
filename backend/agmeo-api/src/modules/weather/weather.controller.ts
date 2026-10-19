import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { type Ctx, OrgCtx } from '../../auth/context.js';
import { WeatherService } from './weather.service.js';

@Controller('orgs/:orgId')
export class WeatherController {
  constructor(private readonly weather: WeatherService) {}

  @Get('farms/:farmId/weather')
  forecast(@OrgCtx() ctx: Ctx, @Param('farmId', ParseUUIDPipe) farmId: string) {
    return this.weather.forecast(ctx, farmId);
  }

  @Get('fields/:fieldId/weather')
  fieldForecast(@OrgCtx() ctx: Ctx, @Param('fieldId', ParseUUIDPipe) fieldId: string) {
    return this.weather.fieldForecast(ctx, fieldId);
  }
}
