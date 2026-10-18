import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission, Role } from '@agmeo/contracts';
import type { Request } from 'express';

export interface AuthUser {
  userId: string;
  subject: string;
  email: string;
}

/** Request context of an organization-scoped route. */
export interface Ctx {
  userId: string;
  orgId: string;
  role: Role;
  /** A background job acting for the organization without a user (`userId` is empty). */
  system?: true;
}

/**
 * Context of a background job for one organization. Only the agmeo_recommender database
 * role may use it: app.org_id() accepts an organization without a user for that role alone.
 */
export function systemCtx(orgId: string): Ctx {
  return { userId: '', orgId, role: 'viewer', system: true };
}

export type AuthedRequest = Request & { user?: AuthUser; ctx?: Ctx };

export const PUBLIC_ROUTE = 'agmeo:public';
export const REQUIRED_PERMISSION = 'agmeo:permission';

/** Skip authentication (health checks, development sign-in). */
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);

/** Require a permission in the organization named by the `:orgId` route parameter. */
export const Requires = (permission: Permission) => SetMetadata(REQUIRED_PERMISSION, permission);

export const CurrentUser = createParamDecorator((_: unknown, host: ExecutionContext) => {
  return host.switchToHttp().getRequest<AuthedRequest>().user!;
});

export const OrgCtx = createParamDecorator((_: unknown, host: ExecutionContext) => {
  const ctx = host.switchToHttp().getRequest<AuthedRequest>().ctx;
  if (!ctx) throw new Error('OrgCtx used on a route without an :orgId parameter');
  return ctx;
});
