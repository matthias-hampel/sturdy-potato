import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { CreateCropCyclesInput, CropColorsInput, CreateCropInput, CreateVarietyInput, SeasonInput, UpdateCropCycleInput } from '@agmeo/contracts';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { type Out, ZBody } from '../../core/validation.js';
import { CropsService } from './crops.service.js';

@Controller('orgs/:orgId')
export class CropsController {
  constructor(private readonly crops: CropsService) {}

  @Get('crops')
  list(@OrgCtx() ctx: Ctx) {
    return this.crops.crops(ctx);
  }

  @Get('crop-colors')
  cropColors(@OrgCtx() ctx: Ctx) {
    return this.crops.cropColors(ctx);
  }

  @Put('crop-colors')
  @Requires('crop.write')
  setCropColors(@OrgCtx() ctx: Ctx, @ZBody(CropColorsInput) input: Out<typeof CropColorsInput>) {
    return this.crops.setCropColors(ctx, input);
  }

  @Post('crops')
  @Requires('crop.write')
  createCrop(@OrgCtx() ctx: Ctx, @ZBody(CreateCropInput) input: Out<typeof CreateCropInput>) {
    return this.crops.createCrop(ctx, input);
  }

  @Get('crops/:cropId/registered-varieties')
  registeredVarieties(@OrgCtx() ctx: Ctx, @Param('cropId', ParseUUIDPipe) cropId: string) {
    return this.crops.registeredVarieties(ctx, cropId);
  }

  @Get('varieties')
  varieties(@OrgCtx() ctx: Ctx, @Query('cropId') cropId?: string) {
    return this.crops.varieties(ctx, cropId);
  }

  @Post('varieties')
  @Requires('crop.write')
  createVariety(@OrgCtx() ctx: Ctx, @ZBody(CreateVarietyInput) input: Out<typeof CreateVarietyInput>) {
    return this.crops.createVariety(ctx, input);
  }

  @Get('seasons')
  seasons(@OrgCtx() ctx: Ctx) {
    return this.crops.seasons(ctx);
  }

  @Post('seasons')
  @Requires('crop.write')
  createSeason(@OrgCtx() ctx: Ctx, @ZBody(SeasonInput) input: Out<typeof SeasonInput>) {
    return this.crops.createSeason(ctx, input);
  }

  @Put('seasons/:id')
  @Requires('crop.write')
  updateSeason(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(SeasonInput) input: Out<typeof SeasonInput>) {
    return this.crops.updateSeason(ctx, id, input);
  }

  @Delete('seasons/:id')
  @Requires('crop.write')
  deleteSeason(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.crops.deleteSeason(ctx, id);
  }

  @Get('crop-cycles')
  cropCycles(@OrgCtx() ctx: Ctx, @Query('seasonId') seasonId?: string, @Query('fieldId') fieldId?: string, @Query('farmId') farmId?: string) {
    return this.crops.cropCycles(ctx, { seasonId, fieldId, farmId });
  }

  @Post('crop-cycles')
  @Requires('crop.write')
  createCropCycles(@OrgCtx() ctx: Ctx, @ZBody(CreateCropCyclesInput) input: Out<typeof CreateCropCyclesInput>) {
    return this.crops.createCropCycles(ctx, input);
  }

  @Patch('crop-cycles/:id')
  @Requires('crop.write')
  updateCropCycle(
    @OrgCtx() ctx: Ctx,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(UpdateCropCycleInput) input: Out<typeof UpdateCropCycleInput>,
  ) {
    return this.crops.updateCropCycle(ctx, id, input);
  }

  @Delete('crop-cycles/:id')
  @HttpCode(204)
  @Requires('crop.write')
  deleteCropCycle(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.crops.deleteCropCycle(ctx, id);
  }
}
