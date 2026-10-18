import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { type Ctx, OrgCtx } from '../../auth/context.js';
import { WeatherService } from './weather.service.js';

@Controller('orgs/:orgId/farms/:farmId/weather')
export class WeatherController {
  constructor(private readonly weather: WeatherService) {}

  @Get()
  forecast(@OrgCtx() ctx: Ctx, @Param('farmId', ParseUUIDPipe) farmId: string) {
    return this.weather.forecast(ctx, farmId);
  }
}
