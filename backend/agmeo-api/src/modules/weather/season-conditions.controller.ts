import { Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { BbchCalibrationInput, RootDepthInput } from '@agmeo/contracts';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { badRequest } from '../../core/errors.js';
import { type Out, ZBody } from '../../core/validation.js';
import { SeasonConditionsService } from './season-conditions.service.js';

@Controller('orgs/:orgId')
export class SeasonConditionsController {
  constructor(private readonly seasonConditions: SeasonConditionsService) {}

  /** Traffic lights, disease risk, calibrated BBCH and water balance of every crop of a season. */
  @Get('conditions')
  season(@OrgCtx() ctx: Ctx, @Query('seasonId', ParseUUIDPipe) seasonId: string) {
    return this.seasonConditions.season(ctx, seasonId);
  }

  /** Root-zone water balance with days and irrigation events per crop of a season. */
  @Get('water-balances')
  waterBalances(@OrgCtx() ctx: Ctx, @Query('seasonId', ParseUUIDPipe) seasonId: string) {
    return this.seasonConditions.waterBalances(ctx, seasonId);
  }

  @Patch('water-balances/root-depths')
  @Requires('crop.write')
  rootDepths(@OrgCtx() ctx: Ctx, @ZBody(RootDepthInput) input: Out<typeof RootDepthInput>) {
    return this.seasonConditions.setRootDepths(ctx, input);
  }

  @Get('crop-cycles/:id/phenology')
  phenology(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.seasonConditions.phenology(ctx, id);
  }

  @Post('crop-cycles/:id/bbch-calibrations')
  @Requires('crop.write')
  calibrate(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(BbchCalibrationInput) input: Out<typeof BbchCalibrationInput>) {
    return this.seasonConditions.calibrate(ctx, id, input);
  }

  @Delete('crop-cycles/:id/bbch-calibrations/:date')
  @Requires('crop.write')
  removeCalibration(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Param('date') date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('invalid_date', 'Dates must be YYYY-MM-DD');
    return this.seasonConditions.removeCalibration(ctx, id, date);
  }
}
