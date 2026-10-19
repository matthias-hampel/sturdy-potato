/**
 * Fixture-based accuracy tests.
 *
 * Ground-truth values are real KTBL grid data extracted from actionCostsData.json
 * across 8 (fieldSizeHa × distanceKm) combinations per FQN.
 * See __fixtures__/fixtures.json — regenerate with extract_cross_params.py if needed.
 *
 * Ported from agmeo `src/lib/ktbl/tests/actionCostFixtures.test.ts`.
 *
 * Tolerance: 20% (CROSS formula R²≈0.999 for field ops; residual = KTBL internal rounding).
 */

import { readFileSync } from 'node:fs';
import { estimateActionCosts } from './action-cost-estimator.js';

const fixtureData = JSON.parse(
  readFileSync(
    new URL('./__fixtures__/fixtures.json', import.meta.url),
    'utf-8',
  ),
) as { fixtures: Fixture[] };

type Fixture = {
  fqn: string;
  mechKw: number;
  fieldSizeHa: number;
  distanceKm: number;
  expected: Record<string, number>;
};

const fixtures = fixtureData.fixtures as Fixture[];

const COST_KEYS = [
  'hours',
  'diesel',
  'depreciation',
  'interest',
  'miscellaneous',
  'repairs',
  'materials',
  'services',
] as const;

function withinTolerance(
  estimated: number,
  actual: number,
  tol = 0.2,
): boolean {
  if (actual < 0.05 && estimated < 0.05) return true;
  if (actual < 0.05) return Math.abs(estimated - actual) < 0.05;
  return Math.abs(estimated - actual) / actual <= tol;
}

describe('fixture accuracy: estimateActionCosts vs KTBL grid ground truth', () => {
  it('fixtures file is loaded and non-empty', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  describe.each([...new Set(fixtures.map((f) => `${f.fqn}@${f.mechKw}`))])(
    '%s',
    (fqnAtMech) => {
      const [fqn, mechStr] = fqnAtMech.split('@');
      const mechKw = parseInt(mechStr);
      const group = fixtures.filter(
        (f) => f.fqn === fqn && f.mechKw === mechKw,
      );

      it.each(group)(
        'fs=$fieldSizeHa ha, dist=$distanceKm km — all costs within 20%',
        ({ fieldSizeHa, distanceKm, expected }) => {
          const result = estimateActionCosts(fqn, {
            mechKw,
            fieldSizeHa,
            distanceKm,
          });
          expect(result).not.toBeNull();

          const failures: string[] = [];
          for (const key of COST_KEYS) {
            const est = result![key];
            const act = expected[key] ?? 0;
            if (!withinTolerance(est, act)) {
              const pct =
                act > 0.05
                  ? `${((Math.abs(est - act) / act) * 100).toFixed(0)}%`
                  : `Δ${Math.abs(est - act).toFixed(3)}`;
              failures.push(
                `  ${key}: est=${est.toFixed(3)} act=${act.toFixed(3)} (${pct} off)`,
              );
            }
          }

          if (failures.length > 0) {
            throw new Error(
              `${fqn} at fs=${fieldSizeHa}ha dist=${distanceKm}km:\n${failures.join('\n')}`,
            );
          }
        },
      );
    },
  );
});
