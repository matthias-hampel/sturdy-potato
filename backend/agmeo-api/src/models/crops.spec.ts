import { CROP_KEY_BY_CODE } from '../modules/regulatory/harmonie/cropKeys.js';
import { allSupportedCrops, MODEL_CROP_BY_CODE, modelCrop } from './crops.js';

/** Every `crops.code` seeded by db/migrations 000003 and 000014. */
const SEEDED_CROP_CODES = [
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

describe('crop code mapping', () => {
  it('maps every seeded crop code onto a reference crop key', () => {
    const known = new Set<string>(allSupportedCrops);
    for (const code of SEEDED_CROP_CODES) {
      expect({ code, key: modelCrop(code) }).toEqual({
        code,
        key: expect.any(String),
      });
      expect(known.has(modelCrop(code)!)).toBe(true);
    }
    expect(Object.keys(MODEL_CROP_BY_CODE).sort()).toEqual(
      [...SEEDED_CROP_CODES].sort(),
    );
  });

  it('resolves a code to the same crop as the regulatory export', () => {
    expect(MODEL_CROP_BY_CODE).toEqual(CROP_KEY_BY_CODE);
  });

  it('returns null for unknown or missing codes', () => {
    expect(modelCrop(null)).toBeNull();
    expect(modelCrop('')).toBeNull();
    expect(modelCrop('toString')).toBeNull();
    expect(modelCrop('banana')).toBeNull();
  });
});
