/**
 * Access primitives of public soil share pages (ported from AGVOLUTION/agmeo lib/soil/shareAccess.ts):
 * the unguessable URL token, the scrypt password hash and the signed access token a viewer gets
 * after entering the password, so later requests (data, file download) need not repeat it.
 */
import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { config } from '../../config.js';

const ACCESS_TTL_MS = 12 * 60 * 60 * 1000;
const KEYLEN = 32;
// Async scrypt: the sync variant blocks the event loop, which an anonymous visitor could abuse.
const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

const secret = () => process.env.SOIL_SHARE_SECRET || config.auth.devSecret;

export const newShareToken = (): string => randomBytes(24).toString('base64url');

export async function hashSharePassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEYLEN);
  return `${salt.toString('base64url')}.${hash.toString('base64url')}`;
}

export async function verifySharePassword(stored: string, password: string): Promise<boolean> {
  const [saltPart, hashPart] = stored.split('.');
  if (!saltPart || !hashPart) return false;
  const expected = Buffer.from(hashPart, 'base64url');
  const got = await scryptAsync(password, Buffer.from(saltPart, 'base64url'), KEYLEN);
  return expected.length === got.length && timingSafeEqual(got, expected);
}

/** Binds the token to the current password hash: changing or removing the password invalidates it. */
const fingerprint = (passwordHash: string | null) =>
  createHmac('sha256', secret())
    .update(passwordHash ?? '-')
    .digest('base64url')
    .slice(0, 16);

export function signAccess(shareId: string, passwordHash: string | null, now = Date.now()): string {
  const payload = `${shareId}.${fingerprint(passwordHash)}.${now + ACCESS_TTL_MS}`;
  const sig = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

export function verifyAccess(value: string | undefined | null, shareId: string, passwordHash: string | null, now = Date.now()): boolean {
  if (!value) return false;
  const [encoded, sig] = value.split('.');
  if (!encoded || !sig) return false;
  const payload = Buffer.from(encoded, 'base64url').toString('utf8');
  const expected = Buffer.from(createHmac('sha256', secret()).update(payload).digest('base64url'));
  const got = Buffer.from(sig);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return false;
  const [id, print, expires] = payload.split('.');
  return id === shareId && print === fingerprint(passwordHash) && Number(expires) > now;
}

/** Failed password attempts per share: at most 10 in 15 minutes (per API instance). */
export class AttemptLimiter {
  private readonly failures = new Map<string, number[]>();
  constructor(
    private readonly max = 10,
    private readonly windowMs = 15 * 60 * 1000,
  ) {}
  blocked(key: string, now = Date.now()) {
    const recent = (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
    this.failures.set(key, recent);
    return recent.length >= this.max;
  }
  fail(key: string, now = Date.now()) {
    this.failures.set(key, [...(this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs), now]);
  }
}
