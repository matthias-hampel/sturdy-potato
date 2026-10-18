import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { FertilizerNeedOverrides, FieldSiteInput, SoilSampleInput, SuggestRatesInput } from '@agmeo/contracts';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { type Out, ZBody, ZodPipe } from '../../core/validation.js';
import { NutrientsService } from './nutrients.service.js';

@Controller('orgs/:orgId')
export class NutrientsController {
  constructor(private readonly nutrients: NutrientsService) {}

  @Get('soil-samples')
  soilSamples(@OrgCtx() ctx: Ctx, @Query('fieldId') fieldId?: string) {
    return this.nutrients.soilSamples(ctx, fieldId);
  }

  @Post('soil-samples')
  @Requires('field.write')
  createSoilSample(@OrgCtx() ctx: Ctx, @ZBody(SoilSampleInput) input: Out<typeof SoilSampleInput>) {
    return this.nutrients.createSoilSample(ctx, input);
  }

  @Delete('soil-samples/:id')
  @HttpCode(204)
  @Requires('field.write')
  deleteSoilSample(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.nutrients.deleteSoilSample(ctx, id);
  }

  @Get('soil')
  soilOverview(@OrgCtx() ctx: Ctx) {
    return this.nutrients.soilOverview(ctx);
  }

  @Patch('fields/:id/site')
  @Requires('field.write')
  updateFieldSite(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(FieldSiteInput) input: Out<typeof FieldSiteInput>) {
    return this.nutrients.updateFieldSite(ctx, id, input);
  }

  /** Preview of the fertilizer need; overrides are passed as a JSON body to keep the query short. */
  @Post('crop-cycles/:id/fertilizer-need/preview')
  @HttpCode(200)
  previewNeed(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(FertilizerNeedOverrides)) input: Out<typeof FertilizerNeedOverrides>) {
    return this.nutrients.fertilizerNeed(ctx, id, input);
  }

  @Get('crop-cycles/:id/fertilizer-need')
  need(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.nutrients.fertilizerNeed(ctx, id, {});
  }

  @Post('crop-cycles/:id/fertilizer-need')
  @Requires('crop.write')
  saveNeed(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(FertilizerNeedOverrides) input: Out<typeof FertilizerNeedOverrides>) {
    return this.nutrients.saveFertilizerNeed(ctx, id, input);
  }

  @Get('crop-cycles/:id/fertilizer-need/records')
  needRecords(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.nutrients.needRecords(ctx, id);
  }

  @Get('crop-cycles/:id/nmin-references')
  nminReferences(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.nutrients.nminReferences(ctx, id);
  }

  @Get('nutrients/season')
  seasonBalance(@OrgCtx() ctx: Ctx, @Query('seasonId', ParseUUIDPipe) seasonId: string) {
    return this.nutrients.seasonBalance(ctx, seasonId);
  }

  @Post('vra-suggestions')
  @HttpCode(200)
  suggestRates(@OrgCtx() ctx: Ctx, @ZBody(SuggestRatesInput) input: Out<typeof SuggestRatesInput>) {
    return this.nutrients.suggestRates(ctx, input);
  }
}
