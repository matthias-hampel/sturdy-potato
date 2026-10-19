import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import {
  AssignProbeNumbersInput,
  BatchSamplingPlanInput,
  BatchZonationInput,
  SamplingPlanInput,
  RestoreZonationsInput,
  SaveZonesInput,
  SoilExportInput,
  UpdateZoneInput,
} from '@agmeo/contracts';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { badRequest } from '../../core/errors.js';
import { type Out, ZBody } from '../../core/validation.js';
import { SoilExportService } from './export.service.js';
import { SoilHistoryService } from './history.service.js';
import { type LabUpload, SoilLabService } from './lab.service.js';
import { SoilZonationService } from './zonation.service.js';

const MAX_LAB_FILES = 50;
const LAB_UPLOAD = FilesInterceptor('files', MAX_LAB_FILES, { storage: memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: MAX_LAB_FILES } });

const jsonArray = <T extends z.ZodType>(item: T) =>
  z.string().transform((s, c) => {
    try {
      return z.array(item).parse(JSON.parse(s));
    } catch {
      c.addIssue({ code: 'custom', message: 'expected a JSON array' });
      return z.NEVER;
    }
  });

const LabUploadFields = z.object({
  // File names as a JSON array in upload order: multipart file names are not reliably UTF-8.
  names: jsonArray(z.string().min(1).max(1000)),
  fieldIds: jsonArray(z.uuid()).optional(),
});

function labUploads(uploaded: Express.Multer.File[], body: unknown): { files: LabUpload[]; fieldIds: string[] | null } {
  const fields = LabUploadFields.safeParse(body);
  if (!uploaded.length || !fields.success || fields.data.names.length !== uploaded.length) throw badRequest('invalid_upload', 'Every uploaded file needs a name');
  return {
    files: uploaded.map((f, i) => ({ name: fields.data.names[i], data: f.buffer, mimeType: f.mimetype })),
    fieldIds: fields.data.fieldIds ?? null,
  };
}

@Controller('orgs/:orgId')
export class SoilController {
  constructor(
    private readonly zonations: SoilZonationService,
    private readonly exports: SoilExportService,
    private readonly lab: SoilLabService,
    private readonly histories: SoilHistoryService,
  ) {}

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

  /** Sample card, zonation or results PDF, GeoJSON or shapefile; archived under "Soil exports". */
  @Post('soil/exports')
  @Requires('field.write')
  export(@OrgCtx() ctx: Ctx, @ZBody(SoilExportInput) input: Out<typeof SoilExportInput>) {
    return this.exports.export(ctx, input);
  }

  // ---------------------------------------------------------------------------
  // Lab results
  // ---------------------------------------------------------------------------

  @Post('soil/lab-results/preview')
  @HttpCode(200)
  @Requires('field.write')
  @UseInterceptors(LAB_UPLOAD)
  labPreview(@OrgCtx() ctx: Ctx, @UploadedFiles() uploaded: Express.Multer.File[] = [], @Body() body: unknown) {
    return this.lab.preview(ctx, labUploads(uploaded, body).files);
  }

  @Post('soil/lab-results')
  @Requires('field.write')
  @UseInterceptors(LAB_UPLOAD)
  labApply(@OrgCtx() ctx: Ctx, @UploadedFiles() uploaded: Express.Multer.File[] = [], @Body() body: unknown) {
    const { files, fieldIds } = labUploads(uploaded, body);
    return this.lab.apply(ctx, files, fieldIds);
  }

  @Get('soil/lab-imports')
  labImports(@OrgCtx() ctx: Ctx) {
    return this.lab.imports(ctx);
  }

  // ---------------------------------------------------------------------------
  // History, compare, analysis
  // ---------------------------------------------------------------------------

  @Get('fields/:id/soil/history')
  fieldHistory(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.histories.fieldHistory(ctx, id);
  }

  /** Past states of the zone maps of the fields (comma-separated ids). */
  @Get('soil/history/states')
  states(@OrgCtx() ctx: Ctx, @Query('fieldIds') fieldIds = '') {
    const ids = z.array(z.uuid()).min(1).max(1000).safeParse(fieldIds.split(',').filter(Boolean));
    if (!ids.success) throw badRequest('invalid_fields', 'fieldIds must list field ids');
    return this.histories.states(ctx, ids.data);
  }

  @Post('soil/history/restore')
  @HttpCode(200)
  @Requires('field.write')
  restoreMany(@OrgCtx() ctx: Ctx, @ZBody(RestoreZonationsInput) input: Out<typeof RestoreZonationsInput>) {
    return this.histories.restoreMany(ctx, input.zonationIds);
  }

  @Get('soil/analysis')
  analysis(@OrgCtx() ctx: Ctx) {
    return this.histories.analysis(ctx);
  }
}
