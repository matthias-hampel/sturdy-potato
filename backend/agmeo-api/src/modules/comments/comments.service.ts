import { Injectable } from '@nestjs/common';
import { can, type Comment, type CommentInput, type CommentQuery, type CommentTarget, type UpdateCommentInput } from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { forbidden, notFound } from '../../core/errors.js';
import { record } from '../../core/events.js';
import { iso } from '../../core/mappers.js';
import type { Out } from '../../core/validation.js';
import { Database, type Trx } from '../../db/database.js';

/**
 * Comments on operations and tasks. Anyone who can see the item can comment; authors edit
 * and delete their own comments, managers may delete any.
 */
@Injectable()
export class CommentsService {
  constructor(private readonly db: Database) {}

  list(ctx: Ctx, q: Out<typeof CommentQuery>): Promise<Comment[]> {
    return this.db.run(ctx, async (trx) => {
      await this.assertTarget(trx, q.entityType, q.entityId);
      return this.rows(trx, ctx, q.entityType, q.entityId);
    });
  }

  /** Adds a comment; posting the same client id again returns the existing comment. */
  create(ctx: Ctx, input: Out<typeof CommentInput>): Promise<Comment> {
    return this.db.run(ctx, async (trx) => {
      await this.assertTarget(trx, input.entityType, input.entityId);
      if (input.id) {
        const existing = await trx.selectFrom('comments').select('id').where('id', '=', input.id).executeTakeFirst();
        if (existing) return (await this.rows(trx, ctx, input.entityType, input.entityId)).find((c) => c.id === input.id)!;
      }
      const author = await trx.selectFrom('users').select('display_name').where('id', '=', ctx.userId).executeTakeFirstOrThrow();
      const row = await trx
        .insertInto('comments')
        .values({
          ...(input.id ? { id: input.id } : {}),
          organization_id: ctx.orgId,
          entity_type: input.entityType,
          entity_id: input.entityId,
          author_user_id: ctx.userId,
          author_name: author.display_name,
          body: input.body,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.touch(trx, input.entityType, input.entityId);
      await record(trx, ctx, {
        entityType: input.entityType,
        entityId: input.entityId,
        action: 'commented',
        event: { type: 'comment.created', payload: { commentId: row.id, entityType: input.entityType, entityId: input.entityId } },
      });
      return (await this.rows(trx, ctx, input.entityType, input.entityId)).find((c) => c.id === row.id)!;
    });
  }

  update(ctx: Ctx, id: string, input: Out<typeof UpdateCommentInput>): Promise<Comment> {
    return this.db.run(ctx, async (trx) => {
      const c = await this.own(trx, ctx, id, false);
      await trx.updateTable('comments').set({ body: input.body, edited_at: sql<Date>`now()` }).where('id', '=', id).execute();
      return (await this.rows(trx, ctx, c.entity_type as CommentTarget, c.entity_id)).find((x) => x.id === id)!;
    });
  }

  delete(ctx: Ctx, id: string): Promise<void> {
    return this.db.run(ctx, async (trx) => {
      const c = await this.own(trx, ctx, id, true);
      await trx.updateTable('comments').set({ deleted_at: sql<Date>`now()` }).where('id', '=', id).execute();
      await this.touch(trx, c.entity_type as CommentTarget, c.entity_id);
    });
  }

  private async own(trx: Trx, ctx: Ctx, id: string, managersToo: boolean) {
    const c = await trx.selectFrom('comments').selectAll().where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    if (!c) throw notFound('Comment');
    if (c.author_user_id !== ctx.userId && !(managersToo && can(ctx.role, 'members.manage'))) throw forbidden('Only the author can change this comment');
    return c;
  }

  private async rows(trx: Trx, ctx: Ctx, type: CommentTarget, entityId: string): Promise<Comment[]> {
    const rows = await trx
      .selectFrom('comments')
      .selectAll()
      .where('entity_type', '=', type)
      .where('entity_id', '=', entityId)
      .where('deleted_at', 'is', null)
      .orderBy('created_at')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      entityType: r.entity_type as CommentTarget,
      entityId: r.entity_id,
      authorUserId: r.author_user_id,
      authorName: r.author_name,
      body: r.body,
      createdAt: iso(r.created_at),
      editedAt: iso(r.edited_at),
      mine: r.author_user_id === ctx.userId,
    }));
  }

  private async assertTarget(trx: Trx, type: CommentTarget, id: string) {
    const found =
      type === 'operation'
        ? await trx.selectFrom('operations').select('id').where('id', '=', id).executeTakeFirst()
        : await trx.selectFrom('tasks').select('id').where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    if (!found) throw notFound(type === 'operation' ? 'Operation' : 'Task');
  }

  /** A comment counts as a change of its task, so syncing clients pick it up. */
  private async touch(trx: Trx, type: CommentTarget, id: string) {
    if (type === 'task') await trx.updateTable('tasks').set({ updated_at: sql<Date>`now()` }).where('id', '=', id).execute();
  }
}
