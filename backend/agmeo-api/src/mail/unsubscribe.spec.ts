import { signUnsubscribeToken, verifyUnsubscribeToken } from './unsubscribe.js';

const user = '01a1505f-34c6-7a61-a193-d7aaeec256ce';

describe('unsubscribe tokens', () => {
  it('round-trips user and notification', () => {
    expect(verifyUnsubscribeToken(signUnsubscribeToken(user, 'rain_digest'))).toEqual({ userId: user, key: 'rain_digest' });
  });

  it('rejects tampered, foreign and malformed tokens', () => {
    const token = signUnsubscribeToken(user, 'rain_digest');
    const [payload, signature] = token.split('.');
    const other = Buffer.from(`${user}.storage_digest`).toString('base64url');
    expect(verifyUnsubscribeToken(`${other}.${signature}`)).toBeNull();
    expect(verifyUnsubscribeToken(`${payload}.${signature.slice(1)}x`)).toBeNull();
    expect(verifyUnsubscribeToken('abc')).toBeNull();
    expect(verifyUnsubscribeToken(null)).toBeNull();
  });
});
