import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { CancelOperationInput, CompleteOperationInput, OperationInput, OperationListQuery, ReopenOperationInput } from '@agmeo/contracts';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { type Out, ZBody, ZQuery } from '../../core/validation.js';
import { OperationsService } from './operations.service.js';

@Controller('orgs/:orgId/operations')
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get()
  list(@OrgCtx() ctx: Ctx, @ZQuery(OperationListQuery) query: Out<typeof OperationListQuery>) {
    return this.operations.list(ctx, query);
  }

  @Get(':id')
  get(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.operations.get(ctx, id);
  }

  @Post()
  @Requires('operation.write')
  create(@OrgCtx() ctx: Ctx, @ZBody(OperationInput) input: Out<typeof OperationInput>) {
    return this.operations.create(ctx, input);
  }

  @Put(':id')
  @Requires('operation.write')
  update(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(OperationInput) input: Out<typeof OperationInput>) {
    return this.operations.update(ctx, id, input);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @Requires('operation.write')
  complete(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(CompleteOperationInput) input: Out<typeof CompleteOperationInput>) {
    return this.operations.complete(ctx, id, input);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  @Requires('operation.write')
  reopen(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(ReopenOperationInput) input: Out<typeof ReopenOperationInput>) {
    return this.operations.reopen(ctx, id, input);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Requires('operation.write')
  cancel(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(CancelOperationInput) input: Out<typeof CancelOperationInput>) {
    return this.operations.cancel(ctx, id, input);
  }

  @Delete(':id')
  @HttpCode(204)
  @Requires('operation.write')
  delete(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.operations.delete(ctx, id);
  }
}
