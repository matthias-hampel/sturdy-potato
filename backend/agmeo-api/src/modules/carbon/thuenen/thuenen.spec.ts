/**
 * Thünen RothC: request building, validation, the batch client and the averaging of the five
 * windows (agmeo tests/carbonModeling/{conversion,thunen}.test.ts). The live calls run only with
 * THUENEN_API_KEY set.
 */
import {
  CARBON_SOIL_DEPTH_CM,
  ORGANIC_FERTILIZER_TYPES,
} from '@agmeo/contracts';
import { carbonCrop, MAPPED_CROP_CODES } from '../crops.js';
import { ORGANIC_CATEGORY } from '../emissions.js';
import {
  batchRunRothC,
  RothCError,
  runRothC,
  thuenenConfigured,
} from './client.js';
import {
  getThuenenCodeForCrop,
  getThuenenCodeForOrganicCategory,
} from './codes.js';
import {
  averageRothCResults,
  buildYearDataForInterval,
  createThuenenRequestBody,
  entryToYearData,
  type RotationEntryForSimulation,
  SIMULATION_INTERVALS,
} from './simulation.js';
import {
  type ThuenenRunRRequest,
  ThuenenRunRRequestSchema,
  type ThuenenRunRResponseBatch,
} from './types.js';

const payload: ThuenenRunRRequest = {
  id: '1be6f204-bda3-41ff-8071-fe899fe0fa21',
  name: 'Test_Analysis_3',
  is_active: false,
  carbon_model: {
    id: 1272,
    name: 'HumusKlimaNetz - RothC Modelsystem',
    project_path: 'https://git-bw.thuenen.de/bw/humusbalancerothc',
    git_url: 'https://git-bw.thuenen.de/bw/humusbalancerothc.git',
    branch_name: 'generalisations',
    commit: 'HEAD',
    main_script: '/humusbalancerothc/RothC_cpp/HumKN2RothC.R',
    description: 'Model for carbon turnover in mineral soils',
    maintainer_email: 'konstantin.aiteew@thuenen.de',
  },
  executed_by: 'KA',
  management: {
    years: [
      {
        main_crop: {
          name: '115',
          sowing_month: 1,
          harvest_main: true,
          harvest_residue_main: true,
          harvest_yield: 6.91,
          harvest_month: 7,
        },
        fertilizer: {
          //fertilizer_name: "999999",
          mineral: [{ name: '999999', N_rate: 999999 }],
          organic: [{ name: '9', fert_rate: 5, DM_content: 23, N_content: 3 }],
        },
        secondary_crop: {
          cover_crop: { name: '999999', sowing_month: 9, kill_month: 11 },
          undersown_crop: { name: '999999', sowing_month: 11, kill_month: 9 },
          harvest_sec: true,
        },
        year: 2010,
        tillage: 20,
        irrigation: 10,
      },
      {
        main_crop: {
          name: '121',
          sowing_month: 10,
          harvest_main: true,
          harvest_residue_main: false,
          harvest_yield: 5.08,
          harvest_month: 7,
        },
        fertilizer: {
          //fertilizer_name: "999999",
          mineral: [{ name: '999999', N_rate: 999999 }],
          organic: [{ name: '9', fert_rate: 2, DM_content: 48, N_content: 5 }],
        },
        secondary_crop: {
          cover_crop: { name: '999999', sowing_month: 9, kill_month: 11 },
          undersown_crop: { name: '999999', sowing_month: 9, kill_month: 11 },
          harvest_sec: true,
        },
        year: 2011,
        tillage: 20,
      },
      {
        main_crop: {
          name: '121',
          sowing_month: 10,
          harvest_main: true,
          harvest_residue_main: false,
          harvest_yield: 3.24,
          harvest_month: 7,
        },
        fertilizer: {
          //fertilizer_name: "999999",
          mineral: [{ name: '999999', N_rate: 999999 }],
          organic: [{ name: '9', fert_rate: 5, DM_content: 23, N_content: 3 }],
        },
        secondary_crop: {
          cover_crop: { name: '999999', sowing_month: 9, kill_month: 11 },
          undersown_crop: { name: '999999', sowing_month: 9, kill_month: 11 },
          harvest_sec: true,
        },
        year: 2012,
        tillage: 20,
      },
      {
        main_crop: {
          name: '211',
          sowing_month: 4,
          harvest_main: true,
          harvest_residue_main: false,
          harvest_yield: 3.9,
          harvest_month: 8,
        },
        fertilizer: {
          //fertilizer_name: "999999",
          mineral: [{ name: '999999', N_rate: 999999 }],
          organic: [
            { name: '9', fert_rate: 999999, DM_content: 99, N_content: 2 },
          ],
        },
        secondary_crop: {
          cover_crop: { name: '999999', sowing_month: 9, kill_month: 11 },
          undersown_crop: { name: '999999', sowing_month: 9, kill_month: 11 },
          harvest_sec: true,
        },
        year: 2013,
        tillage: 20,
      },
      {
        main_crop: {
          name: '144',
          sowing_month: 3,
          harvest_main: true,
          harvest_residue_main: false,
          harvest_yield: 3.76,
          harvest_month: 7,
        },
        fertilizer: {
          //fertilizer_name: "999999",
          mineral: [{ name: '999999', N_rate: 999999 }],
          organic: [{ name: '9', fert_rate: 5, DM_content: 23, N_content: 3 }],
        },
        secondary_crop: {
          cover_crop: { name: '999999', sowing_month: 9, kill_month: 11 },
          undersown_crop: { name: '999999', sowing_month: 9, kill_month: 11 },
          harvest_sec: true,
        },
        year: 2014,
        tillage: 20,
      },
      {
        main_crop: {
          name: '431',
          sowing_month: 8,
          harvest_main: true,
          harvest_residue_main: true,
          harvest_yield: 59.125,
          harvest_month: 9,
        },
        fertilizer: {
          //fertilizer_name: "999999",
          mineral: [{ name: '999999', N_rate: 999999 }],
          organic: [{ name: '4', fert_rate: 15, DM_content: 9, N_content: 3 }],
        },
        secondary_crop: {
          cover_crop: { name: '999999', sowing_month: 9, kill_month: 11 },
          undersown_crop: { name: '999999', sowing_month: 9, kill_month: 11 },
          harvest_sec: true,
        },
        year: 2015,
        tillage: 20,
      },
      {
        main_crop: {
          name: '112',
          sowing_month: 10,
          harvest_main: true,
          harvest_residue_main: true,
          harvest_yield: 7.01,
          harvest_month: 7,
        },
        fertilizer: {
          //fertilizer_name: "999999",
          mineral: [{ name: '999999', N_rate: 999999 }],
          organic: [{ name: '0', fert_rate: 5, DM_content: 23, N_content: 3 }],
        },
        secondary_crop: {
          cover_crop: { name: '999999', sowing_month: 9, kill_month: 11 },
          undersown_crop: { name: '999999', sowing_month: 9, kill_month: 11 },
          harvest_sec: true,
        },
        year: 2016,
        tillage: 20,
      },
      {
        main_crop: {
          name: '142',
          sowing_month: 10,
          harvest_main: true,
          harvest_residue_main: true,
          harvest_yield: 7.23,
          harvest_month: 7,
        },
        fertilizer: {
          //fertilizer_name: "999999",
          mineral: [{ name: '999999', N_rate: 999999 }],
          organic: [{ name: '4', fert_rate: 15, DM_content: 9, N_content: 3 }],
        },
        secondary_crop: {
          cover_crop: { name: '999999', sowing_month: 9, kill_month: 11 },
          undersown_crop: { name: '999999', sowing_month: 9, kill_month: 11 },
          harvest_sec: true,
        },
        year: 2017,
        tillage: 20,
      },
      {
        main_crop: {
          name: '181',
          sowing_month: 4,
          harvest_main: true,
          harvest_residue_main: false,
          harvest_yield: 3.52,
          harvest_month: 8,
        },
        fertilizer: {
          // fertilizer_name: "999999",
          mineral: [{ name: '999999', N_rate: 999999 }],
          organic: [{ name: '0', fert_rate: 20, DM_content: 9, N_content: 3 }],
        },
        secondary_crop: {
          cover_crop: { name: '999999', sowing_month: 9, kill_month: 11 },
          undersown_crop: { name: '999999', sowing_month: 9, kill_month: 11 },
          harvest_sec: true,
        },
        year: 2018,
        tillage: 20,
      },
      {
        main_crop: {
          name: '211',
          sowing_month: 4,
          harvest_main: true,
          harvest_residue_main: false,
          harvest_yield: 3,
          harvest_month: 7,
        },
        fertilizer: {
          //fertilizer_name: "999999",
          mineral: [{ name: '999999', N_rate: 999999 }],
          organic: [{ name: '0', fert_rate: 5, DM_content: 23, N_content: 3 }],
        },
        secondary_crop: {
          cover_crop: { name: '999999', sowing_month: 9, kill_month: 11 },
          undersown_crop: { name: '999999', sowing_month: 9, kill_month: 11 },
          harvest_sec: true,
        },
        year: 2019,
        tillage: 20,
      },
      {
        main_crop: {
          name: '112',
          sowing_month: 10,
          harvest_main: true,
          harvest_residue_main: true,
          harvest_yield: 5,
          harvest_month: 7,
        },
        fertilizer: {
          //fertilizer_name: "999999",
          mineral: [{ name: '999999', N_rate: 999999 }],
          organic: [{ name: '0', fert_rate: 20, DM_content: 9, N_content: 3 }],
        },
        secondary_crop: {
          cover_crop: { name: '999999', sowing_month: 9, kill_month: 11 },
          undersown_crop: { name: '999999', sowing_month: 9, kill_month: 11 },
          harvest_sec: true,
        },
        year: 2020,
        tillage: 20,
      },
      {
        main_crop: {
          name: '618',
          sowing_month: 3,
          harvest_main: true,
          harvest_residue_main: false,
          harvest_yield: 30,
          harvest_month: 8,
        },
        fertilizer: {
          //fertilizer_name: "999999",
          mineral: [{ name: '999999', N_rate: 999999 }],
          organic: [{ name: '9', fert_rate: 20, DM_content: 9, N_content: 3 }],
        },
        secondary_crop: {
          cover_crop: { name: '999999', sowing_month: 9, kill_month: 11 },
          undersown_crop: { name: '999999', sowing_month: 9, kill_month: 11 },
          harvest_sec: true,
        },
        year: 2021,
        tillage: 20,
      },
      {
        main_crop: {
          name: '181',
          sowing_month: 4,
          harvest_main: true,
          harvest_residue_main: false,
          harvest_yield: 3.5,
          harvest_month: 7,
        },
        fertilizer: {
          //fertilizer_name: "999999",
          mineral: [{ name: '999999', N_rate: 999999 }],
          organic: [{ name: '9', fert_rate: 20, DM_content: 9, N_content: 3 }],
        },
        secondary_crop: {
          cover_crop: { name: '999999', sowing_month: 9, kill_month: 11 },
          undersown_crop: { name: '999999', sowing_month: 9, kill_month: 11 },
          harvest_sec: true,
        },
        year: 2022,
        tillage: 20,
      },
      {
        main_crop: {
          name: '320',
          sowing_month: 5,
          harvest_main: true,
          harvest_residue_main: false,
          harvest_yield: 2.4,
          harvest_month: 9,
        },
        fertilizer: {
          // fertilizer_name: "999999",
          mineral: [{ name: '999999', N_rate: 999999 }],
          organic: [{ name: '0', fert_rate: 20, DM_content: 9, N_content: 3 }],
        },
        secondary_crop: {
          cover_crop: { name: '999999', sowing_month: 9, kill_month: 11 },
          undersown_crop: { name: '999999', sowing_month: 9, kill_month: 11 },
          harvest_sec: true,
        },
        year: 2023,
        tillage: 20,
      },
      {
        main_crop: {
          name: '1001',
          sowing_month: 10,
          harvest_main: true,
          harvest_residue_main: false,
          harvest_yield: 25,
          harvest_month: 7,
        },
        fertilizer: {
          //fertilizer_name: "999999",
          mineral: [{ name: '999999', N_rate: 999999 }],
          organic: [{ name: '9', fert_rate: 20, DM_content: 9, N_content: 3 }],
        },
        secondary_crop: {
          cover_crop: { name: '999999', sowing_month: 9, kill_month: 11 },
          undersown_crop: { name: '999999', sowing_month: 9, kill_month: 11 },
          harvest_sec: true,
        },
        year: 2024,
        tillage: 20,
      },
    ],
  },
  site: {
    site_name: 'Auernhofen',
    start_year_v: 2010,
    end_year_v: 2024,
    location: 'SRID=4326;POINT (10.088 49.528)',
    skel: 0,
    sample_depth: 22,
    bd_fb: 1.258,
    clay_content: 22.43,
    soc_content: 1.227,
    CN: 10,
    waterlogging: false,
    hasOrganicFarming: false,
    field_name: 'test_field_3',
    field_size: 1,
    sand_content: 30,
  },
};

