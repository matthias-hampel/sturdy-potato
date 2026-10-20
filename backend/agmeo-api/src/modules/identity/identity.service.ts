import { Injectable } from '@nestjs/common';
import type {
  AuditEvent,
  CreateOrganizationInput,
  CurrentUser,
  InviteMemberInput,
  MeasurementSetting,
  Member,
  OnboardingStep,
  Organization,
  Role,
  UpdateMemberInput,
  UpdateOrganizationInput,
  UpdateProfileInput,
} from '@agmeo/contracts';
import { resolveMeasurementSystem } from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';
import { diff, record } from '../../core/events.js';
import { iso } from '../../core/mappers.js';
import type { Out } from '../../core/validation.js';
import { config } from '../../config.js';
import { Database, type Trx } from '../../db/database.js';
import { queueEmail } from '../../mail/mail.js';

@Injectable()
export class IdentityService {
  constructor(private readonly db: Database) {}

  me(userId: string): Promise<CurrentUser> {
    return this.db.run({ userId }, async (trx) => {
      const user = await trx
        .selectFrom('users')
        .select(['id', 'email', 'display_name', 'locale'])
        .where('id', '=', userId)
        .executeTakeFirstOrThrow();
      return {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        locale: user.locale === 'de' ? 'de' : null,
        organizations: await this.organizations(trx, userId),
      };
    });
  }

  async updateProfile(userId: string, input: Out<typeof UpdateProfileInput>): Promise<CurrentUser> {
    await this.db.run({ userId }, (trx) =>
      trx.updateTable('users').set({ display_name: input.displayName, locale: input.locale }).where('id', '=', userId).execute(),
    );
    return this.me(userId);
  }

