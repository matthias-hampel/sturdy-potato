import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { BaseFertilizationSettingsInput } from '@agmeo/contracts';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { type Out, ZBody } from '../../core/validation.js';
import { BaseFertilizationService } from './base-fertilization.service.js';

@Controller('orgs/:orgId')
export class BaseFertilizationController {
  constructor(private readonly base: BaseFertilizationService) {}

  /** P2O5, K2O, MgO and lime per main crop of a season, with the six-year P2O5 balance. */
  @Get('base-fertilization')
  season(@OrgCtx() ctx: Ctx, @Query('seasonId', ParseUUIDPipe) seasonId: string) {
    return this.base.season(ctx, seasonId);
  }

  @Put('crop-cycles/:id/base-fertilization')
  @Requires('crop.write')
  @HttpCode(204)
  settings(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(BaseFertilizationSettingsInput) input: Out<typeof BaseFertilizationSettingsInput>) {
    return this.base.setSettings(ctx, id, input);
  }
}
