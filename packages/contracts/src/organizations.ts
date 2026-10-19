import { z } from 'zod';
import { countryCode, currencyCode, id, name } from './common.js';
import { MEASUREMENT_SETTINGS, type MeasurementSetting, type MeasurementSystem } from './units.js';

/** UI languages. The user's choice is stored on the account; new accounts follow the browser. */
/** UI languages, as in AGVOLUTION/agmeo; German and English are complete, the others fall back to English. */
export const LOCALES = ['de', 'en', 'cs', 'es', 'et', 'fr', 'lt', 'lv', 'pl', 'ro', 'uk'] as const;
export type Locale = (typeof LOCALES)[number];

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
  'files.write',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  manager: PERMISSIONS.filter((p) => p !== 'org.manage'),
  agronomist: ['field.write', 'crop.write', 'operation.write', 'task.write', 'files.write'],
  worker: ['operation.write', 'task.write', 'files.write'],
  accountant: ['finance.read', 'finance.write', 'files.write'],
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

/** Onboarding steps that come after the organization and its first farm exist. */
export const ONBOARDING_STEPS = ['crops', 'fields', 'invite'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const UpdateOrganizationInput = z.object({
  name: name.optional(),
  country: countryCode.optional(),
  currency: currencyCode.optional(),
  cropYearStartMonth: z.int().min(1).max(12).optional(),
  measurementSetting: z.enum(MEASUREMENT_SETTINGS).optional(),
  /** The open onboarding step; null when the onboarding is finished or skipped. */
  onboardingStep: z.enum(ONBOARDING_STEPS).nullable().optional(),
  /** Daily rainfall e-mail to the members (Settings → Notifications). */
  rainDigestEnabled: z.boolean().optional(),
  /** Fields with a soil zonation cannot be re-zoned or have their zones edited (Settings → Soil). */
  lockZonedFields: z.boolean().optional(),
});
export type UpdateOrganizationInput = z.infer<typeof UpdateOrganizationInput>;

export interface Organization {
  id: string;
  name: string;
  country: string;
  currency: string;
  cropYearStartMonth: number;
  /** The setting as stored: an explicit system or `auto` (from the country). */
  measurementSetting: MeasurementSetting;
  /** The system the UI uses. */
  measurementSystem: MeasurementSystem;
  status: 'active' | 'archived';
  role: Role;
  /** Farms the current user is limited to; null when the user sees every farm. */
  farmIds: string[] | null;
  onboardingStep: OnboardingStep | null;
  rainDigestEnabled: boolean;
  lockZonedFields: boolean;
  /** When the logo last changed (cache key of `GET /orgs/:orgId/logo`); null without a logo. */
  logoUpdatedAt: string | null;
  createdAt: string;
}

export interface Member {
  userId: string;
  email: string;
  displayName: string;
  role: Role;
  status: 'active' | 'invited' | 'disabled';
  /** Farms the member is limited to; null = every farm of the organization. */
  farmIds: string[] | null;
  lastLoginAt: string | null;
  createdAt: string;
}

/** Farms a member is limited to: null or absent = every farm, a list = only those (owners are never limited). */
const memberFarmIds = z.array(id).max(500);

export const InviteMemberInput = z.object({
  email: z.email().max(320),
  /** Defaults to the part of the address before the @. */
  displayName: name.optional(),
  role: z.enum(ROLES),
  farmIds: memberFarmIds.nullish(),
});
export type InviteMemberInput = z.input<typeof InviteMemberInput>;

export const UpdateMemberInput = z.object({
  role: z.enum(ROLES).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  farmIds: memberFarmIds.nullable().optional(),
});
export type UpdateMemberInput = z.infer<typeof UpdateMemberInput>;

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  /** Chosen UI language; null until the user picks one (the app then follows the browser). */
  locale: Locale | null;
  organizations: Organization[];
}

export const UpdateProfileInput = z.object({
  displayName: name.optional(),
  locale: z.enum(LOCALES).optional(),
});
export type UpdateProfileInput = z.infer<typeof UpdateProfileInput>;

/** E-mail notifications a user can switch off for themselves. */
export const NOTIFICATION_KEYS = ['rain_digest', 'storage_digest'] as const;
export type NotificationKey = (typeof NOTIFICATION_KEYS)[number];
export type NotificationSettings = Record<NotificationKey, boolean>;

export const UpdateNotificationSettingsInput = z.object(
  Object.fromEntries(NOTIFICATION_KEYS.map((k) => [k, z.boolean().optional()])) as Record<NotificationKey, z.ZodOptional<z.ZodBoolean>>,
);
export type UpdateNotificationSettingsInput = z.infer<typeof UpdateNotificationSettingsInput>;

/** Unsubscribe link of a notification e-mail (no sign-in needed). */
export const UnsubscribeInput = z.object({ token: z.string().min(10).max(500) });
export interface UnsubscribeResult {
  key: NotificationKey;
  email: string;
}

/** Data categories a processor receives. */
export const DATA_CATEGORIES = ['account', 'farm_records', 'documents', 'field_locations', 'emails'] as const;
export type DataCategory = (typeof DATA_CATEGORIES)[number];

/**
 * A service that processes data on this deployment's behalf (Settings → Data processing). The
 * list is built from the running configuration, so it names only services that are switched on.
 */
export interface DataProcessor {
  /** Stable id; the purpose text is translated in the app (`settings.dataProcessing.purpose.<id>`). */
  id: string;
  name: string;
  categories: DataCategory[];
  /** Processing location as far as known; null when the operator has not stated it. */
  location: string | null;
  url: string | null;
}

/** How the web app signs in, served by `GET /auth/config`. */
export type AuthConfig = { mode: 'dev' } | { mode: 'oidc'; issuer: string; clientId: string };

/** Development-only sign-in (AUTH_MODE=dev). */
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
