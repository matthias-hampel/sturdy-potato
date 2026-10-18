import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { can, type Permission, type Role } from '@agmeo/contracts';
import { sql } from 'kysely';
import { DomainError, forbidden } from '../core/errors.js';
import { Database } from '../db/database.js';
import { type AuthedRequest, PUBLIC_ROUTE, REQUIRED_PERMISSION } from './context.js';
import { TokenService } from './token.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Authenticates the bearer token and resolves the internal user (JIT-provisioned). */
@Injectable()
export class AuthGuard implements CanActivate {
  // subject → user id; sign-in is idempotent, so a stale entry is harmless.
  private readonly users = new Map<string, string>();

  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new DomainError(401, 'unauthenticated', 'Sign in required');

    let claims;
    try {
      claims = await this.tokens.verify(token);
    } catch {
      throw new DomainError(401, 'invalid_token', 'Session expired or invalid; please sign in again');
    }

    let userId = this.users.get(claims.subject);
    if (!userId) {
      const row = await sql<{ id: string }>`SELECT app.sign_in(${claims.subject}, ${claims.email}, ${claims.name}) AS id`
        .execute(this.db.kysely);
      userId = row.rows[0].id;
      this.users.set(claims.subject, userId);
    }
    req.user = { userId, subject: claims.subject, email: claims.email };
    return true;
  }
}

/**
 * For routes with an `:orgId` parameter: verifies membership, loads the role and enforces
 * `@Requires(permission)`. Row-level security enforces the tenant boundary independently.
 */
@Injectable()
export class OrgGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const orgId = req.params?.orgId;
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(REQUIRED_PERMISSION, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!orgId || !req.user) {
      if (permission) throw new Error('@Requires used on a route without an :orgId parameter');
      return true;
    }
    if (typeof orgId !== 'string' || !UUID.test(orgId)) throw new DomainError(404, 'not_found', 'Organization not found');

    const membership = await this.db.run({ userId: req.user.userId, orgId }, (trx) =>
      trx
        .selectFrom('memberships')
        .select('role')
        .where('organization_id', '=', orgId)
        .where('user_id', '=', req.user!.userId)
        .where('status', '=', 'active')
        .executeTakeFirst(),
    );
    // Same response for "does not exist" and "not a member": no tenant enumeration.
    if (!membership) throw new DomainError(404, 'not_found', 'Organization not found');

    const role = membership.role as Role;
    if (permission && !can(role, permission)) throw forbidden();
    req.ctx = { userId: req.user.userId, orgId, role };
    return true;
  }
}
