import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Res } from '@nestjs/common';
import { VraExportQuery, VraMapInput } from '@agmeo/contracts';
import type { Response } from 'express';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { type Out, ZBody, ZQuery } from '../../core/validation.js';
import { VraService } from './vra.service.js';

@Controller('orgs/:orgId/fields/:fieldId/vra-maps')
export class VraController {
  constructor(private readonly vra: VraService) {}

  @Get()
  list(@OrgCtx() ctx: Ctx, @Param('fieldId', ParseUUIDPipe) fieldId: string) {
    return this.vra.list(ctx, fieldId);
  }

  @Get(':id')
  get(@OrgCtx() ctx: Ctx, @Param('fieldId', ParseUUIDPipe) fieldId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.vra.get(ctx, fieldId, id);
  }

  @Post()
  @Requires('field.write')
  create(@OrgCtx() ctx: Ctx, @Param('fieldId', ParseUUIDPipe) fieldId: string, @ZBody(VraMapInput) input: Out<typeof VraMapInput>) {
    return this.vra.create(ctx, fieldId, input);
  }

  @Put(':id')
  @Requires('field.write')
  update(
    @OrgCtx() ctx: Ctx,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(VraMapInput) input: Out<typeof VraMapInput>,
  ) {
    return this.vra.update(ctx, fieldId, id, input);
  }

  @Delete(':id')
  @HttpCode(204)
  @Requires('field.write')
  delete(@OrgCtx() ctx: Ctx, @Param('fieldId', ParseUUIDPipe) fieldId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.vra.delete(ctx, fieldId, id);
  }

  /** Prescription file: zipped Shapefile, zipped ISO-XML TASKDATA, or GeoJSON. */
  @Get(':id/export')
  async export(
    @OrgCtx() ctx: Ctx,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ZQuery(VraExportQuery) query: Out<typeof VraExportQuery>,
    @Res() res: Response,
  ) {
    const file = await this.vra.export(ctx, fieldId, id, query.format);
    res
      .status(200)
      .set({ 'content-type': file.contentType, 'content-disposition': `attachment; filename="${file.filename}"`, 'cache-control': 'no-store' })
      .send(file.body);
  }
}
