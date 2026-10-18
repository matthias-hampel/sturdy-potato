/**
 * ENNI export — the field `menge-in-einheit-naehrstofftraeger-pro-ha` must carry
 * the PHYSICAL application amount of the fertilizer in its carrier unit
 * (m³ / t / dt / hl per ha), NOT the nitrogen amount. The amount is resolved
 * once server-side (`resolveCarrier`) and passed through untouched.
 *
 * Verified against the official ENNI_2025 example XML (tests/enni/):
 *   Rindergülle → 20.000000 (m³/ha) ; NPK 12+12+17 → 2.000000 (dt/ha)
 *
 * See finding E-1 in docs/analyse/enni-duev-analyse.md.
 */
import { buildEnniFromExportData } from './enni/builder.js';
import type { ExportData, ExportFertilization } from './types.js';

import {
  makeCultivation,
  makeExportData,
  makeField,
  makeOrganicFertilization,
} from './__fixtures__/exportData.js';

function makeData(fert: Partial<ExportFertilization>): ExportData {
  return makeExportData({
    integrations: { enni: { betriebsnummer: '0123456789' } },
    fields: [
      makeField({
        id: 'f1',
        name: 'Feld 1',
        areaInHa: 5,
        parcelId: null,
        flik: null,
        cultivations: [
          makeCultivation({
            cultivationId: 'c1',
            cultivationGroupId: 'g1',
            areaInHa: 5,
            fertilizations: [
              makeOrganicFertilization({
                date: new Date('2025-03-02'),
                nKgPerHa: 100,
                n: 4,
                nh4: 2,
                p2o5: 1.5,
                k2o: 4,
                mgo: 1,
                ...fert,
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

const menge = (data: ExportData) =>
  buildEnniFromExportData(data).duengebedarf.schlaege[0].anbauten![0]
    .duengungen![0]['menge-in-einheit-naehrstofftraeger-pro-ha'];

describe('ENNI menge-in-einheit-naehrstofftraeger-pro-ha', () => {
  test('Rindergülle 25 m³/ha → 25, nicht der N-Gehalt (100)', () => {
    expect(menge(makeData({}))).toBe('25.0000');
  });

  test('Mineraldünger 200 kg/ha → 2 dt/ha (ENNI-Trägereinheit)', () => {
    const d = menge(
      makeData({
        articleId: 'MINERAL__NPK',
        articleFqn: 'MINERAL__NPK',
        fertilizerName: 'NPK 12+12+17',
        fqnPrefix: 'MINERAL',
        naehrstofftraegerart: 'MINERALDUENGER',
        quantity: 200,
        unit: 'kg_ha',
        carrierAmountPerHa: 2,
        nKgPerHa: 24,
      }),
    );
    expect(d).toBe('2.0000');
  });
});
