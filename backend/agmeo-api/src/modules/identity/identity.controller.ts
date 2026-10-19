import { Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  CreateOrganizationInput,
  DevSignInInput,
  InviteMemberInput,
  UpdateMemberInput,
  UpdateOrganizationInput,
  UpdateProfileInput,
  type AuthConfig,
  type SignInResult,
} from '@agmeo/contracts';
import { sql } from 'kysely';
import { type AuthUser, type Ctx, CurrentUser, OrgCtx, Public, Requires } from '../../auth/context.js';
import { TokenService } from '../../auth/token.service.js';
import { config } from '../../config.js';
import { DomainError } from '../../core/errors.js';
import { type Out, ZBody } from '../../core/validation.js';
import { Database } from '../../db/database.js';
import { IdentityService } from './identity.service.js';

@Controller()
export class IdentityController {
  constructor(
    private readonly identity: IdentityService,
    private readonly tokens: TokenService,
    private readonly db: Database,
  ) {}

  @Public()
  @Get('health')
  async health() {
    await sql`SELECT 1`.execute(this.db.kysely);
    return { status: 'ok' };
  }

  /** How the web app signs in: Keycloak (OIDC with PKCE) or the development sign-in. */
  @Public()
  @Get('auth/config')
  authConfig(): AuthConfig {
    return config.auth.mode === 'oidc'
      ? { mode: 'oidc', issuer: config.auth.issuer, clientId: config.auth.webClientId }
      : { mode: 'dev' };
  }

  /**
   * Development sign-in: anyone can sign in as any email address. Only enabled in
   * AUTH_MODE=dev.
   */
  @Public()
  @Post('auth/dev/sign-in')
  async devSignIn(@ZBody(DevSignInInput) input: Out<typeof DevSignInInput>): Promise<SignInResult> {
    if (config.auth.mode !== 'dev') throw new DomainError(404, 'not_found', 'Not found');
    const email = input.email.toLowerCase();
    const name = input.displayName ?? email.split('@')[0];
    const { token, expiresAt } = await this.tokens.issue({ subject: `dev|${email}`, email, name });
    const { rows } = await sql<{ id: string }>`SELECT app.sign_in(${`dev|${email}`}, ${email}, ${name}) AS id`.execute(this.db.kysely);
    return { accessToken: token, expiresAt: expiresAt.toISOString(), user: await this.identity.me(rows[0].id) };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.identity.me(user.userId);
  }

  @Patch('me')
  updateProfile(@CurrentUser() user: AuthUser, @ZBody(UpdateProfileInput) input: Out<typeof UpdateProfileInput>) {
    return this.identity.updateProfile(user.userId, input);
  }

  @Post('orgs')
  createOrganization(@CurrentUser() user: AuthUser, @ZBody(CreateOrganizationInput) input: Out<typeof CreateOrganizationInput>) {
    return this.identity.createOrganization(user.userId, input);
  }

  @Get('orgs/:orgId')
  getOrganization(@OrgCtx() ctx: Ctx) {
    return this.identity.getOrganization(ctx);
  }

  @Patch('orgs/:orgId')
  @Requires('org.manage')
  updateOrganization(@OrgCtx() ctx: Ctx, @ZBody(UpdateOrganizationInput) input: Out<typeof UpdateOrganizationInput>) {
    return this.identity.updateOrganization(ctx, input);
  }

  @Get('orgs/:orgId/members')
  members(@OrgCtx() ctx: Ctx) {
    return this.identity.members(ctx);
  }

  @Post('orgs/:orgId/members')
  @Requires('members.manage')
  invite(@OrgCtx() ctx: Ctx, @ZBody(InviteMemberInput) input: Out<typeof InviteMemberInput>) {
    return this.identity.inviteMember(ctx, input);
  }

  @Patch('orgs/:orgId/members/:userId')
  @Requires('members.manage')
  updateMember(
    @OrgCtx() ctx: Ctx,
    @Param('userId', ParseUUIDPipe) userId: string,
    @ZBody(UpdateMemberInput) input: Out<typeof UpdateMemberInput>,
  ) {
    return this.identity.updateMember(ctx, userId, input);
  }

  @Delete('orgs/:orgId/members/:userId')
  @Requires('members.manage')
  removeMember(@OrgCtx() ctx: Ctx, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.identity.removeMember(ctx, userId);
  }

  @Get('orgs/:orgId/audit')
  audit(@OrgCtx() ctx: Ctx, @Query('entityType') entityType: string, @Query('entityId', ParseUUIDPipe) entityId: string) {
    return this.identity.auditTrail(ctx, entityType, entityId);
  }
}
