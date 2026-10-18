import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { FarmInput } from '@agmeo/contracts';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { type Out, ZBody } from '../../core/validation.js';
import { FarmsService } from './farms.service.js';

@Controller('orgs/:orgId/farms')
export class FarmsController {
  constructor(private readonly farms: FarmsService) {}

  @Get()
  list(@OrgCtx() ctx: Ctx, @Query('includeArchived') includeArchived?: string) {
    return this.farms.list(ctx, includeArchived === 'true');
  }

  @Get(':id')
  get(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.farms.get(ctx, id);
  }

  @Post()
  @Requires('farm.write')
  create(@OrgCtx() ctx: Ctx, @ZBody(FarmInput) input: Out<typeof FarmInput>) {
    return this.farms.create(ctx, input);
  }

  @Put(':id')
  @Requires('farm.write')
  update(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(FarmInput) input: Out<typeof FarmInput>) {
    return this.farms.update(ctx, id, input);
  }

  @Post(':id/archive')
  @Requires('farm.write')
  archive(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.farms.setArchived(ctx, id, true);
  }

  @Post(':id/restore')
  @Requires('farm.write')
  restore(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.farms.setArchived(ctx, id, false);
  }

  @Delete(':id')
  @HttpCode(204)
  @Requires('farm.write')
  delete(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.farms.delete(ctx, id);
  }
}
