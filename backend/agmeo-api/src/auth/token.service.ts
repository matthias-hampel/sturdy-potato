import { Injectable } from '@nestjs/common';
import { createRemoteJWKSet, type JWTPayload, jwtVerify, SignJWT } from 'jose';
import { config } from '../config.js';

/** Claims the API needs from an access token, whatever the identity provider. */
export interface IdentityClaims {
  subject: string;
  email: string;
  name: string;
}

/** The token is valid, but its e-mail address has not been confirmed with the identity provider. */
export class UnverifiedEmailError extends Error {}

/**
 * Verifies access tokens.
 *
 * - `oidc` (Keycloak): RS256 tokens checked against the issuer's JWKS, issuer and audience.
 *   The e-mail address must be verified, because sign-in claims pending invitations by e-mail.
 * - `dev`: locally signed HS256 tokens from `POST /auth/dev/sign-in`, for tests and offline
 *   development. Refused when NODE_ENV=production.
 */
@Injectable()
export class TokenService {
  private readonly devKey = new TextEncoder().encode(config.auth.devSecret);
  private readonly devIssuer = 'agmeo-dev-auth';
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor() {
    if (config.auth.mode === 'dev' && process.env.NODE_ENV === 'production') {
      throw new Error('AUTH_MODE=dev must not be used in production');
    }
  }

  async issue(claims: IdentityClaims): Promise<{ token: string; expiresAt: Date }> {
    if (config.auth.mode !== 'dev') throw new Error('Tokens are only issued in AUTH_MODE=dev');
    const expiresAt = new Date(Date.now() + config.auth.tokenTtlHours * 3600_000);
    const token = await new SignJWT({ email: claims.email, name: claims.name, email_verified: true })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.subject)
      .setIssuer(this.devIssuer)
      .setIssuedAt()
      .setExpirationTime(expiresAt)
      .sign(this.devKey);
    return { token, expiresAt };
  }

  async verify(token: string): Promise<IdentityClaims> {
    const payload = config.auth.mode === 'oidc' ? await this.verifyOidc(token) : await this.verifyDev(token);
    if (!payload.sub || typeof payload.email !== 'string') throw new Error('Token is missing claims');
    if (payload.email_verified !== true) throw new UnverifiedEmailError('E-mail address not verified');
    return { subject: payload.sub, email: payload.email.toLowerCase(), name: displayName(payload) };
  }

  private async verifyDev(token: string): Promise<JWTPayload> {
    const { payload } = await jwtVerify(token, this.devKey, { issuer: this.devIssuer, algorithms: ['HS256'] });
    return payload;
  }

  private async verifyOidc(token: string): Promise<JWTPayload> {
    this.jwks ??= createRemoteJWKSet(new URL(`${config.auth.issuer}/protocol/openid-connect/certs`));
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: config.auth.issuer,
      audience: config.auth.audience,
      algorithms: ['RS256', 'ES256', 'PS256'],
    });
    return payload;
  }
}

function displayName(p: JWTPayload): string {
  const full = [p.given_name, p.family_name].filter((s) => typeof s === 'string' && s).join(' ');
  return String((typeof p.name === 'string' && p.name) || full || p.preferred_username || p.email);
}
