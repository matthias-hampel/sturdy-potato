import { Controller, Get, Query } from '@nestjs/common';
import { type Ctx, OrgCtx } from '../../auth/context.js';
import { DashboardService } from './dashboard.service.js';

@Controller('orgs/:orgId/dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  get(@OrgCtx() ctx: Ctx, @Query('seasonId') seasonId?: string) {
    return this.dashboard.get(ctx, seasonId);
  }
}
