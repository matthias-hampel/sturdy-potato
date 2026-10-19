/**
 * Ported from AGVOLUTION/agmeo src/lib/irrigation/events.ts — the pure parts
 * of `createIrrigationEventForOrg`: input validation, the rows one irrigation
 * event books, and the grouping of inserted rows per operation. Ownership
 * checks, the insert transaction and the `externalRef` idempotency claim are
 * database work and stay with the caller.
 *
 * One operation per cultivation = an ACTION row (method fqn, diesel/hours
 * defaults per ha) + a PRODUCT row (water, `quantity = mm × 10` in m³/ha)
 * sharing an operationId. An `externalRef` maps to exactly one operation, so it
 * requires a single cultivationId; the reference mirrored it, `source` and
 * `zone` into the ACTION row's details as provenance.
 */

import { IRRIGATION_DEFAULTS_PER_HA, MM_TO_M3_HA, WATER_FQN } from './data.js';

export type CreateIrrigationEventInput = {
  cultivationIds: string[];
  date: string; // ISO
  amountMm: number;
  actionFqn: string; // key of IRRIGATION_DEFAULTS_PER_HA
  /** Free-form origin marker, e.g. "climavi". Stored in the ACTION row's details. */
  source?: string;
  /** Idempotency key. Replays return the existing operation instead of inserting. */
  externalRef?: string;
  /** Optional caller-side zone reference, mirrored into details.zone. */
  zone?: { id: string; name: string };
  status?: string;
  /** Operator to assign: the reference created a task per operation. */
  operatorId?: string | null;
};

export class IrrigationEventError extends Error {
  constructor(
    public readonly code: 'invalid_input' | 'not_found',
    message: string,
  ) {
    super(message);
    this.name = 'IrrigationEventError';
  }
}

/** Throws IrrigationEventError('invalid_input') before anything touches the DB. */
export function validateIrrigationEventInput(
  input: CreateIrrigationEventInput,
): void {
  const { cultivationIds, amountMm, actionFqn, externalRef } = input;
  if (amountMm <= 0 || !actionFqn || cultivationIds.length === 0) {
    throw new IrrigationEventError(
      'invalid_input',
      'amountMm, actionFqn and cultivationIds are required',
    );
  }
  if (externalRef && cultivationIds.length > 1) {
    throw new IrrigationEventError(
      'invalid_input',
      'externalRef requires a single cultivationId',
    );
  }
}

export type IrrigationEventRow = {
  cultivationId: string;
  operationId: string;
  kind: 'action' | 'product';
  date: string;
  articleId: string;
  quantity: number;
  /** '' on the ACTION row, 'm3_ha' on the water row. */
  unit: string;
  diesel: number;
  hours?: number;
  details?: Record<string, unknown>;
  status: string;
};

export type PlannedIrrigationEvent = {
  operations: {
    cultivationId: string;
    operationId: string;
    operatorId: string | null;
  }[];
  rows: IrrigationEventRow[];
};

/**
 * The rows an irrigation event books — one ACTION + one water PRODUCT per
 * cultivation, each pair under a fresh operationId from `newId`. Validates
 * first. Status defaults to "PLANNING" as in the reference.
 */
export function planIrrigationEvent(
  input: CreateIrrigationEventInput,
  newId: () => string = () => crypto.randomUUID(),
): PlannedIrrigationEvent {
  validateIrrigationEventInput(input);
  const {
    cultivationIds,
    date,
    amountMm,
    actionFqn,
    source,
    externalRef,
    zone,
    operatorId,
  } = input;
  const status = input.status ?? 'PLANNING';

  const waterM3Ha = amountMm * MM_TO_M3_HA;
  const defaults = IRRIGATION_DEFAULTS_PER_HA[actionFqn] ?? {
    hours: 0,
    diesel: 0,
  };
  const details =
    source || externalRef || zone
      ? {
          ...(source ? { source } : {}),
          ...(externalRef ? { externalRef } : {}),
          ...(zone ? { zone: { id: zone.id, name: zone.name } } : {}),
        }
      : undefined;

  const operations: PlannedIrrigationEvent['operations'] = [];
  const rows = cultivationIds.flatMap((cultivationId): IrrigationEventRow[] => {
    const operationId = newId();
    operations.push({
      cultivationId,
      operationId,
      operatorId: operatorId ?? null,
    });
    return [
      {
        cultivationId,
        operationId,
        kind: 'action',
        date,
        articleId: actionFqn,
        details,
        diesel: defaults.diesel,
        hours: defaults.hours,
        quantity: 0,
        unit: '',
        status,
      },
      {
        cultivationId,
        operationId,
        kind: 'product',
        date,
        articleId: WATER_FQN,
        diesel: 0,
        quantity: waterM3Ha,
        unit: 'm3_ha',
        status,
      },
    ];
  });

  return { operations, rows };
}

/** Inserted rows → one entry per operation with its transaction ids. */
export function groupByOperation(
  rows: { id: string; operationId: string; cultivationId: string }[],
): { cultivationId: string; operationId: string; transactionIds: string[] }[] {
  const byOperation = new Map<
    string,
    { cultivationId: string; transactionIds: string[] }
  >();
  for (const row of rows) {
    const entry = byOperation.get(row.operationId) ?? {
      cultivationId: row.cultivationId,
      transactionIds: [],
    };
    entry.transactionIds.push(row.id);
    byOperation.set(row.operationId, entry);
  }
  return [...byOperation.entries()].map(([operationId, e]) => ({
    operationId,
    ...e,
  }));
}
