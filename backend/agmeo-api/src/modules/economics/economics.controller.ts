import { Controller, Delete, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { CostEntryInput, CropPricesInput, FarmOverheadsInput, HarvestInput } from '@agmeo/contracts';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { type Out, ZBody } from '../../core/validation.js';
import { EconomicsService } from './economics.service.js';

@Controller('orgs/:orgId')
export class EconomicsController {
  constructor(private readonly economics: EconomicsService) {}

  @Get('harvests')
  harvests(@OrgCtx() ctx: Ctx, @Query('seasonId') seasonId?: string, @Query('cropCycleId') cropCycleId?: string) {
    return this.economics.harvests(ctx, { seasonId, cropCycleId });
  }

  // Harvest quantities are field records; recording them is part of operations work.
  @Post('harvests')
  @Requires('operation.write')
  createHarvest(@OrgCtx() ctx: Ctx, @ZBody(HarvestInput) input: Out<typeof HarvestInput>) {
    return this.economics.createHarvest(ctx, input);
  }

  @Delete('harvests/:id')
  @HttpCode(204)
  @Requires('operation.write')
  deleteHarvest(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.economics.deleteHarvest(ctx, id);
  }

  @Get('cost-entries')
  @Requires('finance.read')
  costEntries(@OrgCtx() ctx: Ctx, @Query('seasonId') seasonId?: string, @Query('cropCycleId') cropCycleId?: string, @Query('fieldId') fieldId?: string) {
    return this.economics.costEntries(ctx, { seasonId, cropCycleId, fieldId });
  }

  @Post('cost-entries')
  @Requires('finance.write')
  createCostEntry(@OrgCtx() ctx: Ctx, @ZBody(CostEntryInput) input: Out<typeof CostEntryInput>) {
    return this.economics.createCostEntry(ctx, input);
  }

  @Delete('cost-entries/:id')
  @HttpCode(204)
  @Requires('finance.write')
  deleteCostEntry(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.economics.deleteCostEntry(ctx, id);
  }

  @Get('economics/summary')
  @Requires('finance.read')
  summary(@OrgCtx() ctx: Ctx, @Query('seasonId') seasonId?: string) {
    return this.economics.summary(ctx, seasonId);
  }

  @Get('economics/overheads')
  @Requires('finance.read')
  overheads(@OrgCtx() ctx: Ctx, @Query('seasonId', ParseUUIDPipe) seasonId: string) {
    return this.economics.overheads(ctx, seasonId);
  }

  @Put('economics/overheads')
  @Requires('finance.write')
  saveOverheads(@OrgCtx() ctx: Ctx, @ZBody(FarmOverheadsInput) input: Out<typeof FarmOverheadsInput>) {
    return this.economics.saveOverheads(ctx, input);
  }

  @Get('crop-prices')
  @Requires('finance.read')
  cropPrices(@OrgCtx() ctx: Ctx, @Query('harvestYear', ParseIntPipe) harvestYear: number) {
    return this.economics.cropPrices(ctx, harvestYear);
  }

  @Put('crop-prices')
  @Requires('finance.write')
  saveCropPrices(@OrgCtx() ctx: Ctx, @ZBody(CropPricesInput) input: Out<typeof CropPricesInput>) {
    return this.economics.saveCropPrices(ctx, input);
  }
}
