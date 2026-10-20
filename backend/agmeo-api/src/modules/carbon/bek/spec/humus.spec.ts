// Ported from agmeo src/lib/co2calculator/tests/humus.test.ts.
import type { FunctionOutput } from '../calculator.js';
import { humusBalanceMainOrCoverCrop } from '../humus.js';

describe('Humus balance calculator', () => {
  test('silageMaize', () => {
    const humus: FunctionOutput = humusBalanceMainOrCoverCrop(
      'silageMaize',
      0, // The incorporation straw is not important for silage maize
      13500, // The quantity is not important for silage maize
    );
    expect(humus.value).toBe(-800);
  });
  /*
    test("winterWheat with straw incorporation", () => {
        const humus: FunctionOutput = humusBalanceMainOrCoverCrop(
            "winterWheat",
            1,
            8,
        );
        expect(humus.value).toBe(48);
    }); */
  // For winterWheat, where we do not incorporate straw, we should lose humus
  test('winterWheat without straw incorporation', () => {
    const humus: FunctionOutput = humusBalanceMainOrCoverCrop(
      'winterWheat',
      0,
      8,
    );
    expect(humus.value).toBe(-400);
  });
  // TODO: Organic fertilizer humus balance
});
