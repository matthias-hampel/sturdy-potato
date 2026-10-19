import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { GrasslandPredictionInput, PredictionTimeseriesQuery, StartEsmRunInput } from '@agmeo/contracts';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { badRequest } from '../../core/errors.js';
import { type Out, ZBody, ZQuery } from '../../core/validation.js';
import { ModelServicesService } from './model-services.service.js';

@Controller('orgs/:orgId')
export class ModelServicesController {
  constructor(private readonly models: ModelServicesService) {}

  /** The ESM N model of a crop; with `zoningId` also on that zoning's productivity zones. */
  @Get('crop-cycles/:id/nitrogen-model')
  nitrogenModel(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Query('zoningId', new ParseUUIDPipe({ optional: true })) zoningId?: string) {
    return this.models.nitrogenModel(ctx, id, zoningId);
  }

  @Post('crop-cycles/:id/nitrogen-model/runs')
  @Requires('crop.write')
  startRun(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(StartEsmRunInput) input: Out<typeof StartEsmRunInput>) {
    return this.models.startRun(ctx, id, input);
  }

  /** ESM crop timeseries (yield, DMC, BBCH, GDD, LAI, nFK, N uptake and supply) by crop, or by field and harvest year. */
  @Get('predictions/timeseries')
  timeseries(@OrgCtx() ctx: Ctx, @ZQuery(PredictionTimeseriesQuery) q: Out<typeof PredictionTimeseriesQuery>) {
    return this.models.timeseries(ctx, q);
  }

  @Post('predictions/grassland')
  grassland(@OrgCtx() ctx: Ctx, @ZBody(GrasslandPredictionInput) input: Out<typeof GrasslandPredictionInput>) {
    return this.models.grasslandPredictions(ctx, input);
  }

  @Get('crop-cycles/:id/grassland-prediction')
  cropGrassland(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Query('targetDMC') targetDMC?: string) {
    const dmc = targetDMC == null || targetDMC === '' ? 0.35 : Number(targetDMC);
    if (!Number.isFinite(dmc) || dmc < 0.001 || dmc > 1) throw badRequest('invalid_target_dmc', 'targetDMC must be between 0.001 and 1');
    return this.models.cropGrasslandPrediction(ctx, id, dmc);
  }
}
