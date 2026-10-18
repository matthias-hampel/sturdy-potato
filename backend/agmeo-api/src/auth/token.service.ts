import { Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config.js';

/** Claims the API needs from an access token, whatever the identity provider. */
export interface IdentityClaims {
  subject: string;
  email: string;
  name: string;
}

/**
 * Development token issuer/verifier (HS256, shared secret).
 *
 * The Keycloak integration replaces `verify` with JWKS-based verification of the IdP's
 * access tokens (issuer + audience checks) and drops `issue` entirely; everything
 * downstream only depends on IdentityClaims.
 */
@Injectable()
export class TokenService {
  private readonly key = new TextEncoder().encode(config.auth.devSecret);
  private readonly issuer = 'agmeo-dev-auth';

  async issue(claims: IdentityClaims): Promise<{ token: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + config.auth.tokenTtlHours * 3600_000);
    const token = await new SignJWT({ email: claims.email, name: claims.name })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.subject)
      .setIssuer(this.issuer)
      .setIssuedAt()
      .setExpirationTime(expiresAt)
      .sign(this.key);
    return { token, expiresAt };
  }

  async verify(token: string): Promise<IdentityClaims> {
    const { payload } = await jwtVerify(token, this.key, { issuer: this.issuer, algorithms: ['HS256'] });
    if (!payload.sub || typeof payload.email !== 'string') throw new Error('Token is missing claims');
    return { subject: payload.sub, email: payload.email, name: String(payload.name ?? payload.email) };
  }
}
