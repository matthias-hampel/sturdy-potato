/** Share link access (ported behaviour of AGVOLUTION/agmeo lib/soil/shareAccess.ts). */
import { AttemptLimiter, hashSharePassword, newShareToken, signAccess, verifyAccess, verifySharePassword } from './share-access.js';

describe('soil share access', () => {
  it('creates unguessable tokens', () => {
    const a = newShareToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(newShareToken()).not.toBe(a);
  });

  it('hashes passwords with a salt and verifies them', async () => {
    const hash = await hashSharePassword('geheim123');
    expect(hash).not.toContain('geheim');
    expect(await hashSharePassword('geheim123')).not.toBe(hash);
    expect(await verifySharePassword(hash, 'geheim123')).toBe(true);
    expect(await verifySharePassword(hash, 'geheim124')).toBe(false);
    expect(await verifySharePassword('broken', 'x')).toBe(false);
  });

  it('signs access tokens bound to share, password and time', () => {
    const now = Date.now();
    const token = signAccess('share-1', 'hash-a', now);
    expect(verifyAccess(token, 'share-1', 'hash-a', now + 1000)).toBe(true);
    expect(verifyAccess(token, 'share-2', 'hash-a', now)).toBe(false);
    // A changed password invalidates earlier tokens.
    expect(verifyAccess(token, 'share-1', 'hash-b', now)).toBe(false);
    expect(verifyAccess(token, 'share-1', 'hash-a', now + 13 * 3600_000)).toBe(false);
    expect(verifyAccess(`${token}x`, 'share-1', 'hash-a', now)).toBe(false);
    expect(verifyAccess(undefined, 'share-1', 'hash-a', now)).toBe(false);
  });

  it('limits failed attempts per share', () => {
    const limiter = new AttemptLimiter(3, 1000);
    for (let i = 0; i < 3; i++) limiter.fail('s', 0);
    expect(limiter.blocked('s', 10)).toBe(true);
    expect(limiter.blocked('other', 10)).toBe(false);
    expect(limiter.blocked('s', 2000)).toBe(false);
  });
});
