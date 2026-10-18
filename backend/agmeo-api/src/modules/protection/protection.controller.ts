import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { type Ctx, OrgCtx } from '../../auth/context.js';
import { ProtectionService } from './protection.service.js';

@Controller('orgs/:orgId')
export class ProtectionController {
  constructor(private readonly protection: ProtectionService) {}

  @Get('operations/:id/checks')
  checks(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.protection.operationChecks(ctx, id);
  }
}
