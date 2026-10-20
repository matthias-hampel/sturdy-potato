/**
 * Humus balance inputs of the calculator (agmeo src/lib/co2calculator/src/utils/humusBalanceCalculator.ts):
 * the crop's humus effect per hectare (VDLUFA, LfL Bayern) and the humus-C supplied with organic
 * fertilizers. The result is kg humus-C/ha; the calculator turns it into pf9/pf10.
 */
import type { FunctionOutput } from './calculator.js';
import { addUnitToDetails } from './cite-sources.js';
import PARAMS, { type Intercrop } from './parameters.js';
import { parametersWithDetails } from './parameters-sources.js';
import type { SupportedCrops } from './types.js';

/** Called once for the main crop and once for a cover crop. */
export function humusBalanceMainOrCoverCrop(
  crop: SupportedCrops | Intercrop,
  incroporationStraw: number,
  yieldInTPerHa: number,
): FunctionOutput {
  if (incroporationStraw < 0 || incroporationStraw > 1)
    throw new Error('incroporationStraw must be between 0 and 1');
  const cropParameter =
    PARAMS.crop[crop as SupportedCrops] || PARAMS.intercrop[crop as Intercrop];
  if (!cropParameter) throw new Error('Crop parameter not found');

  const humusEffectHp = cropParameter.humusMain; // Humus-eq/ha
  const VHN = cropParameter.MPBR; // ratio between yield and straw
  const humusEffectNp = 0; // the by-product is not credited (reference: kept for later)

  if (yieldInTPerHa === 0) {
    const details = addUnitToDetails([
      {
        inputName: crop,
        inputValue: 1,
        inputUnit: 'ha',
        parameters: [
          {
            relationInputParameter: '+',
            parameterValue: humusEffectHp,
            parameterName: `crop.${crop}.humusMain`,
            parameterUnit:
              parametersWithDetails[`crop.${crop}.humusMain`]?.Einheit || '',
          },
        ],
        resultValue: humusEffectHp,
        resultUnit: 'kg humus-c/ha',
        note: '',
      },
    ]);
    return { value: humusEffectHp, details };
  }

  const value =
    humusEffectHp +
    VHN * incroporationStraw * yieldInTPerHa * 10 * humusEffectNp;
  const details = addUnitToDetails([
    {
      inputName: crop,
      inputValue: yieldInTPerHa,
      inputUnit: 't/ha',
      parameters: [
        {
          relationInputParameter: 'x',
          parameterName: 'conv.t.to.dt',
          parameterUnit: '',
          parameterValue: 10,
        },
        {
          relationInputParameter: 'x',
          parameterValue: VHN,
          parameterName: `crop.${crop}.MPBR`,
          parameterUnit: '',
        },
        {
          relationInputParameter: 'x',
          parameterValue: incroporationStraw * 100,
          parameterName: 'incroporationStraw',
          parameterUnit: '%',
        },
        {
          relationInputParameter: 'x',
          parameterValue: humusEffectNp,
          parameterName: `crop.${crop}.humusByproduct`,
          parameterUnit: 'Humus-eq/ha',
        },
        {
          relationInputParameter: '+',
          parameterValue: humusEffectHp,
          parameterName: `crop.${crop}.humusMain`,
          parameterUnit: 'Humus-eq/ha',
        },
      ],
      resultValue: value,
      resultUnit: 'kg humus/ha',
      note: '',
    },
  ]);
  return { value, details };
}

/**
 * Humus-C of an organic fertilizer application. The reference looks the article up by FQN and
 * converts m³ with its density; agmeo passes the product's humus-C per tonne and the fresh mass.
 */
export function humusBalanceOrganicFertilizer(
  productName: string,
  humusCKgPerT: number,
  freshMassTPerHa: number,
): FunctionOutput {
  const value = humusCKgPerT * freshMassTPerHa;
  const details = addUnitToDetails([
    {
      inputName: productName,
      inputValue: freshMassTPerHa,
      inputUnit: 't_ha',
      parameters: [
        {
          relationInputParameter: 'x',
          parameterName: 'fertilizer.humus',
          parameterUnit: 'kg humus/t',
          parameterValue: humusCKgPerT,
        },
      ],
      resultValue: value,
      resultUnit: 'kg humus/ha',
      note: '',
    },
  ]);
  return { value, details };
}
