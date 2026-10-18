import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CommentInput, CommentQuery, UpdateCommentInput } from '@agmeo/contracts';
import { type Ctx, OrgCtx } from '../../auth/context.js';
import { type Out, ZBody, ZQuery } from '../../core/validation.js';
import { CommentsService } from './comments.service.js';

@Controller('orgs/:orgId/comments')
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get()
  list(@OrgCtx() ctx: Ctx, @ZQuery(CommentQuery) query: Out<typeof CommentQuery>) {
    return this.comments.list(ctx, query);
  }

  @Post()
  create(@OrgCtx() ctx: Ctx, @ZBody(CommentInput) input: Out<typeof CommentInput>) {
    return this.comments.create(ctx, input);
  }

  @Patch(':id')
  update(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(UpdateCommentInput) input: Out<typeof UpdateCommentInput>) {
    return this.comments.update(ctx, id, input);
  }

  @Delete(':id')
  @HttpCode(204)
  delete(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.comments.delete(ctx, id);
  }
}
