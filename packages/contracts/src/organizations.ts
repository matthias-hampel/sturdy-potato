import { z } from 'zod';
import { countryCode, currencyCode, name } from './common.js';

export const ROLES = ['owner', 'manager', 'agronomist', 'worker', 'accountant', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  manager: 'Farm manager',
  agronomist: 'Agronomist',
  worker: 'Farm worker',
  accountant: 'Accountant',
  viewer: 'Viewer',
};

export const PERMISSIONS = [
  'org.manage',
  'members.manage',
  'farm.write',
  'field.write',
  'crop.write',
  'operation.write',
  'task.write',
  'inventory.write',
  'machinery.write',
  'team.write',
  'finance.read',
  'finance.write',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  manager: PERMISSIONS.filter((p) => p !== 'org.manage'),
  agronomist: ['field.write', 'crop.write', 'operation.write', 'task.write'],
  worker: ['operation.write', 'task.write'],
  accountant: ['finance.read', 'finance.write'],
  viewer: [],
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  return role != null && ROLE_PERMISSIONS[role].includes(permission);
}

export const CreateOrganizationInput = z.object({
  name,
  country: countryCode.default('DE'),
  currency: currencyCode.default('EUR'),
});
export type CreateOrganizationInput = z.infer<typeof CreateOrganizationInput>;

export const UpdateOrganizationInput = z.object({
  name: name.optional(),
  country: countryCode.optional(),
  currency: currencyCode.optional(),
  cropYearStartMonth: z.int().min(1).max(12).optional(),
});
export type UpdateOrganizationInput = z.infer<typeof UpdateOrganizationInput>;

export interface Organization {
  id: string;
  name: string;
  country: string;
  currency: string;
  cropYearStartMonth: number;
  status: 'active' | 'archived';
  role: Role;
  createdAt: string;
}

export interface Member {
  userId: string;
  email: string;
  displayName: string;
  role: Role;
  status: 'active' | 'invited' | 'disabled';
  lastLoginAt: string | null;
  createdAt: string;
}

export const InviteMemberInput = z.object({
  email: z.email().max(320),
  displayName: name,
  role: z.enum(ROLES),
});
export type InviteMemberInput = z.infer<typeof InviteMemberInput>;

export const UpdateMemberInput = z.object({
  role: z.enum(ROLES).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});
export type UpdateMemberInput = z.infer<typeof UpdateMemberInput>;

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  organizations: Organization[];
}

/** Development-only sign-in. Replaced by the OIDC flow (e.g. Keycloak) later. */
export const DevSignInInput = z.object({
  email: z.email().max(320),
  displayName: z.string().trim().min(1).max(200).optional(),
});
export type DevSignInInput = z.infer<typeof DevSignInInput>;

export interface SignInResult {
  accessToken: string;
  expiresAt: string;
  user: CurrentUser;
}

export interface AuditEvent {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  actorName: string | null;
  changes: Record<string, unknown>;
  createdAt: string;
}
