import { tmpdir } from 'node:os';
import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { InspectYieldMapInput, RegisterYieldMapInput, SaveYieldZoningInput, UpdateYieldMapSourceInput, YieldEstimateInput } from '@agmeo/contracts';
import type { Response } from 'express';
import { diskStorage } from 'multer';
import { z } from 'zod';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { config } from '../../config.js';
import { badRequest } from '../../core/errors.js';
import { type Out, ZBody } from '../../core/validation.js';
import { YieldService } from './yield.service.js';

const MAX_FILES_PER_UPLOAD = 50;

const UploadFields = z.object({
  year: z.coerce.number().int().min(1900).max(2200).nullable().catch(null),
  seasonId: z.uuid().nullable().catch(null),
  // File names as JSON array, in upload order: multipart file names are not reliably UTF-8.
  names: z.string().transform((s, c) => {
    try {
      return z.array(z.string().min(1).max(1000)).parse(JSON.parse(s));
    } catch {
      c.addIssue({ code: 'custom', message: 'names must be a JSON array of strings' });
      return z.NEVER;
    }
  }),
});

const optionalUuid = (v: unknown) => (typeof v === 'string' && v ? z.uuid().parse(v) : undefined);
const optionalNumber = (v: unknown) => (typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);

/** Yield maps: import, sources, merged rasters, zone yields, analytics and the satellite estimate. */
@Controller('orgs/:orgId/yield-maps')
export class YieldController {
  constructor(private readonly yields: YieldService) {}

  /** Stores the exports in the "Ertragskarten" folder and returns what was read and which fields they overlap. */
  @Post('upload')
  @Requires('operation.write')
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES_PER_UPLOAD, {
      storage: diskStorage({ destination: tmpdir() }),
      limits: { fileSize: config.storage.maxUploadBytes, files: MAX_FILES_PER_UPLOAD },
    }),
  )
  upload(@OrgCtx() ctx: Ctx, @UploadedFiles() uploaded: Express.Multer.File[] = [], @Body() body: unknown) {
    const fields = UploadFields.safeParse(body);
    if (!fields.success || fields.data.names.length !== uploaded.length) throw badRequest('invalid_upload', 'Every uploaded file needs a name');
    if (!uploaded.length) throw badRequest('no_files', 'No files in the upload');
    return this.yields.upload(
      ctx,
      uploaded.map((f, i) => ({ path: f.path, size: f.size, mimetype: f.mimetype, name: fields.data.names[i] })),
      fields.data.year,
      fields.data.seasonId,
    );
  }

  /** Inspects a file that is already stored (e.g. picked from the file browser). */
  @Post('inspect')
  @Requires('operation.write')
  inspect(@OrgCtx() ctx: Ctx, @ZBody(InspectYieldMapInput) input: Out<typeof InspectYieldMapInput>) {
    return this.yields.inspect(ctx, input);
  }

  @Get('sources')
  sources(@OrgCtx() ctx: Ctx, @Query('seasonId') seasonId?: string, @Query('cropCycleId') cropCycleId?: string) {
    return this.yields.sources(ctx, { seasonId: optionalUuid(seasonId), cropCycleId: optionalUuid(cropCycleId) });
  }

  /** Adds an export to one or more crop cycles; the worker parses and merges it. */
  @Post('sources')
  @Requires('operation.write')
  register(@OrgCtx() ctx: Ctx, @ZBody(RegisterYieldMapInput) input: Out<typeof RegisterYieldMapInput>) {
    return this.yields.register(ctx, input);
  }

  @Patch('sources/:id')
  @Requires('operation.write')
  update(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(UpdateYieldMapSourceInput) input: Out<typeof UpdateYieldMapSourceInput>) {
    return this.yields.updateSource(ctx, id, input);
  }

  @Delete('sources/:id')
  @Requires('operation.write')
  @HttpCode(204)
  async remove(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    await this.yields.deleteSource(ctx, id);
  }

  /** The season's crop cycles with coverage and the shared colour scales per crop. */
  @Get('overview')
  overview(@OrgCtx() ctx: Ctx, @Query('seasonId', ParseUUIDPipe) seasonId: string) {
    return this.yields.overview(ctx, seasonId);
  }

  @Get('fields/:fieldId/history')
  history(@OrgCtx() ctx: Ctx, @Param('fieldId', ParseUUIDPipe) fieldId: string) {
    return this.yields.history(ctx, fieldId);
  }

  @Get('crop-cycles/:cropCycleId')
  cropCycle(@OrgCtx() ctx: Ctx, @Param('cropCycleId', ParseUUIDPipe) cropCycleId: string) {
    return this.yields.cropCycle(ctx, cropCycleId);
  }

  @Post('crop-cycles/:cropCycleId/rebuild')
  @Requires('operation.write')
  @HttpCode(202)
  async rebuild(@OrgCtx() ctx: Ctx, @Param('cropCycleId', ParseUUIDPipe) cropCycleId: string) {
    await this.yields.rebuild(ctx, cropCycleId);
    return { queued: true };
  }

  /** Preview of the satellite yield estimate as zones; nothing is stored. */
  @Post('crop-cycles/:cropCycleId/estimate')
  estimate(@OrgCtx() ctx: Ctx, @Param('cropCycleId', ParseUUIDPipe) cropCycleId: string, @ZBody(YieldEstimateInput) input: Out<typeof YieldEstimateInput>) {
    return this.yields.estimate(ctx, cropCycleId, input);
  }

  @Post('crop-cycles/:cropCycleId/zonings')
  @Requires('field.write')
  saveZoning(@OrgCtx() ctx: Ctx, @Param('cropCycleId', ParseUUIDPipe) cropCycleId: string, @ZBody(SaveYieldZoningInput) input: Out<typeof SaveYieldZoningInput>) {
    return this.yields.saveZoning(ctx, cropCycleId, input);
  }

  @Delete('crop-cycles/:cropCycleId/zonings/:zoningId')
  @Requires('field.write')
  @HttpCode(204)
  async deleteZoning(@OrgCtx() ctx: Ctx, @Param('cropCycleId', ParseUUIDPipe) cropCycleId: string, @Param('zoningId', ParseUUIDPipe) zoningId: string) {
    await this.yields.deleteZoning(ctx, cropCycleId, zoningId);
  }

  /** Map tiles of a merged raster; `min`/`max` set the colour stretch (e.g. the crop's shared scale). */
  @Get('rasters/:id/tiles/:z/:x/:y.png')
  async tile(
    @OrgCtx() ctx: Ctx,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('z', ParseIntPipe) z: number,
    @Param('x', ParseIntPipe) x: number,
    @Param('y', ParseIntPipe) y: number,
    @Query('min') min: string | undefined,
    @Query('max') max: string | undefined,
    @Res() res: Response,
  ) {
    if (z < 0 || z > 22) throw badRequest('invalid_zoom', 'Invalid zoom');
    const lo = optionalNumber(min);
    const hi = optionalNumber(max);
    const png = await this.yields.tile(ctx, id, z, x, y, lo !== undefined && hi !== undefined && hi > lo ? [lo, hi] : undefined);
    res.status(200).set({ 'content-type': 'image/png', 'cache-control': 'private, max-age=3600' }).send(png);
  }
}
