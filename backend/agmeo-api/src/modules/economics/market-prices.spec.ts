import { describe, expect, it } from 'vitest';
import { marketingYear, normalizeQuotes, parseEuDate, parseEuPrice, parseFeedRows } from './market-prices.js';

describe('EU agri-food feed parsing', () => {
  it('reads both decimal styles and dates', () => {
    expect(parseEuPrice('€161,50')).toBe(161.5);
    expect(parseEuPrice('€482.50')).toBe(482.5);
    expect(parseEuPrice('€1.234')).toBe(1234);
    expect(parseEuPrice('n/a')).toBeNull();
    expect(parseEuDate('05/07/2026')).toBe('2026-07-05');
    expect(parseEuDate('2026-07-05')).toBe('2026-07-05');
    expect(marketingYear(new Date('2026-08-10T00:00:00Z'))).toBe('2026/2027');
    expect(marketingYear(new Date('2026-03-10T00:00:00Z'))).toBe('2025/2026');
  });

  it('prefers national averages, else the median of the markets', () => {
    const q = normalizeQuotes([
      { commodity: 'WHEAT_BREAD', country: 'DE', quoteDate: '2026-07-05', price: 200, national: false },
      { commodity: 'WHEAT_BREAD', country: 'DE', quoteDate: '2026-07-05', price: 210, national: true },
      { commodity: 'WHEAT_FEED', country: 'DE', quoteDate: '2026-07-05', price: 180, national: false },
      { commodity: 'WHEAT_FEED', country: 'DE', quoteDate: '2026-07-05', price: 190, national: false },
    ]);
    expect(q.find((x) => x.commodity === 'WHEAT_BREAD')?.price).toBe(210);
    expect(q.find((x) => x.commodity === 'WHEAT_FEED')?.price).toBe(185);
  });

  it('maps cereal and oilseed rows and skips unknown products', () => {
    expect(
      parseFeedRows(
        [
          { memberStateCode: 'DE', endDate: '05/07/2026', price: '€161,50', productName: 'Feed barley', marketName: 'National Average' },
          { memberStateCode: 'DE', endDate: '05/07/2026', price: '€99', productName: 'Unknown thing' },
        ],
        'cereal',
      ),
    ).toEqual([{ commodity: 'BARLEY_FEED', country: 'DE', quoteDate: '2026-07-05', price: 161.5 }]);
    expect(parseFeedRows([{ memberStateCode: 'FR', endDate: '2026-07-05', price: '€482.50', product: 'Rapeseed' }], 'oilseed')).toEqual([
      { commodity: 'RAPESEED', country: 'FR', quoteDate: '2026-07-05', price: 482.5 },
    ]);
  });
});
