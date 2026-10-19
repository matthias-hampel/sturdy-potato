import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { BulkOperationMetaInput, OperationBoardQuery, OperationMetaInput, SetOperationStatusInput } from '@agmeo/contracts';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { type Out, ZBody, ZQuery } from '../../core/validation.js';
import { BoardService } from './board.service.js';

/** The task board: operations by status, with board metadata (priority, due date, assignee). */
@Controller('orgs/:orgId/board')
export class BoardController {
  constructor(private readonly board: BoardService) {}

  @Get()
  get(@OrgCtx() ctx: Ctx, @ZQuery(OperationBoardQuery) query: Out<typeof OperationBoardQuery>) {
    return this.board.board(ctx, query);
  }

  @Post('meta')
  @HttpCode(200)
  @Requires('task.write')
  bulkMeta(@OrgCtx() ctx: Ctx, @ZBody(BulkOperationMetaInput) input: Out<typeof BulkOperationMetaInput>) {
    return this.board.bulkMeta(ctx, input);
  }

  @Patch(':id')
  @Requires('task.write')
  updateMeta(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(OperationMetaInput) input: Out<typeof OperationMetaInput>) {
    return this.board.updateMeta(ctx, id, input);
  }

  @Post(':id/status')
  @HttpCode(200)
  @Requires('operation.write')
  setStatus(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(SetOperationStatusInput) input: Out<typeof SetOperationStatusInput>) {
    return this.board.setStatus(ctx, id, input);
  }
}
