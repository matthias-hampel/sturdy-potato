import { Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Put, Query, Res } from '@nestjs/common';
import { AGRARANTRAG_PRESETS, type AgrarantragPreset, FarmRegulatoryInput, LandUseCodeInput, N170Input } from '@agmeo/contracts';
import type { Response } from 'express';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { badRequest } from '../../core/errors.js';
import { type Out, ZBody, ZodPipe } from '../../core/validation.js';
import { RegulatoryService } from './regulatory.service.js';

@Controller('orgs/:orgId')
export class RegulatoryController {
  constructor(private readonly regulatory: RegulatoryService) {}

  @Get('farms/:farmId/regulatory')
  farmData(@OrgCtx() ctx: Ctx, @Param('farmId', ParseUUIDPipe) farmId: string) {
    return this.regulatory.farmData(ctx, farmId);
  }

  @Put('farms/:farmId/regulatory')
  @Requires('farm.write')
  saveFarmData(@OrgCtx() ctx: Ctx, @Param('farmId', ParseUUIDPipe) farmId: string, @ZBody(FarmRegulatoryInput) input: Out<typeof FarmRegulatoryInput>) {
    return this.regulatory.saveFarmData(ctx, farmId, input);
  }

  @Get('land-use-codes')
  landUseCodes(@OrgCtx() ctx: Ctx) {
    return this.regulatory.landUseCodes(ctx);
  }

  @Patch('crop-cycles/:id/land-use-code')
  @Requires('crop.write')
  setLandUseCode(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(LandUseCodeInput)) input: Out<typeof LandUseCodeInput>) {
    return this.regulatory.setLandUseCode(ctx, id, input.landUseCode);
  }

  @Get('regulatory/annual-totals')
  annualTotals(@OrgCtx() ctx: Ctx, @Query('farmId', ParseUUIDPipe) farmId: string, @Query('year', ParseIntPipe) year: number) {
    return this.regulatory.annualTotals(ctx, farmId, year);
  }

  @Get('regulatory/n170')
  n170(@OrgCtx() ctx: Ctx, @Query('farmId', ParseUUIDPipe) farmId: string, @Query('year', ParseIntPipe) year: number) {
    return this.regulatory.n170(ctx, farmId, year);
  }

  @Put('regulatory/n170')
  @Requires('farm.write')
  saveN170(@OrgCtx() ctx: Ctx, @ZBody(N170Input) input: Out<typeof N170Input>) {
    return this.regulatory.saveN170(ctx, input);
  }

  @Get('exports/agrarantrag.zip')
  async agrarantrag(
    @OrgCtx() ctx: Ctx,
    @Query('farmId', ParseUUIDPipe) farmId: string,
    @Query('seasonId', ParseUUIDPipe) seasonId: string,
    @Query('preset') preset: string,
    @Res() res: Response,
  ) {
    if (!(AGRARANTRAG_PRESETS as readonly string[]).includes(preset)) throw badRequest('unknown_preset', 'Unknown portal');
    const file = await this.regulatory.agrarantragShapefile(ctx, farmId, seasonId, preset as AgrarantragPreset);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.body);
  }

  @Get('regulatory/preflight')
  preflight(@OrgCtx() ctx: Ctx, @Query('format') format: string, @Query('farmId', ParseUUIDPipe) farmId: string, @Query('year', ParseIntPipe) year: number) {
    if (format !== 'enni' && format !== 'endo') throw badRequest('unknown_format', 'Unknown export format');
    return this.regulatory.preflight(ctx, format, farmId, year);
  }

  @Get('exports/:format.xml')
  async exportXml(@OrgCtx() ctx: Ctx, @Param('format') format: string, @Query('farmId', ParseUUIDPipe) farmId: string, @Query('year', ParseIntPipe) year: number, @Res() res: Response) {
    if (format !== 'enni' && format !== 'endo') throw badRequest('unknown_format', 'Unknown export format');
    const file = await this.regulatory.exportXml(ctx, format, farmId, year);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.xml);
  }
}
