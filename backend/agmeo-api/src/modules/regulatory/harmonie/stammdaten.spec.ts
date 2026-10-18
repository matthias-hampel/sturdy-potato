/**
 * Every default crop mapping must resolve to a code of its dialect's
 * Berechnungsstammdaten — the Stammdaten stage of the authorities' import.
 */
import { CROP_KEY_BY_CODE } from './cropKeys.js';
import {
  DEFAULT_CROP_TO_FRUCHTART_SH,
  FRUCHTART_CATALOGUE_SH,
  getFruchtartSh,
  isFruchtartInStammdatenSh,
} from './endo/fruchtartCodesSh.js';
import {
  DEFAULT_CROP_TO_FRUCHTART,
  getFruchtart,
  isFruchtartInStammdaten,
} from './shared/fruchtartCodes.js';

// agmeo iterates co2calculator `allSupportedCrops`; here every key either catalogue or the code mapping knows.
const allCropKeys = [
  ...new Set([
    ...Object.keys(DEFAULT_CROP_TO_FRUCHTART),
    ...Object.keys(DEFAULT_CROP_TO_FRUCHTART_SH),
    ...Object.values(CROP_KEY_BY_CODE),
  ]),
];

describe('Fruchtart Stammdaten', () => {
  test('the SH catalogue carries the 285 LLUR Fruchtarten', () => {
    expect(FRUCHTART_CATALOGUE_SH).toHaveLength(285);
    expect(
      FRUCHTART_CATALOGUE_SH.find((f) => f.code === 'WGetreide008')
        ?.bezeichnung,
    ).toMatch(/Winterweizen A\/B/);
  });

  test('every mapped crop resolves to a valid code per dialect', () => {
    for (const crop of allCropKeys) {
      const enni = getFruchtart(crop);
      if (enni)
        expect({
          crop,
          dialect: 'enni',
          ok: isFruchtartInStammdaten(enni.code),
        }).toEqual({
          crop,
          dialect: 'enni',
          ok: true,
        });
      const sh = getFruchtartSh(crop);
      if (sh)
        expect({
          crop,
          dialect: 'sh',
          ok: isFruchtartInStammdatenSh(sh.code),
        }).toEqual({
          crop,
          dialect: 'sh',
          ok: true,
        });
    }
  });

  test('colliding code strings keep their dialect meaning', () => {
    expect(getFruchtart('winterWheat')?.code).toBe('WGetreide001');
    expect(getFruchtartSh('winterWheat')?.code).toBe('WGetreide008');
    expect(getFruchtartSh('spelt')?.code).toBe('WGetreide001');
    expect(getFruchtartSh('sugarBeet')?.bezeichnung).toBe('Zuckerrüben');
  });

  test('unmappable crops stay unmapped so the preflight asks', () => {
    expect(getFruchtartSh('landscapeFeature')).toBeUndefined();
    expect(getFruchtartSh('sorghum')).toBeUndefined();
  });
});
