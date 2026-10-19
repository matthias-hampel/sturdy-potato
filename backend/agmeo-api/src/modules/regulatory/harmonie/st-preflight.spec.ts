import { runStPreflightRules, type StOrgMetadata } from './st/index.js';
import type { PreflightResult } from './types.js';

import {
  makeCultivation,
  makeExportData,
  makeField,
  makeSoilSample,
} from './__fixtures__/exportData.js';

const codes = (result: PreflightResult, severity?: string) =>
  result.issues
    .filter((i) => !severity || i.severity === severity)
    .map((i) => i.code);

const complete: StOrgMetadata = {
  betriebsname: 'Hof',
  euBetriebsnummer: '151111111111',
  sitzPlz: '06406',
  sitzOrt: 'Bernburg',
  kreisNr: 89,
  bewirtschaftung: 'k',
  sitzInSt: true,
};

const readyData = () =>
  makeExportData({
    federalState: 'ST',
    fields: [
      makeField({
        flik: 'DESTLI0512340001',
        parcelId: '12',
        soilSamples: [makeSoilSample()],
        cultivations: [
          makeCultivation({
            previousCrop: 'canola',
            sowingDate: new Date('2024-10-01'),
          }),
        ],
      }),
    ],
  });

describe('Sachsen-Anhalt preflight', () => {
  test('complete metadata + data passes', () => {
    const result = runStPreflightRules(
      readyData(),
      complete,
      new Set(['cult-1']),
    );
    expect(result.missingFields).toEqual([]);
    expect(result.missingCropMappings).toEqual([]);
    expect(codes(result, 'blocking')).toEqual([]);
    expect(result.isValid).toBe(true);
  });

  test('asks for every farm field the files need', () => {
    const result = runStPreflightRules(readyData(), {});
    expect(result.missingFields.map((f) => f.key)).toEqual([
      'betriebsname',
      'euBetriebsnummer',
      'sitzPlz',
      'sitzOrt',
      'kreisNr',
      'bewirtschaftung',
    ]);
    expect(
      result.missingFields
        .find((f) => f.key === 'kreisNr')
        ?.options?.map((o) => o.value),
    ).toContain('82');
  });

  test('EU-Betriebsnummer: 12 digits, Land 15 expected for a Betriebssitz in ST', () => {
    expect(
      codes(
        runStPreflightRules(readyData(), {
          ...complete,
          euBetriebsnummer: '276030000000001',
        }),
        'blocking',
      ),
    ).toContain('betriebsnummer_format');
    expect(
      codes(
        runStPreflightRules(readyData(), {
          ...complete,
          euBetriebsnummer: '120000000001',
        }),
        'warning',
      ),
    ).toContain('st_betriebsnummer_land');
    expect(
      codes(
        runStPreflightRules(readyData(), {
          ...complete,
          euBetriebsnummer: '120000000001',
          sitzInSt: false,
        }),
      ),
    ).not.toContain('st_betriebsnummer_land');
  });

  test('Feldblock must be DESTLI + 10 digits, Parzelle numeric, Bundesland ST', () => {
    const data = makeExportData({
      federalState: 'NI',
      fields: [
        makeField({
          flik: 'DENILI1234567890',
          parcelId: 'A-1',
          cultivations: [makeCultivation({ previousCrop: 'canola' })],
        }),
      ],
    });
    const blocking = codes(runStPreflightRules(data, complete), 'blocking');
    expect(blocking).toEqual(
      expect.arrayContaining([
        'st_feldblock_format',
        'st_parzelle_missing',
        'bundesland_mismatch',
      ]),
    );
  });

  test('missing P soil value and missing DBE warn; unmapped crops only when they reach a row', () => {
    const data = makeExportData({
      federalState: 'ST',
      fields: [
        makeField({
          flik: 'DESTLI0512340001',
          parcelId: '1',
          cultivations: [
            makeCultivation({ crop: 'sorghum', previousCrop: 'canola' }),
            makeCultivation({
              cultivationId: 'u',
              crop: 'ryegrassUndersow',
              cropRole: 'UNDERSOW',
              fertilizations: [],
            }),
          ],
        }),
      ],
    });
    const result = runStPreflightRules(data, complete, new Set());
    expect(codes(result, 'warning')).toEqual(
      expect.arrayContaining(['st_p_soil_value_missing', 'st_dbe_missing']),
    );
    expect(result.missingCropMappings.map((m) => m.cropName)).toEqual([
      'sorghum',
    ]);
  });

  test('an override outside Anlage 1 blocks', () => {
    const result = runStPreflightRules(readyData(), {
      ...complete,
      cropCodeOverrides: { winterWheat: '999999' },
    });
    expect(codes(result, 'blocking')).toContain('fruchtart_not_in_stammdaten');
  });
});
