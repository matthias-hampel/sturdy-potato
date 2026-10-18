import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { type Ctx, OrgCtx } from '../../auth/context.js';
import { ComplianceService } from './compliance.service.js';

@Controller('orgs/:orgId/compliance')
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  @Get('report')
  report(@OrgCtx() ctx: Ctx, @Query('seasonId') seasonId?: string) {
    return this.compliance.report(ctx, seasonId);
  }

  @Get('application-records.csv')
  async export(@OrgCtx() ctx: Ctx, @Res() res: Response, @Query('seasonId') seasonId?: string) {
    const { filename, csv } = await this.compliance.applicationRecordsCsv(ctx, seasonId);
    res
      .status(200)
      .set({ 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${filename}"` })
      // BOM so spreadsheet applications detect UTF-8 (umlauts in field and product names).
      .send('﻿' + csv);
  }
}
