import { Controller, Get, Query, ParseUUIDPipe } from '@nestjs/common';
import type { CropTableConditions, CropTableEvaluation } from '@agmeo/contracts';
import { type Ctx, OrgCtx } from '../../auth/context.js';
import { FieldConditionsService } from '../weather/field-conditions.service.js';
import { CropTableService } from './crop-table.service.js';

/** Batch values of the crop table: one request per column group, not one per row. */
@Controller('orgs/:orgId/crop-table')
export class CropTableController {
  constructor(
    private readonly table: CropTableService,
    private readonly fieldConditions: FieldConditionsService,
  ) {}

  /** Weather, phenology, satellite and disease values of every crop of the season. */
  @Get('conditions')
  conditions(@OrgCtx() ctx: Ctx, @Query('seasonId', ParseUUIDPipe) seasonId: string): Promise<CropTableConditions> {
    return this.fieldConditions.seasonTable(ctx, seasonId);
  }

  /** Yield, contribution margin, CO2e and nitrogen of every crop of the season. */
  @Get('evaluation')
  evaluation(@OrgCtx() ctx: Ctx, @Query('seasonId', ParseUUIDPipe) seasonId: string): Promise<CropTableEvaluation> {
    return this.table.evaluation(ctx, seasonId);
  }
}
