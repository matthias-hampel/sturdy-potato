/**
 * Ported from AGVOLUTION/agmeo src/lib/irrigation/events.test.ts — same
 * validation cases. The reference asserted them on the async DB writer with a
 * mocked `getDb`; here the validation is its own pure function, so the cases
 * call it (and the row planner) directly.
 */

import {
  type IrrigationEventError,
  groupByOperation,
  planIrrigationEvent,
  validateIrrigationEventInput,
} from './events.js';

const baseInput = {
  date: '2026-06-12',
  amountMm: 25,
  actionFqn: 'IRRIGATION_METHOD__DRIP',
};

describe('createIrrigationEventForOrg input validation', () => {
  it('rejects externalRef with more than one cultivation (a ref maps to one operation)', () => {
    expect(() =>
      validateIrrigationEventInput({
        ...baseInput,
        cultivationIds: ['c1', 'c2'],
        externalRef: 'climavi:ref-1',
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'invalid_input',
      } satisfies Partial<IrrigationEventError>),
    );
  });

  it('rejects a non-positive amount and empty cultivations before touching the db', () => {
    expect(() =>
      validateIrrigationEventInput({
        ...baseInput,
        amountMm: 0,
        cultivationIds: ['c1'],
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_input' }));
    expect(() =>
      validateIrrigationEventInput({ ...baseInput, cultivationIds: [] }),
    ).toThrow(expect.objectContaining({ code: 'invalid_input' }));
  });
});

describe('planIrrigationEvent', () => {
  it('books an ACTION and a water PRODUCT per cultivation, mm × 10 as m³/ha', () => {
    let n = 0;
    const plan = planIrrigationEvent(
      { ...baseInput, cultivationIds: ['c1', 'c2'], source: 'climavi' },
      () => `op${++n}`,
    );
    expect(plan.operations.map((o) => o.operationId)).toEqual(['op1', 'op2']);
    expect(plan.rows).toHaveLength(4);
    const [action, water] = plan.rows;
    expect(action).toMatchObject({
      kind: 'action',
      articleId: 'IRRIGATION_METHOD__DRIP',
      hours: 0.02,
      diesel: 0,
      status: 'PLANNING',
      details: { source: 'climavi' },
    });
    expect(water).toMatchObject({
      kind: 'product',
      articleId: 'MISCELLANEOUS__WATER__DRINKING_WATER',
      quantity: 250,
      unit: 'm3_ha',
    });
  });

  it('groups inserted rows per operation', () => {
    expect(
      groupByOperation([
        { id: 't1', operationId: 'op1', cultivationId: 'c1' },
        { id: 't2', operationId: 'op1', cultivationId: 'c1' },
      ]),
    ).toEqual([
      { operationId: 'op1', cultivationId: 'c1', transactionIds: ['t1', 't2'] },
    ]);
  });
});
