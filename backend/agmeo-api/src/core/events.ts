import type { Ctx } from '../auth/context.js';
import type { Trx } from '../db/database.js';

export interface DomainEvent {
  /** Dotted event type, published to NATS as `agmeo.events.<type>`. */
  type: string;
  payload: Record<string, unknown>;
}

interface Change {
  entityType: string;
  entityId: string;
  action: string;
  changes?: Record<string, unknown>;
  event?: DomainEvent;
}

/**
 * Appends the audit record and, when given, a domain event to the transactional outbox.
 * Must run in the same transaction as the change it describes.
 */
export async function record(trx: Trx, ctx: Ctx, change: Change): Promise<void> {
  await trx
    .insertInto('audit_events')
    .values({
      organization_id: ctx.orgId,
      entity_type: change.entityType,
      entity_id: change.entityId,
      action: change.action,
      actor_user_id: ctx.userId,
      changes: JSON.stringify(change.changes ?? {}),
    })
    .execute();

  if (change.event) {
    await trx
      .insertInto('outbox_events')
      .values({
        organization_id: ctx.orgId,
        event_type: change.event.type,
        aggregate_type: change.entityType,
        aggregate_id: change.entityId,
        payload: JSON.stringify({ organizationId: ctx.orgId, actorUserId: ctx.userId, ...change.event.payload }),
      })
      .execute();
  }
}

/** Field-level diff for audit records: only keys whose values changed. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    if (after[key] === undefined) continue;
    const a = before[key] instanceof Date ? (before[key] as Date).toISOString() : before[key];
    if (JSON.stringify(a) !== JSON.stringify(after[key])) out[key] = { from: a ?? null, to: after[key] };
  }
  return out;
}
