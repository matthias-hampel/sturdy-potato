import {
  buildJahressumme,
  legalNFertilizerNeed,
  nutzungOfField,
  sumOverSources,
  verfuegbarerNAnteil,
} from './shared/jahressumme.js';

import {
  makeCultivation,
  makeExportData,
  makeField,
  makeHerbstansaat,
  makeMineralFertilization,
  makeOrganicFertilization,
} from './__fixtures__/exportData.js';

describe('Jahressumme', () => {
  test('crop-less fields count towards the Betriebsgröße but not towards the fertilized area', () => {
    const data = makeExportData({
      fields: [
        makeField({ areaInHa: 10 }),
        makeField({
          id: 'gl',
          areaInHa: 4,
          cultivations: [
            makeCultivation({ crop: 'permanentGrasslandWiltedSilage' }),
          ],
        }),
        makeField({ id: 'brache', areaInHa: 1.5, cultivations: [] }),
      ],
    });
    const summe = buildJahressumme(data, {});
    expect(summe).toMatchObject({
      ackerlandHa: 10,
      gruenlandHa: 4,
      sonstigeHa: 0,
      ohneAnbauHa: 1.5,
      flaeche170Ha: 14,
    });
    expect(summe.schlaege.map((s) => s.fieldId)).toEqual(['field-1', 'gl']);
  });

  test("a Herbstansaat's applications count, its (next year's) DBE does not", () => {
    const data = makeExportData({
      fields: [
        makeField({
          areaInHa: 10,
          cultivations: [
            makeCultivation({ areaInHa: 10 }),
            makeHerbstansaat({ areaInHa: 10 }),
          ],
        }),
      ],
    });
    const need = { nFertilizerNeed: 100, isGrassland: false };
    const summe = buildJahressumme(data, {
      'cult-1': need,
      'cult-next': { ...need, nFertilizerNeed: 999 },
    });
    expect(summe.nBedarfKg).toBe(1000);
    // 81 + 105 kg N/ha of the wheat, 0 N but 60 kg P2O5/ha from the autumn PK
    expect(summe.nSummeKg).toBeCloseTo(1860);
    expect(summe.p2o5SummeKg).toBeCloseTo(450 + 600);
    expect(summe.schlaege[0].nutzung).toBe('AL');
  });
});

describe('Jahressumme helpers', () => {
  test('verfuegbarer N: mineral counts in full, organic by Anlage 3 Mindestwirksamkeit', () => {
    expect(verfuegbarerNAnteil(makeMineralFertilization(), 'AL')).toBe(1);
    // Rindergülle: 60 % on Ackerland
    expect(verfuegbarerNAnteil(makeOrganicFertilization(), 'AL')).toBeCloseTo(
      0.6,
    );
  });

  test("Nutzung follows the field's crops", () => {
    expect(nutzungOfField(makeField())).toBe('AL');
    expect(
      nutzungOfField(
        makeField({
          cultivations: [
            makeCultivation({ crop: 'permanentGrasslandWiltedSilage' }),
          ],
        }),
      ),
    ).toBe('GL');
  });

  test('legal N need is the §3 need of the stored DBE', () => {
    expect(
      legalNFertilizerNeed({ nFertilizerNeed: 120, isGrassland: false }),
    ).toBe(120);
    // older snapshots: final need plus the §13a reduction
    expect(
      legalNFertilizerNeed({
        nFertilizerNeedFinal: 96,
        nitrateZoneReduction: 24,
      }),
    ).toBe(120);
    expect(legalNFertilizerNeed({})).toBeUndefined();
  });

  test('farm sums add up the source classes', () => {
    const summe = buildJahressumme(
      makeExportData({ fields: [makeField({ areaInHa: 10 })] }),
      {},
    );
    expect(sumOverSources(summe.sums, 'n')).toBeCloseTo(summe.nSummeKg);
  });
});