const soil = {
  depthCm: CARBON_SOIL_DEPTH_CM,
  bulkDensity: 1.258,
  clayPct: 22.43,
  socPct: 1.227,
  sandPct: 30,
};

const entry = (
  position: number,
  cropCode: string,
  extra: Partial<RotationEntryForSimulation> = {},
): RotationEntryForSimulation => ({
  position,
  cropCode,
  sowingMd: '10-10',
  harvestMd: '07-25',
  yieldTHa: 8,
  fertilizers: [],
  catchCrop: null,
  ...extra,
});

describe('Thünen request building', () => {
  it('validates the reference payload', () => {
    expect(ThuenenRunRRequestSchema.safeParse(payload).success).toBe(true);
  });

  it('has a Thünen code for every organic fertilizer type', () => {
    for (const type of ORGANIC_FERTILIZER_TYPES)
      expect(
        getThuenenCodeForOrganicCategory(ORGANIC_CATEGORY[type] ?? 'unknown'),
      ).toBeTruthy();
  });

  const simulated = MAPPED_CROP_CODES.filter((code) => {
    try {
      return Boolean(getThuenenCodeForCrop(carbonCrop(code)!));
    } catch {
      return false;
    }
  });

  it('covers the arable crops', () => {
    for (const code of [
      'winter_wheat',
      'winter_barley',
      'winter_rapeseed',
      'silage_maize',
      'sugar_beet',
      'potatoes',
      'cc_mustard',
    ])
      expect(simulated).toContain(code);
  });

  it.each(simulated)('converts %s into a valid request', (code) => {
    const fertilizers = [
      {
        ratePerHa: 300,
        product: {
          name: 'KAS',
          category: 'fertilizer',
          baseUnit: 'kg' as const,
          fertilizerType: 'can' as const,
          nPct: 27,
        },
      },
      {
        ratePerHa: 20,
        product: {
          name: 'Rindergülle',
          category: 'fertilizer',
          baseUnit: 'm3' as const,
          fertilizerType: 'cattle_slurry' as const,
          nPct: 0.4,
          densityTM3: 1,
          dryMatterPct: 8,
        },
      },
    ];
    const year = entryToYearData(
      entry(0, code, {
        fertilizers,
        catchCrop: {
          code: 'cc_mustard',
          sowingMd: '08-20',
          harvestMd: '03-01',
        },
      }),
    );
    expect(year.main_crop.name).toBeTruthy();
    expect(year.fertilizer?.mineral).toEqual([{ name: 'KAS', N_rate: 81 }]);
    expect(year.fertilizer?.organic?.[0]).toMatchObject({
      name: '0',
      fert_rate: 20,
      DM_content: 8,
      N_content: 80,
    });
    expect(year.secondary_crop?.cover_crop?.name).toBe('619');
    const body = createThuenenRequestBody({
      interval: SIMULATION_INTERVALS[0],
      lat: 52.52,
      lon: 13.405,
      fieldName: 'Kamp',
      soil,
      years: [{ ...year, year: 2020 }],
    });
    const parsed = ThuenenRunRRequestSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('wraps the rotation over the window from the chosen start', () => {
    const years = buildYearDataForInterval(
      [
        entry(0, 'winter_wheat'),
        entry(1, 'winter_rapeseed'),
        entry(2, 'winter_barley'),
      ],
      SIMULATION_INTERVALS[0],
      1,
    );
    expect(years).toHaveLength(10);
    expect(years.map((y) => y.main_crop.name).slice(0, 4)).toEqual([
      '311',
      '131',
      '115',
      '311',
    ]);
    expect(years[0].year).toBe(2011);
  });

  it('refuses crops the service does not know', () => {
    expect(() => entryToYearData(entry(0, 'winter_oats'))).toThrow(
      /No Thünen crop/,
    );
  });
});

function run(start: string, base: number) {
  const t0 = new Date(start);
  return Array.from({ length: 120 }, (_, m) => {
    const d = new Date(t0);
    d.setUTCMonth(d.getUTCMonth() + m);
    return {
      Time_ISO_8601: d.toISOString(),
      SOC_stock_Mg_C_ha_1: base + m / 100,
      SOC_content_percent_C_ha_1: base / 40,
    };
  });
}

describe('RothC results', () => {
  it('averages the windows month by month with min and max', () => {
    const batch: ThuenenRunRResponseBatch = {
      processed_count: 2,
      results: [
        { results: run('2011-01-31T00:00:00Z', 40), warnings: [], errors: [] },
        { results: run('2012-01-31T00:00:00Z', 44), warnings: [], errors: [] },
      ],
    };
    const avg = averageRothCResults(batch);
    expect(avg).toHaveLength(120);
    expect(avg[0]).toMatchObject({
      monthIndex: 1,
      year: 2011,
      SOC_stock_Mg_C_ha_1: 42,
      lower_SOC_stock_Mg_C_ha_1: 40,
      upper_SOC_stock_Mg_C_ha_1: 44,
    });
    expect(avg[119].SOC_stock_Mg_C_ha_1).toBeCloseTo(42 + 1.19, 6);
    expect(() =>
      averageRothCResults({
        processed_count: 1,
        results: [
          {
            results: run('2011-01-31T00:00:00Z', 40).slice(0, 12),
            warnings: [],
            errors: [],
          },
        ],
      }),
    ).toThrow(/Not enough/);
  });
});

describe('Thünen batch client', () => {
  const env = { ...process.env };
  beforeAll(async () => {
    const { config } = await import('../../../config.js');
    if (!config.thuenen.apiKey)
      (config.thuenen as { apiKey: string }).apiKey = 'test-key';
  });
  afterAll(() => {
    process.env = env;
  });

  it('normalises the bracketed column names and checks the count', async () => {
    const body = JSON.stringify({
      processed_count: 1,
      results: [
        {
          results: [
            {
              'Time_[ISO_8601]': '2011-01-31',
              'SOC_stock_[Mg_C_ha-1]': 40,
              'SOC_content_[%_C_ha-1]': 1,
            },
          ],
          warnings: [],
          errors: [],
        },
      ],
    });
    let url = '';
    const fetchMock = (async (u: URL) => {
      url = String(u);
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
    const res = await batchRunRothC([payload], fetchMock);
    expect(url).toContain('/humusbalancerothc/batch?api_key=');
    expect(res.results[0].results[0].SOC_stock_Mg_C_ha_1).toBe(40);
  });

  it('fails on warnings and on HTTP errors', async () => {
    const warn = JSON.stringify({
      processed_count: 1,
      results: [{ results: [], warnings: ['soil'], errors: [] }],
    });
    await expect(
      batchRunRothC(
        [payload],
        (async () => new Response(warn)) as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/warnings/);
    await expect(
      batchRunRothC(
        [payload],
        (async () =>
          new Response('down', { status: 503 })) as unknown as typeof fetch,
      ),
    ).rejects.toBeInstanceOf(RothCError);
  });
});

const live = process.env.THUENEN_API_KEY?.trim() ? describe : describe.skip;

live('Thünen RothC service (live)', () => {
  it('runs one simulation', async () => {
    expect(thuenenConfigured()).toBe(true);
    const response = await runRothC(payload);
    expect(response.data.length).toBeGreaterThan(0);
  });

  it('runs a batch', async () => {
    const response = await batchRunRothC([
      payload,
      {
        ...payload,
        id: '2be6f204-bda3-41ff-8071-fe899fe0fa22',
        name: 'Test_Analysis_4',
      },
    ]);
    expect(response.processed_count).toBe(2);
  });
});
