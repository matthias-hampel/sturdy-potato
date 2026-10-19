import { Injectable } from '@nestjs/common';
import type { FieldGroup, FieldGroupInput, FieldGroupMembersInput } from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { badRequest, notFound } from '../../core/errors.js';
import { record } from '../../core/events.js';
import type { Out } from '../../core/validation.js';
import { Database, type Trx } from '../../db/database.js';

const PALETTE = ['#2e86ab', '#e4572e', '#76b041', '#f2a541', '#9c51b6', '#17bebb', '#e83f6f', '#5c6b73'];

/** Field groups: named, coloured tags (management groups) a field can carry any number of. */
@Injectable()
export class FieldGroupsService {
  constructor(private readonly db: Database) {}

  list(ctx: Ctx): Promise<FieldGroup[]> {
    return this.db.run(ctx, (trx) => this.listIn(trx));
  }

  private async listIn(trx: Trx): Promise<FieldGroup[]> {
    const rows = await trx
      .selectFrom('field_groups as g')
      .select(['g.id', 'g.name', 'g.color'])
      .select((eb) => eb.selectFrom('field_group_members as m').select(sql<number>`count(*)::int`.as('n')).whereRef('m.group_id', '=', 'g.id').as('field_count'))
      .orderBy('g.name')
      .execute();
    return rows.map((r) => ({ id: r.id, name: r.name, color: r.color, fieldCount: r.field_count ?? 0 }));
  }

  create(ctx: Ctx, input: Out<typeof FieldGroupInput>): Promise<FieldGroup> {
    return this.db.run(ctx, async (trx) => {
      const id = await this.ensure(trx, ctx, input.name, input.color);
      return (await this.listIn(trx)).find((g) => g.id === id)!;
    });
  }

  update(ctx: Ctx, id: string, input: Partial<Out<typeof FieldGroupInput>>): Promise<FieldGroup> {
    return this.db.run(ctx, async (trx) => {
      const row = await trx.updateTable('field_groups').set({ name: input.name, color: input.color }).where('id', '=', id).returning('id').executeTakeFirst();
      if (!row) throw notFound('Field group');
      await record(trx, ctx, { entityType: 'field_group', entityId: id, action: 'updated', changes: input });
      return (await this.listIn(trx)).find((g) => g.id === id)!;
    });
  }

  delete(ctx: Ctx, id: string): Promise<void> {
    return this.db.run(ctx, async (trx) => {
      const row = await trx.deleteFrom('field_groups').where('id', '=', id).returning('name').executeTakeFirst();
      if (!row) throw notFound('Field group');
      await record(trx, ctx, { entityType: 'field_group', entityId: id, action: 'deleted', changes: { name: row.name } });
    });
  }

  /** Adds fields to a group, creating the group by name when needed. */
  addMembers(ctx: Ctx, input: Out<typeof FieldGroupMembersInput>): Promise<FieldGroup[]> {
    return this.db.run(ctx, async (trx) => {
      const groupId = input.groupId ?? (input.groupName ? await this.ensure(trx, ctx, input.groupName) : null);
      if (!groupId) throw badRequest('group_required', 'Name a group or choose one');
      const group = await trx.selectFrom('field_groups').select('id').where('id', '=', groupId).executeTakeFirst();
      if (!group) throw notFound('Field group');
      const fields = await trx.selectFrom('fields').select('id').where('id', 'in', input.fieldIds).execute();
      if (fields.length) {
        await trx
          .insertInto('field_group_members')
          .values(fields.map((f) => ({ organization_id: ctx.orgId, group_id: groupId, field_id: f.id })))
          .onConflict((oc) => oc.doNothing())
          .execute();
      }
      return this.listIn(trx);
    });
  }

  removeMembers(ctx: Ctx, input: Out<typeof FieldGroupMembersInput>): Promise<FieldGroup[]> {
    return this.db.run(ctx, async (trx) => {
      if (!input.groupId) throw badRequest('group_required', 'Choose a group');
      await trx.deleteFrom('field_group_members').where('group_id', '=', input.groupId).where('field_id', 'in', input.fieldIds).execute();
      return this.listIn(trx);
    });
  }

  private async ensure(trx: Trx, ctx: Ctx, name: string, color?: string): Promise<string> {
    const existing = await trx.selectFrom('field_groups').select('id').where(sql<boolean>`lower(name) = lower(${name.trim()})`).executeTakeFirst();
    if (existing) return existing.id;
    const count = (await trx.selectFrom('field_groups').select(sql<number>`count(*)::int`.as('n')).executeTakeFirstOrThrow()).n;
    const row = await trx
      .insertInto('field_groups')
      .values({ organization_id: ctx.orgId, name: name.trim(), color: color ?? PALETTE[count % PALETTE.length] })
      .returning('id')
      .executeTakeFirstOrThrow();
    await record(trx, ctx, { entityType: 'field_group', entityId: row.id, action: 'created', changes: { name } });
    return row.id;
  }
}
