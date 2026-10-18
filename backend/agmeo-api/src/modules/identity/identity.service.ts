import { Injectable } from '@nestjs/common';
import type {
  AuditEvent,
  CreateOrganizationInput,
  CurrentUser,
  InviteMemberInput,
  Member,
  Organization,
  Role,
  UpdateMemberInput,
  UpdateOrganizationInput,
} from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';
import { diff, record } from '../../core/events.js';
import { iso } from '../../core/mappers.js';
import type { Out } from '../../core/validation.js';
import { Database, type Trx } from '../../db/database.js';

@Injectable()
export class IdentityService {
  constructor(private readonly db: Database) {}

  me(userId: string): Promise<CurrentUser> {
    return this.db.run({ userId }, async (trx) => {
      const user = await trx
        .selectFrom('users')
        .select(['id', 'email', 'display_name'])
        .where('id', '=', userId)
        .executeTakeFirstOrThrow();
      return { id: user.id, email: user.email, displayName: user.display_name, organizations: await this.organizations(trx, userId) };
    });
  }

  private async organizations(trx: Trx, userId: string): Promise<Organization[]> {
    const rows = await trx
      .selectFrom('organizations as o')
      .innerJoin('memberships as m', (j) => j.onRef('m.organization_id', '=', 'o.id').on('m.user_id', '=', userId))
      .select(['o.id', 'o.name', 'o.country', 'o.currency', 'o.crop_year_start_month', 'o.status', 'o.created_at', 'm.role'])
      .where('m.status', '=', 'active')
      .orderBy('o.name')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      country: r.country,
      currency: r.currency,
      cropYearStartMonth: r.crop_year_start_month,
      status: r.status as Organization['status'],
      role: r.role as Role,
      createdAt: iso(r.created_at),
    }));
  }

  createOrganization(userId: string, input: Out<typeof CreateOrganizationInput>): Promise<Organization> {
    return this.db.run({ userId }, async (trx) => {
      const { rows } = await sql<{ id: string }>`
        SELECT app.create_organization(${input.name}, ${input.country}, ${input.currency}) AS id`.execute(trx);
      const orgId = rows[0].id;
      await sql`SELECT set_config('app.organization_id', ${orgId}, true)`.execute(trx);
      await record(trx, { userId, orgId, role: 'owner' }, {
        entityType: 'organization',
        entityId: orgId,
        action: 'created',
        changes: { name: input.name },
        event: { type: 'organization.created', payload: { name: input.name } },
      });
      const orgs = await this.organizations(trx, userId);
      return orgs.find((o) => o.id === orgId)!;
    });
  }

  getOrganization(ctx: Ctx): Promise<Organization> {
    return this.db.run(ctx, async (trx) => {
      const org = (await this.organizations(trx, ctx.userId)).find((o) => o.id === ctx.orgId);
      if (!org) throw notFound('Organization');
      return org;
    });
  }

  updateOrganization(ctx: Ctx, input: Out<typeof UpdateOrganizationInput>): Promise<Organization> {
    return this.db.run(ctx, async (trx) => {
      const before = await trx.selectFrom('organizations').selectAll().where('id', '=', ctx.orgId).executeTakeFirstOrThrow();
      const values = {
        name: input.name,
        country: input.country,
        currency: input.currency,
        crop_year_start_month: input.cropYearStartMonth,
      };
      await trx.updateTable('organizations').set(values).where('id', '=', ctx.orgId).execute();
      await record(trx, ctx, { entityType: 'organization', entityId: ctx.orgId, action: 'updated', changes: diff(before, values) });
      return (await this.organizations(trx, ctx.userId)).find((o) => o.id === ctx.orgId)!;
    });
  }

  members(ctx: Ctx): Promise<Member[]> {
    return this.db.run(ctx, async (trx) => {
      const rows = await trx
        .selectFrom('memberships as m')
        .innerJoin('users as u', 'u.id', 'm.user_id')
        .select(['u.id', 'u.email', 'u.display_name', 'u.last_login_at', 'm.role', 'm.status', 'm.created_at'])
        .where('m.organization_id', '=', ctx.orgId)
        .orderBy('u.display_name')
        .execute();
      return rows.map((r) => ({
        userId: r.id,
        email: r.email,
        displayName: r.display_name,
        role: r.role as Role,
        status: r.status as Member['status'],
        lastLoginAt: iso(r.last_login_at),
        createdAt: iso(r.created_at),
      }));
    });
  }

  inviteMember(ctx: Ctx, input: Out<typeof InviteMemberInput>): Promise<Member[]> {
    if (input.role === 'owner' && ctx.role !== 'owner') throw forbidden('Only owners can add owners');
    return this.db
      .run(ctx, async (trx) => {
        const { rows } = await sql<{ id: string }>`SELECT app.ensure_user(${input.email}, ${input.displayName}) AS id`.execute(trx);
        const userId = rows[0].id;
        const existing = await trx
          .selectFrom('memberships')
          .select('status')
          .where('organization_id', '=', ctx.orgId)
          .where('user_id', '=', userId)
          .executeTakeFirst();
        if (existing) throw conflict('already_member', `${input.email} is already a member of this organization`);
        // Users who have signed in before become active immediately; others on first sign-in.
        const user = await trx.selectFrom('users').select('auth_subject').where('id', '=', userId).executeTakeFirst();
        await trx
          .insertInto('memberships')
          .values({
            organization_id: ctx.orgId,
            user_id: userId,
            role: input.role,
            status: user?.auth_subject ? 'active' : 'invited',
            invited_by: ctx.userId,
          })
          .execute();
        await record(trx, ctx, {
          entityType: 'membership',
          entityId: userId,
          action: 'invited',
          changes: { email: input.email, role: input.role },
          event: { type: 'membership.invited', payload: { userId, email: input.email, role: input.role } },
        });
      })
      .then(() => this.members(ctx));
  }

  updateMember(ctx: Ctx, userId: string, input: Out<typeof UpdateMemberInput>): Promise<Member[]> {
    return this.db
      .run(ctx, async (trx) => {
        const current = await trx
          .selectFrom('memberships')
          .select(['role', 'status'])
          .where('organization_id', '=', ctx.orgId)
          .where('user_id', '=', userId)
          .executeTakeFirst();
        if (!current) throw notFound('Member');
        if ((current.role === 'owner' || input.role === 'owner') && ctx.role !== 'owner') {
          throw forbidden('Only owners can change owner memberships');
        }
        if (current.role === 'owner' && (input.role && input.role !== 'owner' || input.status === 'disabled')) {
          await this.assertAnotherOwner(trx, ctx, userId);
        }
        await trx
          .updateTable('memberships')
          .set({ role: input.role, status: input.status })
          .where('organization_id', '=', ctx.orgId)
          .where('user_id', '=', userId)
          .execute();
        await record(trx, ctx, { entityType: 'membership', entityId: userId, action: 'updated', changes: diff(current, input) });
      })
      .then(() => this.members(ctx));
  }

  removeMember(ctx: Ctx, userId: string): Promise<Member[]> {
    return this.db
      .run(ctx, async (trx) => {
        const current = await trx
          .selectFrom('memberships')
          .select('role')
          .where('organization_id', '=', ctx.orgId)
          .where('user_id', '=', userId)
          .executeTakeFirst();
        if (!current) throw notFound('Member');
        if (current.role === 'owner') {
          if (ctx.role !== 'owner') throw forbidden('Only owners can remove owners');
          await this.assertAnotherOwner(trx, ctx, userId);
        }
        await trx.deleteFrom('memberships').where('organization_id', '=', ctx.orgId).where('user_id', '=', userId).execute();
        await record(trx, ctx, { entityType: 'membership', entityId: userId, action: 'removed' });
      })
      .then(() => this.members(ctx));
  }

  private async assertAnotherOwner(trx: Trx, ctx: Ctx, userId: string) {
    const others = await trx
      .selectFrom('memberships')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('organization_id', '=', ctx.orgId)
      .where('role', '=', 'owner')
      .where('status', '=', 'active')
      .where('user_id', '<>', userId)
      .executeTakeFirstOrThrow();
    if (others.n === 0) throw badRequest('last_owner', 'An organization needs at least one active owner');
  }

  auditTrail(ctx: Ctx, entityType: string, entityId: string): Promise<AuditEvent[]> {
    return this.db.run(ctx, async (trx) => {
      const rows = await trx
        .selectFrom('audit_events as a')
        .leftJoin('users as u', 'u.id', 'a.actor_user_id')
        .select(['a.id', 'a.entity_type', 'a.entity_id', 'a.action', 'a.changes', 'a.created_at', 'u.display_name'])
        .where('a.entity_type', '=', entityType)
        .where('a.entity_id', '=', entityId)
        .orderBy('a.created_at', 'desc')
        .limit(200)
        .execute();
      return rows.map((r) => ({
        id: String(r.id),
        entityType: r.entity_type,
        entityId: r.entity_id,
        action: r.action,
        actorName: r.display_name,
        changes: r.changes as Record<string, unknown>,
        createdAt: iso(r.created_at),
      }));
    });
  }
}
