import { Controller, Get, Post, Res } from '@nestjs/common';
import { BulkVraInput, VraBatchExportInput, VraListQuery } from '@agmeo/contracts';
import type { Response } from 'express';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { type Out, ZBody, ZQuery } from '../../core/validation.js';
import { VraService } from './vra.service.js';

/** Application maps of the whole organization: the list, bulk creation and batch export. */
@Controller('orgs/:orgId/vra-maps')
export class VraOrgController {
  constructor(private readonly vra: VraService) {}

  @Get()
  list(@OrgCtx() ctx: Ctx, @ZQuery(VraListQuery) query: Out<typeof VraListQuery>) {
    return this.vra.listOrg(ctx, query);
  }

  @Post('bulk')
  @Requires('field.write')
  bulk(@OrgCtx() ctx: Ctx, @ZBody(BulkVraInput) input: Out<typeof BulkVraInput>) {
    return this.vra.bulk(ctx, input);
  }

  /** One ZIP with the prescriptions of several maps. */
  @Post('export')
  async export(@OrgCtx() ctx: Ctx, @ZBody(VraBatchExportInput) input: Out<typeof VraBatchExportInput>, @Res() res: Response) {
    const file = await this.vra.exportBatch(ctx, input.mapIds, input.format);
    res
      .status(200)
      .set({ 'content-type': file.contentType, 'content-disposition': `attachment; filename="${file.filename}"`, 'cache-control': 'no-store' })
      .send(file.body);
  }
}
