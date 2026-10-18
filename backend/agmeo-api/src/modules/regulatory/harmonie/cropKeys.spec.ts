import { CROP_KEY_BY_CODE, cropKeyForCode } from './cropKeys.js';
import {
  getFruchtartSh,
  isFruchtartInStammdatenSh,
} from './endo/fruchtartCodesSh.js';
import {
  getFruchtart,
  isFruchtartInStammdaten,
} from './shared/fruchtartCodes.js';

const SYSTEM_CROP_CODES = [
  'winter_wheat',
  'spring_wheat',
  'winter_barley',
  'spring_barley',
  'winter_rye',
  'triticale',
  'oats',
  'winter_rapeseed',
  'sunflower',
  'grain_maize',
  'silage_maize',
  'sugar_beet',
  'potatoes',
  'field_beans',
  'peas',
  'soybeans',
  'grassland',
  'cover_crop',
  'fallow',
  'winter_spelt',
  'winter_oats',
  'spring_rapeseed',
  'lupins',
  'field_grass',
  'clover_grass',
  'alfalfa',
  'cc_mustard',
  'cc_phacelia',
  'cc_oil_radish',
  'cc_legume_mix',
  'cc_winter_rye',
];

describe('CROP_KEY_BY_CODE', () => {
  test('maps every system crop code', () => {
    expect(SYSTEM_CROP_CODES.filter((code) => !CROP_KEY_BY_CODE[code])).toEqual(
      [],
    );
  });

  test.each(Object.entries(CROP_KEY_BY_CODE))(
    '%s → %s resolves in the ENNI and the ENDO-SH Stammdaten',
    (_code, key) => {
      const enni = getFruchtart(key);
      const sh = getFruchtartSh(key);
      expect(enni && isFruchtartInStammdaten(enni.code)).toBe(true);
      expect(sh && isFruchtartInStammdatenSh(sh.code)).toBe(true);
    },
  );

  test('known anchors', () => {
    expect(cropKeyForCode('winter_wheat')).toBe('winterWheat');
    expect(cropKeyForCode('winter_barley')).toBe('winterBarleyFodder');
    expect(cropKeyForCode('potatoes')).toBe('potatoTableLate');
    expect(cropKeyForCode('grassland')).toBe('permanentGrasslandWiltedSilage');
    expect(cropKeyForCode('cc_mustard')).toBe('mustardIntercrop');
    expect(getFruchtart(CROP_KEY_BY_CODE.fallow)?.code).toBe('Sonstige001');
    expect(getFruchtartSh(CROP_KEY_BY_CODE.fallow)?.code).toBe('Brache018');
  });

  test('unknown codes and prototype keys have no mapping', () => {
    expect(cropKeyForCode('dragon_fruit')).toBeNull();
    expect(cropKeyForCode('constructor')).toBeNull();
    expect(cropKeyForCode(null)).toBeNull();
  });
});
