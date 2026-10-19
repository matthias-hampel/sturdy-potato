import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BasePatch, ManualBaseInput, SatelliteBaseInput, SoilBaseInput, UniformBaseInput } from '@agmeo/contracts';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { badRequest } from '../../core/errors.js';
import { type Out, ZBody } from '../../core/validation.js';
import { VraBasesService } from './bases.service.js';

const MAX_ZONE_FILE_BYTES = 30 * 1024 * 1024;
const UploadName = z.object({ name: z.string().trim().min(1).max(300).optional() });

/** Base zonations of a field's application maps: list, copy, upload, satellite, brush edits. */
@Controller('orgs/:orgId/fields/:fieldId/vra-bases')
export class VraBasesController {
  constructor(private readonly bases: VraBasesService) {}

  @Get()
  list(@OrgCtx() ctx: Ctx, @Param('fieldId', ParseUUIDPipe) fieldId: string) {
    return this.bases.list(ctx, fieldId);
  }

  @Post('soil')
  @Requires('field.write')
  soil(@OrgCtx() ctx: Ctx, @Param('fieldId', ParseUUIDPipe) fieldId: string, @ZBody(SoilBaseInput) input: Out<typeof SoilBaseInput>) {
    return this.bases.createFromSoil(ctx, fieldId, input.name);
  }

  @Post('uniform')
  @Requires('field.write')
  uniform(@OrgCtx() ctx: Ctx, @Param('fieldId', ParseUUIDPipe) fieldId: string, @ZBody(UniformBaseInput) input: Out<typeof UniformBaseInput>) {
    return this.bases.createUniform(ctx, fieldId, input.name);
  }

  @Post('satellite')
  @Requires('field.write')
  satellite(@OrgCtx() ctx: Ctx, @Param('fieldId', ParseUUIDPipe) fieldId: string, @ZBody(SatelliteBaseInput) input: Out<typeof SatelliteBaseInput>) {
    return this.bases.queueSatellite(ctx, fieldId, input);
  }

  @Post('manual')
  @Requires('field.write')
  manual(@OrgCtx() ctx: Ctx, @Param('fieldId', ParseUUIDPipe) fieldId: string, @ZBody(ManualBaseInput) input: Out<typeof ManualBaseInput>) {
    return this.bases.saveManual(ctx, fieldId, input);
  }

  /** A zone file: GeoJSON, Shapefile ZIP or ISO-XML TASKDATA ZIP (multipart field `file`, optional `name`). */
  @Post('upload')
  @Requires('field.write')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_ZONE_FILE_BYTES, files: 1 } }))
  upload(@OrgCtx() ctx: Ctx, @Param('fieldId', ParseUUIDPipe) fieldId: string, @UploadedFile() file: Express.Multer.File | undefined, @Body() body: unknown) {
    if (!file?.buffer?.length) throw badRequest('no_file', 'No file in the upload');
    const name = UploadName.safeParse(body ?? {});
    return this.bases.upload(ctx, fieldId, { name: (name.success && name.data.name) || file.originalname || 'upload', data: file.buffer });
  }

  @Patch(':zoningId')
  @Requires('field.write')
  update(
    @OrgCtx() ctx: Ctx,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @Param('zoningId', ParseUUIDPipe) zoningId: string,
    @ZBody(BasePatch) input: Out<typeof BasePatch>,
  ) {
    return this.bases.update(ctx, fieldId, zoningId, input);
  }

  @Delete('jobs/:jobId')
  @HttpCode(204)
  @Requires('field.write')
  deleteJob(@OrgCtx() ctx: Ctx, @Param('fieldId', ParseUUIDPipe) fieldId: string, @Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.bases.deleteJob(ctx, fieldId, jobId);
  }

  @Delete(':zoningId')
  @HttpCode(204)
  @Requires('field.write')
  delete(@OrgCtx() ctx: Ctx, @Param('fieldId', ParseUUIDPipe) fieldId: string, @Param('zoningId', ParseUUIDPipe) zoningId: string) {
    return this.bases.delete(ctx, fieldId, zoningId);
  }
}
