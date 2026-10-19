import { Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { PsmAttestationsInput, PsmRecordInput } from '@agmeo/contracts';
import { type Ctx, OrgCtx, Requires } from '../../../auth/context.js';
import { badRequest } from '../../../core/errors.js';
import { type Out, ZBody } from '../../../core/validation.js';
import { PsmRecordService } from './psm-record.service.js';

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

const checkYear = (year: number) => {
  if (year < MIN_YEAR || year > MAX_YEAR) throw badRequest('invalid_year', 'Invalid year');
  return year;
};

/** The plant-protection record (EU 2023/564): readiness, the farm's certificates, the files and their history. */
@Controller('orgs/:orgId/protection')
export class PsmRecordController {
  constructor(private readonly record: PsmRecordService) {}

  @Get('attestations')
  attestations(@OrgCtx() ctx: Ctx) {
    return this.record.attestations(ctx);
  }

  @Put('attestations')
  @Requires('farm.write')
  saveAttestations(@OrgCtx() ctx: Ctx, @ZBody(PsmAttestationsInput) input: Out<typeof PsmAttestationsInput>) {
    return this.record.saveAttestations(ctx, input);
  }

  @Get('record/readiness')
  readiness(@OrgCtx() ctx: Ctx, @Query('year', ParseIntPipe) year: number) {
    return this.record.readiness(ctx, checkYear(year));
  }

  @Get('record/issues/:code')
  issueTargets(@OrgCtx() ctx: Ctx, @Param('code') code: string, @Query('year', ParseIntPipe) year: number) {
    return this.record.issueTargets(ctx, checkYear(year), code);
  }

  @Get('record/history')
  history(@OrgCtx() ctx: Ctx, @Query('year', ParseIntPipe) year: number) {
    return this.record.history(ctx, checkYear(year));
  }

  /** Generates the record, archives it in Files > Exports and returns its content for the download. */
  @Post('record')
  @HttpCode(200)
  generate(@OrgCtx() ctx: Ctx, @ZBody(PsmRecordInput) input: Out<typeof PsmRecordInput>) {
    return this.record.generate(ctx, input.year, input.format, input.includeIncomplete);
  }
}
