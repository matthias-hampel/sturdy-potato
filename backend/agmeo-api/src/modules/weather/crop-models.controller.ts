import { Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { RootDepthInput } from '@agmeo/contracts';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { type Out, ZBody } from '../../core/validation.js';
import { CropModelsService } from './crop-models.service.js';

@Controller('orgs/:orgId')
export class CropModelsController {
  constructor(private readonly models: CropModelsService) {}

  /** Root-zone water balance with days and irrigation events per crop of a season. */
  @Get('water-balances')
  waterBalances(@OrgCtx() ctx: Ctx, @Query('seasonId', ParseUUIDPipe) seasonId: string) {
    return this.models.waterBalances(ctx, seasonId);
  }

  @Patch('water-balances/root-depths')
  @Requires('crop.write')
  rootDepths(@OrgCtx() ctx: Ctx, @ZBody(RootDepthInput) input: Out<typeof RootDepthInput>) {
    return this.models.setRootDepths(ctx, input);
  }

  /** The BBCH dialog: model run, calibrated stages and the observations. */
  @Get('crop-cycles/:id/phenology')
  phenology(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.models.phenology(ctx, id);
  }
}
