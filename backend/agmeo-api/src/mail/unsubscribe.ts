import { createHmac, timingSafeEqual } from 'node:crypto';
import { NOTIFICATION_KEYS, type NotificationKey } from '@agmeo/contracts';
import { config } from '../config.js';

/**
 * Capability token in the footer of a notification e-mail: whoever holds it may switch that one
 * notification off for that one user, without signing in. HMAC-signed, no expiry — a link in a
 * mail from last spring must still work, and the action is idempotent and mild (reference:
 * lib/notifications/unsubscribeToken.ts).
 */
function secret(): string {
  if (!config.mail.unsubscribeSecret) throw new Error('EMAIL_UNSUBSCRIBE_SECRET is not set');
  return config.mail.unsubscribeSecret;
}

export function signUnsubscribeToken(userId: string, key: NotificationKey): string {
  const payload = `${userId}.${key}`;
  const signature = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${signature}`;
}

export function verifyUnsubscribeToken(token: string | null | undefined): { userId: string; key: NotificationKey } | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const payload = Buffer.from(parts[0], 'base64url').toString('utf8');
  const expected = Buffer.from(createHmac('sha256', secret()).update(payload).digest('base64url'));
  const got = Buffer.from(parts[1]);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  const dot = payload.lastIndexOf('.');
  if (dot <= 0) return null;
  const userId = payload.slice(0, dot);
  const key = payload.slice(dot + 1);
  if (!(NOTIFICATION_KEYS as readonly string[]).includes(key)) return null;
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
  return { userId, key: key as NotificationKey };
}

/** Links of a notification e-mail: the page for people and the RFC 8058 one-click endpoint for mail clients. */
export function unsubscribeLinks(userId: string, key: NotificationKey) {
  const token = signUnsubscribeToken(userId, key);
  return {
    page: `${config.appUrl}/unsubscribe/${token}`,
    oneClick: `${config.appUrl}/api/v1/notifications/unsubscribe/one-click?token=${encodeURIComponent(token)}`,
  };
}
