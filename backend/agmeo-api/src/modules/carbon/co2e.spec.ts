import { BEK_SOURCES } from '@agmeo/contracts';
import { emptyCo2eReport } from './bek/empty.js';
import PARAMS from './bek/parameters.js';
import {
  bekSource,
  CO2E_FACTOR_SET,
  calculationParameters,
  emissionCategory,
} from './co2e.js';
import { carbonCrop, hasModelData, MAPPED_CROP_CODES } from './crops.js';
import {
  type CarbonInputLine,
  cycleEmissionsPerHa,
  fuelKind,
  incorporationTime,
  operationEmissionsPerHa,
} from './emissions.js';

const fert = (
  type: string,
  nPct: number,
  rate: number,
  extra: Partial<CarbonInputLine['product']> = {},
): CarbonInputLine => ({
  ratePerHa: rate,
  product: {
    name: type,
    category: 'fertilizer',
    baseUnit: 'kg',
    fertilizerType: type as never,
    nPct,
    ...extra,
  },
});
const op = (
  inputs: CarbonInputLine[],
  dieselLPerHa = 0,
  incorporationHours: number | null = null,
) => ({ type: 'fertilization', dieselLPerHa, incorporationHours, inputs });

describe('BEK emissions of agmeo operations', () => {
  it('names the factor set and keeps the source list in step with the calculator', () => {
    expect(CO2E_FACTOR_SET).toMatch(/^DE-BEK/);
    expect([...BEK_SOURCES].sort()).toEqual(
      Object.keys(emptyCo2eReport.byId).sort(),
    );
  });

  it('counts diesel combustion (pb6a) and machinery (pb7) per litre', () => {
    const e = operationEmissionsPerHa(op([], 10), 'winterWheat').byId;
    expect(e.pb6a).toBeCloseTo(30.13, 2);
    expect(e.pb7).toBeCloseTo(8.85, 2);
  });

  it('splits fuel products into diesel, biodiesel and HVO', () => {
    expect(fuelKind('Diesel')).toBe('diesel');
    expect(fuelKind('HVO 100')).toBe('hvo100');
    expect(fuelKind('Biodiesel (RME)')).toBe('biodiesel');
    const fuel = (name: string): CarbonInputLine => ({
      ratePerHa: 10,
      product: { name, category: 'fuel', baseUnit: 'l', fertilizerType: null },
    });
    const e = operationEmissionsPerHa(
      op([fuel('Diesel'), fuel('HVO100'), fuel('Biodiesel')]),
      null,
    ).byId;
    expect(e.pb6a).toBeCloseTo(10 * 3.013 + 10 * 0.58, 2);
    expect(e.pb6b).toBeCloseTo(10 * 0.536, 2);
    expect(e.pb7).toBeCloseTo(20 * 0.885, 2);
  });

  it('counts mineral N: direct N2O (pf4), N2O from NH3 (pf2) and production (pb1a)', () => {
    // 370.37 kg CAN with 27 % N = 100 kg N.
    const e = operationEmissionsPerHa(
      op([fert('can', 27, 370.37)]),
      'winterWheat',
    ).byId;
    expect(e.pf4).toBeCloseTo(100 * 0.01225 * 1.57 * 273, 0);
    expect(e.pf2).toBeCloseTo(100 * 0.01 * 0.01 * 1.57 * 273, 1);
    expect(e.pb1a).toBeCloseTo(352, 0);
    expect(e.pf8b).toBeUndefined();
  });

  it('adds CO2 from urea hydrolysis and higher NH3 losses for urea', () => {
    const e = operationEmissionsPerHa(
      op([fert('urea', 46, 217.39)]),
      'winterWheat',
    ).byId;
    expect(e.pf8b).toBeCloseTo(157, 0);
    expect(e.pf2).toBeCloseTo(100 * 0.128 * 0.01 * 1.57 * 273, 0);
    expect(e.pb1a).toBeCloseTo(350.2, 0);
  });

  it('counts P, K and applied lime, but not the negative lime value of acidifying fertilizers', () => {
    const e = operationEmissionsPerHa(
      op([fert('npk', 15, 100, { p2o5Pct: 15, k2oPct: 15, caoPct: 10 })]),
      'winterWheat',
    ).byId;
    expect(e.pb1b).toBeCloseTo(15 * 0.542, 3);
    expect(e.pb1c).toBeCloseTo(15 * 0.416, 3);
    expect(e.pf8a).toBeCloseTo(10 * 0.786, 3);
    expect(
      operationEmissionsPerHa(op([fert('can', 27, 100, { caoPct: -15 })]), null)
        .byId.pf8a,
    ).toBeUndefined();
  });

  it('uses NH3 factors by organic type and incorporation, N efficiency and the humus-C of the product', () => {
    const slurry = fert('cattle_slurry', 0.4, 25, {
      baseUnit: 'm3',
      nh4NPct: 0.2,
      densityTM3: 1,
      humusCKgPerT: 8,
    });
    const late = operationEmissionsPerHa(op([slurry]), 'winterWheat').byId;
    const quick = operationEmissionsPerHa(
      op([slurry], 0, 1),
      'winterWheat',
    ).byId;
    // 25 t × 4 kg N/t = 100 kg N; 50 % TAN.
    expect(late.pf1).toBeCloseTo(
      100 *
        0.5 *
        PARAMS.findOrganicFertilizerParameter(
          'cattleSlurry',
          'noIncorporation',
        ) *
        0.01 *
        1.57 *
        273,
      1,
    );
    expect(quick.pf1!).toBeLessThan(late.pf1!);
    // DüV minimum efficiency of cattle slurry: 60 %.
    expect(late.pf3).toBeCloseTo(60 * 0.01225 * 1.57 * 273, 1);
    expect(late.pb2a).toBeCloseTo(60 * 3.397, 1);
    expect(late.pb1a).toBeUndefined();
    // 25 t × 8 kg humus-C bind CO2.
    expect(late.pf9).toBeCloseTo(-200 * 3.67, 1);
    expect(incorporationTime(6)).toBe('8h');
  });

  it('counts plant protection products and seed with the crop factor', () => {
    const ppp: CarbonInputLine = {
      ratePerHa: 10,
      product: {
        name: 'Fungizid',
        category: 'crop_protection',
        baseUnit: 'l',
        fertilizerType: null,
      },
    };
    expect(operationEmissionsPerHa(op([ppp]), null).byId.pb5).toBeCloseTo(
      38.8,
      1,
    );
    const seed: CarbonInputLine = {
      ratePerHa: 180,
      product: {
        name: 'Weizen',
        category: 'seed',
        baseUnit: 'kg',
        fertilizerType: null,
      },
    };
    expect(
      operationEmissionsPerHa(op([seed]), 'winterWheat').byId.pb4,
    ).toBeCloseTo(180 * PARAMS.crop.winterWheat.supplySeed, 3);
    // Maize is sown in units; a crop without model data has no seed factor.
    const units: CarbonInputLine = {
      ratePerHa: 2,
      product: {
        name: 'Mais',
        category: 'seed',
        baseUnit: 'unit',
        fertilizerType: null,
      },
    };
    expect(
      operationEmissionsPerHa(op([units]), 'silageMaize').byId.pb4,
    ).toBeCloseTo(
      2 *
        PARAMS.crop.silageMaize.piecesToKg *
        PARAMS.crop.silageMaize.supplySeed,
      3,
    );
    expect(
      operationEmissionsPerHa(op([seed]), 'winterOats').byId.pb4,
    ).toBeUndefined();
  });

  it('books humus, residues, credits and last year’s organic N on the crop cycle', () => {
    const withStraw = cycleEmissionsPerHa({
      crop: 'winterWheat',
      yieldTHa: 8,
      strawRemoved: false,
      nLastYearKgHa: 100,
    }).byId;
    expect(withStraw.pf9).toBeCloseTo(400 * 3.67, 1);
    expect(withStraw.pf10).toBeGreaterThan(0);
    expect(withStraw.pf5a).toBeGreaterThan(0);
    expect(withStraw.pf5b).toBeGreaterThan(0);
    expect(withStraw.pn1a).toBeLessThan(0);
    expect(withStraw.pn2a).toBeLessThan(0);
    expect(withStraw.pf6).toBeCloseTo(10 * 0.01225 * 1.57 * 273, 1);
    expect(withStraw.pb2a).toBeCloseTo(10 * 3.397, 1);
    const removed = cycleEmissionsPerHa({
      crop: 'winterWheat',
      yieldTHa: 8,
      strawRemoved: true,
      nLastYearKgHa: 0,
    }).byId;
    expect(removed.pf5b).toBeUndefined();
    expect(removed.pn1a).toBeUndefined();
    expect(removed.pf5a).toBeCloseTo(withStraw.pf5a!, 3);
    // Silage maize leaves no residues; crops without model data only carry last year's N.
    expect(
      cycleEmissionsPerHa({
        crop: 'silageMaize',
        yieldTHa: 45,
        strawRemoved: false,
        nLastYearKgHa: 0,
      }).byId.pf5a,
    ).toBeUndefined();
    expect(
      Object.keys(
        cycleEmissionsPerHa({
          crop: 'winterOats',
          yieldTHa: 6,
          strawRemoved: false,
          nLastYearKgHa: 0,
        }).byId,
      ),
    ).toEqual([]);
  });

  it('maps every agmeo crop code to a calculator crop', () => {
    const seeded = [
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
    for (const code of seeded) expect(MAPPED_CROP_CODES).toContain(code);
    expect(carbonCrop('winter_wheat')).toBe('winterWheat');
    expect(hasModelData(carbonCrop('winter_oats'))).toBe(false);
    expect(carbonCrop('my_own_crop')).toBeNull();
  });

  it('maps ledger rows of the simplified calculator onto BEK sources', () => {
    expect(bekSource('diesel')).toBe('pb6a');
    expect(bekSource('pf4')).toBe('pf4');
    expect(emissionCategory('pn1a')).toBe('credits');
    expect(emissionCategory('n2o_direct')).toBe('n2o_direct');
  });

  it('lists the factors with their citations', () => {
    const params = calculationParameters();
    const diesel = params.find((p) => p.id === 'ef.diesel')!;
    expect(diesel).toMatchObject({ group: 'fuel', value: 3.013 });
    expect(diesel.source).toBeTruthy();
    expect(
      params.filter((p) => p.group === 'crop' && p.variant === 'winterWheat')
        .length,
    ).toBeGreaterThan(10);
    expect(
      params.find((p) => p.id === 'orgFertParams.cattleSlurry.noIncorporation')
        ?.variant,
    ).toBe('cattleSlurry.noIncorporation');
  });
});
