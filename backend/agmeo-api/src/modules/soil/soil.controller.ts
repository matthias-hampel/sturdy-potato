import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  AssignProbeNumbersInput,
  BatchSamplingPlanInput,
  BatchZonationInput,
  SamplingPlanInput,
  SaveZonesInput,
  UpdateZoneInput,
} from '@agmeo/contracts';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { type Out, ZBody } from '../../core/validation.js';
import { SoilZonationService } from './zonation.service.js';

@Controller('orgs/:orgId')
export class SoilController {
  constructor(private readonly zonations: SoilZonationService) {}

  @Get('soil/fields')
  overview(@OrgCtx() ctx: Ctx) {
    return this.zonations.overview(ctx);
  }

  @Get('fields/:id/soil')
  field(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.zonations.fieldZonation(ctx, id);
  }

  @Get('fields/:id/soil/zonations')
  history(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.zonations.history(ctx, id);
  }

  @Delete('fields/:id/soil/zonation')
  @HttpCode(204)
  @Requires('field.write')
  remove(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.zonations.remove(ctx, id);
  }

  @Post('fields/:id/soil/zonations/:zonationId/restore')
  @HttpCode(200)
  @Requires('field.write')
  restore(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Param('zonationId', ParseUUIDPipe) zonationId: string) {
    return this.zonations.restore(ctx, id, zonationId);
  }

  /** Queues satellite zonations (fcm, kmeans, segment, probe, probe-v2) for agmeo-geo. */
  @Post('soil/zonations')
  @Requires('field.write')
  queue(@OrgCtx() ctx: Ctx, @ZBody(BatchZonationInput) input: Out<typeof BatchZonationInput>) {
    return this.zonations.queueBatch(ctx, input);
  }

  @Get('soil/zonations')
  batch(@OrgCtx() ctx: Ctx, @Query('batchId', ParseUUIDPipe) batchId: string) {
    return this.zonations.batchStatus(ctx, batchId);
  }

  @Post('fields/:id/soil/plan/preview')
  @HttpCode(200)
  preview(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(SamplingPlanInput) input: Out<typeof SamplingPlanInput>) {
    return this.zonations.previewPlan(ctx, id, input);
  }

  @Post('fields/:id/soil/plan')
  @Requires('field.write')
  plan(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(SamplingPlanInput) input: Out<typeof SamplingPlanInput>) {
    return this.zonations.createPlan(ctx, id, input);
  }

  @Post('soil/plans')
  @Requires('field.write')
  plans(@OrgCtx() ctx: Ctx, @ZBody(BatchSamplingPlanInput) input: Out<typeof BatchSamplingPlanInput>) {
    return this.zonations.createPlans(ctx, input);
  }

  @Put('fields/:id/soil/zones')
  @Requires('field.write')
  saveZones(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(SaveZonesInput) input: Out<typeof SaveZonesInput>) {
    return this.zonations.saveZones(ctx, id, input);
  }

  @Patch('soil/zones/:zoneId')
  @Requires('field.write')
  updateZone(@OrgCtx() ctx: Ctx, @Param('zoneId', ParseUUIDPipe) zoneId: string, @ZBody(UpdateZoneInput) input: Out<typeof UpdateZoneInput>) {
    return this.zonations.updateZone(ctx, zoneId, input);
  }

  @Post('soil/probe-numbers')
  @HttpCode(200)
  @Requires('field.write')
  probeNumbers(@OrgCtx() ctx: Ctx, @ZBody(AssignProbeNumbersInput) input: Out<typeof AssignProbeNumbersInput>) {
    return this.zonations.assignProbeNumbers(ctx, input);
  }
}
