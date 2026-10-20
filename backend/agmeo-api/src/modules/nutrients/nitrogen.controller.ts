import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApplyStrategyInput, FertilizationStrategyInput, NPlanningInput } from '@agmeo/contracts';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { type Out, ZBody } from '../../core/validation.js';
import { NitrogenService } from './nitrogen.service.js';

@Controller('orgs/:orgId')
export class NitrogenController {
  constructor(private readonly nitrogen: NitrogenService) {}

  /** The agmeo N balance of every main crop of a season. */
  @Get('nitrogen')
  season(@OrgCtx() ctx: Ctx, @Query('seasonId', ParseUUIDPipe) seasonId: string) {
    return this.nitrogen.season(ctx, seasonId);
  }

  @Put('crop-cycles/:id/n-planning')
  @Requires('crop.write')
  setPlanning(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(NPlanningInput) input: Out<typeof NPlanningInput>) {
    return this.nitrogen.setPlanning(ctx, id, input);
  }

  @Get('fertilization-strategies')
  strategies(@OrgCtx() ctx: Ctx) {
    return this.nitrogen.strategies(ctx);
  }

  @Post('fertilization-strategies')
  @Requires('operation.write')
  createStrategy(@OrgCtx() ctx: Ctx, @ZBody(FertilizationStrategyInput) input: Out<typeof FertilizationStrategyInput>) {
    return this.nitrogen.createStrategy(ctx, input);
  }

  @Delete('fertilization-strategies/:id')
  @Requires('operation.write')
  @HttpCode(204)
  deleteStrategy(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.nitrogen.deleteStrategy(ctx, id);
  }

  /** Splits the N need of the crops into the strategy's doses as planned fertilizations. */
  @Post('fertilization-strategies/:id/apply')
  @Requires('operation.write')
  @HttpCode(200)
  apply(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(ApplyStrategyInput) input: Out<typeof ApplyStrategyInput>) {
    return this.nitrogen.applyStrategy(ctx, id, input);
  }
}