  private async organizations(trx: Trx, userId: string): Promise<Organization[]> {
    const rows = await trx
      .selectFrom('organizations as o')
      .innerJoin('memberships as m', (j) => j.onRef('m.organization_id', '=', 'o.id').on('m.user_id', '=', userId))
      .select([
        'o.id',
        'o.name',
        'o.country',
        'o.currency',
        'o.crop_year_start_month',
        'o.measurement_setting',
        'o.status',
        'o.created_at',
        'o.onboarding_step',
        'o.rain_digest_enabled',
        'o.lock_zoned_fields',
        'o.logo_updated_at',
        'm.role',
        'm.restricted_to_farms',
      ])
      .where('m.status', '=', 'active')
      .orderBy('o.name')
      .execute();
    const limits = await trx.selectFrom('membership_farms').select(['organization_id', 'farm_id']).where('user_id', '=', userId).execute();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      country: r.country,
      currency: r.currency,
      cropYearStartMonth: r.crop_year_start_month,
      measurementSetting: r.measurement_setting as MeasurementSetting,
      measurementSystem: resolveMeasurementSystem(r.measurement_setting as MeasurementSetting, r.country),
      status: r.status as Organization['status'],
      role: r.role as Role,
      farmIds: r.restricted_to_farms ? limits.filter((l) => l.organization_id === r.id).map((l) => l.farm_id) : null,
      onboardingStep: (r.onboarding_step as OnboardingStep | null) ?? null,
      rainDigestEnabled: r.rain_digest_enabled,
      lockZonedFields: r.lock_zoned_fields,
      logoUpdatedAt: iso(r.logo_updated_at),
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
        measurement_setting: input.measurementSetting,
        onboarding_step: input.onboardingStep,
        rain_digest_enabled: input.rainDigestEnabled,
        lock_zoned_fields: input.lockZonedFields,
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
        .select(['u.id', 'u.email', 'u.display_name', 'u.last_login_at', 'm.role', 'm.status', 'm.created_at', 'm.restricted_to_farms'])
        .where('m.organization_id', '=', ctx.orgId)
        .orderBy('u.display_name')
        .execute();
      const limits = await trx.selectFrom('membership_farms').select(['user_id', 'farm_id']).where('organization_id', '=', ctx.orgId).execute();
      return rows.map((r) => ({
        userId: r.id,
        email: r.email,
        displayName: r.display_name,
        role: r.role as Role,
        status: r.status as Member['status'],
        farmIds: r.restricted_to_farms ? limits.filter((l) => l.user_id === r.id).map((l) => l.farm_id) : null,
        lastLoginAt: iso(r.last_login_at),
        createdAt: iso(r.created_at),
      }));
    });
  }

  inviteMember(ctx: Ctx, input: Out<typeof InviteMemberInput>): Promise<Member[]> {
    if (input.role === 'owner' && ctx.role !== 'owner') throw forbidden('Only owners can add owners');
    return this.db
      .run(ctx, async (trx) => {
        const displayName = input.displayName ?? input.email.split('@')[0];
        const farmIds = await this.checkFarmLimit(trx, input.role, input.farmIds ?? null);
        const { rows } = await sql<{ id: string }>`SELECT app.ensure_user(${input.email}, ${displayName}) AS id`.execute(trx);
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
            restricted_to_farms: farmIds !== null,
          })
          .execute();
        await this.writeFarmLimit(trx, ctx, userId, farmIds);
        await record(trx, ctx, {
          entityType: 'membership',
          entityId: userId,
          action: 'invited',
          changes: { email: input.email, role: input.role, farmIds },
          event: { type: 'membership.invited', payload: { userId, email: input.email, role: input.role } },
        });
        const [org, inviter] = await Promise.all([
          trx.selectFrom('organizations').select('name').where('id', '=', ctx.orgId).executeTakeFirstOrThrow(),
          trx.selectFrom('users').select('display_name').where('id', '=', ctx.userId).executeTakeFirstOrThrow(),
        ]);
        await queueEmail(trx, {
          to: input.email,
          template: 'invitation',
          organizationId: ctx.orgId,
          params: { orgName: org.name, inviterName: inviter.display_name, role: input.role, acceptUrl: `${config.appUrl}/login?invited=1` },
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
        const role = (input.role ?? current.role) as Role;
        // Owners always see every farm; becoming owner lifts a limit.
        const farmIds = input.farmIds !== undefined ? await this.checkFarmLimit(trx, role, input.farmIds) : role === 'owner' ? null : undefined;
        await trx
          .updateTable('memberships')
          .set({ role: input.role, status: input.status, restricted_to_farms: farmIds === undefined ? undefined : farmIds !== null })
          .where('organization_id', '=', ctx.orgId)
          .where('user_id', '=', userId)
          .execute();
        if (farmIds !== undefined) await this.writeFarmLimit(trx, ctx, userId, farmIds);
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

  /**
   * Validates the farms a member is to be limited to (null = every farm). Owners are never
   * limited, and a member who is limited themselves can only hand out farms they see.
   */
  private async checkFarmLimit(trx: Trx, role: Role, farmIds: string[] | null): Promise<string[] | null> {
    const { rows } = await sql<{ ids: string[] | null }>`SELECT app.allowed_farm_ids() AS ids`.execute(trx);
    const actorLimited = rows[0]?.ids != null;
    if (farmIds === null) {
      if (actorLimited) throw forbidden('You can only give access to the farms you can see yourself');
      return null;
    }
    if (role === 'owner') throw badRequest('owner_not_limited', 'Owners always have access to every farm');
    const unique = [...new Set(farmIds)];
    if (unique.length) {
      // Reads through the row policies: farms of other organizations or beyond the actor's own limit are not found.
      const visible = await trx.selectFrom('farms').select('id').where('id', 'in', unique).execute();
      if (visible.length !== unique.length) throw badRequest('unknown_farm', 'One of the farms does not exist in this organization');
    }
    return unique;
  }

  private async writeFarmLimit(trx: Trx, ctx: Ctx, userId: string, farmIds: string[] | null) {
    await trx.deleteFrom('membership_farms').where('organization_id', '=', ctx.orgId).where('user_id', '=', userId).execute();
    if (farmIds?.length) {
      await trx
        .insertInto('membership_farms')
        .values(farmIds.map((farmId) => ({ organization_id: ctx.orgId, user_id: userId, farm_id: farmId })))
        .execute();
    }
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
