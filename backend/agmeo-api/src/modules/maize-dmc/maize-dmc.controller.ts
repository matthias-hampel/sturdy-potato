import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from '@nestjs/common';
import {
  ApplyDmcOffsetInput,
  CreateDmcMeasurementInput,
  DMC_RESOLUTIONS,
  type DmcResolution,
  RevokeDmcOffsetsInput,
  UpdateDmcMeasurementInput,
  UpdateDmcSettingsInput,
} from '@agmeo/contracts';
import type { Response } from 'express';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { badRequest } from '../../core/errors.js';
import { type Out, ZBody } from '../../core/validation.js';
import { MaizeDmcService } from './maize-dmc.service.js';
import type { ResultBand, ResultOutput } from './types.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EXECUTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const parseYear = (v?: string) => {
  const year = v ? Number(v) : new Date().getUTCFullYear();
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw badRequest('invalid_year', 'Invalid harvest year');
  return year;
};
const parseResolution = (v?: string): DmcResolution | undefined => {
  if (v == null || v === '') return undefined;
  if (!(DMC_RESOLUTIONS as readonly string[]).includes(v)) throw badRequest('invalid_resolution', "Use '10m' or '3m'");
  return v as DmcResolution;
};
const parseDate = (v: string | undefined, name: string) => {
  if (!v || !DATE.test(v)) throw badRequest('invalid_date', `${name}: expected YYYY-MM-DD`);
  return v;
};

/**
 * Maize dry-matter monitoring. Without MAIZE_DMC_API_URL the overview reports
 * `configured: false`; forecast and raster routes answer 503 `dmc_not_configured`.
 */
@Controller('orgs/:orgId/maize-dmc')
export class MaizeDmcController {
  constructor(private readonly dmc: MaizeDmcService) {}

  @Get()
  overview(@OrgCtx() ctx: Ctx, @Query('harvestYear') harvestYear?: string) {
    return this.dmc.overview(ctx, parseYear(harvestYear));
  }

  @Get('status')
  status() {
    return { configured: this.dmc.configured };
  }

  @Get('cycles/:cropCycleId/forecast')
  forecast(@OrgCtx() ctx: Ctx, @Param('cropCycleId', ParseUUIDPipe) cropCycleId: string, @Query('resolution') resolution?: string) {
    return this.dmc.forecast(ctx, cropCycleId, parseResolution(resolution) ?? '10m');
  }

  @Put('cycles/:cropCycleId/settings')
  @Requires('crop.write')
  settings(@OrgCtx() ctx: Ctx, @Param('cropCycleId', ParseUUIDPipe) cropCycleId: string, @ZBody(UpdateDmcSettingsInput) input: Out<typeof UpdateDmcSettingsInput>) {
    return this.dmc.updateSettings(ctx, cropCycleId, input);
  }

  @Get('cycles/:cropCycleId/measurements')
  measurements(@OrgCtx() ctx: Ctx, @Param('cropCycleId', ParseUUIDPipe) cropCycleId: string) {
    return this.dmc.measurements(ctx, cropCycleId);
  }

  @Post('cycles/:cropCycleId/measurements')
  @Requires('crop.write')
  addMeasurement(@OrgCtx() ctx: Ctx, @Param('cropCycleId', ParseUUIDPipe) cropCycleId: string, @ZBody(CreateDmcMeasurementInput) input: Out<typeof CreateDmcMeasurementInput>) {
    return this.dmc.addMeasurement(ctx, cropCycleId, input);
  }

  @Patch('measurements/:id')
  @Requires('crop.write')
  updateMeasurement(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(UpdateDmcMeasurementInput) input: Out<typeof UpdateDmcMeasurementInput>) {
    return this.dmc.updateMeasurement(ctx, id, input);
  }

  @Delete('measurements/:id')
  @Requires('crop.write')
  @HttpCode(204)
  deleteMeasurement(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.dmc.deleteMeasurement(ctx, id);
  }

  @Get('offsets')
  offsets(@OrgCtx() ctx: Ctx, @Query('harvestYear') harvestYear?: string) {
    return this.dmc.offsets(ctx, parseYear(harvestYear));
  }

  @Get('offsets/varieties')
  offsetVarieties(@OrgCtx() ctx: Ctx, @Query('harvestYear') harvestYear?: string) {
    return this.dmc.offsetVarieties(ctx, parseYear(harvestYear));
  }

  /** `?harvestYear=&varietyIds=a,b&from=&to=` */
  @Get('offsets/basis')
  offsetBasis(@OrgCtx() ctx: Ctx, @Query('harvestYear') harvestYear?: string, @Query('varietyIds') varietyIds?: string, @Query('from') from?: string, @Query('to') to?: string) {
    const ids = (varietyIds ?? '').split(',').filter(Boolean);
    if (ids.some((v) => !EXECUTION_ID.test(v))) throw badRequest('invalid_id', 'varietyIds: expected UUIDs');
    return this.dmc.offsetBasis(ctx, parseYear(harvestYear), { varietyIds: ids.slice(0, 200), from: parseDate(from, 'from'), to: parseDate(to, 'to') });
  }

  @Post('offsets')
  @Requires('crop.write')
  applyOffset(@OrgCtx() ctx: Ctx, @ZBody(ApplyDmcOffsetInput) input: Out<typeof ApplyDmcOffsetInput>) {
    return this.dmc.applyOffset(ctx, input);
  }

  @Post('offsets/revoke')
  @Requires('crop.write')
  @HttpCode(200)
  revokeOffsets(@OrgCtx() ctx: Ctx, @ZBody(RevokeDmcOffsetsInput) input: Out<typeof RevokeDmcOffsetsInput>) {
    return this.dmc.revokeOffsets(ctx, input);
  }

  /** One day's DM raster of a run (proxied from maize-dmc-api): `?output=png|tiff&band=mean|p10|p90&resolution=10m|3m`. */
  @Get('runs/:executionId/results/:date')
  async result(
    @OrgCtx() ctx: Ctx,
    @Param('executionId') executionId: string,
    @Param('date') date: string,
    @Query('output') output: string | undefined,
    @Query('band') band: string | undefined,
    @Query('resolution') resolution: string | undefined,
    @Res() res: Response,
  ) {
    if (!EXECUTION_ID.test(executionId)) throw badRequest('invalid_execution', 'Invalid executionId');
    parseDate(date, 'date');
    const out = (output ?? 'png') as ResultOutput;
    if (out !== 'png' && out !== 'tiff') throw badRequest('invalid_output', "Expected 'png' or 'tiff'");
    const b = (band ?? 'mean') as ResultBand;
    if (!['mean', 'p10', 'p90'].includes(b)) throw badRequest('invalid_band', "Expected 'mean', 'p10' or 'p90'");
    const result = await this.dmc.result(ctx, executionId, date, { output: out, band: b, resolution: parseResolution(resolution) });
    res.status(200).set({
      'content-type': result.contentType,
      // An execution's rasters never change; private because the route needs a sign-in.
      'cache-control': 'private, max-age=86400, immutable',
      'content-disposition': `inline; filename="dmc-${date}.${out === 'tiff' ? 'tif' : 'png'}"`,
      ...(result.bbox3857 ? { 'x-bounding-box-epsg-3857': result.bbox3857 } : {}),
    });
    res.send(result.body);
  }
}
