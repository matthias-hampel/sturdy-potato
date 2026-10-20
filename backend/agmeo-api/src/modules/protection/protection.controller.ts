import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { type Ctx, OrgCtx } from '../../auth/context.js';
import { ProtectionService } from './protection.service.js';

@Controller('orgs/:orgId')
export class ProtectionController {
  constructor(private readonly protection: ProtectionService) {}

  /** Approval findings of all plant-protection operations of a season. */
  @Get('protection/checks')
  seasonChecks(@OrgCtx() ctx: Ctx, @Query('seasonId', ParseUUIDPipe) seasonId: string) {
    return this.protection.seasonChecks(ctx, seasonId);
  }

  /** Approval, approved use and Auflagen of a plant-protection product. */
  @Get('products/:id/psm-info')
  productInfo(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Query('awgId') awgId?: string) {
    return this.protection.productInfo(ctx, id, awgId || undefined);
  }

  @Get('operations/:id/checks')
  checks(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.protection.operationChecks(ctx, id);
  }
}
